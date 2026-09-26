"""Новые Уе!паки с FirePacks — на страницу отзывов сами (таймер yestudio-reviews, раз в час).

python3 autopublish.py [--dry-run]

Смотрит первую страницу свежих паков FirePacks (100 последних). Пак автора с названием «Уе!пак №N», которого
ещё нет в packs/, скачивается целиком (ссылка из каталога) и собирается в манифест с миниатюрами
(build_manifest.py) — на странице он появляется сразу. Номер из названия = адрес страницы (уепак.рф/N).

- Старый манифест того же номера в packs-hidden/ (собранный до выхода) заменяется версией с FirePacks.
- Номер в reviews/autopublish-skip.txt (по строке) не публикуется никогда — если автор снял пак руками.
- Уже опубликованный пак не пересобирается: id вопросов позиционные, пересборка перепутала бы отзывы.
Итог — reviews/autopublish.json (что, когда, откуда), журнал — stdout (journalctl -u yestudio-reviews).
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sys
import tempfile
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
VENDOR = os.path.join(os.path.dirname(HERE), "vendor")   # /opt/yestudio/vendor: Pillow без системных пакетов
if os.path.isdir(VENDOR):
    sys.path.insert(0, VENDOR)
import build_manifest  # noqa: E402

DATA = os.environ.get("YES_DATA", "/opt/yestudio/data")
ROOT = os.path.join(DATA, "reviews")
API = "https://firepacks.net/api/packages?sort=added&dir=desc&unrated=1&showBlacklisted=1&pageSize=100&page=1"
UA = "Mozilla/5.0 (Ye!Studio reviews; new packs)"
AUTHORS = {"Борис Бритва"}
NAME_RE = re.compile(r"^\s*Уе!\s*пак\s*№\s*(\d{1,3})\b", re.I)
MAX_BYTES = 1 << 30     # пак больше гигабайта — что-то не то


def log(msg: str) -> None:
    print(time.strftime("%Y-%m-%d %H:%M:%S"), msg, flush=True)


def get(url: str, timeout: int = 60):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=timeout)


def candidates(packages: list) -> list:
    """[(номер, пак из каталога)] — только паки автора с названием «Уе!пак №N»."""
    out = []
    for p in packages:
        m = NAME_RE.match(p.get("name") or "")
        if m and AUTHORS & set(p.get("authors") or []):
            out.append((str(int(m.group(1))), p))
    return out


def download(url: str, dst: str) -> int:
    for attempt in range(3):
        try:
            with get(url, timeout=120) as r, open(dst, "wb") as f:
                n = 0
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        return n
                    n += len(chunk)
                    if n > MAX_BYTES:
                        raise RuntimeError("пак больше 1 ГБ")
                    f.write(chunk)
        except (OSError, urllib.error.URLError) as e:   # у VK бывают 502/504 — пробуем ещё
            if attempt == 2:
                raise
            log(f"  повтор скачивания через {30 * (attempt + 1)} с: {e}")
            time.sleep(30 * (attempt + 1))
    return 0


def publish(slug: str, p: dict, state: dict, dry: bool) -> None:
    packs, hidden = os.path.join(ROOT, "packs"), os.path.join(ROOT, "packs-hidden")
    log(f"новый пак на FirePacks: «{p['name']}» (id {p['id']}) → /{slug}")
    if dry:
        return
    work = tempfile.mkdtemp(prefix=".build-", dir=ROOT)   # в данных: у сервиса /tmp свой и маленький
    try:
        siq = os.path.join(work, "pack.siq")
        size = download(p["url"], siq)
        log(f"  скачано {size >> 20} МБ")
        build_manifest.build(slug, siq, work)
        os.remove(siq)
        if os.path.isdir(os.path.join(hidden, slug)):
            shutil.rmtree(os.path.join(hidden, slug))
            log("  убран старый скрытый манифест")
        os.makedirs(packs, exist_ok=True)
        os.replace(os.path.join(work, slug), os.path.join(packs, slug))   # появляется на странице разом
        state[slug] = {"firepacksId": p["id"], "name": p["name"], "packDate": p.get("packDate"),
                       "publishedAt": time.strftime("%Y-%m-%dT%H:%M:%S"), "thumbs": build_manifest.Image is not None}
        log(f"  опубликован: /{slug}")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main(argv: list) -> int:
    dry = "--dry-run" in argv
    state_path = os.path.join(ROOT, "autopublish.json")
    try:
        with open(state_path, encoding="utf-8") as f:
            state = json.load(f)
    except (OSError, ValueError):
        state = {}
    try:
        with open(os.path.join(ROOT, "autopublish-skip.txt"), encoding="utf-8") as f:
            skip = {ln.strip() for ln in f if ln.strip() and not ln.startswith("#")}
    except OSError:
        skip = set()
    try:
        with get(API) as r:
            packages = json.loads(r.read()).get("packages") or []
    except Exception as e:  # noqa: BLE001 — каталог не ответил: попробуем через час
        log(f"каталог FirePacks не ответил: {e}")
        return 0
    if build_manifest.Image is None:
        log("ВНИМАНИЕ: нет Pillow — паки выйдут без миниатюр (поставить: pip install --target /opt/yestudio/vendor Pillow)")
    failed = 0
    for slug, p in candidates(packages):
        if slug in skip or os.path.isdir(os.path.join(ROOT, "packs", slug)):
            continue
        try:
            publish(slug, p, state, dry)
        except Exception as e:  # noqa: BLE001 — один пак не должен мешать другим; повтор через час
            failed += 1
            log(f"  не вышло: {type(e).__name__}: {e}")
    if not dry:
        tmp = state_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=1)
        os.replace(tmp, state_path)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
