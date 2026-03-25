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
            archived_dir = input_dir / "archived"
            archived_dir.mkdir(parents=True, exist_ok=True)

            (input_dir / "book.pdf").write_bytes(b"%PDF-1.4\n")
            (archived_dir / "book.pdf").write_bytes(b"%PDF-1.4\narchived")

            resolved, archive_processed = convert._resolve_input_pdf(input_dir, "book.pdf")
            self.assertEqual(resolved, input_dir / "book.pdf")
            self.assertTrue(archive_processed)

    def test_resolve_archived_source_for_reconvert(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            input_dir = Path(tmp_dir) / "input"
            archived_dir = input_dir / "archived"
            archived_dir.mkdir(parents=True, exist_ok=True)
            (archived_dir / "book.pdf").write_bytes(b"%PDF-1.4\n")

            resolved, archive_processed = convert._resolve_input_pdf(input_dir, "book.pdf")
            self.assertEqual(resolved, archived_dir / "book.pdf")
            self.assertFalse(archive_processed)

    def test_resolve_rejects_path_traversal_like_input(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            input_dir = Path(tmp_dir) / "input"
            archived_dir = input_dir / "archived"
            archived_dir.mkdir(parents=True, exist_ok=True)
            (input_dir / "book.pdf").write_bytes(b"%PDF-1.4\n")

            resolved, _ = convert._resolve_input_pdf(input_dir, "../book.pdf")
            self.assertEqual(resolved, input_dir / "book.pdf")

    def test_resolve_missing_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            input_dir = Path(tmp_dir) / "input"
            (input_dir / "archived").mkdir(parents=True, exist_ok=True)

            with self.assertRaises(FileNotFoundError):
                convert._resolve_input_pdf(input_dir, "missing.pdf")


if __name__ == "__main__":
    unittest.main()
