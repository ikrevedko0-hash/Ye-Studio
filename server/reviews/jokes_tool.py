"""Шутки страницы отзывов: разметка автором в формате labeler и сборка web/jokes.js.

python jokes_tool.py batch <папка>        пачка «questions» для шаблона разметки → <папка>/шутки-айсберг.json
python jokes_tool.py apply <отзывы.json>  оставить в jokes.json только взятое (с правками автора) и собрать js
python jokes_tool.py js                   собрать web/jokes.js из jokes.json как есть

Слот = «тема» разметки, вариант = «вопрос»: цена — номер варианта, текст — шутка, ответ — где показывается.
"""
from __future__ import annotations

import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "jokes.json")
JS = os.path.join(HERE, "web", "jokes.js")
# ключи, без которых страница остаётся без текста (ачивки, ярусы, служебные) — после разметки должны уцелеть
REQUIRED = {
    "tier": {"sky", "l1", "l2", "l3", "l4", "l5"},
    "ach": {"first", "hater", "mom", "d1000", "d5000", "bottom", "combo5", "meh10", "fire10", "dup", "themes",
            "critic", "fish"},
    "misc": {"offline", "empty_board", "bottom_btn", "why"},
}


def load() -> dict:
    with open(SRC, encoding="utf-8") as f:
        return json.load(f)


def write_js(data: dict) -> None:
    out = {s["id"]: [{"k": v.get("key", ""), "t": v["text"]} for v in s["variants"]] for s in data["slots"]}
    with open(JS, "w", encoding="utf-8", newline="\n") as f:
        f.write("// Собрано jokes_tool.py из jokes.json — руками не править.\n")
        f.write("window.JOKES = " + json.dumps(out, ensure_ascii=False, indent=0) + ";\n")
    missing = [f"{sid}:{k}" for sid, keys in REQUIRED.items() for k in keys
               if not any(v["k"] == k for v in out.get(sid, []))]
    if missing:
        print("ВНИМАНИЕ: не осталось ни одного варианта для", ", ".join(missing), "— страница покажет запасной текст")
    print("готово:", JS)


def batch(folder: str) -> None:
    data = load()
    themes = []
    for i, s in enumerate(data["slots"], 1):
        qs = []
        for j, v in enumerate(s["variants"], 1):
            qs.append({"id": f"t{i:02d}q{j}", "price": j, "text": v["text"],
                       "image": "", "answer": s["where"] + (f" · {v['key']}" if v.get("key") else ""),
                       "answerImage": "", "accept": [], "options": None, "type": "simple"})
        themes.append({"id": f"t{i:02d}", "round": 1, "name": s["name"], "comment": s["where"],
                       "note": "Бери сколько нравится (счётчик x/7 тут ни при чём). ✎ — поправить текст на месте. "
                               "Страница выбирает случайный из взятых вариантов. Своё — в «Ответ» впиши ключ "
                               "(то, что после «·» у соседей), иначе вариант не к чему привязать.",
                       "questions": qs})
    out = {"v": 1, "pack": "Айсберг отзывов — шутки", "batch": time.strftime("%Y-%m-%d") + "-jokes-1",
           "stage": "questions", "themes": themes}
    path = os.path.join(folder, "шутки-айсберг.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print("пачка:", path, "—", sum(len(t["questions"]) for t in themes), "шуток")


def apply(reviews_path: str) -> None:
    data = load()
    with open(reviews_path, encoding="utf-8-sig") as f:
        rev = json.load(f)
    dec = {d["id"]: d for d in rev.get("decisions", [])}
    kept = dropped = 0
    for i, s in enumerate(data["slots"], 1):
        variants = []
        for j, v in enumerate(s["variants"], 1):
            d = dec.get(f"t{i:02d}q{j}")
            if d is None or d.get("take") is None:     # не размечено — оставляем как было
                variants.append(v)
                continue
            if d.get("take"):
                edited = d.get("edited") or {}
                if edited.get("text"):
                    v = dict(v, text=edited["text"])
                variants.append(v)
                kept += 1
            else:
                dropped += 1
        # «+ своё» автора: в поле «Ответ» можно написать ключ (чип, ачивку, ярус), иначе вариант без ключа
        keys = {v.get("key", "") for v in s["variants"]}
        for o in rev.get("own", []):
            if o.get("theme") == f"t{i:02d}" and o.get("text", "").strip():
                key = o.get("answer", "").strip()
                variants.append({"text": o["text"].strip(), **({"key": key} if key in keys and key else {})})
                kept += 1
        s["variants"] = variants
    with open(SRC, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"взято {kept}, выброшено {dropped}")
    write_js(data)


def main(argv: list) -> int:
    if argv[:1] == ["batch"] and len(argv) == 2:
        batch(argv[1])
    elif argv[:1] == ["apply"] and len(argv) == 2:
        apply(argv[1])
    elif argv[:1] == ["js"]:
        write_js(load())
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
