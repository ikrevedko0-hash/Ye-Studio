"""Тесты для yestudio_server.py — только стандартная библиотека.

Запуск:
  python -m unittest server.test_server -v
или (из папки server/):
  python -m unittest test_server -v
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import importlib


API_KEY_HEADER = "X-YeStudio-Key"
API_KEY_VALUE = "yes-beta-2026"


def free_port() -> int:
    import socket

    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class ServerTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp_dir = tempfile.mkdtemp(prefix="yestudio-test-")
        cls.port = free_port()

        os.environ["YES_HOST"] = "127.0.0.1"
        os.environ["YES_PORT"] = str(cls.port)
        os.environ["YES_DATA"] = cls.tmp_dir

        # Импортируем модуль после установки env-переменных, т.к. он читает их на уровне модуля.
        cls.mod = importlib.import_module("yestudio_server")
        importlib.reload(cls.mod)

        cls.mod.ensure_dirs()

        cls.server = cls.mod.Server((cls.mod.HOST, cls.mod.PORT), cls.mod.Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, kwargs={"poll_interval": 0.1}, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.port}"
        time.sleep(0.2)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        shutil.rmtree(cls.tmp_dir, ignore_errors=True)

    def _url(self, path: str) -> str:
        return self.base_url + path

    def _get(self, path: str, headers=None, timeout=5):
        req = urllib.request.Request(self._url(path), headers=headers or {}, method="GET")
        try:
            resp = urllib.request.urlopen(req, timeout=timeout)
            return resp.getcode(), resp.read(), dict(resp.headers)
        except urllib.error.HTTPError as e:
            return e.code, e.read(), dict(e.headers)

    def _post_json(self, path: str, obj, headers=None, timeout=5):
        body = json.dumps(obj).encode("utf-8")
        h = {"Content-Type": "application/json", "Content-Length": str(len(body))}
        h.update(headers or {})
        req = urllib.request.Request(self._url(path), data=body, headers=h, method="POST")
        try:
            resp = urllib.request.urlopen(req, timeout=timeout)
            return resp.getcode(), resp.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def _key_headers(self):
        return {API_KEY_HEADER: API_KEY_VALUE}

    # --- /health ---------------------------------------------------------

    def test_health(self):
        code, body, _ = self._get("/health")
        self.assertEqual(code, 200)
        self.assertEqual(body.decode(), "ok")

    def setUp(self):
        # лимиты считаются на IP, а в тестах все запросы с 127.0.0.1 — каждый тест начинает с чистого счёта
        self.mod._rate_buckets.clear()

    # --- /api/ping и старый /api/control ----------------------------------

    def test_ping_rate_limited(self):
        limit, _ = self.mod.RATE_LIMITS["ping"]
        for _ in range(limit):
            code, _, _ = self._get("/api/ping?id=r&v=1", headers=self._key_headers())
            self.assertEqual(code, 200)
        code, _, _ = self._get("/api/ping?id=r&v=1", headers=self._key_headers())
        self.assertEqual(code, 429)

    def test_ping_writes_installs(self):
        code, body, _ = self._get("/api/ping?id=install-xyz&v=2.0.0", headers=self._key_headers())
        self.assertEqual(code, 200)
        self.assertTrue(json.loads(body)["ok"])
        with open(os.path.join(self.tmp_dir, "installs.json"), "r", encoding="utf-8") as f:
            data = json.load(f)
        self.assertEqual(data["install-xyz"]["v"], "2.0.0")

    def test_ping_forbidden_without_key(self):
        code, _, _ = self._get("/api/ping?id=abc123&v=1.0.0")
        self.assertEqual(code, 403)

    def test_control_never_disables(self):
        # старый control.json с блокировкой больше ни на что не влияет
        control_path = os.path.join(self.tmp_dir, "control.json")
        with open(control_path, "w", encoding="utf-8") as f:
            json.dump({"global": {"disabled": True, "message": "x"}, "blocked": {"old-id": "x"}}, f)
        try:
            code, body, _ = self._get("/api/control?id=old-id&v=0.2.0-beta.1", headers=self._key_headers())
            self.assertEqual(code, 200)
            self.assertFalse(json.loads(body)["disabled"])
        finally:
            os.remove(control_path)

    # --- /api/errors ------------------------------------------------------

    def test_errors_requires_key(self):
        code, body = self._post_json("/api/errors", {"id": "a", "v": "1", "os": "win", "items": []})
        self.assertEqual(code, 403)

    def test_errors_writes_jsonl(self):
        payload = {
            "id": "err-id",
            "v": "1.2.3",
            "os": "win32",
            "items": [{"ts": "2026-09-25T00:00:00Z", "where": "renderer", "kind": "TypeError",
                       "message": "oops", "stack": "at x()", "count": 3}],
        }
        code, body = self._post_json("/api/errors", payload, headers=self._key_headers())
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(body), {"ok": True})

        from datetime import datetime, timezone
        month_key = datetime.now(timezone.utc).strftime("%Y-%m")
        errors_path = os.path.join(self.tmp_dir, "errors", f"{month_key}.jsonl")
        self.assertTrue(os.path.isfile(errors_path))
        with open(errors_path, "r", encoding="utf-8") as f:
            lines = [json.loads(line) for line in f if line.strip()]
        found = [l for l in lines if l.get("message") == "oops"]
        self.assertTrue(found)
        self.assertEqual(found[-1]["id"], "err-id")

    # --- /api/feedback ------------------------------------------------------

    def test_feedback_saves_screenshot(self):
        png_bytes = b"\x89PNG\r\n\x1a\nFAKE"
        b64 = base64.b64encode(png_bytes).decode()
        payload = {
            "id": "fb-id-12345678",
            "v": "1.0.0",
            "os": "win32",
            "text": "не работает кнопка",
            "contact": "test@example.com",
            "screenshot": b64,
            "screenshotType": "png",
        }
        code, body = self._post_json("/api/feedback", payload, headers=self._key_headers())
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(body), {"ok": True})

        feedback_dir = os.path.join(self.tmp_dir, "feedback")
        subdirs = [d for d in os.listdir(feedback_dir) if "fb-id-12" in d]
        self.assertTrue(subdirs)
        folder = os.path.join(feedback_dir, subdirs[0])
        self.assertTrue(os.path.isfile(os.path.join(folder, "feedback.json")))
        self.assertTrue(os.path.isfile(os.path.join(folder, "screenshot.png")))
        with open(os.path.join(folder, "screenshot.png"), "rb") as f:
            self.assertEqual(f.read(), png_bytes)

    # --- /updates ------------------------------------------------------

    def test_updates_serves_file(self):
        updates_dir = os.path.join(self.tmp_dir, "updates")
        os.makedirs(updates_dir, exist_ok=True)
        content = b"0123456789" * 100
        with open(os.path.join(updates_dir, "latest.yml"), "wb") as f:
            f.write(content)

        code, body, headers = self._get("/updates/latest.yml")
        self.assertEqual(code, 200)
        self.assertEqual(body, content)

    def test_updates_range(self):
        updates_dir = os.path.join(self.tmp_dir, "updates")
        os.makedirs(updates_dir, exist_ok=True)
        content = bytes(range(256)) * 4  # 1024 байта
        with open(os.path.join(updates_dir, "app.exe"), "wb") as f:
            f.write(content)

        req = urllib.request.Request(self._url("/updates/app.exe"), headers={"Range": "bytes=10-19"})
        resp = urllib.request.urlopen(req, timeout=5)
        self.assertEqual(resp.getcode(), 206)
        data = resp.read()
        self.assertEqual(data, content[10:20])
        self.assertEqual(resp.headers.get("Content-Range"), f"bytes 10-19/{len(content)}")

    def test_updates_rejects_path_traversal(self):
        code, body, _ = self._get("/updates/..%2F..%2Fetc%2Fpasswd")
        self.assertIn(code, (404, 400))

        code2, body2, _ = self._get("/updates/nonexistent-file.exe")
        self.assertEqual(code2, 404)

    # --- лимиты тела ------------------------------------------------------

    def test_errors_too_large_body_rejected(self):
        big_text = "x" * (5 * 1024 * 1024)  # 5 МБ > лимита 4 МБ
        payload = {"id": "big", "v": "1", "os": "win", "items": [{"message": big_text}]}
        try:
            code, body = self._post_json("/api/errors", payload, headers=self._key_headers())
        except (ConnectionAbortedError, ConnectionResetError, urllib.error.URLError):
            # сервер отказал, не дочитав 5 МБ, и закрыл соединение — на Windows клиент видит обрыв, а не 413
            return
        self.assertEqual(code, 413)


if __name__ == "__main__":
    unittest.main()
