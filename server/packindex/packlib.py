"""База повторов паков: разбор content.xml, нормализация, хеши, сжатый индекс и проверка по нему.

Один и тот же модуль работает на ПК автора (первое индексирование), на сервере (ежедневное обновление
и /api/pack-check) и в check.py. Только стандартная библиотека, Python 3.9+.

Индекс хранит не тексты, а 8-байтовые хеши:
  «e» — дословный повтор: norm(текст) | norm(первый ответ) | отпечатки медиа вопроса;
  «a» — ответ: norm(каждого правильного ответа), от 3 символов;
  «m» — файл: crc32:размер из оглавления архива (медиа вопроса и ответа).
Нормализацию делает только Python (здесь): клиент шлёт сырой текст, поэтому правила живут в одном месте.
Поменялись правила — поднять NORM_VERSION: индекс пересоберётся целиком из data/xml.
"""
import gzip, hashlib, json, os, re, sqlite3, struct, unicodedata, urllib.parse
from xml.etree import ElementTree as ET

NORM_VERSION = 1
FORMAT_VERSION = 2          # схема index.sqlite
PACK_URL = "https://firepacks.net/pack/{}"

RARE_ANSWER = 3             # 🟠 «тот же ответ» — только если ответ встречается не больше чем в 3 вопросах базы
COMMON_FILE = 20            # файл, который есть в 20+ паках (заставки, пустышки), — не повод для 🔴
MAX_ANSWERS = 5             # сколько правильных ответов вопроса индексировать
SHOW = 3                    # сколько самых ранних совпадений отдавать на вопрос

# ---------- нормализация ----------

# латиница, которая на экране выглядит как кириллица: заменяем только в словах, где есть кириллица
# («Cтарые» с латинской C → «старые»), слова целиком латиницей («Nirvana») не трогаем
_TWINS = str.maketrans("aceopxykmthb", "асеорхукмтнв")
_CYR = re.compile(r"[а-яё]")
_NONWORD = re.compile(r"[^\w]+", re.UNICODE)
FP_RE = re.compile(r"^[0-9a-f]{8}:\d{1,12}$")


def norm(text) -> str:
    t = unicodedata.normalize("NFKC", str(text or "")).lower().replace("ё", "е")
    t = _NONWORD.sub(" ", t).replace("_", " ")
    return " ".join(w.translate(_TWINS) if _CYR.search(w) else w for w in t.split())


def sha1(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()


def h64(kind: str, value: str) -> int:
    """Первые 8 байт sha1(«вид|значение») как знаковое 64-битное число — ключ в SQLite."""
    return struct.unpack("<q", hashlib.sha1(f"{kind}|{value}".encode("utf-8")).digest()[:8])[0]


# ---------- разбор content.xml (SIQ 4 и 5) ----------

_KIND_DIR = {"image": "Images", "audio": "Audio", "voice": "Audio", "video": "Video", "html": "Html"}


def _strip_ns(root):
    for el in root.iter():
        if isinstance(el.tag, str) and "}" in el.tag:
            el.tag = el.tag.split("}", 1)[1]
    return root


def _content(el):
    """Текст и медиа из <param type="content"> (SIQ 5) или <atom> (SIQ 4). Медиа: (вид, имя в архиве или '', как в xml)."""
    texts, media = [], []
    for it in el.iter():
        if it.tag == "item":                      # SIQ 5
            kind = (it.get("type") or "text").lower()
            val = (it.text or "").strip()
            if kind in ("text", "say"):
                if val: texts.append(val)
            elif val:
                media.append((kind, val if (it.get("isRef") or "").lower() == "true" else "", val))
        elif it.tag == "atom":                    # SIQ 4
            kind = (it.get("type") or "text").lower()
            val = (it.text or "").strip()
            if kind in ("text", "say", ""):
                if val: texts.append(val)
            elif kind == "marker":
                pass
            elif val:
                media.append((kind, val[1:] if val.startswith("@") else "", val))
    return texts, media


def parse_pack(xml_bytes: bytes):
    """→ {name, authors, questions: [{round, theme, t (номер темы в паке), q, price, text, answers, media, answer_media}]}"""
    root = _strip_ns(ET.fromstring(xml_bytes))
    authors = [a.text.strip() for a in root.iter("author") if a.text and a.text.strip()]
    out = {"name": root.get("name", ""), "authors": authors, "questions": []}
    t = -1
    for rnd in root.iter("round"):
        for th in rnd.iter("theme"):
            t += 1
            for qi, q in enumerate(th.iter("question")):
                qtext, qmedia, amedia = [], [], []
                params = q.find("params")
                if params is not None:                         # SIQ 5
                    for p in params.findall("param"):
                        name = p.get("name")
                        if name == "question":
                            tx, m = _content(p); qtext += tx; qmedia += m
                        elif name == "answer":
                            _, m = _content(p); amedia += m
                sc = q.find("scenario")
                if sc is not None:                             # SIQ 4: маркер отделяет ответ
                    part = qmedia
                    for at in sc.findall("atom"):
                        if (at.get("type") or "") == "marker":
                            part = amedia; continue
                        tx, m = _content(at)
                        if part is qmedia: qtext += tx
                        part += m
                right = q.find("right")
                answers = [a.text.strip() for a in right.findall("answer") if a.text and a.text.strip()] if right is not None else []
                out["questions"].append({
                    "round": rnd.get("name", ""), "theme": th.get("name", ""), "t": t, "q": qi,
                    "price": q.get("price", ""), "text": " ".join(qtext),
                    "answers": answers, "media": qmedia, "answer_media": amedia,
                })
    return out


def zip_names_to_files(entries):
    """Оглавление → {«Images/кот.jpg»: {size, crc}} с раскодированными именами (в архиве они в %XX)."""
    out = {}
    for e in entries:
        name = e["name"]
        try: name = urllib.parse.unquote(name)
        except Exception: pass
        out[name] = e
    return out


def media_fp(kind, ref, files: dict) -> str:
    """Отпечаток медиафайла: «crc32:размер» или '' (ссылка наружу, файла нет, пустой файл)."""
    if not ref:
        return ""
    folder = _KIND_DIR.get(kind, "")
    for key in (f"{folder}/{ref}", ref):
        e = files.get(key)
        if e and e.get("size"):
            return f"{e['crc'] & 0xFFFFFFFF:08x}:{e['size']}"
    return ""


def question_keys(text, answers, fps):
    """Ключи вопроса → (exact | None, [ответы], [файлы]) — все int64. fps — «crc32:размер» файлов вопроса."""
    fps = sorted({f for f in fps if f and FP_RE.match(f)})
    nt = norm(text)
    na = [a for a in dict.fromkeys(norm(a) for a in answers) if len(a) >= 3][:MAX_ANSWERS]
    first = norm(answers[0]) if answers else ""
    # без текста и без файлов «дословным» считать нечего: совпал бы любой вопрос с тем же ответом
    exact = h64("e", f"{NORM_VERSION}|{nt}|{first}|{','.join(fps)}") if (nt or fps) else None
    return exact, [h64("a", a) for a in na], [h64("m", f) for f in fps]


def price_int(p):
    try: return int(str(p).strip())
    except (TypeError, ValueError): return None


# ---------- индекс ----------

SCHEMA = """
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE packs(
  id INTEGER PRIMARY KEY,       -- id на FirePacks → ссылка firepacks.net/pack/<id>
  name TEXT, authors TEXT,      -- authors через « / »
  date_ts INTEGER,              -- когда выложен (мс), по нему «кто раньше»
  qn INTEGER,                   -- вопросов в паке
  xml_sha1 TEXT,                -- одинаковые копии пака не индексируются второй раз
  dup_of INTEGER,               -- если это копия: id более раннего пака
  fetched_at TEXT               -- когда скачан (из status.json): по нему видно, что пак обновился
);
CREATE INDEX p_sha ON packs(xml_sha1);
CREATE TABLE themes(pack INTEGER, t INTEGER, round TEXT, name TEXT, PRIMARY KEY(pack, t)) WITHOUT ROWID;
CREATE TABLE hits(h INTEGER, pack INTEGER, tq INTEGER, price INTEGER, PRIMARY KEY(h, pack, tq)) WITHOUT ROWID;
"""
# tq = номер темы * 1000 + номер вопроса в теме


def open_index(path, readonly=False, cache_mb=64):
    if readonly:
        db = sqlite3.connect(f"file:{urllib.parse.quote(os.path.abspath(path).replace(os.sep, '/'))}?mode=ro",
                             uri=True, check_same_thread=False)
    else:
        db = sqlite3.connect(path)
    db.execute(f"PRAGMA cache_size=-{int(cache_mb) * 1024}")
    return db


def create_index(path):
    if os.path.exists(path): os.remove(path)
    db = open_index(path)
    db.execute("PRAGMA journal_mode=OFF"); db.execute("PRAGMA synchronous=OFF")
    db.executescript(SCHEMA)
    set_meta(db, norm_version=NORM_VERSION, format_version=FORMAT_VERSION)
    return db


def get_meta(db):
    try: return dict(db.execute("SELECT key, value FROM meta"))
    except sqlite3.Error: return {}


def set_meta(db, **kv):
    for k, v in kv.items():
        db.execute("INSERT OR REPLACE INTO meta VALUES(?,?)", (k, str(v)))


def index_compatible(db) -> bool:
    m = get_meta(db)
    return m.get("norm_version") == str(NORM_VERSION) and m.get("format_version") == str(FORMAT_VERSION)


def remove_pack(db, pid):
    db.execute("DELETE FROM hits WHERE pack=?", (pid,))
    db.execute("DELETE FROM themes WHERE pack=?", (pid,))
    db.execute("DELETE FROM packs WHERE id=?", (pid,))


def index_pack(db, pid: int, meta: dict, xml: bytes, entries, fetched_at=""):
    """Добавить пак (заменив прежнюю версию). → («ok» | «dup» , вопросов). Бросает исключение, если xml не разобрался."""
    remove_pack(db, pid)
    h = hashlib.sha1(xml).hexdigest()
    pk = parse_pack(xml)
    name = meta.get("name") or pk["name"]
    authors = " / ".join(meta.get("authors") or pk["authors"])
    date_ts = meta.get("vkTs")
    dup = db.execute("SELECT id FROM packs WHERE xml_sha1=? AND dup_of IS NULL AND id<>? ORDER BY date_ts LIMIT 1", (h, pid)).fetchone()
    db.execute("INSERT INTO packs VALUES(?,?,?,?,?,?,?,?)",
               (pid, name, authors, date_ts, len(pk["questions"]), h, dup[0] if dup else None, fetched_at))
    if dup:
        return "dup", len(pk["questions"])
    files = zip_names_to_files(entries)
    seen_t = set()
    rows = []
    for q in pk["questions"]:
        if q["t"] not in seen_t:
            seen_t.add(q["t"])
            db.execute("INSERT OR IGNORE INTO themes VALUES(?,?,?,?)", (pid, q["t"], q["round"], q["theme"]))
        qfps = [media_fp(k, r, files) for k, r, _ in q["media"]]
        exact, ans, med = question_keys(q["text"], q["answers"], qfps)
        med += [h64("m", f) for f in {media_fp(k, r, files) for k, r, _ in q["answer_media"]} if f]
        tq, price = q["t"] * 1000 + q["q"], price_int(q["price"])
        for k in {x for x in [exact, *ans, *med] if x is not None}:
            rows.append((k, pid, tq, price))
    db.executemany("INSERT OR IGNORE INTO hits VALUES(?,?,?,?)", rows)
    return "ok", len(pk["questions"])


# ---------- проверка ----------

def _rows(db, h, limit):
    return db.execute("SELECT h.pack, h.tq, h.price FROM hits h WHERE h.h=? LIMIT ?", (h, limit)).fetchall()


def check(db, questions, exclude=()):
    """questions: [{text, answers: [..], media: ["crc32:размер", ..]}].

    → {"results": [{"i", "kind": exact|media|answer, "total", "where": [{pack, tq, price}]}],
       "packs": {id: {name, url, date, authors}}, "themes": {"id:t": [round, theme]}, "summary": [...]}
    На вопрос — одно самое сильное совпадение (дословно > файл > ответ), в where — самые ранние паки.
    """
    exclude = {int(x) for x in exclude if str(x).lstrip("-").isdigit()}
    pack_cache, results, per_pack = {}, [], {}

    def pinfo(pid):
        if pid not in pack_cache:
            r = db.execute("SELECT name, date_ts, authors, dup_of FROM packs WHERE id=?", (pid,)).fetchone()
            pack_cache[pid] = r or ("", None, "", None)
        return pack_cache[pid]

    def found(rows):
        rows = [r for r in rows if r[0] not in exclude]
        rows.sort(key=lambda r: (pinfo(r[0])[1] or 1 << 62, r[0], r[1]))
        return rows

    for i, q in enumerate(questions):
        exact, ans, med = question_keys(q.get("text") or "", q.get("answers") or [], q.get("media") or [])
        hit = None
        if exact is not None:
            rows = found(_rows(db, exact, 500))
            if rows: hit = ("exact", rows)
        if not hit:
            for m in med:
                rows = found(_rows(db, m, 500))
                if rows and len({r[0] for r in rows}) < COMMON_FILE:
                    hit = ("media", rows); break
        if not hit:
            for a in ans:
                rows = found(_rows(db, a, RARE_ANSWER + 1 + len(exclude) * 5))
                if 0 < len(rows) <= RARE_ANSWER:
                    hit = ("answer", rows); break
        if not hit:
            continue
        kind, rows = hit
        results.append({"i": i, "kind": kind, "total": len(rows),
                        "where": [{"pack": r[0], "tq": r[1], "price": r[2]} for r in rows[:SHOW]]})
        for pid in {r[0] for r in rows}:
            per_pack.setdefault(pid, {"exact": 0, "media": 0, "answer": 0})[kind] += 1

    shown = {w["pack"] for r in results for w in r["where"]}
    top = sorted(per_pack.items(), key=lambda kv: (-(kv[1]["exact"] + kv[1]["media"]), -kv[1]["answer"],
                                                   pinfo(kv[0])[1] or 1 << 62, kv[0]))[:10]
    shown |= {pid for pid, _ in top}
    packs = {}
    for pid in shown:
        name, date_ts, authors, _ = pinfo(pid)
        packs[str(pid)] = {"name": name, "url": PACK_URL.format(pid), "date": date_ts, "authors": authors}
    themes = {}
    for r in results:
        for w in r["where"]:
            key = f"{w['pack']}:{w['tq'] // 1000}"
            if key not in themes:
                t = db.execute("SELECT round, name FROM themes WHERE pack=? AND t=?", (w["pack"], w["tq"] // 1000)).fetchone()
                themes[key] = list(t) if t else ["", ""]
    summary = [{"pack": pid, **c} for pid, c in top]
    return {"results": results, "packs": packs, "themes": themes, "summary": summary}


def index_info(db):
    m = get_meta(db)
    return {"builtAt": m.get("built_at"), "packs": int(m.get("packs", 0) or 0),
            "questions": int(m.get("questions", 0) or 0), "normVersion": int(m.get("norm_version", 0) or 0)}


# ---------- файлы данных ----------

def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_atomic(path, data: bytes):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def write_json(path, obj, indent=None):
    write_atomic(path, json.dumps(obj, ensure_ascii=False, indent=indent).encode("utf-8"))


def read_xml_gz(path) -> bytes:
    with gzip.open(path) as f:
        return f.read()
