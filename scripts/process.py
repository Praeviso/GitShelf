#!/usr/bin/env python3
"""Unified content processing pipeline.

Handles three content types from input/:
  - .pdf → book (chapters via MinerU API)
  - .md  → article (single markdown document)
  - .zip → site (static site extraction)

Usage: python scripts/process.py [--input-dir INPUT] [--output-dir OUTPUT] [--split-level LEVEL]
"""

import argparse
import json
import os
import re
import shutil
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

try:
    from .build_manifest import build_manifest
except ImportError:
    from build_manifest import build_manifest

# Reuse PDF pipeline from convert.py
try:
    from .convert import (
        convert_single_pdf,
        detect_new_pdfs,
        generate_book_id,
        reconvert_from_cache,
        _read_config_split_level,
        _write_failures,
        _remove_failure,
    )
except ImportError:
    from convert import (
        convert_single_pdf,
        detect_new_pdfs,
        generate_book_id,
        reconvert_from_cache,
        _read_config_split_level,
        _write_failures,
        _remove_failure,
    )

FAILURES_FILENAME = "failures.json"


def _utc_now_iso() -> str:
    return datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _generate_id(path: Path) -> str:
    """Generate URL-safe ID from filename (reuses book ID logic)."""
    return generate_book_id(path)


# --- Markdown processing ---

def _count_words(text: str) -> int:
    """Count words in text."""
    return len(text.split())


def process_markdown(md_path: Path, output_dir: Path) -> None:
    """Process a single .md file into an article.

    Creates:
      docs/articles/{id}/
        content.md   - the markdown content
        meta.json    - article metadata
    """
    article_id = _generate_id(md_path)
    title = md_path.stem
    print(f"Processing markdown: {md_path.name} -> {article_id}")

    content = md_path.read_text(encoding="utf-8")
    word_count = _count_words(content)

    article_dir = output_dir / article_id
    article_dir.mkdir(parents=True, exist_ok=True)

    # Write content
    (article_dir / "content.md").write_text(content, encoding="utf-8")

    # Write metadata
    meta = {
        "id": article_id,
        "type": "doc",
        "title": title,
        "source": md_path.name,
        "word_count": word_count,
        "created_at": _utc_now_iso(),
        "updated_at": _utc_now_iso(),
    }
    (article_dir / "meta.json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    # Delete source
    md_path.unlink(missing_ok=True)
    print(f"  Article created: {article_id} ({word_count} words)")


# --- ZIP / static site processing ---

def _flatten_single_root(extract_dir: Path) -> None:
    """If ZIP extracted to a single root folder, flatten it.

    Common pattern: archive contains dist/ or project-name/ wrapping everything.
    """
    entries = list(extract_dir.iterdir())
    if len(entries) == 1 and entries[0].is_dir():
        single_dir = entries[0]
        print(f"  Flattening single root directory: {single_dir.name}/")
        for item in single_dir.iterdir():
            dest = extract_dir / item.name
            if item.is_dir():
                shutil.move(str(item), str(dest))
            else:
                shutil.move(str(item), str(dest))
        single_dir.rmdir()


def process_site(zip_path: Path, output_dir: Path) -> None:
    """Process a .zip file into a static site.

    Extracts to:
      docs/sites/{id}/
        .meta.json   - site metadata (dot-prefixed to avoid conflicts)
        index.html   - required entry point
        ...other files
    """
    site_id = _generate_id(zip_path)
    print(f"Processing site: {zip_path.name} -> {site_id}")

    site_dir = output_dir / site_id

    # Clean existing site directory for re-upload
    if site_dir.exists():
        shutil.rmtree(site_dir)

    site_dir.mkdir(parents=True, exist_ok=True)

    # Extract ZIP
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(site_dir)
    except zipfile.BadZipFile as exc:
        shutil.rmtree(site_dir, ignore_errors=True)
        raise ValueError(f"Invalid ZIP file: {zip_path.name}: {exc}") from exc

    # Flatten single root directory
    _flatten_single_root(site_dir)

    # Validate index.html exists
    if not (site_dir / "index.html").exists():
        shutil.rmtree(site_dir, ignore_errors=True)
        raise FileNotFoundError(
            f"ZIP must contain index.html at root level: {zip_path.name}"
        )

    # Write metadata (dot-prefixed to not interfere with site files)
    entry = f"sites/{site_id}/index.html"
    meta = {
        "id": site_id,
        "type": "site",
        "title": zip_path.stem,
        "source": zip_path.name,
        "entry": entry,
        "created_at": _utc_now_iso(),
        "updated_at": _utc_now_iso(),
    }
    (site_dir / ".meta.json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    # Delete source
    zip_path.unlink(missing_ok=True)
    print(f"  Site created: {site_id} (entry: {entry})")


# --- Main ---

def _resolve_input_file(input_dir: Path, filename: str) -> Path:
    """Resolve a dispatch filename from input/."""
    target = input_dir / Path(filename).name
    if target.exists():
        return target
    raise FileNotFoundError(f"File not found in input/: {filename}")


def main() -> None:
    config_level = _read_config_split_level()

    parser = argparse.ArgumentParser(description="Process content (PDF, Markdown, ZIP).")
    parser.add_argument("--input-dir", type=Path, default=Path("input"))
    parser.add_argument("--output-dir", type=Path, default=Path("docs"))
    parser.add_argument(
        "--split-level", type=int, choices=[1, 2, 3],
        default=config_level or 1,
    )
    args = parser.parse_args()

    books_dir = args.output_dir / "books"
    articles_dir = args.output_dir / "articles"
    sites_dir = args.output_dir / "sites"

    input_filename = os.environ.get("INPUT_FILENAME", "").strip()

    # Collect jobs by type
    pdf_jobs: list[Path] = []
    md_jobs: list[Path] = []
    zip_jobs: list[Path] = []

    if input_filename:
        try:
            path = _resolve_input_file(args.input_dir, input_filename)
            ext = path.suffix.lower()
            if ext == ".pdf":
                pdf_jobs = [path]
            elif ext == ".md":
                md_jobs = [path]
            elif ext == ".zip":
                zip_jobs = [path]
            else:
                print(f"Unsupported file type: {input_filename}", file=sys.stderr)
                sys.exit(1)
        except FileNotFoundError:
            # For PDFs, try reconvert from cache
            if input_filename.lower().endswith(".pdf"):
                print(f"PDF not found, attempting reconvert from cache: {input_filename}")
                try:
                    reconvert_from_cache(input_filename, books_dir, args.split_level)
                    build_manifest(books_dir, articles_dir=articles_dir, sites_dir=sites_dir)
                    print("Manifest rebuilt.")
                    return
                except FileNotFoundError as exc:
                    print(str(exc), file=sys.stderr)
                    sys.exit(1)
            else:
                print(f"File not found: {input_filename}", file=sys.stderr)
                sys.exit(1)
    else:
        pdf_jobs = detect_new_pdfs(args.input_dir)
        md_jobs = sorted(args.input_dir.glob("*.md"))
        zip_jobs = sorted(args.input_dir.glob("*.zip"))

    total = len(pdf_jobs) + len(md_jobs) + len(zip_jobs)
    if total == 0:
        print("No new content found in input/. Nothing to do.")
        return

    print(f"Found {total} item(s) to process: {len(pdf_jobs)} PDF, {len(md_jobs)} MD, {len(zip_jobs)} ZIP")

    failures: list[tuple[Path, Exception]] = []

    # Process PDFs (existing pipeline)
    for pdf_path in pdf_jobs:
        try:
            convert_single_pdf(pdf_path, books_dir, args.split_level)
        except Exception as exc:
            print(f"  FAILED: {pdf_path.name}: {exc}", file=sys.stderr)
            failures.append((pdf_path, exc))

    # Process Markdown files
    for md_path in md_jobs:
        try:
            process_markdown(md_path, articles_dir)
        except Exception as exc:
            print(f"  FAILED: {md_path.name}: {exc}", file=sys.stderr)
            failures.append((md_path, exc))

    # Process ZIP files
    for zip_path in zip_jobs:
        try:
            process_site(zip_path, sites_dir)
        except Exception as exc:
            print(f"  FAILED: {zip_path.name}: {exc}", file=sys.stderr)
            failures.append((zip_path, exc))

    # Rebuild manifest
    build_manifest(books_dir, articles_dir=articles_dir, sites_dir=sites_dir)
    print("Manifest rebuilt.")

    if failures:
        _write_failures(failures, args.output_dir)
        print(f"\n{len(failures)} item(s) failed:", file=sys.stderr)
        for path, exc in failures:
            print(f"  - {path.name}: {exc}", file=sys.stderr)
    else:
        print("All content processed successfully.")


if __name__ == "__main__":
    main()
