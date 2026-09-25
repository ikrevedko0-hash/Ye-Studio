#!/usr/bin/env python3
"""Бета-сервер для десктоп-приложения "Ye!Studio".

Только стандартная библиотека Python 3 (совместимость с 3.9+).
Эндпоинты:
  GET  /api/ping?id=<installId>&v=<version>     — статистика запусков (installs.json)
  GET  /api/control?id=<installId>&v=<version>  — то же для установок 0.2.0-beta.1; всегда «не выключен»
  POST /api/errors
  POST /api/feedback
  GET/HEAD /updates/<file>
  GET  /health

Запуск:
  python3 yestudio_server.py
Переменные окружения:
  YES_HOST (default 0.0.0.0)
  YES_PORT (default 8787)
  YES_DATA (default /opt/yestudio/data)
"""

from __future__ import annotations

import base64
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
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs

# ---------------------------------------------------------------------------
# Конфигурация
# ---------------------------------------------------------------------------

HOST = os.environ.get("YES_HOST", "0.0.0.0")
PORT = int(os.environ.get("YES_PORT", "8787"))
DATA_DIR = os.environ.get("YES_DATA", "/opt/yestudio/data")

API_KEY_HEADER = "X-YeStudio-Key"
API_KEY_VALUE = "yes-beta-2026"

MAX_BODY_BYTES = 4 * 1024 * 1024  # 4 МБ
# Лимиты на один IP: (сколько запросов, за сколько секунд). Клиент сам шлёт ping раз в 15 мин и ошибки
# раз в 10 мин — запас на несколько установок за одним IP (дом, общежитие), но не на поток мусора.
RATE_LIMITS = {
    "ping": (30, 3600),
    "errors": (30, 3600),
    "feedback": (5, 3600),
}
RATE_LIMIT_WINDOW_SEC = max(w for _, w in RATE_LIMITS.values())

MAX_TEXT_LEN = 10000
MAX_MESSAGE_LEN = 2000
MAX_STACK_LEN = 8000
MAX_ITEMS = 500

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
        return self.client_address[0]

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
        short_id = (install_id[:8] if install_id else "unknown")
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
