"""Тесты базы повторов (packindex/) и /api/pack-check — только стандартная библиотека.

    python -m unittest test_packindex -v        (из папки server/)
"""
from __future__ import annotations

import gzip, http.server, importlib, io, json, os, shutil, sys, tempfile, threading, time, unittest
import urllib.error, urllib.request, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "packindex"))

import packlib  # noqa: E402
import update  # noqa: E402

SIQ5 = """<?xml version="1.0" encoding="utf-8"?>
<package name="{name}" version="5" xmlns="https://github.com/VladimirKhil/SI/blob/master/assets/siq_5.xsd">
 <info><authors><author>Автор</author></authors></info>
 <rounds><round name="Раунд 1"><themes>
  <theme name="{theme}"><questions>
   <question price="100"><params><param name="question" type="content">
     <item>{q1}</item></param></params><right><answer>{a1}</answer></right></question>
   <question price="200"><params><param name="question" type="content">
     <item type="image" isRef="True">кот.jpg</item></param></params><right><answer>Кот</answer></right></question>
   <question price="300"><params><param name="question" type="content">
     <item>Самое частое слово</item></param></params><right><answer>Москва</answer></right></question>
  </questions></theme>
 </themes></round></rounds>
</package>"""

SIQ4 = """<?xml version="1.0" encoding="utf-8"?>
<package name="Старый" version="4" xmlns="http://vladimirkhil.com/ygpackage3.0.xsd">
 <rounds><round name="1"><themes><theme name="Звери"><questions>
  <question price="100"><scenario><atom>Первый вопрос</atom><atom type="image">@кот.jpg</atom>
   <atom type="marker" /><atom type="image">@ответ.png</atom></scenario>
   <right><answer>Ехидна</answer><answer>ехидны</answer></right></question>
 </questions></theme></themes></round></rounds>
</package>"""


def siq5(name="Пак", theme="Тема", q1="Кто несёт яйца и кормит молоком?", a1="Ехидна"):
    return SIQ5.format(name=name, theme=theme, q1=q1, a1=a1).encode("utf-8")


class NormTest(unittest.TestCase):
    def test_norm(self):
        self.assertEqual(packlib.norm("  Ёжик, «в» ТУМАНЕ!! "), "ежик в тумане")
        self.assertEqual(packlib.norm("Cтарые"), "старые")          # латинская C в русском слове
        self.assertEqual(packlib.norm("Nirvana"), "nirvana")        # слово латиницей не трогаем
        self.assertEqual(packlib.norm("snake_case"), "snake case")

    def test_keys(self):
        e1, a1, m1 = packlib.question_keys("Кто это?", ["Ехидна", "ехидна!"], ["0000abcd:10"])
        e2, a2, _ = packlib.question_keys("кто ЭТО", ["ехидна"], ["0000abcd:10"])
        self.assertEqual(e1, e2)
        self.assertEqual(len(a1), 1)                               # одинаковые после norm ответы — один ключ
        self.assertEqual(len(m1), 1)
        e3, _, _ = packlib.question_keys("", ["Ехидна"], [])
        self.assertIsNone(e3)                                      # ни текста, ни файлов — «дословного» нет
        self.assertEqual(packlib.question_keys("x", [], ["../../etc"])[2], [])   # мусор вместо отпечатка


class ParseTest(unittest.TestCase):
    def test_siq5(self):
        pk = packlib.parse_pack(siq5())
        self.assertEqual(pk["authors"], ["Автор"])
        self.assertEqual(len(pk["questions"]), 3)
        q = pk["questions"][1]
        self.assertEqual(q["media"][0][:2], ("image", "кот.jpg"))
        self.assertEqual((q["t"], q["q"], q["price"]), (0, 1, "200"))

    def test_siq4(self):
        q = packlib.parse_pack(SIQ4.encode("utf-8"))["questions"][0]
        self.assertEqual(q["text"], "Первый вопрос")
        self.assertEqual([m[1] for m in q["media"]], ["кот.jpg"])
        self.assertEqual([m[1] for m in q["answer_media"]], ["ответ.png"])
        self.assertEqual(q["answers"], ["Ехидна", "ехидны"])


def make_base(root, packs):
    """packs: {id: (xml, vkTs, entries)} → папка базы, как после скачивания."""
    P = update.Paths(root)
    status, cat = {}, {}
    for pid, (xml, ts, entries) in packs.items():
        packlib.write_atomic(P.xml(pid), gzip.compress(xml))
        packlib.write_json(P.files(pid), {"id": pid, "zipSize": 1, "entries": entries})
        status[str(pid)] = {"s": "ok", "at": f"2026-01-01T00:00:{pid % 60:02d}", "size": 1, "vkTs": ts}
        cat[str(pid)] = {"id": pid, "name": f"Пак {pid}", "authors": ["А"], "vkTs": ts, "size": 1}
    packlib.write_json(P.status, status)
    packlib.write_json(P.catalog, {"packs": cat})
    return P


def run_update(*args):
    old = sys.argv
    sys.argv = ["update.py", *args]
    try:
        return update.main()
    finally:
        sys.argv = old


CAT = [{"name": "Images/%D0%BA%D0%BE%D1%82.jpg", "size": 5000, "crc": 0x1234ABCD}]   # кот.jpg в %XX


class IndexTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="packindex-test-")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def build(self, packs):
        P = make_base(self.tmp, packs)
        self.assertEqual(run_update("--data", self.tmp, "--no-fetch", "--quiet"), 0)
        return P, packlib.open_index(P.index, readonly=True)

    def test_build_and_check(self):
        P, db = self.build({
            20: (siq5("Поздний"), 2000, CAT),
            10: (siq5("Ранний", theme="Звери"), 1000, CAT),
            30: (siq5("Поздний"), 3000, CAT),                       # копия 20 байт в байт
            40: (siq5("Другой", q1="Другое", a1="Утконос"), 1500, []),
        })
        info = packlib.index_info(db)
        self.assertEqual(info["packs"], 3)
        self.assertEqual(db.execute("SELECT dup_of FROM packs WHERE id=30").fetchone()[0], 20)
        with open(os.path.join(self.tmp, "last_run.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f)["result"], "ok")

        res = packlib.check(db, [
            {"text": "Кто несёт яйца и кормит молоком", "answers": ["ехидна"]},     # дословно
            {"text": "Совсем другой текст", "answers": ["нечто"], "media": ["1234abcd:5000"]},  # тот же файл
            {"text": "Новый вопрос про зверя", "answers": ["Утконос"]},             # редкий ответ
            {"text": "Новый вопрос", "answers": ["Москва"]},                         # ответ в 3 паках — редкий
            {"text": "Чистый вопрос", "answers": ["Уникальное"]},
        ])
        by_i = {r["i"]: r for r in res["results"]}
        self.assertEqual(by_i[0]["kind"], "exact")
        self.assertEqual([w["pack"] for w in by_i[0]["where"]], [10, 20])          # раньше выложенный — первым
        self.assertEqual(res["themes"]["10:0"], ["Раунд 1", "Звери"])
        self.assertEqual(res["packs"]["10"]["url"], "https://firepacks.net/pack/10")
        self.assertEqual(by_i[1]["kind"], "media")
        self.assertEqual(by_i[2]["kind"], "answer")
        self.assertNotIn(4, by_i)
        self.assertEqual(res["summary"][0]["pack"], 10)

        # свой же пак на FirePacks можно исключить
        res = packlib.check(db, [{"text": "Кто несёт яйца и кормит молоком", "answers": ["ехидна"]}], exclude=["10"])
        self.assertEqual([w["pack"] for w in res["results"][0]["where"]], [20])
        db.close()

    def test_common_answer_and_file_are_not_flagged(self):
        packs = {i: (siq5(f"П{i}", q1=f"Вопрос {i}"), 1000 + i, CAT) for i in range(1, 25)}
        P, db = self.build(packs)
        res = packlib.check(db, [{"text": "Совсем новый", "answers": ["Москва"], "media": ["1234abcd:5000"]}])
        self.assertEqual(res["results"], [])      # «Москва» в 24 паках, кот.jpg в 24 паках — не повтор
        db.close()

    def test_incremental_update(self):
        P, db = self.build({1: (siq5("Первый"), 1000, [])})
        db.close()
        # новый пак и обновлённый первый
        packlib.write_atomic(P.xml(2), gzip.compress(siq5("Второй", q1="Новый текст", a1="Панда")))
        packlib.write_json(P.files(2), {"entries": []})
        packlib.write_atomic(P.xml(1), gzip.compress(siq5("Первый", q1="Переписан", a1="Коала")))
        st = packlib.read_json(P.status)
        st["1"]["at"] = "2026-02-02T00:00:00"
        st["2"] = {"s": "ok", "at": "2026-02-02T00:00:00", "size": 1}
        packlib.write_json(P.status, st)
        self.assertEqual(run_update("--data", self.tmp, "--no-fetch", "--quiet"), 0)
        db = packlib.open_index(P.index, readonly=True)
        self.assertEqual(packlib.index_info(db)["packs"], 2)
        chk = lambda t, a: packlib.check(db, [{"text": t, "answers": [a]}])["results"]  # noqa: E731
        self.assertTrue(chk("Переписан", "Коала"))
        self.assertFalse(chk("Кто несёт яйца и кормит молоком", "Ехидна"))   # старая версия пака 1 ушла
        self.assertTrue(chk("Новый текст", "Панда"))
        db.close()

    def test_broken_pack_does_not_stop_build(self):
        P = make_base(self.tmp, {1: (siq5(), 1000, []), 2: (b"<not xml", 1001, [])})
        self.assertEqual(run_update("--data", self.tmp, "--no-fetch", "--quiet"), 0)
        run = packlib.read_json(os.path.join(self.tmp, "last_run.json"))
        self.assertEqual(run["counts"]["index_bad"], 1)
        self.assertTrue(os.path.exists(P.index))


# ---------- скачивание кусками с локального HTTP ----------

class RangeHandler(http.server.BaseHTTPRequestHandler):
    files: dict = {}
    ignore_range = False

    def log_message(self, *a): pass

    def do_GET(self):
        body = self.files.get(self.path.split("?")[0])
        if body is None:
            self.send_response(404); self.end_headers(); return
        rng = self.headers.get("Range")
        if rng and not self.ignore_range:
            a, b = rng.split("=")[1].split("-")
            a, b = int(a), min(int(b), len(body) - 1)
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {a}-{b}/{len(body)}")
            part = body[a:b + 1]
        else:
            self.send_response(200); part = body
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(part)))
        self.end_headers()
        self.wfile.write(part)


class FetchTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("content.xml", siq5())
            z.writestr("Images/%D0%BA%D0%BE%D1%82.jpg", os.urandom(200_000), compress_type=zipfile.ZIP_STORED)
        cls.zip = buf.getvalue()
        RangeHandler.files = {"/pack.siq": cls.zip, "/junk": b"<html>deleted</html>"}
        cls.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), RangeHandler)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}"
        cls.tmp = tempfile.mkdtemp(prefix="packindex-fetch-")
        cls.out = update.Out(os.path.join(cls.tmp, "logs"), quiet=True)

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown(); cls.srv.server_close()
        cls.out.f.close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def setUp(self):
        RangeHandler.ignore_range = False
        self.net = update.Net(self.out, "none")

    def test_fetch_one_reads_only_xml_and_toc(self):
        P = update.Paths(self.tmp)
        nbytes = update.fetch_one(self.net, {"id": 7, "url": self.base + "/pack.siq"}, (P.xml(7), P.files(7)))
        self.assertLess(nbytes, 100_000)                             # 200 КБ картинки не качали
        self.assertEqual(packlib.read_xml_gz(P.xml(7)), siq5())
        entries = packlib.read_json(P.files(7))["entries"]
        self.assertEqual([e["size"] for e in entries], [200_000])

    def test_server_ignoring_range_is_soft_and_not_read(self):
        RangeHandler.ignore_range = True
        P = update.Paths(self.tmp)
        with self.assertRaises(update.Soft):
            update.fetch_one(self.net, {"id": 8, "url": self.base + "/pack.siq"}, (P.xml(8), P.files(8)))

    def test_missing_is_dead(self):
        P = update.Paths(self.tmp)
        with self.assertRaises(update.Dead):
            update.fetch_one(self.net, {"id": 9, "url": self.base + "/nope"}, (P.xml(9), P.files(9)))


# ---------- /api/pack-check ----------

class EndpointTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="packindex-srv-")
        base = os.path.join(cls.tmp, "packindex")
        make_base(base, {10: (siq5("Ранний"), 1000, CAT)})
        assert run_update("--data", base, "--no-fetch", "--quiet") == 0
        os.environ.update(YES_HOST="127.0.0.1", YES_PORT="0", YES_DATA=cls.tmp)
        os.environ.pop("YES_PACKINDEX", None)
        cls.mod = importlib.reload(importlib.import_module("yestudio_server"))
        cls.mod.ensure_dirs()
        cls.srv = cls.mod.Server(("127.0.0.1", 0), cls.mod.Handler)
        threading.Thread(target=cls.srv.serve_forever, kwargs={"poll_interval": 0.1}, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.srv.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown(); cls.srv.server_close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def call(self, path, body=None, key=True):
        h = {"Content-Type": "application/json"}
        if key: h["X-YeStudio-Key"] = "yes-beta-2026"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.url + path, data=data, headers=h, method="POST" if data else "GET")
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    def test_check(self):
        st, res = self.call("/api/pack-check", {"questions": [
            {"text": "Кто несёт яйца и кормит молоком?", "answers": ["Ехидна"]},
            {"text": "x", "answers": [], "media": ["1234abcd:5000", "не отпечаток"]},
            "мусор"]})
        self.assertEqual(st, 200)
        self.assertEqual([r["kind"] for r in res["results"]], ["exact", "media"])
        self.assertEqual(res["packs"]["10"]["url"], "https://firepacks.net/pack/10")
        self.assertEqual(res["index"]["packs"], 1)

    def test_info_and_limits(self):
        st, info = self.call("/api/pack-index")
        self.assertEqual((st, info["packs"]), (200, 1))
        self.assertEqual(self.call("/api/pack-check", {"questions": []})[0], 400)
        self.assertEqual(self.call("/api/pack-check", {"questions": [{}] * 3001})[0], 413)
        self.assertEqual(self.call("/api/pack-check", {"questions": [{}]}, key=False)[0], 403)

    def test_missing_index_is_503(self):
        old = self.mod.PACKINDEX
        self.mod.PACKINDEX = os.path.join(self.tmp, "нет.sqlite")
        try:
            self.assertEqual(self.call("/api/pack-check", {"questions": [{"text": "a"}]})[0], 503)
        finally:
            self.mod.PACKINDEX = old


if __name__ == "__main__":
    unittest.main()
