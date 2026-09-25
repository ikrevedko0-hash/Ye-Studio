"""Вставить тему с картинками с диска прямо в .siq, не трогая остальное.

python "вставить тему в пак.py" <пак.siq> <тема.json>
тема.json: {"round": 1, "name": "...", "comment": "...",
            "questions": [{"price": 100, "image": "путь/к/файлу.jpg", "text": "", "answer": "...", "accept": ["..."]}]}
Правила: тема встаёт на место первой ПУСТОЙ заготовки в раунде (все вопросы без текста, ответа и медиа),
иначе дописывается в конец раунда. Рядом сохраняется копия пака «… — копия до вставки.siq».
Имена картинок внутри пака — «<тема> N.ext», чтобы имя файла не выдавало ответ.
"""
import json, re, shutil, sys, urllib.parse, zipfile, pathlib
from xml.sax.saxutils import escape
pack, spec = pathlib.Path(sys.argv[1]), json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8-sig"))
shutil.copy(pack, pack.with_name(pack.stem + " — копия до вставки.siq"))
zin = zipfile.ZipFile(pack); raw = zin.read("content.xml"); bom = raw.startswith(b"\xef\xbb\xbf"); xml = raw.decode("utf-8-sig")
have = {urllib.parse.unquote(n.split("/", 1)[1]) for n in zin.namelist() if n.startswith("Images/")}
qs, files = [], []
for i, q in enumerate(spec["questions"], 1):
    items = ""
    if q.get("image"):
        p = pathlib.Path(q["image"]); name = f'{spec["name"].strip("*")} {i}{p.suffix}'
        k = 2
        while name in have: name = f'{spec["name"].strip("*")} {i}-{k}{p.suffix}'; k += 1
        have.add(name); files.append((name, p)); items += f'<item type="image" isRef="True">{escape(name)}</item>'
    if q.get("text"): items += f'<item>{escape(q["text"])}</item>'
    ans = "".join(f"<answer>{escape(a)}</answer>" for a in [q["answer"]] + q.get("accept", []))
    qs.append(f'<question price="{q["price"]}"><params><param name="question" type="content">{items or "<item></item>"}</param></params><right>{ans}</right></question>')
info = f'<info><comments>{escape(spec["comment"])}</comments></info>' if spec.get("comment") else ""
theme = f'<theme name="{escape(spec["name"], {chr(34): "&quot;"})}">{info}<questions>{"".join(qs)}</questions></theme>'
rounds = [m for m in re.finditer(r"<round [^>]*>.*?</round>", xml, re.S)]
r = rounds[spec["round"] - 1]; body = r.group(0)
empty = next((m for m in re.finditer(r"<theme [^>]*>.*?</theme>", body, re.S)
              if not re.search(r"<item[^>]*>[^<]+</item>|<answer>[^<]+</answer>|isRef", m.group(0))), None)
new_body = body[:empty.start()] + theme + body[empty.end():] if empty else body.replace("</themes>", theme + "</themes>", 1)
xml = xml[:r.start()] + new_body + xml[r.end():]
tmp = pack.with_suffix(".tmp")
with zipfile.ZipFile(tmp, "w") as z:
    z.writestr(zipfile.ZipInfo("content.xml", date_time=zin.getinfo("content.xml").date_time), (b"\xef\xbb\xbf" if bom else b"") + xml.encode(), compress_type=zipfile.ZIP_DEFLATED)
    for info_ in zin.infolist():
        if info_.filename != "content.xml": z.writestr(info_, zin.read(info_.filename))
    for name, p in files: z.write(p, "Images/" + urllib.parse.quote(name, safe="()[],!'&#@~$+;=:"), compress_type=zipfile.ZIP_STORED)
zin.close(); tmp.replace(pack)
print("вставлено:", spec["name"], "вопросов:", len(qs), "на место пустой заготовки" if empty else "в конец раунда")
