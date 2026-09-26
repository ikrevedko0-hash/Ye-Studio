"""Обновить базу повторов: каталог FirePacks → тексты новых паков → сжатый индекс.

    python update.py --data <папка базы> [--bind auto] [--workers 4] [--limit N] [--retry-dead]
                     [--no-catalog] [--no-fetch] [--full-rebuild] [--quiet]

На ПК автора: «база паков\\Обновить базу.cmd» (--bind auto — мимо VPN).
На сервере: таймер yestudio-packindex (--quiet, раз в сутки).

Из пака берутся только content.xml и оглавление архива (кусками по Range, медиа не качаются).
Можно прервать и запустить снова — продолжит с места остановки.

Что видно и где искать беду:
  консоль — шаги, полоса прогресса, итог; при ошибке — что случилось и какой лог прислать;
  <data>/logs/update-*.log — подробный журнал (каждый неудачный пак, полный traceback);
  <data>/last_run.json — итог последнего запуска (шаг, ошибка, счётчики) для yes-admin и Claude.
Коды выхода: 0 — готово, 1 — остановлено из-за ошибки, 2 — неожиданный сбой, 3 — уже запущено.
"""
import argparse, functools, gzip, http.client, json, os, platform, shutil, socket, ssl, struct, subprocess, sys
import threading, time, traceback, urllib.error, urllib.parse, urllib.request, zlib
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import packlib  # noqa: E402

try:
    import truststore; truststore.inject_into_ssl()   # на Windows у VK сертификат, которого нет в наборе Python
    TRUSTSTORE = True
except ImportError:
    TRUSTSTORE = False

VERSION = "2026-09-26"
API = "https://firepacks.net/api/packages?sort=added&dir=asc&unrated=1&showBlacklisted=1&pageSize=100&page={}"
UA = "Mozilla/5.0 (Ye!Studio pack index; duplicate check)"   # без своего UA Cloudflare FirePacks отвечает 403 (1010)
KEEP = ("id", "name", "slug", "authors", "packDate", "vkTs", "size", "questionCount", "url", "language", "plagiarism")
MIN_GAP = 0.15             # не чаще ~6 запросов в секунду на все потоки — чтобы VK не обиделся
TRIP = 30                  # столько ошибок сети подряд — останавливаемся: VK или сеть легли, дальше молотить бессмысленно
ERR_TO_DEAD = 6            # столько запусков подряд с ошибкой — ссылка считается мёртвой
DEAD_RETRY_DAYS = 30       # мёртвые ссылки перепроверяются раз в месяц
MAX_INDEX_MB = 1024        # индекс больше — что-то пошло не так, старый не заменяем
MIN_FREE_MB = 512


class Fatal(Exception):
    """Остановка с понятным объяснением (что случилось и что делать)."""


class Dead(Exception): pass      # пак не скачать никогда: удалён, битый, не zip
class Soft(Exception): pass      # временная беда (сеть, 403/429/5xx) — повторить в следующий запуск


# ---------- консоль и журнал ----------

class Out:
    def __init__(self, logdir, quiet):
        self.quiet = quiet or not sys.stdout.isatty()
        self.lock = threading.Lock()
        os.makedirs(logdir, exist_ok=True)
        self.path = os.path.join(logdir, time.strftime("update-%Y%m%d-%H%M%S.log"))
        self.f = open(self.path, "a", encoding="utf-8")
        self.live = False            # на экране сейчас строка прогресса (её надо стереть перед текстом)
        logs = sorted(x for x in os.listdir(logdir) if x.startswith("update-") and x.endswith(".log"))
        for old in logs[:-30]:
            try: os.remove(os.path.join(logdir, old))
            except OSError: pass

    def log(self, msg):
        with self.lock:
            self.f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')}  {msg}\n"); self.f.flush()

    def say(self, msg, color=""):
        """В консоль и в журнал."""
        self.log(msg)
        with self.lock:
            if self.live and not self.quiet:
                sys.stdout.write("\r\033[K"); self.live = False
            c, r = ({"ok": "\033[32m", "warn": "\033[33m", "err": "\033[31m", "head": "\033[1;36m"}.get(color, ""), "\033[0m") \
                if color and not self.quiet else ("", "")
            print(f"{c}{msg}{r}", flush=True)

    def bar(self, line, title=None):
        if self.quiet: return
        with self.lock:
            sys.stdout.write("\r\033[K" + line)
            if title: sys.stdout.write(f"\033]0;{title}\007")
            sys.stdout.flush(); self.live = True


class Run:
    """Итог запуска в last_run.json: пишется при каждом шаге, чтобы и после сбоя было видно, где остановились."""
    def __init__(self, data, out, args):
        self.path = os.path.join(data, "last_run.json")
        self.d = {"started": time.strftime("%Y-%m-%dT%H:%M:%S"), "finished": None, "result": "running",
                  "stage": "", "error": None, "log": out.path, "args": " ".join(args), "host": platform.node(),
                  "counts": {}}
        self.save()

    def stage(self, name):
        self.d["stage"] = name; self.save()

    def save(self):
        try: packlib.write_json(self.path, self.d, indent=1)
        except OSError: pass


# ---------- сеть ----------

def _vpn_route_windows():
    """Маршрут по умолчанию мимо VPN: адрес физического адаптера. TUN-адаптеры (Happ/xray, WireGuard) ставят
    маршрут с NextHop 0.0.0.0 — настоящий шлюз роутера у них не указан, по этому и отличаем."""
    ps = ("[Console]::OutputEncoding=[Text.Encoding]::UTF8;"
          "$all = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix 0.0.0.0/0 -ErrorAction SilentlyContinue;"
          "$vpn = ($all | Where-Object { $_.NextHop -eq '0.0.0.0' } | ForEach-Object { $_.InterfaceAlias }) -join ',';"
          "$r = $all | Where-Object { $_.NextHop -ne '0.0.0.0' } | Sort-Object { $_.RouteMetric + "
          "(Get-NetIPInterface -InterfaceIndex $_.ifIndex -AddressFamily IPv4).InterfaceMetric } | Select-Object -First 1;"
          "if ($r) { $ip = (Get-NetIPAddress -InterfaceIndex $r.ifIndex -AddressFamily IPv4 | Select-Object -First 1).IPAddress;"
          " Write-Output \"$ip|$($r.InterfaceAlias)|$($r.NextHop)|$vpn\" } else { Write-Output \"|||$vpn\" }")
    res = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                         capture_output=True, timeout=60)
    line = res.stdout.decode("utf-8", "replace").strip().splitlines()
    parts = (line[-1] if line else "|||").split("|")
    return (parts + ["", "", "", ""])[:4]


class Net:
    def __init__(self, out, bind):
        self.out, self.src = out, None
        self.lock, self.last = threading.Lock(), 0.0
        self.last_answer = time.time()
        self.vpn = ""
        if bind == "auto":
            if os.name != "nt":
                out.say("  --bind auto нужен только на Windows с VPN — здесь выхожу в сеть напрямую.")
            else:
                ip, alias, gw, self.vpn = _vpn_route_windows()
                if not ip:
                    raise Fatal("Не нашёл сетевую карту с выходом в интернет мимо VPN (маршрута через роутер нет).\n"
                                "  Проверьте, что кабель/Wi-Fi подключён. VPN-адаптеры: " + (self.vpn or "не видно"))
                self.src = ip
                out.say(f"  Мимо VPN через «{alias}»: адрес {ip}, роутер {gw}. VPN-адаптер: {self.vpn or 'не найден'}")
        elif bind and bind != "none":
            self.src = bind
        # FirePacks (Cloudflare) — обычным маршрутом, то есть через VPN, если он включён: напрямую у российского
        # провайдера большие ответы Cloudflare виснут (страница каталога — таймаут, проверено 2026-09-26).
        # Мимо VPN ходим только к VK за файлами паков.
        self.direct = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        handlers = [urllib.request.ProxyHandler({})]           # системные прокси не нужны: VPN обходим напрямую
        if self.src:
            src = (self.src, 0)
            class H(urllib.request.HTTPHandler):
                def http_open(s, req):
                    return s.do_open(functools.partial(http.client.HTTPConnection, source_address=src), req)
            class HS(urllib.request.HTTPSHandler):
                def https_open(s, req):
                    return s.do_open(functools.partial(http.client.HTTPSConnection, source_address=src), req,
                                     context=ssl.create_default_context())
            handlers += [H(), HS()]
        self.opener = urllib.request.build_opener(*handlers)

    def _pace(self):
        with self.lock:
            wait = self.last + MIN_GAP - time.time()
            if wait > 0: time.sleep(wait)
            self.last = time.time()

    def get(self, url, rng=None, max_bytes=20 << 20, tries=3, pace=True):
        """→ (статус, итоговый url, заголовки, тело). Тело читается, только если это то, что просили:
        на запрос куска (Range) сервер, отдающий файл целиком (200), тело не читаем — пак может весить гигабайт."""
        h = {"User-Agent": UA}
        if rng: h["Range"] = rng
        for n in range(tries):
            if pace: self._pace()
            host = (urllib.parse.urlsplit(url).hostname or "").lower()
            op = self.direct if host == "firepacks.net" or host.endswith(".firepacks.net") else self.opener
            try:
                with op.open(urllib.request.Request(url, headers=h), timeout=60) as r:
                    st, final, hd = r.status, r.geturl(), r.headers
                    ctype = (hd.get("Content-Type") or "").lower()
                    if rng and st != 206:
                        body = r.read(4096) if "html" in ctype else b""
                    else:
                        body = r.read(max_bytes + 1)
                        if len(body) > max_bytes:
                            raise Soft(f"ответ больше {max_bytes >> 20} МБ — не читаю")
                    self.last_answer = time.time()
                    return st, final, hd, body
            except urllib.error.HTTPError as e:
                self.last_answer = time.time()
                if e.code in (404, 410):
                    raise Dead(f"HTTP {e.code} (файл удалён)")
                if e.code in (429, 500, 502, 503, 504) and n < tries - 1:
                    time.sleep(20 * (n + 1)); continue
                raise Soft(f"HTTP {e.code} от {urllib.parse.urlsplit(url).hostname}")
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError, http.client.HTTPException) as e:
                reason = getattr(e, "reason", e)
                if getattr(reason, "winerror", None) == 10049 or getattr(reason, "errno", None) == 99:
                    raise Fatal(f"Адрес {self.src} больше не принадлежит этому компьютеру (роутер выдал новый?).\n"
                                "  Просто запустите обновление ещё раз — адрес определится заново.")
                if n < tries - 1:
                    time.sleep(5 * (n + 1)); continue
                raise Soft(f"сеть: {type(reason).__name__}: {reason}")

    def my_ip(self, bound=True):
        try:
            op = self.opener if bound else urllib.request.build_opener()
            with op.open(urllib.request.Request("https://api.ipify.org", headers={"User-Agent": UA}), timeout=15) as r:
                return r.read(64).decode().strip()
        except Exception as e:  # noqa: BLE001
            return f"не узнать ({type(e).__name__}: {e})"


# ---------- каталог ----------

def load_catalog(net, out, old):
    packs, page, total = {}, 1, None
    while page < 1000:
        try:
            _, _, _, body = net.get(API.format(page), pace=False)
            d = json.loads(body)
        except (Soft, Dead, ValueError) as e:
            raise Soft(f"страница каталога {page}: {e}")
        total = d.get("total", 0)
        for p in d.get("packages") or []:
            packs[str(p["id"])] = {k: p.get(k) for k in KEEP}
        out.bar(f"  страниц {page}, паков {len(packs)}", title=f"Каталог: {len(packs)} паков")
        if not d.get("packages") or page * (d.get("pageSize") or 100) >= total:
            break
        page += 1
        time.sleep(0.3)
    out.log(f"каталог: {page} страниц, {len(packs)} паков, total в API {total}")
    if old and len(packs) < 0.9 * len(old):
        out.say(f"  ⚠ Каталог пришёл неполный: {len(packs)} паков против {len(old)} в прошлый раз. "
                "Старые записи сохраняю, новые добавляю.", "warn")
    merged = dict(old or {}); merged.update(packs)
    return merged, len(packs), sum(1 for k in packs if k not in (old or {}))


# ---------- один пак ----------

def _zip64_extra(extra, usize, csize, loff):
    i = 0
    while i + 4 <= len(extra):
        hid, ln = struct.unpack("<HH", extra[i:i + 4])
        if hid == 1:
            vals, j = [], i + 4
            while j + 8 <= i + 4 + ln:
                vals.append(struct.unpack("<Q", extra[j:j + 8])[0]); j += 8
            it = iter(vals)
            if usize == 0xFFFFFFFF: usize = next(it, usize)
            if csize == 0xFFFFFFFF: csize = next(it, csize)
            if loff == 0xFFFFFFFF: loff = next(it, loff)
            break
        i += 4 + ln
    return usize, csize, loff


def fetch_one(net, p, dirs):
    xml_path, files_path = dirs
    st, final, hd, head = net.get(p["url"], "bytes=0-99")
    ctype = (hd.get("Content-Type") or "").lower()
    if st != 206:
        if "html" in ctype: raise Dead("файл удалён (VK отдаёт страницу вместо файла)")
        raise Soft(f"сервер не отдаёт кусок файла (статус {st})")
    if head[:2] != b"PK":
        raise Dead("это не zip")
    total = int((hd.get("Content-Range") or "/0").split("/")[-1] or 0)
    if total < 22: raise Dead(f"слишком маленький файл ({total} байт)")

    def rng(a, b, what):
        if b - a + 1 > (64 << 20): raise Dead(f"{what}: {b - a + 1 >> 20} МБ — подозрительно много")
        s, _, _, body = net.get(final, f"bytes={a}-{b}", max_bytes=b - a + 1024)
        if s != 206: raise Soft(f"{what}: сервер не отдал кусок (статус {s})")
        return body

    tail_n = min(total, 65536 + 22 + 20)
    tail_start = total - tail_n
    tail = rng(tail_start, total - 1, "конец архива")
    e = tail.rfind(b"PK\x05\x06")
    if e < 0: raise Dead("битый zip (нет оглавления)")
    n_ent, cd_size, cd_off = struct.unpack("<HII", tail[e + 10:e + 20])
    if cd_off == 0xFFFFFFFF or cd_size == 0xFFFFFFFF or n_ent == 0xFFFF:          # zip64
        loc = e - 20
        if loc < 0 or tail[loc:loc + 4] != b"PK\x06\x07": raise Dead("zip64 без локатора")
        z64, = struct.unpack("<Q", tail[loc + 8:loc + 16])
        rec = tail[z64 - tail_start:z64 - tail_start + 56] if z64 >= tail_start else rng(z64, z64 + 55, "zip64")
        if rec[:4] != b"PK\x06\x06": raise Dead("битый zip64")
        cd_size, cd_off = struct.unpack("<QQ", rec[40:56])
    cd = tail[cd_off - tail_start:cd_off - tail_start + cd_size] if cd_off >= tail_start else \
        rng(cd_off, cd_off + cd_size - 1, "оглавление")
    entries, xml_entry, i = [], None, 0
    while i + 46 <= len(cd) and cd[i:i + 4] == b"PK\x01\x02":
        flags, method = struct.unpack("<HH", cd[i + 8:i + 12])
        crc, csize, usize, nlen, xlen, clen = struct.unpack("<IIIHHH", cd[i + 16:i + 34])
        loff, = struct.unpack("<I", cd[i + 42:i + 46])
        name = cd[i + 46:i + 46 + nlen].decode("utf-8" if flags & 0x800 else "cp866", "replace")
        usize, csize, loff = _zip64_extra(cd[i + 46 + nlen:i + 46 + nlen + xlen], usize, csize, loff)
        entries.append({"name": name, "size": usize, "crc": crc})
        if name.lower().endswith("content.xml") and "/" not in name.strip("/"):
            xml_entry = (method, csize, loff, flags)
        i += 46 + nlen + xlen + clen
    if not entries: raise Dead("битый zip (пустое оглавление)")
    if not xml_entry: raise Dead("в архиве нет content.xml")
    method, csize, loff, flags = xml_entry
    if flags & 1: raise Dead("content.xml зашифрован")
    lh = rng(loff, loff + 29, "заголовок content.xml")
    if lh[:4] != b"PK\x03\x04": raise Dead("битый zip (заголовок content.xml)")
    nlen, xlen = struct.unpack("<HH", lh[26:30])
    start = loff + 30 + nlen + xlen
    data = rng(start, start + csize - 1, "content.xml") if csize else b""
    try:
        if method == 8: xml = zlib.decompress(data, -15)
        elif method == 0: xml = data
        else: raise Dead(f"неизвестное сжатие {method}")
    except zlib.error as ex:
        raise Dead(f"content.xml не распаковался: {ex}")
    packlib.write_atomic(xml_path, gzip.compress(xml, 6))
    packlib.write_json(files_path, {"id": p["id"], "zipSize": total, "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
                                    "entries": [x for x in entries if not x["name"].lower().endswith("content.xml")]})
    return len(head) + len(tail) + len(data) + len(lh)


# ---------- пути ----------

class Paths:
    def __init__(self, data):
        self.data = os.path.abspath(data)
        self.catalog = os.path.join(self.data, "data", "catalog.json")
        self.status = os.path.join(self.data, "data", "status.json")
        self.index = os.path.join(self.data, "index.sqlite")
        self.logs = os.path.join(self.data, "logs")

    def _shard(self, pid): return str(int(pid) // 1000)
    def xml(self, pid): return os.path.join(self.data, "data", "xml", self._shard(pid), f"{pid}.xml.gz")
    def files(self, pid): return os.path.join(self.data, "data", "files", self._shard(pid), f"{pid}.json")


# ---------- прогресс ----------

class Progress:
    def __init__(self, out, total, what):
        self.out, self.total, self.what = out, total, what
        self.done = self.ok = self.dead = self.err = self.bytes = 0
        self.t0 = time.time(); self.lock = threading.Lock()
        self.stop = threading.Event(); self.last_log = time.time()
        self.net = None
        threading.Thread(target=self._tick, daemon=True).start()

    def add(self, kind, nbytes=0):
        with self.lock:
            self.done += 1; self.bytes += nbytes
            setattr(self, kind, getattr(self, kind) + 1)

    def line(self):
        el = time.time() - self.t0
        pct = self.done / self.total * 100 if self.total else 100
        rate = self.done / el if el > 0 else 0
        left = (self.total - self.done) / rate if rate > 0 else 0
        eta = (f"{int(left // 3600)} ч {int(left % 3600 // 60):02d} мин" if left >= 3600 else f"{int(left // 60)} мин {int(left % 60):02d} с") \
            if rate > 0 else "…"
        bar = "█" * int(pct / 5) + "░" * (20 - int(pct / 5))
        s = f"{bar} {pct:5.1f}%  {self.done}/{self.total}  ок {self.ok}"
        if self.dead or self.err: s += f" · мёртвых {self.dead} · ошибок {self.err}"
        s += f" · {rate * 60:.0f}/мин · осталось {eta}"
        if self.net and time.time() - self.net.last_answer > 45:
            s += f" · \033[33mнет ответа {int(time.time() - self.net.last_answer)} с\033[0m"
        return s, f"{pct:.0f}% {self.what}"

    def _tick(self):
        while not self.stop.wait(1.0):
            s, title = self.line()
            self.out.bar(s, title)
            if time.time() - self.last_log >= (60 if self.out.quiet else 300):
                self.last_log = time.time()
                self.out.log("прогресс: " + s.replace("\033[33m", "").replace("\033[0m", ""))
                if self.out.quiet: print("  " + s, flush=True)

    def close(self):
        self.stop.set()
        s, _ = self.line()
        self.out.say("  " + s.replace("\033[33m", "").replace("\033[0m", ""))


# ---------- шаг: скачивание ----------

def fetch_all(a, P, net, out, run, packs):
    status = packlib.read_json(P.status, {}) or {}
    now = time.time()
    todo, skipped_dead = [], 0
    for pid, p in packs.items():
        s = status.get(pid, {})
        have = os.path.exists(P.xml(pid)) and os.path.exists(P.files(pid))
        if have and s.get("s") == "ok" and s.get("size") == p.get("size") and s.get("vkTs", p.get("vkTs")) == p.get("vkTs"):
            continue                                     # уже есть, пак не менялся
        if s.get("s") == "dead":
            age = now - time.mktime(time.strptime(s.get("at") or "2000-01-01T00:00:00", "%Y-%m-%dT%H:%M:%S"))
            if not a.retry_dead and age < DEAD_RETRY_DAYS * 86400:
                skipped_dead += 1; continue
        if not p.get("url"):
            status[pid] = {"s": "dead", "at": time.strftime("%Y-%m-%dT%H:%M:%S"), "err": "нет ссылки"}; continue
        todo.append(p)
    todo.sort(key=lambda p: int(p["id"]))
    if a.limit: todo = todo[:a.limit]
    have_n = sum(1 for s in status.values() if s.get("s") == "ok")
    out.say(f"  Всего в каталоге {len(packs)}, уже скачано {have_n}, мёртвых ссылок (ждут повтора) {skipped_dead}. "
            f"Качаю сейчас: {len(todo)}.")
    run.d["counts"].update(to_fetch=len(todo))
    if not todo:
        packlib.write_json(P.status, status); return Counter()

    pr = Progress(out, len(todo), "скачивание"); pr.net = net
    stop = threading.Event(); errs = Counter(); streak = [0, ""]
    last_save = time.time()

    def job(p):
        if stop.is_set(): return None
        return fetch_one(net, p, (P.xml(p["id"]), P.files(p["id"])))

    def kept(pid, prev, ts, msg):
        """Пак уже был скачан, а теперь удалён с VK или перезалит неудачно: старая версия остаётся в базе —
        удалённый пак тоже «было раньше». Отмечаем ошибку, статус ok не трогаем."""
        if prev.get("s") == "ok" and os.path.exists(P.xml(pid)):
            status[pid] = {**prev, "last_err": msg, "last_err_at": ts}
            return True
        return False

    fatal = None
    ex = ThreadPoolExecutor(max(1, min(6, a.workers)))
    try:
        futs = {ex.submit(job, p): p for p in todo}
        if futs:
            for f in as_completed(futs):
                p = futs[f]; pid = str(p["id"]); ts = time.strftime("%Y-%m-%dT%H:%M:%S")
                prev = status.get(pid, {})
                try:
                    nb = f.result()
                    if nb is None: continue                               # отменено после остановки
                    status[pid] = {"s": "ok", "at": ts, "size": p.get("size"), "vkTs": p.get("vkTs")}
                    pr.add("ok", nb); streak[0] = 0
                except Dead as e:
                    if kept(pid, prev, ts, str(e)): pass
                    else: status[pid] = {"s": "dead", "at": ts, "err": str(e)}
                    pr.add("dead"); errs[f"мёртвая: {e}"] += 1; streak[0] = 0
                    out.log(f"пак {pid} «{p.get('name')}»: мёртвая ссылка — {e}")
                except Fatal as e:
                    fatal = e; stop.set(); break
                except Exception as e:  # noqa: BLE001 — Soft и всё неожиданное: повторим в следующий раз
                    msg = str(e) if isinstance(e, Soft) else f"{type(e).__name__}: {e}"
                    n = prev.get("n", 0) + 1 if prev.get("s") == "err" else 1
                    if not kept(pid, prev, ts, msg):
                        status[pid] = {"s": "dead" if n >= ERR_TO_DEAD else "err", "at": ts, "n": n,
                                       "err": (f"{ERR_TO_DEAD} запусков подряд: " if n >= ERR_TO_DEAD else "") + msg}
                    pr.add("err"); errs[f"ошибка: {msg[:120]}"] += 1
                    out.log(f"пак {pid} «{p.get('name')}»: {msg}" + ("" if isinstance(e, Soft) else "\n" + traceback.format_exc()))
                    streak[0] += 1; streak[1] = msg
                    if streak[0] >= TRIP:
                        fatal = Fatal(f"{TRIP} паков подряд не скачались. Последняя ошибка: {msg}\n"
                                      "  Похоже, VK или сеть перестали отвечать. Скачанное сохранено — "
                                      "запустите позже, продолжит с места остановки.")
                        stop.set(); break
                if time.time() - last_save > 30:
                    packlib.write_json(P.status, status); last_save = time.time()
    finally:
        stop.set()                          # Ctrl+C или ошибка: не ждать тысячи оставшихся паков, только текущие
        ex.shutdown(wait=True, cancel_futures=True)
        packlib.write_json(P.status, status)
        pr.close()
        run.d["counts"].update(fetched_ok=pr.ok, fetched_dead=pr.dead, fetched_err=pr.err, fetched_mb=round(pr.bytes / 1e6, 1))
        run.save()
    if errs:
        out.log("сводка ошибок:\n" + "\n".join(f"  {n:5d} × {k}" for k, n in errs.most_common(20)))
        top = errs.most_common(3)
        out.say("  Чаще всего: " + "; ".join(f"{k} ({n})" for k, n in top), "warn" if pr.err else "")
    if fatal: raise fatal
    return errs


# ---------- шаг: индекс ----------

def build(a, P, out, run, packs):
    status = packlib.read_json(P.status, {}) or {}
    ok = {pid: s for pid, s in status.items() if s.get("s") == "ok" and pid.isdigit()}
    target = P.index + ".building"
    full = a.full_rebuild or not os.path.exists(P.index)
    if not full:
        try:
            db0 = packlib.open_index(P.index, readonly=True)
            if not packlib.index_compatible(db0):
                full = True; out.say("  Правила или формат индекса поменялись — пересобираю целиком.")
            db0.close()
        except Exception as e:  # noqa: BLE001
            full = True; out.say(f"  Старый индекс не открылся ({e}) — пересобираю целиком.", "warn")

    old_size = os.path.getsize(P.index) if os.path.exists(P.index) else 0
    free = shutil.disk_usage(P.data).free
    need = max(MIN_FREE_MB << 20, old_size * 3)
    if free < need:
        raise Fatal(f"Мало места на диске: свободно {free >> 20} МБ, для сборки нужно {need >> 20} МБ. "
                    "Индекс не тронут.")

    if os.path.exists(target): os.remove(target)
    if full:
        db = packlib.create_index(target)
        done = {}
    else:
        shutil.copyfile(P.index, target)
        db = packlib.open_index(target)
        db.execute("PRAGMA journal_mode=OFF"); db.execute("PRAGMA synchronous=OFF")
        done = {str(r[0]): r[1] for r in db.execute("SELECT id, fetched_at FROM packs")}
    db.execute(f"PRAGMA cache_size=-{a.cache_mb * 1024}")
    todo = [pid for pid, s in ok.items() if done.get(pid) != s.get("at")]
    todo.sort(key=lambda pid: (packs.get(pid, {}).get("vkTs") or 1 << 62, int(pid)))   # раньше выложен — раньше в индексе
    out.say(f"  {'Полная сборка, паков' if full else 'Дописываю паков'}: {len(todo)}" + ("" if full else f" (в индексе уже {len(done)})"))

    pr = Progress(out, len(todo), "индекс") if todo else None
    bad, n_ok, n_dup = [], 0, 0
    try:
        for n, pid in enumerate(todo, 1):
            try:
                xml = packlib.read_xml_gz(P.xml(pid))
                fj = packlib.read_json(P.files(pid), {}) or {}
                res, _ = packlib.index_pack(db, int(pid), packs.get(pid, {}), xml, fj.get("entries", []), ok[pid].get("at", ""))
                if res == "dup": n_dup += 1; pr.add("ok")
                else: n_ok += 1; pr.add("ok")
            except Exception as e:  # noqa: BLE001
                bad.append(pid); pr.add("err")
                out.log(f"пак {pid}: не вошёл в индекс — {type(e).__name__}: {e}")
            if n % 500 == 0: db.commit()
        n_packs = db.execute("SELECT count(*) FROM packs WHERE dup_of IS NULL").fetchone()[0]
        n_q = db.execute("SELECT coalesce(sum(qn),0) FROM packs WHERE dup_of IS NULL").fetchone()[0]
        packlib.set_meta(db, built_at=time.strftime("%Y-%m-%dT%H:%M:%S"), packs=n_packs, questions=n_q,
                         copies=db.execute("SELECT count(*) FROM packs WHERE dup_of IS NOT NULL").fetchone()[0])
        db.commit()
        if full:
            out.say("  Сжимаю файл индекса…"); db.execute("VACUUM")
        db.execute("PRAGMA optimize")
        db.close()
    except BaseException:
        try: db.close()
        except Exception: pass
        try: os.remove(target)
        except OSError: pass
        raise
    finally:
        if pr: pr.close()
    size = os.path.getsize(target)
    if size > MAX_INDEX_MB << 20:
        os.remove(target)
        raise Fatal(f"Новый индекс получился {size >> 20} МБ — больше предела {MAX_INDEX_MB} МБ. Что-то не так, "
                    "старый индекс оставлен как был.")
    try:
        os.replace(target, P.index)
    except PermissionError:
        raise Fatal("Не могу заменить index.sqlite: файл занят (открыто окно проверки пака?). Закройте его и "
                    "запустите обновление снова — скачанное не пропадёт.")
    if bad:
        out.say(f"  Не вошли в индекс (content.xml не разобрался): {len(bad)} — список в журнале.", "warn")
        out.log("не вошли: " + ", ".join(bad[:200]))
    run.d["counts"].update(indexed_new=n_ok, indexed_copies=n_dup, index_bad=len(bad), index_packs=n_packs,
                           index_questions=n_q, index_mb=round(size / 1e6, 1))
    return n_packs, n_q, size


# ---------- блокировка, сон ----------

class Lock:
    """Второй запуск (таймер + ручной) не должен писать status.json одновременно с первым."""
    def __init__(self, path):
        self.f = open(path, "a+")
        try:
            if os.name == "nt":
                import msvcrt; self.f.seek(0); msvcrt.locking(self.f.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl; fcntl.flock(self.f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.f.close(); raise


def keep_awake():
    if os.name == "nt":
        try:
            import ctypes; ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001)   # не засыпать
        except Exception: pass


# ---------- main ----------

def main():
    ap = argparse.ArgumentParser(description="Обновить базу повторов паков.")
    ap.add_argument("--data", required=True, help="папка базы (data/, index.sqlite, logs/)")
    ap.add_argument("--bind", default="none", help="auto — выходить в сеть мимо VPN (Windows); none; или IP")
    ap.add_argument("--workers", type=int, default=4, help="сколько паков качать одновременно (не больше 6)")
    ap.add_argument("--limit", type=int, default=0, help="скачать только N паков (для пробы)")
    ap.add_argument("--retry-dead", action="store_true", help="перепроверить все мёртвые ссылки сейчас")
    ap.add_argument("--no-catalog", action="store_true", help="не обновлять каталог, взять сохранённый")
    ap.add_argument("--no-fetch", action="store_true", help="ничего не качать, только собрать индекс")
    ap.add_argument("--full-rebuild", action="store_true", help="пересобрать индекс целиком")
    ap.add_argument("--quiet", action="store_true", help="без полосы прогресса (для таймера на сервере)")
    ap.add_argument("--cache-mb", type=int, default=192, help="память SQLite при сборке, МБ")
    a = ap.parse_args()

    try:
        os.system("") if os.name == "nt" else None                 # ANSI-цвета в консоли Windows
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    P = Paths(a.data)
    os.makedirs(os.path.join(P.data, "data"), exist_ok=True)
    try:
        lock = Lock(os.path.join(P.data, ".update.lock"))  # noqa: F841 — держим до выхода
    except OSError:
        print("Обновление базы уже идёт в другом окне (или на сервере работает таймер). Второй запуск не нужен.")
        return 3
    out = Out(P.logs, a.quiet)
    run = Run(P.data, out, sys.argv[1:])
    keep_awake()
    t0 = time.time()
    out.log(f"update.py {VERSION}, Python {sys.version.split()[0]} ({platform.platform()}), truststore={TRUSTSTORE}, "
            f"аргументы: {' '.join(sys.argv[1:])}, данные: {P.data}")
    code, fail_stage = 0, ""
    try:
        packs = (packlib.read_json(P.catalog, {}) or {}).get("packs") or {}
        if not a.no_fetch:
            run.stage("сеть"); out.say("Шаг 1/4. Проверка сети", "head")
            net = Net(out, a.bind)
            ip_b = net.my_ip(True)
            out.say(f"  Внешний адрес для скачивания: {ip_b}")
            if net.src:
                ip_v = net.my_ip(False)
                out.say(f"  Через VPN было бы: {ip_v}")
                if ip_b == ip_v and net.vpn:
                    raise Fatal(f"Обход VPN не сработал: и так и так адрес {ip_b}.\n"
                                "  Возможно, в VPN включён строгий режим (kill switch). Выключите его или VPN на время.")
                if ip_b.startswith("не узнать"):
                    raise Fatal(f"Мимо VPN в интернет не выйти: {ip_b}\n"
                                "  Проверьте, что интернет есть без VPN (кабель/Wi-Fi), и запустите ещё раз.")
            try:
                net.get(API.format(1).replace("pageSize=100", "pageSize=1"), pace=False)
                out.say("  FirePacks отвечает (к нему — обычным маршрутом, к VK — мимо VPN).", "ok")
            except (Soft, Dead) as e:
                raise Fatal(f"FirePacks не отвечает: {e}")

            run.stage("каталог"); out.say("Шаг 2/4. Каталог FirePacks", "head")
            if a.no_catalog and packs:
                out.say(f"  Беру сохранённый: {len(packs)} паков.")
            else:
                try:
                    packs, got, new = load_catalog(net, out, packs)
                    packlib.write_json(P.catalog, {"fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%S"), "packs": packs})
                    out.say(f"  В каталоге {got} паков, новых с прошлого раза: {new}.", "ok")
                except Soft as e:
                    if not packs: raise Fatal(f"Каталог FirePacks не скачался: {e}")
                    out.say(f"  ⚠ Каталог не обновился ({e}) — беру сохранённый ({len(packs)} паков).", "warn")
            run.d["counts"]["catalog"] = len(packs)

            run.stage("скачивание"); out.say("Шаг 3/4. Скачивание текстов паков (только content.xml, без медиа)", "head")
            fetch_all(a, P, net, out, run, packs)
        run.stage("индекс"); out.say("Шаг 4/4. Сборка индекса", "head")
        n_packs, n_q, size = build(a, P, out, run, packs)
        mins = (time.time() - t0) / 60
        out.say(f"✔ Готово за {mins:.0f} мин. Паков в индексе: {n_packs}, вопросов: {n_q}, файл {size / 1e6:.1f} МБ.", "ok")
        run.d["result"] = "ok"
    except Fatal as e:
        code, fail_stage = 1, run.d["stage"]
        run.d.update(result="failed", error=str(e))
        out.say(f"\n✖ Остановлено на шаге «{fail_stage}»: {e}", "err")
    except KeyboardInterrupt:
        code = 1
        run.d.update(result="stopped", error="остановлено вручную (Ctrl+C)")
        out.say("\nОстановлено вручную. Скачанное сохранено — запустите снова, продолжит с места остановки.", "warn")
    except Exception as e:  # noqa: BLE001
        code, fail_stage = 2, run.d["stage"]
        tb = traceback.format_exc()
        run.d.update(result="crashed", error=f"{type(e).__name__}: {e}", traceback=tb)
        out.log("НЕОЖИДАННЫЙ СБОЙ:\n" + tb)
        out.say(f"\n✖ Неожиданный сбой на шаге «{fail_stage}»: {type(e).__name__}: {e}", "err")
    finally:
        run.d["finished"] = time.strftime("%Y-%m-%dT%H:%M:%S"); run.save()
    if code:
        out.say(f"  Журнал: {out.path}")
        out.say(f"  Напишите Claude: «обновление базы паков упало, смотри {out.path}»")
    else:
        out.say(f"  Журнал: {out.path}")
    return code


if __name__ == "__main__":
    sys.exit(main())
