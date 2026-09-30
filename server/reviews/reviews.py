"""Отзывы игроков на Уе!паки: хранилище, глубина погружения, выгрузка для автора и Claude.

Только стандартная библиотека. Данные — $YES_DATA/reviews/:
  packs/<slug>/manifest.json + миниатюры   (кладёт автор, build_manifest.py)
  reviews.sqlite                           (ответы игроков)
  admin-token                              (ключ выгрузки, создаётся сам)

CLI на сервере (через yes-admin reviews):
  python3 reviews.py summary [slug]   сводка по пакам
  python3 reviews.py export <slug>    JSON для автора (то же, что /api/review/export/<slug>)
  python3 reviews.py hide <slug> <ник>  убрать ник с доски
  python3 reviews.py token            ключ выгрузки
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
from collections import Counter

# --- что игрок может ответить (в тех же словах, что в разметке labeler, где совпадает) -------------

DISLIKES = {  # «что не зашло» в целом
    "ai": "Много ИИ-контента", "boring": "Скучно / банально", "hard": "Слишком сложно", "easy": "Слишком легко",
    "sound": "Много звука и видео", "dup": "Вопросы уже были", "broken": "Криво собрано", "long": "Затянуто",
    "humor": "Юмор не мой", "niche": "Не для моего поколения",
}
LIKES = {  # «что зашло» в целом
    "pics": "Картинки", "themes": "Темы", "humor": "Юмор", "nostalgia": "Ностальгия", "final": "Финал",
    "balance": "Сложность в самый раз", "mechanics": "Необычные механики", "adult": "Взрослые темы",
}
CONTEXT = {"friends": "С друзьями", "stream": "Смотрел стрим", "host": "Вёл сам", "random": "С незнакомцами в SIGame"}
# Причины к вопросу. boring/wording/wrong/hint/media — как REASONS в шаблоне разметки вопросов.
WHY = {
    "boring": "Скучно", "wording": "Непонятно, что хотят", "wrong": "Факт неверен", "hint": "Ответ подсказан",
    "media": "Трудно с медиа", "dup": "Уже было", "easy": "Слишком легко", "hard": "Слишком сложно",
}
REACTIONS = ("fire", "ok", "meh")          # 🔥 огонь / 👌 норм / 💩 мимо
THEME_MARKS = ("fire", "poop")
TEXTS = ("author", "idea", "steal")        # автору / идея темы / вопрос, который бы украл
MAX_TEXT = 1000
MAX_NICK = 24

# Глубина в метрах: до дна Марианской впадины (10 994 м) — только если ответил на всё.
DEPTH_RATING, DEPTH_CHIP, DEPTH_CHIPS_MAX, DEPTH_CTX, DEPTH_DIFF = 5, 15, 10, 20, 20
DEPTH_THEMES, DEPTH_QUESTIONS, DEPTH_TEXT = 600, 9200, 333
DEPTH_MAX = 10994
BOARD_MIN_DEPTH = 500   # на доску — только нырнувшие хотя бы на 500 м

NEW_PLAYERS_PER_IP_DAY = 25   # больше новых дайверов с одного адреса за сутки — это не игроки

SLUG_RE = re.compile(r"^[a-z0-9-]{1,32}$")
PID_RE = re.compile(r"^[a-f0-9]{16,32}$")
FILE_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
URLISH_RE = re.compile(r"(https?:|://|www\.|\.(ru|com|net|org|su|рф|io|me)\b)", re.I)
CTRL_RE = re.compile(r"[\x00-\x1f\x7f​-‏‪-‮]")


def blurb_text(text, limit: int = 160) -> str:
    """Отзыв целиком, если короткий; иначе первые предложения до limit и «…»."""
    text = " ".join(str(text or "").split())
    if len(text) < 4 or re.search(r"https?:|www\.|\w\.(ru|com|рф|net|org|me|io)(?!\w)|@\w", text, re.I):
        return ""   # ссылки и контакты на главную не выводим
    if len(text) <= limit:
        return text
    cut = max(text.rfind(c, 0, limit) for c in ".!?")
    return text[:cut + 1] if cut >= 40 else text[:limit].rsplit(" ", 1)[0] + "…"


class Invalid(Exception):
    pass


def clean_text(value, limit: int) -> str:
    if not isinstance(value, str):
        raise Invalid("text")
    lines = value.replace("\r\n", "\n").split("\n")
    return "\n".join(CTRL_RE.sub(" ", ln) for ln in lines).strip()[:limit]


def clean_nick(value) -> str:
    nick = " ".join(CTRL_RE.sub(" ", value).split())[:MAX_NICK] if isinstance(value, str) else ""
    return "" if URLISH_RE.search(nick) else nick


class Store:
    def __init__(self, data_dir: str, salt: str = ""):
        self.root = os.path.join(data_dir, "reviews")
        self.packs_dir = os.path.join(self.root, "packs")
        os.makedirs(self.packs_dir, exist_ok=True)
        self.db_path = os.path.join(self.root, "reviews.sqlite")
        self._lock = threading.Lock()
        self._manifests: dict = {}   # slug → (mtime, manifest, raw bytes)
        self.salt = salt or self._secret("ip-salt")
        with self._db() as db:
            db.executescript("""
            create table if not exists players(
              pid text, slug text, nick text default '', hidden int default 0, ip text, depth int default 0,
              score int default 0, created real, updated real, primary key(pid, slug));
            create table if not exists answers(
              pid text, slug text, key text, value text, ts real, primary key(pid, slug, key));
            create index if not exists players_slug on players(slug, depth);
            create index if not exists players_ip on players(ip, created);
            """)

    # --- служебное ---------------------------------------------------------------------------------

    def _db(self):
        db = sqlite3.connect(self.db_path, timeout=10)
        db.execute("pragma journal_mode=wal")
        return db

    def _secret(self, name: str) -> str:
        path = os.path.join(self.root, name)
        try:
            with open(path, encoding="utf-8") as f:
                value = f.read().strip()
            if value:
                return value
        except OSError:
            pass
        value = secrets.token_urlsafe(24)
        with open(path, "w", encoding="utf-8") as f:
            f.write(value)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
        return value

    def admin_token(self) -> str:
        return self._secret("admin-token")

    def ip_hash(self, ip: str) -> str:
        return hashlib.sha256((self.salt + ip).encode()).hexdigest()[:16]

    # --- паки --------------------------------------------------------------------------------------

    def manifest(self, slug: str):
        """(manifest dict, raw bytes) или None."""
        if not SLUG_RE.match(slug or ""):
            return None
        path = os.path.join(self.packs_dir, slug, "manifest.json")
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            return None
        cached = self._manifests.get(slug)
        if cached and cached[0] == mtime:
            return cached[1], cached[2]
        with open(path, "rb") as f:
            raw = f.read()
        m = json.loads(raw.decode("utf-8"))
        m["_qids"] = {q["id"] for r in m["rounds"] for t in r["themes"] for q in t["questions"]}
        m["_tids"] = {t["id"] for r in m["rounds"] for t in r["themes"]}
        self._manifests[slug] = (mtime, m, raw)
        return m, raw

    def pack_file(self, slug: str, name: str):
        if not SLUG_RE.match(slug or "") or not FILE_RE.match(name or "") or name.startswith("."):
            return None
        path = os.path.join(self.packs_dir, slug, name)
        return path if os.path.isfile(path) else None

    def packs(self) -> list:
        slugs = [s for s in os.listdir(self.packs_dir) if SLUG_RE.match(s)] if os.path.isdir(self.packs_dir) else []
        with self._db() as db:
            divers = dict(db.execute("select slug, count(*) from players where depth > 0 group by slug").fetchall())
        out = []
        for s in slugs:
            got = self.manifest(s)
            if not got:
                continue
            m = got[0]
            out.append({"slug": s, "title": m.get("title", s), "date": m.get("date", ""),
                        "logo": m.get("logo"), "questions": len(m["_qids"]), "divers": divers.get(s, 0)})

        def order(p):  # свежие сверху: номер пака, если slug — число
            return (0, -int(p["slug"])) if p["slug"].isdigit() else (1, p["slug"])
        return sorted(out, key=order)

    # --- глубина -----------------------------------------------------------------------------------

    @staticmethod
    def depth(answers: dict, n_themes: int, n_questions: int) -> int:
        d = 0.0
        if "rating" in answers:
            d += DEPTH_RATING
        chips = len(answers.get("dis") or []) + len(answers.get("like") or [])
        d += DEPTH_CHIP * min(chips, DEPTH_CHIPS_MAX)
        if "ctx" in answers:
            d += DEPTH_CTX
        if "diff" in answers:
            d += DEPTH_DIFF
        th = sum(1 for k in answers if k.startswith("th:"))
        qs = sum(1 for k in answers if k.startswith("q:"))
        if n_themes:
            d += DEPTH_THEMES * min(th, n_themes) / n_themes
        if n_questions:
            d += DEPTH_QUESTIONS * min(qs, n_questions) / n_questions
        d += DEPTH_TEXT * sum(1 for t in TEXTS if answers.get("txt:" + t))
        return min(DEPTH_MAX, round(d))

    # --- проверка одного ответа --------------------------------------------------------------------

    @staticmethod
    def check_value(m: dict, key: str, value):
        """Нормализованное значение или Invalid. None — удалить ответ."""
        if value is None:
            return None
        if key == "rating" or key == "diff":
            hi = 10 if key == "rating" else 5
            if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= hi:
                raise Invalid(key)
            return value
        if key in ("dis", "like"):
            allowed = DISLIKES if key == "dis" else LIKES
            if not isinstance(value, list) or any(v not in allowed for v in value):
                raise Invalid(key)
            return sorted(set(value))
        if key == "ctx":
            if value not in CONTEXT:
                raise Invalid(key)
            return value
        if key.startswith("th:"):
            if key[3:] not in m["_tids"] or value not in THEME_MARKS:
                raise Invalid(key)
            return value
        if key.startswith("q:"):
            if key[2:] not in m["_qids"] or not isinstance(value, dict):
                raise Invalid(key)
            r, why = value.get("r"), value.get("why") or []
            if r not in REACTIONS or not isinstance(why, list) or any(w not in WHY for w in why):
                raise Invalid(key)
            return {"r": r, "why": sorted(set(why))} if why else {"r": r}
        if key.startswith("txt:") and key[4:] in TEXTS:
            text = clean_text(value, MAX_TEXT)
            return text or None
        raise Invalid(key)

    # --- сохранение --------------------------------------------------------------------------------

    def save(self, slug: str, pid: str, answers: dict, nick, score, ip: str) -> dict:
        got = self.manifest(slug)
        if not got:
            raise Invalid("pack")
        m = got[0]
        if not PID_RE.match(pid or ""):
            raise Invalid("pid")
        if not isinstance(answers, dict) or len(answers) > len(m["_qids"]) + len(m["_tids"]) + 20:
            raise Invalid("answers")
        clean = {k: self.check_value(m, k, v) for k, v in answers.items() if isinstance(k, str)}
        now, iph = time.time(), self.ip_hash(ip)
        with self._lock, self._db() as db:
            row = db.execute("select nick from players where pid=? and slug=?", (pid, slug)).fetchone()
            if row is None:
                recent = db.execute("select count(distinct pid) from players where ip=? and created>?",
                                    (iph, now - 86400)).fetchone()[0]
                if recent >= NEW_PLAYERS_PER_IP_DAY:
                    raise Invalid("too many players from this address")
                db.execute("insert into players(pid, slug, ip, created, updated) values(?,?,?,?,?)",
                           (pid, slug, iph, now, now))
            for k, v in clean.items():
                if v is None:
                    db.execute("delete from answers where pid=? and slug=? and key=?", (pid, slug, k))
                else:
                    db.execute("insert or replace into answers values(?,?,?,?,?)",
                               (pid, slug, k, json.dumps(v, ensure_ascii=False), now))
            all_answers = {k: json.loads(v) for k, v in
                           db.execute("select key, value from answers where pid=? and slug=?", (pid, slug))}
            depth = self.depth(all_answers, len(m["_tids"]), len(m["_qids"]))
            # очки с комбо считает страница; верим им не больше, чем в 6 раз глубины (ну и мелочь сверху)
            sc = score if isinstance(score, int) and not isinstance(score, bool) else 0
            sc = max(0, min(sc, depth * 6 + 500))
            fields, vals = "depth=?, score=max(score, ?), updated=?", [depth, sc, now]
            if nick is not None:
                fields += ", nick=?"
                vals.append(clean_nick(nick))
            db.execute(f"update players set {fields} where pid=? and slug=?", (*vals, pid, slug))
            total, shallower = db.execute(
                "select count(*), sum(depth < ?) from players where slug=? and depth > 0", (depth, slug)).fetchone()
        pct = round(100 * (shallower or 0) / (total - 1)) if total and total > 1 else 100
        return {"depth": depth, "deeperThan": pct, "divers": total or 0}

    def board(self, slug: str, limit: int = 20) -> list:
        with self._db() as db:
            rows = db.execute(
                "select nick, depth, score from players where slug=? and nick!='' and hidden=0 and depth>=? "
                "order by depth desc, score desc, updated asc limit ?", (slug, BOARD_MIN_DEPTH, limit)).fetchall()
        return [{"nick": n, "depth": d, "score": s} for n, d, s in rows]

    def quotes(self, limit: int = 50) -> list:
        """Свежие отзывы «автору» для главной, как цитаты критиков на обложке. Скрытые игроки не попадают."""
        titles = {p["slug"]: p["title"] for p in self.packs()}
        with self._db() as db:
            rows = db.execute(
                "select a.slug, a.value, p.nick, p.depth from answers a join players p on p.pid=a.pid and p.slug=a.slug "
                "where a.key='txt:author' and p.hidden=0 order by a.ts desc limit ?", (limit * 2,)).fetchall()
        out = []
        for slug, value, nick, depth in rows:
            text = blurb_text(json.loads(value) if value else "")
            if slug in titles and text:
                out.append({"text": text, "nick": nick, "depth": depth, "pack": titles[slug]})
        return out[:limit]

    def hide(self, slug: str, nick: str) -> int:
        with self._db() as db:
            return db.execute("update players set hidden=1 where slug=? and nick=?", (slug, nick)).rowcount

    # --- выгрузка для автора и Claude --------------------------------------------------------------

    def export(self, slug: str) -> dict:
        got = self.manifest(slug)
        if not got:
            raise Invalid("pack")
        m = got[0]
        with self._db() as db:
            players = db.execute("select pid, depth from players where slug=? and depth>0", (slug,)).fetchall()
            rows = db.execute("select pid, key, value from answers where slug=?", (slug,)).fetchall()
        live = {p for p, _ in players}
        per: dict = {}
        for pid, key, value in rows:
            if pid in live:
                per.setdefault(pid, {})[key] = json.loads(value)

        ratings = [a["rating"] for a in per.values() if "rating" in a]
        diffs = [a["diff"] for a in per.values() if "diff" in a]
        count = lambda key, names: {names[k]: n for k, n in Counter(v for a in per.values() for v in a.get(key) or []).most_common()}
        themes, questions = [], []
        for ri, r in enumerate(m["rounds"], 1):
            for t in r["themes"]:
                marks = Counter(a.get("th:" + t["id"]) for a in per.values())
                themes.append({"id": t["id"], "round": r["name"], "name": t["name"],
                               "fire": marks["fire"], "poop": marks["poop"]})
                for q in t["questions"]:
                    got_q = [a["q:" + q["id"]] for a in per.values() if "q:" + q["id"] in a]
                    react = Counter(g["r"] for g in got_q)
                    why = Counter(w for g in got_q for w in g.get("why", []))
                    questions.append({
                        "id": q["id"], "round": r["name"], "theme": t["name"], "price": q["price"],
                        "text": q.get("text", ""), "answer": q.get("answer", ""), "media": q.get("media", []),
                        "votes": len(got_q), "fire": react["fire"], "ok": react["ok"], "meh": react["meh"],
                        "reasons": {WHY[k]: n for k, n in why.most_common()},
                    })
        texts = [{"kind": k, "text": a["txt:" + k]} for a in per.values() for k in TEXTS if a.get("txt:" + k)]
        return {
            "v": 1, "source": "players", "pack": m.get("title", slug), "slug": slug,
            "exportedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "players": len(per), "avgDepth": round(sum(d for _, d in players) / len(players)) if players else 0,
            "rating": {"avg": round(sum(ratings) / len(ratings), 2) if ratings else None,
                       "hist": dict(sorted(Counter(ratings).items()))},
            "difficulty": {"avg": round(sum(diffs) / len(diffs), 2) if diffs else None,
                           "scale": "1 — детский сад, 5 — ад"},
            "dislikes": count("dis", DISLIKES), "likes": count("like", LIKES),
            "context": {CONTEXT[k]: n for k, n in Counter(a["ctx"] for a in per.values() if "ctx" in a).most_common()},
            "themes": themes, "questions": questions, "texts": texts,
        }

    def summary(self, slug: str | None = None) -> str:
        lines = []
        for p in self.packs():
            if slug and p["slug"] != slug:
                continue
            e = self.export(p["slug"])
            lines.append(f"{p['title']}: дайверов {e['players']}, оценка {e['rating']['avg']}, "
                         f"средняя глубина {e['avgDepth']} м")
            if slug:
                lines.append("  не зашло: " + ", ".join(f"{k} {v}" for k, v in e["dislikes"].items()))
                lines.append("  зашло: " + ", ".join(f"{k} {v}" for k, v in e["likes"].items()))
        return "\n".join(lines) or "паков нет"


def main(argv: list) -> int:
    store = Store(os.environ.get("YES_DATA", "/opt/yestudio/data"))
    cmd = argv[0] if argv else ""
    if cmd == "summary":
        print(store.summary(argv[1] if len(argv) > 1 else None))
    elif cmd == "export" and len(argv) == 2:
        print(json.dumps(store.export(argv[1]), ensure_ascii=False, indent=1))
    elif cmd == "hide" and len(argv) == 3:
        print("скрыто:", store.hide(argv[1], argv[2]))
    elif cmd == "token":
        print(store.admin_token())
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
