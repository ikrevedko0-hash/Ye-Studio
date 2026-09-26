"""Сверить вопросы со всеми паками FirePacks (~10 600) по базе на сервере Ye!Studio.

python "проверить повторы.py" <пачка вопросов.json | пак.siq> [--no-write]

Пачка (stage: "questions"): каждому вопросу с совпадением дописывается поле "dup" — страница разметки
покажет метку со ссылкой на пак. Без --no-write файл пачки перезаписывается (копия — <имя>.bak.json).
Пак .siq: печатает отчёт (текст, ответы и файлы вопросов сверяются байт в байт).

🔴 дословно — тот же текст, ответ и файлы;  🔴 тот же файл — та же картинка/звук байт в байт;
🟠 тот же ответ — редкий ответ уже был: факт мог повториться — решать глазами.
Сервер хранит только отпечатки, текст вопросов не сохраняет. Только стандартная библиотека Python.
"""
import json, pathlib, re, shutil, sys, urllib.error, urllib.parse, urllib.request, zipfile
from xml.etree import ElementTree as ET

SERVER = "http://193.233.112.48:8787"      # тот же, что в Ye!Studio (app/src/shared/server.ts)
KEY = "yes-beta-2026"
KIND = {"exact": "🔴 дословно", "media": "🔴 тот же файл", "answer": "🟠 тот же ответ"}
FOLDER = {"image": "Images", "audio": "Audio", "voice": "Audio", "video": "Video", "html": "Html"}

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def check(questions):
    body = json.dumps({"questions": questions}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(f"{SERVER}/api/pack-check", data=body, method="POST",
                                 headers={"Content-Type": "application/json", "X-YeStudio-Key": KEY})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        why = {503: "база повторов на сервере ещё не готова", 429: "слишком много проверок — через час",
               413: "слишком много вопросов (больше 3000)"}.get(e.code, f"сервер ответил {e.code}")
        sys.exit(f"Проверка не удалась: {why}. Можно проверить в Ye!Studio: «Проверка пака» → «Найти повторы».")
    except (urllib.error.URLError, OSError) as e:
        sys.exit(f"Нет связи с сервером проверки ({e}). Можно проверить позже в Ye!Studio: «Проверка пака» → «Найти повторы».")


def places(res, r):
    out = []
    for w in r["where"]:
        p = res["packs"].get(str(w["pack"]), {})
        th = res["themes"].get(f"{w['pack']}:{w['tq'] // 1000}", ["", ""])
        out.append({"name": p.get("name", ""), "url": p.get("url", ""), "theme": th[1], "price": w["price"]})
    return out


def siq_questions(path):
    """Вопросы .siq (SIQ 5 и 4): подпись, текст, ответы, отпечатки файлов вопроса «crc32:размер»."""
    with zipfile.ZipFile(path) as z:
        info = [i for i in z.infolist() if i.filename.lower().endswith("content.xml")][0]
        root = ET.fromstring(z.read(info))
        files = {urllib.parse.unquote(i.filename): i for i in z.infolist()}
    for el in root.iter():
        if isinstance(el.tag, str) and "}" in el.tag:
            el.tag = el.tag.split("}", 1)[1]

    def fp(kind, ref):
        i = files.get(f"{FOLDER.get(kind, '')}/{ref}") or files.get(ref)
        return f"{i.CRC & 0xFFFFFFFF:08x}:{i.file_size}" if i and i.file_size else None

    out = []
    for th in root.iter("theme"):
        for q in th.iter("question"):
            text, media = [], []
            p = q.find("params")
            if p is not None:
                for par in p.findall("param"):
                    if par.get("name") != "question":
                        continue
                    for it in par.iter("item"):
                        kind, val = (it.get("type") or "text").lower(), (it.text or "").strip()
                        if kind in ("text", "say"):
                            text.append(val)
                        elif val and (it.get("isRef") or "").lower() == "true":
                            media.append(fp(kind, val))
            sc = q.find("scenario")
            if sc is not None:
                for at in sc.findall("atom"):
                    kind, val = (at.get("type") or "text").lower(), (at.text or "").strip()
                    if kind == "marker":
                        break
                    if kind in ("text", "say", ""):
                        text.append(val)
                    elif val.startswith("@"):
                        media.append(fp(kind, val[1:]))
            right = q.find("right")
            answers = [a.text.strip() for a in right.findall("answer") if a.text and a.text.strip()] if right is not None else []
            out.append((f"{th.get('name')} / {q.get('price')}",
                        {"text": " ".join(t for t in text if t), "answers": answers, "media": [m for m in media if m]}))
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__); return
    src = pathlib.Path(args[0])
    if src.suffix.lower() == ".siq":
        items, batch = siq_questions(src), None
    else:
        batch = json.loads(src.read_text(encoding="utf-8-sig"))
        items = []
        for t in batch.get("themes", []):
            for q in t.get("questions", []):
                answers = [q.get("answer") or ""] + list(q.get("accept") or [])
                items.append((f"{t.get('name')} / {q.get('price')}", {"text": q.get("text") or "", "answers": answers, "media": []}, q))
    res = check([it[1] for it in items])
    info = res.get("index", {})
    print(f"База FirePacks от {str(info.get('builtAt') or '?')[:10]}: {info.get('packs')} паков. Проверено вопросов: {len(items)}.\n")
    for s in res.get("summary", []):
        if s["exact"] + s["media"] >= 3:
            p = res["packs"].get(str(s["pack"]), {})
            print(f"⚠ С паком «{p.get('name')}» совпадает {s['exact'] + s['media']} вопросов: {p.get('url')}")
    hit_ids = set()
    for r in res.get("results", []):
        label, q = items[r["i"]][0], items[r["i"]][1]
        where = places(res, r)
        more = f"  …и ещё {r['total'] - len(where)}" if r["total"] > len(where) else ""
        print(f"{label}: {q['answers'][0] if q['answers'] else ''}\n    {KIND[r['kind']]}: "
              + "\n      ".join(f"«{w['name']}» / {w['theme']} / {w['price']}  {w['url']}" for w in where) + more)
        if batch is not None:
            items[r["i"]][2]["dup"] = {"kind": r["kind"], "total": r["total"], "where": where}
            hit_ids.add(r["i"])
    print(f"\nС совпадениями: {len(res.get('results', []))} из {len(items)}.")
    if batch is not None and "--no-write" not in sys.argv:
        for i, it in enumerate(items):                 # старые метки от прошлой проверки — снять
            if i not in hit_ids:
                it[2].pop("dup", None)
        shutil.copyfile(src, src.with_suffix(".bak.json"))
        src.write_text(json.dumps(batch, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"Метки «dup» записаны в {src.name} — пересоберите страницу разметки.")


if __name__ == "__main__":
    main()
