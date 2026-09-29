#!/usr/bin/env python3
"""Бета-сервер для десктоп-приложения "Ye!Studio".

Только стандартная библиотека Python 3 (совместимость с 3.9+).
Эндпоинты:
  GET  /api/ping?id=<installId>&v=<version>     — статистика запусков (installs.json)
  GET  /api/control?id=<installId>&v=<version>  — то же для установок 0.2.0-beta.1; всегда «не выключен»
  POST /api/errors
  POST /api/feedback
  GET/HEAD /updates/<file>
  GET  /api/pack-index                          — дата и размер базы повторов
  POST /api/pack-check                          — проверить вопросы пака по базе повторов (packindex/)
  GET  /health
Отзывы игроков на Уе!паки (публичные, без ключа; reviews/):
  GET  /  и  /<пак>                             — страница «айсберга» (reviews/web/)
  GET  /s/<file>, /p/<пак>/<file>               — её скрипты и миниатюры вопросов
  GET  /api/review/packs, /api/review/pack/<пак>, /api/review/board/<пак>
  POST /api/review                              — порция ответов игрока
  GET  /api/review/export/<пак>                 — выгрузка для автора (заголовок X-Review-Admin)
  GET  /api/review/installs                     — сводка по установкам без id и ip (тот же заголовок X-Review-Admin)
  GET  /api/review/errors?days=30               — ошибки приложения, сгруппированные, без id установок (X-Review-Admin)
  GET  /api/review/feedback?days=90             — обращения игроков (X-Review-Admin)
  GET  /api/review/feedback/<ключ>/screenshot|log — снимок / лог обращения (X-Review-Admin)

Запуск:
  python3 yestudio_server.py
Переменные окружения:
  YES_HOST (default 0.0.0.0)
  YES_PORT (default 8787)
  YES_DATA (default /opt/yestudio/data)
  YES_PACKINDEX (default $YES_DATA/packindex/index.sqlite)
"""

from __future__ import annotations

import base64
import hmac
import io
import json
import os
import re
import signal
import socket
import sys
import tempfile
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "packindex"))
try:
    import packlib  # база повторов: нормализация, хеши, проверка (server/packindex/packlib.py)
except ImportError:  # сервер без packindex/ продолжает работать, проверка отвечает 503
    packlib = None

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "reviews"))
try:
    import reviews  # отзывы игроков (server/reviews/reviews.py)
except ImportError:
    reviews = None
REVIEWS_WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reviews", "web")

# ---------------------------------------------------------------------------
# Конфигурация
# ---------------------------------------------------------------------------

HOST = os.environ.get("YES_HOST", "0.0.0.0")
PORT = int(os.environ.get("YES_PORT", "8787"))
DATA_DIR = os.environ.get("YES_DATA", "/opt/yestudio/data")
PACKINDEX = os.environ.get("YES_PACKINDEX", os.path.join(DATA_DIR, "packindex", "index.sqlite"))

API_KEY_HEADER = "X-YeStudio-Key"
API_KEY_VALUE = "yes-beta-2026"

MAX_BODY_BYTES = 4 * 1024 * 1024  # 4 МБ
# Лимиты на один IP: (сколько запросов, за сколько секунд). Клиент сам шлёт ping раз в 15 мин и ошибки
# раз в 10 мин — запас на несколько установок за одним IP (дом, общежитие), но не на поток мусора.
RATE_LIMITS = {
    "ping": (30, 3600),
    "errors": (30, 3600),
    "feedback": (5, 3600),
    "packcheck": (60, 3600),    # проверка пака по кнопке: с запасом на правку и перепроверку
    "packinfo": (120, 3600),
    # страница отзывов шлёт ответы порциями не чаще раза в 4 с; 900/ч — компания игроков за одним роутером
    "review": (900, 3600),
    "reviewread": (900, 3600),
}
RATE_LIMIT_WINDOW_SEC = max(w for _, w in RATE_LIMITS.values())

MAX_TEXT_LEN = 10000
MAX_MESSAGE_LEN = 2000
MAX_STACK_LEN = 8000
MAX_ITEMS = 500

# /api/pack-check: пак «Своей игры» — сотни вопросов; больше 3000 — не пак, а попытка выкачать базу
MAX_CHECK_QUESTIONS = 3000
MAX_CHECK_TEXT = 4000
MAX_CHECK_ANSWERS = 10
MAX_CHECK_MEDIA = 20
_check_slots = threading.BoundedSemaphore(2)  # не больше 2 проверок одновременно — рядом VPN и сайт

CHUNK_SIZE = 256 * 1024  # 256 КБ при раздаче файлов обновлений

SOCKET_TIMEOUT = 30

# ---------------------------------------------------------------------------
# Утилиты
# ---------------------------------------------------------------------------


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def log(line: str) -> None:
    # Одна строка, без тел запросов — journald заберёт stdout.
    sys.stdout.write(line.rstrip("\n") + "\n")
    sys.stdout.flush()


def ensure_dirs() -> None:
    for sub in ("", "errors", "feedback", "updates"):
        p = os.path.join(DATA_DIR, sub) if sub else DATA_DIR
        os.makedirs(p, exist_ok=True)


_write_lock = threading.Lock()


def atomic_write_json(path: str, data) -> None:
    """Атомарная запись JSON: временный файл в той же директории + os.replace."""
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".tmp-", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise


def read_json_safe(path: str, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def append_jsonl(path: str, obj) -> None:
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    with _write_lock:
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(obj, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------------------
# Rate limiting (в памяти, по IP)
# ---------------------------------------------------------------------------

_rate_lock = threading.Lock()
_rate_buckets: dict[str, list[float]] = {}


def rate_limit_ok(ip: str, kind: str = "ping") -> bool:
    limit, window = RATE_LIMITS[kind]
    now = time.time()
    with _rate_lock:
        bucket = _rate_buckets.setdefault(f"{kind}:{ip}", [])
        cutoff = now - window
        while bucket and bucket[0] < cutoff:
            bucket.pop(0)
        if len(bucket) >= limit:
            return False
        bucket.append(now)
        return True


# Изредка подчищаем старые бакеты, чтобы не течь памятью.
def _gc_rate_buckets() -> None:
    while True:
        time.sleep(300)
        now = time.time()
        cutoff = now - RATE_LIMIT_WINDOW_SEC
        with _rate_lock:
            dead = []
            for ip, bucket in _rate_buckets.items():
                while bucket and bucket[0] < cutoff:
                    bucket.pop(0)
                if not bucket:
                    dead.append(ip)
            for ip in dead:
                del _rate_buckets[ip]


# ---------------------------------------------------------------------------
# installs.json (последний раз видели)
# ---------------------------------------------------------------------------

_installs_lock = threading.Lock()


def touch_install(install_id: str, version: str, ip: str) -> None:
    path = os.path.join(DATA_DIR, "installs.json")
    with _installs_lock:
        data = read_json_safe(path, {})
        if not isinstance(data, dict):
            data = {}
        entry = data.get(install_id)
        ts = now_iso()
        if entry and isinstance(entry, dict):
            entry["last"] = ts
            entry["v"] = version
            entry["ip"] = ip
            if "first" not in entry:
                entry["first"] = ts
        else:
            entry = {"first": ts, "last": ts, "v": version, "ip": ip}
        data[install_id] = entry
        atomic_write_json(path, data)


def _parse_iso(value):
    """ISO-время (в том числе с «Z») → aware datetime в UTC или None."""
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def installs_summary() -> dict:
    """Только агрегаты по installs.json: ни id установок, ни ip наружу не идут."""
    data = read_json_safe(os.path.join(DATA_DIR, "installs.json"), {})
    if not isinstance(data, dict):
        data = {}
    now = datetime.now(timezone.utc)
    active = {"1d": 0, "7d": 0, "30d": 0}
    by_version: dict[str, int] = {}
    first_by_day: dict[str, int] = {}
    total = 0
    for entry in data.values():
        if not isinstance(entry, dict):
            continue
        total += 1
        v = str(entry.get("v") or "?")[:32]
        by_version[v] = by_version.get(v, 0) + 1
        first = _parse_iso(entry.get("first"))
        if first:
            day = first.astimezone(timezone.utc).strftime("%Y-%m-%d")
            first_by_day[day] = first_by_day.get(day, 0) + 1
        last = _parse_iso(entry.get("last"))
        if last:
            age = (now - last).total_seconds()
            for key, days in (("1d", 1), ("7d", 7), ("30d", 30)):
                if age <= days * 86400:
                    active[key] += 1
    return {
        "total": total,
        "active": active,
        "byVersion": dict(sorted(by_version.items(), key=lambda kv: -kv[1])),
        "firstByDay": dict(sorted(first_by_day.items())),
        "generatedAt": now_iso(),
    }


def _days_param(qs: dict, default: int, maximum: int) -> int:
    try:
        days = int((qs.get("days") or [default])[0])
    except (TypeError, ValueError):
        days = default
    return max(1, min(days, maximum))


def errors_summary(days: int) -> dict:
    """Ошибки приложения за days дней из errors/<ГГГГ-ММ>.jsonl, сгруппированные по (тип, первая строка сообщения).
    Id установок наружу не идут — только число разных."""
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)
    months = []
    y, m = cutoff.year, cutoff.month
    while (y, m) <= (now.year, now.month):
        months.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    total = 0
    by_version: dict[str, int] = {}
    by_os: dict[str, int] = {}
    groups: dict[tuple, dict] = {}
    for month in months:
        path = os.path.join(DATA_DIR, "errors", f"{month}.jsonl")
        try:
            f = open(path, "r", encoding="utf-8")
        except OSError:
            continue
        with f:
            for line in f:
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                if not isinstance(rec, dict):
                    continue
                when = _parse_iso(rec.get("received")) or _parse_iso(rec.get("ts"))
                if not when or when < cutoff:
                    continue
                total += 1
                v = str(rec.get("v") or "?")[:32]
                o = str(rec.get("os") or "?")[:64]
                by_version[v] = by_version.get(v, 0) + 1
                by_os[o] = by_os.get(o, 0) + 1
                kind = str(rec.get("kind") or "")[:128]
                msg = str(rec.get("message") or "").strip().split("\n", 1)[0][:300]
                g = groups.get((kind, msg))
                if g is None:
                    g = groups[(kind, msg)] = {"message": msg, "kind": kind, "count": 0, "ids": set(),
                                               "versions": set(), "first": None, "last": None, "sample": None}
                g["count"] += 1
                g["ids"].add(str(rec.get("id") or ""))
                g["versions"].add(v)
                stamp = when.isoformat()
                if g["first"] is None or stamp < g["first"]:
                    g["first"] = stamp
                if g["last"] is None or stamp >= g["last"]:
                    g["last"] = stamp
                    sample = {k: rec.get(k) for k in ("received", "v", "os", "ts", "where", "kind", "message", "stack", "count")}
                    if isinstance(sample.get("stack"), str):
                        sample["stack"] = sample["stack"][:4000]
                    g["sample"] = sample
    out = []
    for g in sorted(groups.values(), key=lambda g: -g["count"])[:50]:
        out.append({"message": g["message"], "kind": g["kind"], "count": g["count"], "installs": len(g["ids"]),
                    "versions": sorted(g["versions"]), "first": g["first"], "last": g["last"], "sample": g["sample"]})
    return {
        "days": days,
        "total": total,
        "byVersion": dict(sorted(by_version.items(), key=lambda kv: -kv[1])),
        "byOs": dict(sorted(by_os.items(), key=lambda kv: -kv[1])),
        "groups": out,
        "generatedAt": now_iso(),
    }


FEEDBACK_KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_FEEDBACK_SHOTS = (("screenshot.png", "image/png"), ("screenshot.jpg", "image/jpeg"))


def _feedback_folder(key: str):
    """Папка обращения по ключу или None. Ключ — только безопасные символы, папка обязана лежать внутри feedback/."""
    if not FEEDBACK_KEY_RE.match(key or ""):
        return None
    root = os.path.realpath(os.path.join(DATA_DIR, "feedback"))
    folder = os.path.realpath(os.path.join(root, key))
    if os.path.dirname(folder) != root or not os.path.isdir(folder):
        return None
    return folder


def _feedback_shot(folder: str):
    for name, ctype in _FEEDBACK_SHOTS:
        p = os.path.join(folder, name)
        if os.path.isfile(p):
            return p, ctype
    return None


def feedback_list(days: int) -> dict:
    """Обращения игроков за days дней, новые сверху, до 100. Id установки наружу не идёт."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    root = os.path.join(DATA_DIR, "feedback")
    try:
        names = sorted(os.listdir(root), reverse=True)
    except OSError:
        names = []
    items = []
    for key in names:
        if len(items) >= 100:
            break
        folder = _feedback_folder(key)
        if not folder:
            continue
        meta = read_json_safe(os.path.join(folder, "feedback.json"), None)
        if not isinstance(meta, dict):
            continue
        when = _parse_iso(meta.get("received"))
        if when and when < cutoff:
            continue
        items.append({
            "key": key,
            "date": meta.get("received"),
            "v": str(meta.get("v") or "")[:64],
            "os": str(meta.get("os") or "")[:64],
            "text": str(meta.get("text") or ""),
            "contact": meta.get("contact") or None,
            "hasLog": bool(meta.get("log")),
            "hasScreenshot": _feedback_shot(folder) is not None,
        })
    return {"items": items}


# ---------------------------------------------------------------------------
# Валидация
# ---------------------------------------------------------------------------

SAFE_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,128}$")


def clamp_str(value, max_len: int) -> str:
    if not isinstance(value, str):
        return ""
    return value[:max_len]


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------


class Handler(BaseHTTPRequestHandler):
    server_version = "YeStudioBeta/1.0"
    protocol_version = "HTTP/1.1"

    # --- служебное -----------------------------------------------------

    def log_message(self, fmt, *args):  # переопределяем, лог в одну строку
        log(f'{self.client_address[0]} "{self.command} {self.path}" {fmt % args}')

    def _client_ip(self) -> str:
        # Страницу отзывов отдаёт nginx по домену: тогда настоящий адрес — в X-Real-IP.
        # Верим заголовку, только если соединение пришло с этой же машины.
        ip = self.client_address[0]
        if ip in ("127.0.0.1", "::1"):
            return (self.headers.get("X-Real-IP") or ip).strip()[:64]
        return ip

    def _send_json(self, status: int, payload) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_text(self, status: int, text: str, content_type: str = "text/plain; charset=utf-8") -> None:
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _check_api_key(self) -> bool:
        return self.headers.get(API_KEY_HEADER) == API_KEY_VALUE

    def _read_body(self) -> bytes:
        length_header = self.headers.get("Content-Length")
        if length_header is None:
            raise ApiError(HTTPStatus.LENGTH_REQUIRED, "Content-Length required")
        try:
            length = int(length_header)
        except ValueError:
            raise ApiError(HTTPStatus.BAD_REQUEST, "bad Content-Length")
        if length < 0:
            raise ApiError(HTTPStatus.BAD_REQUEST, "bad Content-Length")
        if length > MAX_BODY_BYTES:
            raise ApiError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "body too large")
        data = self.rfile.read(length)
        if len(data) != length:
            raise ApiError(HTTPStatus.BAD_REQUEST, "truncated body")
        return data

    def _read_json_body(self) -> dict:
        raw = self._read_body()
        try:
            obj = json.loads(raw.decode("utf-8"))
        except Exception:
            raise ApiError(HTTPStatus.BAD_REQUEST, "invalid JSON")
        if not isinstance(obj, dict):
            raise ApiError(HTTPStatus.BAD_REQUEST, "invalid JSON")
        return obj

    # --- маршрутизация --------------------------------------------------

    def do_GET(self):
        self._route()

    def do_HEAD(self):
        self._route()

    def do_POST(self):
        self._route()

    def _route(self):
        try:
            parsed = urlsplit(self.path)
            path = parsed.path

            if path == "/health":
                self._send_text(HTTPStatus.OK, "ok")
                return

            if path.startswith("/updates/"):
                self._handle_updates(path[len("/updates/"):])
                return

            if path in ("/api/ping", "/api/control") and self.command == "GET":
                self._require_key_and_rate("ping")
                self._handle_ping(parsed)
                return

            if path == "/api/errors" and self.command == "POST":
                self._require_key_and_rate("errors")
                self._handle_errors()
                return

            if path == "/api/feedback" and self.command == "POST":
                self._require_key_and_rate("feedback")
                self._handle_feedback()
                return

            if path == "/api/pack-index" and self.command == "GET":
                self._require_key_and_rate("packinfo")
                self._handle_pack_index()
                return

            if path == "/api/pack-check" and self.command == "POST":
                self._require_key_and_rate("packcheck")
                self._handle_pack_check()
                return

            if self._route_reviews(path):
                return

            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
        except ApiError as e:
            try:
                self._send_json(e.status, {"error": e.message})
            except Exception:
                pass
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:  # noqa: BLE001
            log(f"ERROR {type(e).__name__}: {e}")
            try:
                self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "internal error"})
            except Exception:
                pass

    def _require_key_and_rate(self, kind: str):
        if not self._check_api_key():
            raise ApiError(HTTPStatus.FORBIDDEN, "forbidden")
        if not rate_limit_ok(self._client_ip(), kind):
            raise ApiError(HTTPStatus.TOO_MANY_REQUESTS, "rate limit")

    # --- /api/ping (и старый /api/control) -------------------------------
    # Выключения по команде больше нет: только отмечаем, когда установку видели последний раз.
    # /api/control оставлен для установок 0.2.0-beta.1 — они ждут ответ {"disabled": ...}.

    def _handle_ping(self, parsed):
        qs = parse_qs(parsed.query)
        install_id = clamp_str((qs.get("id") or [""])[0], 128)
        version = clamp_str((qs.get("v") or [""])[0], 64)
        if install_id and SAFE_ID_RE.match(install_id):
            try:
                touch_install(install_id, version, self._client_ip())
            except Exception as e:  # noqa: BLE001
                log(f"WARN installs.json write failed: {e}")
        self._send_json(HTTPStatus.OK, {"ok": True, "disabled": False})

    # --- /api/errors --------------------------------------------------

    def _handle_errors(self):
        body = self._read_json_body()

        install_id = clamp_str(body.get("id"), 128)
        version = clamp_str(body.get("v"), 64)
        os_name = clamp_str(body.get("os"), 64)
        items = body.get("items")
        if not isinstance(items, list):
            items = []
        items = items[:MAX_ITEMS]

        month_key = datetime.now(timezone.utc).strftime("%Y-%m")
        out_path = os.path.join(DATA_DIR, "errors", f"{month_key}.jsonl")

        received = now_iso()
        for item in items:
            if not isinstance(item, dict):
                continue
            record = {
                "received": received,
                "id": install_id,
                "v": version,
                "os": os_name,
                "ts": clamp_str(item.get("ts"), 64),
                "where": clamp_str(item.get("where"), 256),
                "kind": clamp_str(item.get("kind"), 128),
                "message": clamp_str(item.get("message"), MAX_MESSAGE_LEN),
                "stack": clamp_str(item.get("stack"), MAX_STACK_LEN) if item.get("stack") else None,
                "count": item.get("count") if isinstance(item.get("count"), (int, float)) else None,
            }
            append_jsonl(out_path, record)

        self._send_json(HTTPStatus.OK, {"ok": True})

    # --- /api/feedback --------------------------------------------------

    def _handle_feedback(self):
        body = self._read_json_body()

        install_id = clamp_str(body.get("id"), 128)
        version = clamp_str(body.get("v"), 64)
        os_name = clamp_str(body.get("os"), 64)
        text = clamp_str(body.get("text"), MAX_TEXT_LEN)
        contact = clamp_str(body.get("contact"), 512) if body.get("contact") else None
        log_text = clamp_str(body.get("log"), MAX_TEXT_LEN) if body.get("log") else None

        screenshot_b64 = body.get("screenshot")
        screenshot_type = body.get("screenshotType")
        if screenshot_type not in ("png", "jpeg"):
            screenshot_type = "png"

        ts = datetime.now(timezone.utc)
        stamp = ts.strftime("%Y%m%d-%H%M%S")
        short_id = re.sub(r"[^A-Za-z0-9._-]", "_", install_id[:8]) if install_id else "unknown"
        # Не даём пересечься параллельным отправкам с одинаковой секундой/id.
        folder_name = f"{stamp}-{short_id}-{uuid.uuid4().hex[:6]}"
        folder = os.path.join(DATA_DIR, "feedback", folder_name)
        os.makedirs(folder, exist_ok=True)

        meta = {
            "id": install_id,
            "v": version,
            "os": os_name,
            "text": text,
            "contact": contact,
            "log": log_text,
            "received": now_iso(),
        }
        atomic_write_json(os.path.join(folder, "feedback.json"), meta)

        if isinstance(screenshot_b64, str) and screenshot_b64:
            try:
                # Допускаем data: префикс.
                raw_b64 = screenshot_b64
                if "," in raw_b64 and raw_b64.strip().startswith("data:"):
                    raw_b64 = raw_b64.split(",", 1)[1]
                img_bytes = base64.b64decode(raw_b64, validate=False)
                ext = "png" if screenshot_type == "png" else "jpg"
                shot_path = os.path.join(folder, f"screenshot.{ext}")
                with open(shot_path, "wb") as f:
                    f.write(img_bytes)
            except Exception as e:  # noqa: BLE001
                log(f"WARN feedback screenshot decode failed: {e}")

        self._send_json(HTTPStatus.OK, {"ok": True})

    # --- /api/pack-index, /api/pack-check ---------------------------------
    # Текст вопросов приходит в теле и нигде не сохраняется и не пишется в лог (пак может быть неизданным).

    def _open_packindex(self):
        if packlib is None or not os.path.isfile(PACKINDEX):
            raise ApiError(HTTPStatus.SERVICE_UNAVAILABLE, "pack index not ready")
        # Новое соединение на запрос: таймер подменяет файл целиком (os.replace), и следующий запрос
        # сразу видит новую базу без перезапуска сервиса.
        db = packlib.open_index(PACKINDEX, readonly=True, cache_mb=16)
        if not packlib.index_compatible(db):
            db.close()
            raise ApiError(HTTPStatus.SERVICE_UNAVAILABLE, "pack index not ready")
        return db

    def _handle_pack_index(self):
        db = self._open_packindex()
        try:
            info = packlib.index_info(db)
        finally:
            db.close()
        self._send_json(HTTPStatus.OK, info)

    def _handle_pack_check(self):
        body = self._read_json_body()
        raw = body.get("questions")
        if not isinstance(raw, list) or not raw:
            raise ApiError(HTTPStatus.BAD_REQUEST, "questions required")
        if len(raw) > MAX_CHECK_QUESTIONS:
            raise ApiError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "too many questions")
        questions = []
        for q in raw:
            if not isinstance(q, dict):
                q = {}
            answers = q.get("answers") if isinstance(q.get("answers"), list) else []
            media = q.get("media") if isinstance(q.get("media"), list) else []
            questions.append({
                "text": clamp_str(q.get("text"), MAX_CHECK_TEXT),
                "answers": [clamp_str(a, 500) for a in answers[:MAX_CHECK_ANSWERS] if isinstance(a, str)],
                "media": [m for m in media[:MAX_CHECK_MEDIA] if isinstance(m, str) and packlib and packlib.FP_RE.match(m)],
            })
        exclude = body.get("exclude") if isinstance(body.get("exclude"), list) else []
        exclude = [x for x in exclude[:50] if isinstance(x, int) or (isinstance(x, str) and x.isdigit())]
        if not _check_slots.acquire(timeout=20):
            raise ApiError(HTTPStatus.SERVICE_UNAVAILABLE, "busy")
        try:
            db = self._open_packindex()
            try:
                t0 = time.time()
                result = packlib.check(db, questions, exclude)
                result["index"] = packlib.index_info(db)
            finally:
                db.close()
        finally:
            _check_slots.release()
        log(f"pack-check: {len(questions)} вопросов, совпадений {len(result['results'])}, {int((time.time() - t0) * 1000)} мс")
        self._send_json(HTTPStatus.OK, result)

    # --- отзывы игроков ----------------------------------------------------

    def _route_reviews(self, path: str) -> bool:
        """True, если запрос про отзывы и уже обработан."""
        if reviews is None:
            return False
        get = self.command in ("GET", "HEAD")
        if get and (path == "/" or re.match(r"^/[a-z0-9-]{1,32}/?$", path)):
            self._send_static(os.path.join(REVIEWS_WEB, "index.html"), no_cache=True)
            return True
        if get and path.startswith("/s/"):
            name = path[3:]
            if re.match(r"^[a-z0-9._-]{1,64}$", name) and not name.startswith("."):
                self._send_static(os.path.join(REVIEWS_WEB, name))
            else:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return True
        m = re.match(r"^/p/([^/]+)/([^/]+)$", path)
        if get and m:
            found = review_store().pack_file(m.group(1), m.group(2))
            if found:
                self._send_static(found, max_age=86400)
            else:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return True
        if not path.startswith("/api/review"):
            return False

        store = review_store()
        if path == "/api/review" and self.command == "POST":
            if not rate_limit_ok(self._client_ip(), "review"):
                raise ApiError(HTTPStatus.TOO_MANY_REQUESTS, "rate limit")
            body = self._read_json_body()
            if body.get("website"):  # поле-ловушка: человек его не видит, бот заполняет
                self._send_json(HTTPStatus.OK, {"depth": 0, "deeperThan": 0, "divers": 0})
                return True
            try:
                res = store.save(str(body.get("pack", "")), str(body.get("pid", "")), body.get("answers") or {},
                                 body.get("nick"), body.get("score"), self._client_ip())
            except reviews.Invalid as e:
                raise ApiError(HTTPStatus.BAD_REQUEST, f"invalid: {e}")
            self._send_json(HTTPStatus.OK, res)
            return True
        if not get:
            return False
        if not rate_limit_ok(self._client_ip(), "reviewread"):
            raise ApiError(HTTPStatus.TOO_MANY_REQUESTS, "rate limit")
        if path == "/api/review/packs":
            self._send_json(HTTPStatus.OK, {"packs": store.packs()})
            return True
        if path == "/api/review/installs":
            self._require_review_admin(store)
            self._send_json(HTTPStatus.OK, installs_summary())
            return True
        if path == "/api/review/errors":
            self._require_review_admin(store)
            qs = parse_qs(urlsplit(self.path).query)
            self._send_json(HTTPStatus.OK, errors_summary(_days_param(qs, 30, 90)))
            return True
        if path == "/api/review/feedback":
            self._require_review_admin(store)
            qs = parse_qs(urlsplit(self.path).query)
            self._send_json(HTTPStatus.OK, feedback_list(_days_param(qs, 90, 365)))
            return True
        m = re.match(r"^/api/review/feedback/([^/]+)/(screenshot|log)$", path)
        if m:
            self._require_review_admin(store)
            folder = _feedback_folder(m.group(1))
            if not folder:
                raise ApiError(HTTPStatus.BAD_REQUEST, "bad key")
            if m.group(2) == "screenshot":
                shot = _feedback_shot(folder)
                if not shot:
                    raise ApiError(HTTPStatus.NOT_FOUND, "no screenshot")
                with open(shot[0], "rb") as f:
                    self._send_bytes(f.read(), shot[1])
            else:
                meta = read_json_safe(os.path.join(folder, "feedback.json"), None)
                log_text = meta.get("log") if isinstance(meta, dict) else None
                if not log_text:
                    raise ApiError(HTTPStatus.NOT_FOUND, "no log")
                self._send_text(HTTPStatus.OK, str(log_text))
            return True
        m = re.match(r"^/api/review/(pack|board|export)/([^/]+)$", path)
        if not m:
            return False
        kind, slug = m.groups()
        got = store.manifest(slug)
        if not got:
            raise ApiError(HTTPStatus.NOT_FOUND, "no such pack")
        if kind == "pack":
            self._send_bytes(got[1], "application/json; charset=utf-8", max_age=300)
        elif kind == "board":
            self._send_json(HTTPStatus.OK, {"board": store.board(slug)})
        else:
            token = self.headers.get("X-Review-Admin") or ""
            if not hmac.compare_digest(token.encode(), store.admin_token().encode()):
                raise ApiError(HTTPStatus.FORBIDDEN, "forbidden")
            self._send_json(HTTPStatus.OK, store.export(slug))
        return True

    def _require_review_admin(self, store) -> None:
        token = self.headers.get("X-Review-Admin") or ""
        if not hmac.compare_digest(token.encode(), store.admin_token().encode()):
            raise ApiError(HTTPStatus.FORBIDDEN, "forbidden")

    STATIC_TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
                    ".css": "text/css; charset=utf-8", ".webp": "image/webp", ".png": "image/png",
                    ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8",
                    ".ico": "image/x-icon", ".webmanifest": "application/manifest+json"}

    def _send_bytes(self, body: bytes, content_type: str, max_age: int = 0, no_cache: bool = False) -> None:
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache" if no_cache else f"public, max-age={max_age}")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        if content_type.startswith("text/html"):
            self.send_header("Content-Security-Policy",
                             "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
                             "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_static(self, path: str, max_age: int = 300, no_cache: bool = False) -> None:
        ctype = self.STATIC_TYPES.get(os.path.splitext(path)[1].lower())
        if not ctype or not os.path.isfile(path):
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        with open(path, "rb") as f:
            self._send_bytes(f.read(), ctype, max_age=max_age, no_cache=no_cache)

    # --- /updates/<file> --------------------------------------------------

    def _handle_updates(self, rel_name: str):
        # rel_name без ведущего слэша (мы его срезали в _route).
        if not rel_name or ".." in rel_name or "/" in rel_name or "\\" in rel_name:
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        if os.path.isabs(rel_name):
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return

        updates_dir = os.path.realpath(os.path.join(DATA_DIR, "updates"))
        candidate = os.path.realpath(os.path.join(updates_dir, rel_name))

        # Защита от выхода за пределы updates_dir (realpath + проверка префикса).
        if os.path.commonpath([updates_dir, candidate]) != updates_dir:
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return

        if not os.path.isfile(candidate):
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return

        file_size = os.path.getsize(candidate)
        content_type = self._guess_content_type(rel_name)

        range_header = self.headers.get("Range")
        if range_header:
            self._serve_range(candidate, file_size, content_type, range_header)
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(file_size))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        if self.command == "HEAD":
            return
        self._stream_file(candidate, 0, file_size - 1)

    @staticmethod
    def _guess_content_type(name: str) -> str:
        lower = name.lower()
        if lower.endswith(".yml") or lower.endswith(".yaml"):
            return "text/yaml; charset=utf-8"
        if lower.endswith(".exe"):
            return "application/octet-stream"
        if lower.endswith(".blockmap"):
            return "application/octet-stream"
        if lower.endswith(".zip"):
            return "application/zip"
        if lower.endswith(".json"):
            return "application/json; charset=utf-8"
        return "application/octet-stream"

    def _serve_range(self, path: str, file_size: int, content_type: str, range_header: str) -> None:
        # Поддерживаем один диапазон "bytes=start-end"; на мульти-диапазонный
        # запрос отвечаем целым файлом 200 (простой и корректный вариант).
        m = re.match(r"^bytes=(\d*)-(\d*)$", range_header.strip())
        if not m or "," in range_header:
            # Множественный диапазон или некорректный формат — отдаём весь файл.
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(file_size))
            self.send_header("Accept-Ranges", "bytes")
            self.end_headers()
            if self.command != "HEAD":
                self._stream_file(path, 0, file_size - 1)
            return

        start_s, end_s = m.group(1), m.group(2)
        if start_s == "" and end_s == "":
            self._send_range_not_satisfiable(file_size)
            return

        if start_s == "":
            # suffix range: последние N байт
            length = int(end_s)
            if length <= 0:
                self._send_range_not_satisfiable(file_size)
                return
            start = max(0, file_size - length)
            end = file_size - 1
        else:
            start = int(start_s)
            end = int(end_s) if end_s != "" else file_size - 1

        if start > end or start >= file_size:
            self._send_range_not_satisfiable(file_size)
            return
        end = min(end, file_size - 1)

        length = end - start + 1
        self.send_response(HTTPStatus.PARTIAL_CONTENT)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        if self.command != "HEAD":
            self._stream_file(path, start, end)

    def _send_range_not_satisfiable(self, file_size: int) -> None:
        self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
        self.send_header("Content-Range", f"bytes */{file_size}")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _stream_file(self, path: str, start: int, end: int) -> None:
        remaining = end - start + 1
        try:
            with open(path, "rb") as f:
                f.seek(start)
                while remaining > 0:
                    chunk = f.read(min(CHUNK_SIZE, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


_review_store = None
_review_store_lock = threading.Lock()


def review_store():
    global _review_store
    with _review_store_lock:
        if _review_store is None:
            _review_store = reviews.Store(DATA_DIR)
        return _review_store


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> None:
    ensure_dirs()

    server = Server((HOST, PORT), Handler)
    server.timeout = SOCKET_TIMEOUT
    try:
        server.socket.settimeout(SOCKET_TIMEOUT)
    except OSError:
        pass

    gc_thread = threading.Thread(target=_gc_rate_buckets, daemon=True)
    gc_thread.start()

    def handle_sigterm(signum, frame):
        log("SIGTERM received, shutting down")
        threading.Thread(target=server.shutdown, daemon=True).start()

    try:
        signal.signal(signal.SIGTERM, handle_sigterm)
        signal.signal(signal.SIGINT, handle_sigterm)
    except ValueError:
        # На некоторых платформах (не главный поток) сигналы не назначаемы.
        pass

    log(f"yestudio_server listening on {HOST}:{PORT}, data={DATA_DIR}")
    try:
        server.serve_forever(poll_interval=1.0)
    finally:
        server.server_close()
        log("yestudio_server stopped")


if __name__ == "__main__":
    main()
