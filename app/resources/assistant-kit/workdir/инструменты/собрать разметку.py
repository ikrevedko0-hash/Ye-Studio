"""Собрать страницу разметки из пачки предложений.

python "собрать разметку.py" <пачка.json> <выход.html>
Шаблон выбирается по полю "stage": "themes" или "questions".
"""
import json, sys, pathlib
here = pathlib.Path(__file__).parent
batch = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
tpl = here / ("шаблон разметки тем.html" if batch.get("stage") == "themes" else "шаблон разметки вопросов.html")
html = tpl.read_text(encoding="utf-8").replace("/*DATA*/null", json.dumps(batch, ensure_ascii=False).replace("</", "<\\/"))
pathlib.Path(sys.argv[2]).write_text(html, encoding="utf-8")
print("готово:", sys.argv[2])
