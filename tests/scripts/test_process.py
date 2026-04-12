import hashlib
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import process


def _build_sample_epub(path: Path, *, title: str = "Sample EPUB") -> bytes:
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("mimetype", "application/epub+zip")
        zf.writestr(
            "META-INF/container.xml",
            """<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>
""",
        )
        zf.writestr(
            "OEBPS/content.opf",
            f"""<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="bookid" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:test-book</dc:identifier>
    <dc:title>{title}</dc:title>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml" />
    <item id="chapter-2" href="chapter-2.xhtml" media-type="application/xhtml+xml" />
  </manifest>
  <spine>
    <itemref idref="chapter-1" />
    <itemref idref="chapter-2" />
  </spine>
</package>
""",
        )
        zf.writestr(
            "OEBPS/nav.xhtml",
            """<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>TOC</title></head>
  <body>
    <nav epub:type="toc">
      <ol>
        <li>
          <a href="chapter-1.xhtml">Chapter One</a>
          <ol>
            <li><a href="chapter-1.xhtml#section-1">Section One</a></li>
          </ol>
        </li>
        <li><a href="chapter-2.xhtml">Chapter Two</a></li>
      </ol>
    </nav>
  </body>
</html>
""",
        )
        zf.writestr(
            "OEBPS/chapter-1.xhtml",
            """<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Chapter One</h1><h2 id="section-1">Section One</h2><p>Hello world.</p></body></html>""",
        )
        zf.writestr(
            "OEBPS/chapter-2.xhtml",
            """<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Chapter Two</h1><p>More text.</p></body></html>""",
        )
    return path.read_bytes()


class EpubProcessingTest(unittest.TestCase):
    def test_process_epub_stores_original_file_and_generated_toc(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            books_dir = root / "docs" / "books"
            books_dir.mkdir(parents=True, exist_ok=True)

            epub_path = root / "input" / "sample.epub"
            epub_bytes = _build_sample_epub(epub_path)
            expected_md5 = hashlib.md5(epub_bytes).hexdigest()

            with patch.object(process, "_utc_now_iso", return_value="2026-04-12T12:00:00Z"):
                process.process_epub(epub_path, books_dir)

            book_dir = books_dir / "sample"
            self.assertFalse(epub_path.exists())
            self.assertFalse((book_dir / "chapters").exists())
            self.assertTrue((book_dir / "book.epub").exists())
            self.assertEqual((book_dir / "book.epub").read_bytes(), epub_bytes)

            toc = json.loads((book_dir / "toc.json").read_text(encoding="utf-8"))
            self.assertEqual(toc["title"], "Sample EPUB")
            self.assertEqual(toc["children"][0]["title"], "Chapter One")
            self.assertEqual(toc["children"][0]["href"], "chapter-1.xhtml")
            self.assertEqual(toc["children"][0]["children"][0]["title"], "Section One")
            self.assertEqual(
                toc["children"][0]["children"][0]["href"],
                "chapter-1.xhtml#section-1",
            )
            self.assertEqual(toc["children"][1]["title"], "Chapter Two")

            readme = (book_dir / "README.md").read_text(encoding="utf-8")
            self.assertIn("# Sample EPUB", readme)
            self.assertIn("- Chapter One", readme)

            meta = json.loads((book_dir / "meta.json").read_text(encoding="utf-8"))
            self.assertEqual(meta["source"], "sample.epub")
            self.assertEqual(meta["source_format"], "epub")
            self.assertEqual(meta["epub_md5"], expected_md5)
            self.assertEqual(meta["created_at"], "2026-04-12T12:00:00Z")
            self.assertEqual(meta["updated_at"], "2026-04-12T12:00:00Z")

    def test_reconvert_epub_from_stored_source_preserves_created_at(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            books_dir = root / "docs" / "books"
            book_dir = books_dir / "cached-book"
            book_dir.mkdir(parents=True, exist_ok=True)

            epub_bytes = _build_sample_epub(book_dir / "book.epub", title="Stored EPUB")
            expected_md5 = hashlib.md5(epub_bytes).hexdigest()
            (book_dir / "meta.json").write_text(
                json.dumps(
                    {
                        "id": "cached-book",
                        "type": "book",
                        "source": "cached.epub",
                        "source_format": "epub",
                        "epub_md5": expected_md5,
                        "created_at": "2026-04-10T08:00:00Z",
                        "updated_at": "2026-04-10T08:00:00Z",
                    },
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )

            with patch.object(process, "_utc_now_iso", return_value="2026-04-12T12:00:00Z"):
                process.reconvert_epub_from_cache("cached.epub", books_dir)

            self.assertTrue((book_dir / "book.epub").exists())
            self.assertEqual((book_dir / "book.epub").read_bytes(), epub_bytes)

            toc = json.loads((book_dir / "toc.json").read_text(encoding="utf-8"))
            self.assertEqual([entry["title"] for entry in toc["children"]], ["Chapter One", "Chapter Two"])

            meta = json.loads((book_dir / "meta.json").read_text(encoding="utf-8"))
            self.assertEqual(meta["source"], "cached.epub")
            self.assertEqual(meta["source_format"], "epub")
            self.assertEqual(meta["epub_md5"], expected_md5)
            self.assertEqual(meta["created_at"], "2026-04-10T08:00:00Z")
            self.assertEqual(meta["updated_at"], "2026-04-12T12:00:00Z")


if __name__ == "__main__":
    unittest.main()
