#!/usr/bin/env python3
"""PDF to Book conversion pipeline.

Usage: python scripts/convert.py [--input-dir INPUT] [--output-dir OUTPUT] [--split-level LEVEL]
"""

import argparse
import re
import shutil
import sys
import tempfile
from pathlib import Path

import fitz  # PyMuPDF

try:
    from .mineru_client import MineruClient
    from .split_markdown import split_by_headings
    from .generate_structure import generate_book_structure
    from .build_manifest import build_manifest
except ImportError:
    from mineru_client import MineruClient
    from split_markdown import split_by_headings
    from generate_structure import generate_book_structure
    from build_manifest import build_manifest

MAX_PAGES_PER_CHUNK = 500
PAGE_THRESHOLD = 600


def detect_new_pdfs(input_dir: Path) -> list[Path]:
    """Find .pdf files in input_dir (not in archived/)."""
    archived = input_dir / "archived"
    return [
        p
        for p in sorted(input_dir.glob("*.pdf"))
        if not p.is_relative_to(archived)
    ]


def get_page_count(pdf_path: Path) -> int:
    """Get page count using PyMuPDF."""
    with fitz.open(pdf_path) as doc:
        return len(doc)


def split_pdf(pdf_path: Path, chunk_size: int = MAX_PAGES_PER_CHUNK) -> list[Path]:
    """Split large PDF into chunks using PyMuPDF. Returns list of chunk paths.

    Chunks are written to a temporary directory. The caller is responsible
    for cleaning up via the parent directory of the returned paths.
    """
    tmp_dir = Path(tempfile.mkdtemp(prefix="pdf2book_chunks_"))
    chunk_paths: list[Path] = []

    with fitz.open(pdf_path) as doc:
        total = len(doc)
        for start in range(0, total, chunk_size):
            end = min(start + chunk_size, total)
            chunk_doc = fitz.open()
            chunk_doc.insert_pdf(doc, from_page=start, to_page=end - 1)
            chunk_path = tmp_dir / f"{pdf_path.stem}_chunk_{start:05d}.pdf"
            chunk_doc.save(str(chunk_path))
            chunk_doc.close()
            chunk_paths.append(chunk_path)

    return chunk_paths


def generate_book_id(pdf_path: Path) -> str:
    """Generate URL-safe book ID from PDF filename."""
    name = pdf_path.stem.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", name)
    slug = slug.strip("-")
    return slug


def convert_single_pdf(pdf_path: Path, output_dir: Path, split_level: int = 1) -> None:
    """Convert one PDF through the full pipeline.

    Steps:
        1. Check page count
        2. If >600 pages: split into chunks, convert each, concatenate
        3. If <=600 pages: convert directly
        4. Split markdown into chapters
        5. Generate book directory structure with toc.json
        6. Move processed PDF to archived/
    """
    book_id = generate_book_id(pdf_path)
    title = pdf_path.stem
    client = MineruClient()

    print(f"Processing: {pdf_path.name} -> {book_id}")

    page_count = get_page_count(pdf_path)
    print(f"  Page count: {page_count}")

    if page_count > PAGE_THRESHOLD:
        markdown = _convert_large_pdf(client, pdf_path, page_count)
    else:
        markdown = client.convert(pdf_path)

    chapters = split_by_headings(markdown, level=split_level)
    generate_book_structure(book_id, title, chapters, output_dir, split_level)

    archived_dir = pdf_path.parent / "archived"
    archived_dir.mkdir(exist_ok=True)
    shutil.move(str(pdf_path), str(archived_dir / pdf_path.name))
    print(f"  Archived: {pdf_path.name}")


def _convert_large_pdf(client: MineruClient, pdf_path: Path, page_count: int) -> str:
    """Split a large PDF into chunks, convert each via MinerU, and concatenate."""
    print(f"  Splitting {page_count}-page PDF into ~{MAX_PAGES_PER_CHUNK}-page chunks")
    chunk_paths = split_pdf(pdf_path)
    tmp_dir = chunk_paths[0].parent

    try:
        parts: list[str] = []
        for i, chunk_path in enumerate(chunk_paths, 1):
            print(f"  Converting chunk {i}/{len(chunk_paths)}: {chunk_path.name}")
            parts.append(client.convert(chunk_path))
        return "\n\n".join(parts)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def main() -> None:
    """Main entry point. Parse args, run pipeline."""
    parser = argparse.ArgumentParser(description="Convert PDFs to online books.")
    parser.add_argument(
        "--input-dir",
        type=Path,
        default=Path("input"),
        help="Path to input directory (default: input/)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("docs/books"),
        help="Path to output directory (default: docs/books)",
    )
    parser.add_argument(
        "--split-level",
        type=int,
        choices=[1, 2, 3],
        default=1,
        help="Heading level for chapter splitting: 1, 2, or 3 (default: 1)",
    )
    args = parser.parse_args()

    pdfs = detect_new_pdfs(args.input_dir)
    if not pdfs:
        print("No new PDFs found in input/. Nothing to do.")
        return

    print(f"Found {len(pdfs)} PDF(s) to process.")

    failures: list[tuple[Path, Exception]] = []
    for pdf_path in pdfs:
        try:
            convert_single_pdf(pdf_path, args.output_dir, args.split_level)
        except Exception as exc:
            print(f"  FAILED: {pdf_path.name}: {exc}", file=sys.stderr)
            failures.append((pdf_path, exc))

    build_manifest(args.output_dir)
    print("Manifest rebuilt.")

    if failures:
        print(f"\n{len(failures)} PDF(s) failed:", file=sys.stderr)
        for path, exc in failures:
            print(f"  - {path.name}: {exc}", file=sys.stderr)
        sys.exit(1)

    print("All PDFs processed successfully.")


if __name__ == "__main__":
    main()
