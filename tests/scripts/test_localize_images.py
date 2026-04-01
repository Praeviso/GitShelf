"""Tests for localize_images module."""

import sys
import tempfile
import unittest
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from threading import Thread

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from localize_images import localize_images, _url_to_filename


class FakeImageHandler(BaseHTTPRequestHandler):
    """Serves a 1x1 red PNG for any request."""

    PNG_BYTES = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00"
        b"\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00"
        b"\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )

    def do_GET(self):
        if "/fail" in self.path:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.end_headers()
        self.wfile.write(self.PNG_BYTES)

    def log_message(self, *args):
        pass


class TestUrlToFilename(unittest.TestCase):
    def test_extracts_filename_from_path(self):
        url = "https://cdn.example.com/result/2026/abc123.jpg"
        self.assertEqual(_url_to_filename(url), "abc123.jpg")

    def test_falls_back_to_md5_for_no_extension(self):
        url = "https://example.com/images/noext"
        name = _url_to_filename(url)
        self.assertTrue(name.endswith(".jpg"))
        self.assertEqual(len(name), 32 + 4)  # md5 hex + ".jpg"


class TestLocalizeImages(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), FakeImageHandler)
        cls.port = cls.server.server_address[1]
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def test_no_images_returns_unchanged(self):
        md = "# Hello\n\nNo images here."
        result = localize_images(md, Path("/tmp/unused"), "img/")
        self.assertEqual(result, md)

    def test_downloads_and_rewrites_url(self):
        url = f"http://127.0.0.1:{self.port}/test.png"
        md = f"![diagram]({url})"

        with tempfile.TemporaryDirectory() as tmp:
            images_dir = Path(tmp) / "images"
            result = localize_images(md, images_dir, "books/test/images/")
            self.assertEqual(result, "![diagram](books/test/images/test.png)")
            self.assertTrue((images_dir / "test.png").exists())

    def test_failed_download_keeps_original_url(self):
        url = f"http://127.0.0.1:{self.port}/fail/broken.png"
        md = f"![img]({url})"

        with tempfile.TemporaryDirectory() as tmp:
            images_dir = Path(tmp) / "images"
            result = localize_images(md, images_dir, "img/")
            self.assertEqual(result, md)

    def test_skips_already_local_paths(self):
        md = "![local](images/already-here.png)"
        with tempfile.TemporaryDirectory() as tmp:
            result = localize_images(md, Path(tmp), "img/")
        self.assertEqual(result, md)

    def test_deduplicates_same_url(self):
        url = f"http://127.0.0.1:{self.port}/dup.png"
        md = f"![a]({url})\n![b]({url})"

        with tempfile.TemporaryDirectory() as tmp:
            images_dir = Path(tmp) / "images"
            result = localize_images(md, images_dir, "p/")
            self.assertIn("![a](p/dup.png)", result)
            self.assertIn("![b](p/dup.png)", result)
            self.assertEqual(len(list(images_dir.iterdir())), 1)

    def test_skips_existing_file(self):
        url = f"http://127.0.0.1:{self.port}/existing.jpg"
        md = f"![pic]({url})"

        with tempfile.TemporaryDirectory() as tmp:
            images_dir = Path(tmp) / "images"
            images_dir.mkdir()
            (images_dir / "existing.jpg").write_bytes(b"old")
            result = localize_images(md, images_dir, "b/")
            self.assertEqual(result, "![pic](b/existing.jpg)")
            self.assertEqual((images_dir / "existing.jpg").read_bytes(), b"old")


if __name__ == "__main__":
    unittest.main()
