import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import convert


class ConvertDispatchResolutionTest(unittest.TestCase):
    def test_resolve_prefers_input_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            input_dir = Path(tmp_dir) / "input"
            input_dir.mkdir(parents=True, exist_ok=True)

            (input_dir / "book.pdf").write_bytes(b"%PDF-1.4\n")

            resolved = convert._resolve_input_pdf(input_dir, "book.pdf")
            self.assertEqual(resolved, input_dir / "book.pdf")

    def test_resolve_missing_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            input_dir = Path(tmp_dir) / "input"
            input_dir.mkdir(parents=True, exist_ok=True)

            with self.assertRaises(FileNotFoundError):
                convert._resolve_input_pdf(input_dir, "missing.pdf")

    def test_resolve_rejects_path_traversal_like_input(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            input_dir = Path(tmp_dir) / "input"
            input_dir.mkdir(parents=True, exist_ok=True)
            (input_dir / "book.pdf").write_bytes(b"%PDF-1.4\n")

            resolved = convert._resolve_input_pdf(input_dir, "../book.pdf")
            self.assertEqual(resolved, input_dir / "book.pdf")


class ContentIdGenerationTest(unittest.TestCase):
    def test_generate_book_id_preserves_unicode_letters(self) -> None:
        item_id = convert.generate_book_id(Path("测试 文档.pdf"))
        self.assertEqual(item_id, "测试-文档")

    def test_generate_book_id_falls_back_when_slug_is_empty(self) -> None:
        item_id = convert.generate_book_id(Path("!!!.pdf"))
        self.assertTrue(item_id.startswith("item-"))
        self.assertGreater(len(item_id), 5)


class FailureTrackingTest(unittest.TestCase):
    def test_write_failures_creates_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            docs_dir = Path(tmp_dir)
            pdf_path = Path("input/bad.pdf")
            convert._write_failures([(pdf_path, ValueError("API error"))], docs_dir)

            data = __import__("json").loads((docs_dir / "failures.json").read_text())
            self.assertEqual(len(data["failures"]), 1)
            self.assertEqual(data["failures"][0]["filename"], "bad.pdf")
            self.assertEqual(data["failures"][0]["error"], "API error")
            self.assertIn("failed_at", data["failures"][0])
            self.assertIn("book_id", data["failures"][0])

    def test_write_failures_deduplicates_by_filename(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            docs_dir = Path(tmp_dir)
            pdf_path = Path("input/bad.pdf")
            convert._write_failures([(pdf_path, ValueError("first error"))], docs_dir)
            convert._write_failures([(pdf_path, ValueError("second error"))], docs_dir)

            data = __import__("json").loads((docs_dir / "failures.json").read_text())
            self.assertEqual(len(data["failures"]), 1)
            self.assertEqual(data["failures"][0]["error"], "second error")

    def test_remove_failure(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            docs_dir = Path(tmp_dir)
            convert._write_failures([
                (Path("input/a.pdf"), ValueError("err a")),
                (Path("input/b.pdf"), ValueError("err b")),
            ], docs_dir)

            convert._remove_failure("a.pdf", docs_dir)

            data = __import__("json").loads((docs_dir / "failures.json").read_text())
            self.assertEqual(len(data["failures"]), 1)
            self.assertEqual(data["failures"][0]["filename"], "b.pdf")

    def test_remove_failure_noop_when_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            docs_dir = Path(tmp_dir)
            # No failures.json exists — should not raise
            convert._remove_failure("nonexistent.pdf", docs_dir)

    def test_read_failures_returns_empty_on_missing_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            result = convert._read_failures(Path(tmp_dir))
            self.assertEqual(result, [])


class ChapterImagePathRewriteTest(unittest.TestCase):
    def test_rewrites_extracted_image_paths_for_chapters(self) -> None:
        markdown = "![Figure](images/diagram.png)\n\n![](./images/chart.jpg)"

        rewritten = convert._rewrite_chapter_image_paths(markdown, "my-book")

        self.assertIn("![Figure](../images/diagram.png)", rewritten)
        self.assertIn("![](../images/chart.jpg)", rewritten)

    def test_rewrites_book_scoped_image_paths_for_repo_readability(self) -> None:
        markdown = "![Figure](books/my-book/images/diagram.png)"

        rewritten = convert._rewrite_chapter_image_paths(markdown, "my-book")

        self.assertEqual(rewritten, "![Figure](../images/diagram.png)")

    def test_keeps_remote_and_data_images_unchanged(self) -> None:
        markdown = (
            "![Remote](https://example.com/diagram.png)\n"
            "<img src=\"data:image/png;base64,abc\" alt=\"inline\">"
        )

        rewritten = convert._rewrite_chapter_image_paths(markdown, "my-book")

        self.assertIn("![Remote](https://example.com/diagram.png)", rewritten)
        self.assertIn('<img src="data:image/png;base64,abc" alt="inline">', rewritten)


if __name__ == "__main__":
    unittest.main()
