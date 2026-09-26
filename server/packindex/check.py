"""Проверить пак (.siq) или пачку предложений (.json «Из Claude») на повторы по index.sqlite.

    python check.py <индекс.sqlite> <пак.siq | пачка.json> [--exclude 123,456]

Та же проверка, что на сервере (/api/pack-check), — удобно сверить результат руками.
🔴 дословно — тот же текст, ответ и файлы;  🔴 тот же файл — байт в байт;  🟠 тот же редкий ответ.
"""
import json, os, sys, zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import packlib  # noqa: E402

MARK = {"exact": "🔴 дословно", "media": "🔴 тот же файл", "answer": "🟠 тот же ответ"}


def load(path):
    """→ [(подпись, {text, answers, media})]"""
    if path.lower().endswith(".siq"):
        with zipfile.ZipFile(path) as z:
            info = [i for i in z.infolist() if i.filename.lower().endswith("content.xml")][0]
            xml = z.read(info)
            files = packlib.zip_names_to_files([{"name": i.filename, "size": i.file_size, "crc": i.CRC} for i in z.infolist()])
        pk = packlib.parse_pack(xml)
        return [(f"{q['theme']} / {q['price']}",
                 {"text": q["text"], "answers": q["answers"],
                  "media": [f for f in (packlib.media_fp(k, r, files) for k, r, _ in q["media"]) if f]})
                for q in pk["questions"]]
    with open(path, encoding="utf-8-sig") as f:
        d = json.load(f)
    out = []
    for t in d.get("themes", []):
        for q in t.get("questions", []):
            out.append((f"{t.get('name')} / {q.get('price')}",
                        {"text": q.get("text", ""), "answers": [q.get("answer", "")] + list(q.get("accept") or []), "media": []}))
    return out


def main():
    args = [x for x in sys.argv[1:] if not x.startswith("--")]
    if len(args) < 2:
        print(__doc__); return 1
    exclude = []
    if "--exclude" in sys.argv:
        exclude = sys.argv[sys.argv.index("--exclude") + 1].split(",")
        args = [x for x in args if x != sys.argv[sys.argv.index("--exclude") + 1]]
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    index, path = args[0], args[1]
    if not os.path.exists(index):
        print(f"Нет индекса: {index}. Сначала обновите базу."); return 1
    db = packlib.open_index(index, readonly=True)
    if not packlib.index_compatible(db):
        print("Индекс старого формата или не достроен — запустите «Скачать базу.cmd» (или «Пересобрать индекс.cmd»)."); return 1
    info = packlib.index_info(db)
    items = load(path)
    res = packlib.check(db, [q for _, q in items], exclude)
    print(f"База от {info['builtAt']}: {info['packs']} паков, {info['questions']} вопросов.\n")
    for s in res["summary"][:5]:
        p = res["packs"][str(s["pack"])]
        if s["exact"] + s["media"] >= 3:
            print(f"⚠ С паком «{p['name']}» совпадает {s['exact'] + s['media']} вопросов: {p['url']}")
    for r in res["results"]:
        label, q = items[r["i"]]
        where = []
        for w in r["where"]:
            p = res["packs"][str(w["pack"])]
            th = res["themes"].get(f"{w['pack']}:{w['tq'] // 1000}", ["", ""])
            where.append(f"«{p['name']}» / {th[1]} / {w['price'] if w['price'] is not None else '?'}  {p['url']}")
        more = f"  …и ещё {r['total'] - len(where)}" if r["total"] > len(where) else ""
        print(f"{label}: {q['answers'][0] if q['answers'] else ''}\n    {MARK[r['kind']]}: " + "\n      ".join(where) + more)
    print(f"\nПроверено вопросов: {len(items)}, с совпадениями: {len(res['results'])}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
