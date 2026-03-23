"""Scan docs/books/ and generate docs/manifest.json."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


def _build_book_entry(book_dir: Path) -> dict:
    """Build a single manifest entry for one book directory.

    Raises:
        FileNotFoundError: If toc.json is missing in the book directory.
    """
    toc_path = book_dir / "toc.json"
    if not toc_path.exists():
        raise FileNotFoundError(
            f"Missing toc.json in book directory: {book_dir}"
        )

    toc = json.loads(toc_path.read_text(encoding="utf-8"))
    chapters_dir = book_dir / "chapters"

    # Single glob pass for both chapter count and word count.
    md_files = sorted(chapters_dir.glob("*.md")) if chapters_dir.is_dir() else []
    chapters_count = len(md_files)
    word_count = sum(
        len(f.read_text(encoding="utf-8").split()) for f in md_files
    )

    created_at = datetime.fromtimestamp(
        book_dir.stat().st_mtime, tz=timezone.utc
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    return {
        "id": book_dir.name,
        "title": toc["title"],
        "chapters_count": chapters_count,
        "word_count": word_count,
        "created_at": created_at,
    }


def build_manifest(
    books_dir: Path = Path("docs/books"),
    output_path: Path = Path("docs/manifest.json"),
) -> None:
    """Scan books_dir for book directories, build manifest.json.

    Each book directory must contain a toc.json file. The resulting
    manifest.json lists all books with metadata.

    Raises:
        FileNotFoundError: If books_dir does not exist.
        FileNotFoundError: If any book directory is missing toc.json.
    """
    if not books_dir.exists():
        raise FileNotFoundError(
            f"Books directory does not exist: {books_dir}"
        )

    book_entries: list[dict] = []
    for book_dir in sorted(books_dir.iterdir()):
        if not book_dir.is_dir():
            continue
        book_entries.append(_build_book_entry(book_dir))

    manifest = {"books": book_entries}
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
