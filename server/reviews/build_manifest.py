"""Собрать манифест пака для страницы отзывов из .siq (запускать на ПК автора).

python build_manifest.py <номер> <пак.siq> [<номер> <пак.siq> ...] [--out packs]

На выходе packs/<номер>/manifest.json + миниатюры вопросов (webp, 360 px по ширине).
Миниатюра — картинка вопроса, иначе картинка ответа, иначе кадр видео (ffmpeg). Без Pillow — без миниатюр.
Паки и так лежат на FirePacks, так что ответы в манифесте — не секрет.
"""
from __future__ import annotations

import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from urllib.parse import unquote

try:
    from PIL import Image
except ImportError:  # манифест без миниатюр тоже рабочий
    Image = None

NS = "{https://github.com/VladimirKhil/SI/blob/master/assets/siq_5.xsd}"
THUMB_W = 360
FOLDERS = {"image": "Images", "audio": "Audio", "video": "Video"}


def tag(el) -> str:
    return el.tag.replace(NS, "")


def media_index(z: zipfile.ZipFile) -> dict:
    """«Images/имя» без percent-encoding → имя в архиве."""
    out = {}
    for n in z.namelist():
        out[unquote(n)] = n
        out[n] = n
    return out


def content_items(question, param_name: str) -> list:
    """[(type, value)] из <param name=...> вопроса."""
    params = question.find(NS + "params")
    if params is None:
        return []
    for p in params:
        if p.get("name") == param_name:
            return [(it.get("type") or "text", (it.text or "").strip()) for it in p if tag(it) == "item"]
    return []


def thumb_from_image(data: bytes):
    img = Image.open(io.BytesIO(data))
    img.seek(0)  # gif — первый кадр
    img = img.convert("RGB")
    if img.width > THUMB_W:
        img = img.resize((THUMB_W, round(img.height * THUMB_W / img.width)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=62, method=5)
    return buf.getvalue()


def thumb_from_video(data: bytes):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = os.path.join(tmp, "v"), os.path.join(tmp, "f.png")
        with open(src, "wb") as f:
            f.write(data)
        for ss in ("1", "0"):
            subprocess.run([ffmpeg, "-v", "quiet", "-y", "-ss", ss, "-i", src, "-frames:v", "1", dst])
            if os.path.exists(dst):
                with open(dst, "rb") as f:
                    return thumb_from_image(f.read())
    return None


def make_thumb(z, idx, kind: str, name: str):
    arc = idx.get(f"{FOLDERS[kind]}/{name}")
    if not arc:
        return None
    try:
        data = z.read(arc)
        return thumb_from_image(data) if kind == "image" else thumb_from_video(data)
    except Exception as e:  # битая картинка не должна ронять весь пак
        print(f"  ! миниатюра {name}: {e}", file=sys.stderr)
        return None


def build(slug: str, siq_path: str, out_root: str) -> dict:
    z = zipfile.ZipFile(siq_path)
    idx = media_index(z)
    root = ET.fromstring(z.read("content.xml").decode("utf-8-sig"))
    out_dir = os.path.join(out_root, slug)
    if os.path.isdir(out_dir):
        shutil.rmtree(out_dir)
    os.makedirs(out_dir)

    manifest = {"v": 1, "slug": slug, "title": root.get("name", ""), "date": root.get("date", ""),
                "logo": None, "rounds": []}
    logo = (root.get("logo") or "").lstrip("@")
    if logo and Image:
        t = make_thumb(z, idx, "image", logo)
        if t:
            with open(os.path.join(out_dir, "logo.webp"), "wb") as f:
                f.write(t)
            manifest["logo"] = "logo.webp"

    total = thumbs = 0
    for ri, rnd in enumerate(root.iter(NS + "round"), 1):
        r = {"name": rnd.get("name", f"Раунд {ri}"), "final": rnd.get("type") == "final", "themes": []}
        for ti, theme in enumerate(rnd.iter(NS + "theme"), 1):
            tid = f"r{ri}t{ti}"
            t = {"id": tid, "name": (theme.get("name") or "").strip(), "questions": []}
            for qi, q in enumerate(theme.iter(NS + "question"), 1):
                qid = f"{tid}q{qi}"
                qitems, aitems = content_items(q, "question"), content_items(q, "answer")
                right = q.find(NS + "right")
                answers = [(a.text or "").strip() for a in right] if right is not None else []
                text = " ".join(v for k, v in qitems if k == "text").strip()
                kinds = sorted({k for k, _ in qitems if k in FOLDERS})
                qq = {"id": qid, "price": int(q.get("price") or 0), "text": text[:300],
                      "answer": next((a for a in answers if a), ""), "media": kinds, "type": q.get("type") or ""}
                if Image:
                    src = ([("image", v) for k, v in qitems if k == "image"] + [("image", v) for k, v in aitems if k == "image"]
                           + [("video", v) for k, v in qitems if k == "video"] + [("video", v) for k, v in aitems if k == "video"])
                    for kind, name in src:
                        data = make_thumb(z, idx, kind, name)
                        if data:
                            with open(os.path.join(out_dir, qid + ".webp"), "wb") as f:
                                f.write(data)
                            qq["thumb"] = qid + ".webp"
                            thumbs += 1
                            break
                t["questions"].append(qq)
                total += 1
            r["themes"].append(t)
        manifest["rounds"].append(r)

    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, separators=(",", ":"))
    size = sum(os.path.getsize(os.path.join(out_dir, n)) for n in os.listdir(out_dir))
    print(f"{slug}: {manifest['title']} — {total} вопросов, миниатюр {thumbs}, {size // 1024} КБ")
    return manifest


def main(argv: list) -> int:
    out = "packs"
    if "--out" in argv:
        i = argv.index("--out")
        out = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    if not argv or len(argv) % 2:
        print(__doc__)
        return 2
    for slug, path in zip(argv[::2], argv[1::2]):
        build(slug, path, out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
