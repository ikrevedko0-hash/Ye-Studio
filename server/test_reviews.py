"""Тесты отзывов игроков (reviews/reviews.py). Запуск из server/: python -m unittest test_reviews -v"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "reviews"))
import reviews  # noqa: E402

MANIFEST = {"v": 1, "slug": "9", "title": "Уе!пак №9", "date": "25.09.2026", "logo": None, "rounds": [
    {"name": "Разминка", "final": False, "themes": [
        {"id": "r1t1", "name": "Марка пива", "questions": [
            {"id": "r1t1q1", "price": 100, "text": "", "answer": "Miller", "media": ["image"]},
            {"id": "r1t1q2", "price": 200, "text": "", "answer": "Tuborg", "media": ["image"]}]},
        {"id": "r1t2", "name": "Дудлы", "questions": [
            {"id": "r1t2q1", "price": 100, "text": "Что за праздник?", "answer": "Пасха", "media": ["image"]}]}]}]}
PID = "0123456789abcdef01234567"


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="yes-reviews-")
        os.makedirs(os.path.join(self.tmp, "reviews", "packs", "9"))
        with open(os.path.join(self.tmp, "reviews", "packs", "9", "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(MANIFEST, f, ensure_ascii=False)
        self.s = reviews.Store(self.tmp, salt="test")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_packs_list(self):
        self.assertEqual([p["slug"] for p in self.s.packs()], ["9"])
        self.assertEqual(self.s.packs()[0]["questions"], 3)

    def test_save_is_incremental_and_counts_depth(self):
        r = self.s.save("9", PID, {"rating": 8}, None, 0, "1.1.1.1")
        self.assertEqual(r["depth"], reviews.DEPTH_RATING)
        r = self.s.save("9", PID, {"q:r1t1q1": {"r": "fire"}}, None, 0, "1.1.1.1")
        self.assertEqual(r["depth"], round(reviews.DEPTH_RATING + reviews.DEPTH_QUESTIONS / 3))
        # null удаляет ответ
        r = self.s.save("9", PID, {"q:r1t1q1": None}, None, 0, "1.1.1.1")
        self.assertEqual(r["depth"], reviews.DEPTH_RATING)

    def test_full_answers_reach_the_bottom(self):
        ans = {"rating": 3, "dis": ["ai", "boring", "hard", "easy", "sound", "dup", "broken", "long", "humor", "niche"],
               "ctx": "friends", "diff": 5, "th:r1t1": "fire", "th:r1t2": "poop",
               "q:r1t1q1": {"r": "fire"}, "q:r1t1q2": {"r": "meh", "why": ["boring"]}, "q:r1t2q1": {"r": "ok"},
               "txt:author": "a", "txt:idea": "b", "txt:steal": "c"}
        self.assertEqual(self.s.save("9", PID, ans, None, 0, "1.1.1.1")["depth"], reviews.DEPTH_MAX)

    def test_rejects_junk(self):
        bad = [{"rating": 11}, {"rating": True}, {"dis": ["nope"]}, {"q:r9t9q9": {"r": "fire"}},
               {"q:r1t1q1": {"r": "lol"}}, {"q:r1t1q1": {"r": "ok", "why": ["x"]}}, {"th:r1t1": "meh"}, {"hack": 1}]
        for a in bad:
            with self.assertRaises(reviews.Invalid, msg=a):
                self.s.save("9", PID, a, None, 0, "1.1.1.1")
        with self.assertRaises(reviews.Invalid):
            self.s.save("9", "not-a-pid", {"rating": 5}, None, 0, "1.1.1.1")
        with self.assertRaises(reviews.Invalid):
            self.s.save("../etc", PID, {"rating": 5}, None, 0, "1.1.1.1")

    def test_new_players_per_ip_limited(self):
        for i in range(reviews.NEW_PLAYERS_PER_IP_DAY):
            self.s.save("9", f"{i:024x}", {"rating": 5}, None, 0, "2.2.2.2")
        with self.assertRaises(reviews.Invalid):
            self.s.save("9", "f" * 24, {"rating": 5}, None, 0, "2.2.2.2")
        self.s.save("9", "e" * 24, {"rating": 5}, None, 0, "3.3.3.3")   # другой адрес — можно

    def test_board_and_nick(self):
        ans = {"q:r1t1q1": {"r": "fire"}}
        self.s.save("9", PID, ans, "Капитан Немо", 999999, "1.1.1.1")
        self.s.save("9", "a" * 24, ans, "http://spam.ru", 0, "1.1.1.1")
        board = self.s.board("9")
        self.assertEqual([b["nick"] for b in board], ["Капитан Немо"])
        self.assertLessEqual(board[0]["score"], board[0]["depth"] * 6 + 500)   # очки не накрутить
        self.s.hide("9", "Капитан Немо")
        self.assertEqual(self.s.board("9"), [])

    def test_quotes_for_home(self):
        self.s.save("9", PID, {"txt:author": "Спасибо, было весело"}, "Капитан Немо", 0, "1.1.1.1")
        self.s.save("9", "a" * 24, {"txt:author": "Заходи на spam.ru, там лучше"}, None, 0, "1.1.1.1")
        self.s.save("9", "b" * 24, {"txt:author": "Длинно. " + "очень " * 60, "txt:idea": "не цитата"}, "Болтун", 0, "1.1.1.1")
        q = {x["nick"]: x for x in self.s.quotes()}
        self.assertEqual(set(q), {"Капитан Немо", "Болтун"})          # ссылка не прошла, idea не цитируется
        self.assertEqual(q["Капитан Немо"]["text"], "Спасибо, было весело")
        self.assertLessEqual(len(q["Болтун"]["text"]), 161)
        self.s.hide("9", "Болтун")
        self.assertEqual([x["nick"] for x in self.s.quotes()], ["Капитан Немо"])

    def test_export(self):
        self.s.save("9", PID, {"rating": 4, "dis": ["ai"], "th:r1t2": "poop",
                               "q:r1t1q2": {"r": "meh", "why": ["dup", "boring"]}, "txt:idea": "Узнай пиво по пробке"},
                    None, 0, "1.1.1.1")
        self.s.save("9", "b" * 24, {"rating": 8, "q:r1t1q2": {"r": "ok"}}, None, 0, "4.4.4.4")
        e = self.s.export("9")
        self.assertEqual(e["players"], 2)
        self.assertEqual(e["rating"]["avg"], 6.0)
        self.assertEqual(e["dislikes"], {"Много ИИ-контента": 1})
        q = next(q for q in e["questions"] if q["id"] == "r1t1q2")
        self.assertEqual((q["votes"], q["meh"], q["ok"]), (2, 1, 1))
        self.assertEqual(q["reasons"], {"Уже было": 1, "Скучно": 1})
        self.assertEqual(next(t for t in e["themes"] if t["id"] == "r1t2")["poop"], 1)
        self.assertEqual(e["texts"], [{"kind": "idea", "text": "Узнай пиво по пробке"}])

    def test_pack_file_is_confined(self):
        self.assertIsNotNone(self.s.pack_file("9", "manifest.json"))
        for name in ("../manifest.json", "..", ".hidden", "a/b"):
            self.assertIsNone(self.s.pack_file("9", name))


class AutopublishTest(unittest.TestCase):
    def test_candidates_only_authors_numbered_packs(self):
        import autopublish
        packs = [
            {"id": 1, "name": "Уе!пак №11", "authors": ["Борис Бритва"]},
            {"id": 2, "name": "Уе!пак №12", "authors": ["Кто-то другой"]},            # чужой — мимо
            {"id": 3, "name": "Уе! пак № 7 (ремастер)", "authors": ["Борис Бритва"]},
            {"id": 4, "name": "Ночные посиделки №85", "authors": ["Борис Бритва"]},    # не Уе!пак — мимо
            {"id": 5, "name": "Мой Уе!пак №3", "authors": ["Борис Бритва"]},          # не с начала — мимо
        ]
        self.assertEqual([(s, p["id"]) for s, p in autopublish.candidates(packs)], [("11", 1), ("7", 3)])


if __name__ == "__main__":
    unittest.main()
