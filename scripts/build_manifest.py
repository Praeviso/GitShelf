"""Build published manifest and full catalog from converted books."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

CONVERSION_METADATA_FILENAME = "conversion.json"
VALID_VISIBILITY = {"published", "hidden", "archived"}


def _utc_now_iso() -> str:
    return datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _normalize_tags(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]

    if isinstance(value, str):
        return [tag.strip() for tag in value.split(",") if tag.strip()]

    return []


def _normalize_manual_order(value: object) -> int | None:
    if value is None or value == "":
        return None

    try:
        return int(value)
    except (TypeError, ValueError):
        raise ValueError(f"manual_order must be an integer, got {value!r}") from None


def _normalize_visibility(value: object) -> str:
    normalized = str(value).strip().lower() if value is not None else "published"
    if normalized in VALID_VISIBILITY:
        return normalized
    raise ValueError(
        f"visibility must be one of {sorted(VALID_VISIBILITY)}, got {value!r}"
    )


def _read_catalog_metadata(path: Path) -> dict[str, dict]:
    """Read curator-managed metadata keyed by book id.

    Supported forms:
    - {"books": {"book-id": {...}}}
    - {"books": [{"id": "book-id", ...}, ...]}
    """
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({"books": {}}, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        return {}

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid catalog metadata JSON at {path}: {exc}") from exc

    if not isinstance(raw, dict):
        raise ValueError(f"Catalog metadata at {path} must be an object")

    books = raw.get("books", {})
    normalized: dict[str, dict] = {}

    if isinstance(books, dict):
        iterable = ((book_id, data) for book_id, data in books.items())
    elif isinstance(books, list):
        iterable = ((entry.get("id"), entry) for entry in books if isinstance(entry, dict))
    else:
        raise ValueError(f"Catalog metadata 'books' at {path} must be an object or array")

    for book_id, data in iterable:
        if not book_id or not isinstance(data, dict):
            continue

        try:
            normalized[str(book_id)] = {
                "display_title": str(data.get("display_title", "")).strip() or None,
                "author": str(data.get("author", "")).strip() or None,
                "summary": str(data.get("summary", "")).strip() or None,
                "tags": _normalize_tags(data.get("tags")),
                "featured": bool(data.get("featured", False)),
                "manual_order": _normalize_manual_order(data.get("manual_order")),
                "visibility": _normalize_visibility(data.get("visibility")),
                "metadata_updated_at": str(data.get("metadata_updated_at", "")).strip() or None,
                "source_pdf": str(data.get("source_pdf", "")).strip() or None,
            }
        except ValueError as exc:
            raise ValueError(f"Invalid catalog metadata for {book_id}: {exc}") from exc

    return normalized


def _read_conversion_metadata(book_dir: Path) -> dict:
    path = book_dir / CONVERSION_METADATA_FILENAME
    if not path.exists():
        return {}

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid conversion metadata JSON at {path}: {exc}") from exc

    if not isinstance(raw, dict):
        raise ValueError(f"Conversion metadata at {path} must be an object")

    return raw


def _sort_key(entry: dict) -> tuple:
    featured_rank = 0 if entry.get("featured") else 1
    manual_order = entry.get("manual_order")
    normalized_order = manual_order if isinstance(manual_order, int) else 10**9
    title = str(entry.get("title", "")).casefold()
    book_id = str(entry.get("id", ""))
    return (featured_rank, normalized_order, title, book_id)


def _to_public_book(entry: dict) -> dict:
    return {
        "id": entry["id"],
        "title": entry["title"],
        "author": entry["author"],
        "summary": entry["summary"],
        "tags": entry["tags"],
        "featured": entry["featured"],
        "visibility": entry["visibility"],
        "manual_order": entry["manual_order"],
        "source_pdf": entry["source_pdf"],
        "chapters_count": entry["chapters_count"],
        "word_count": entry["word_count"],
        "created_at": entry["created_at"],
        "converted_at": entry["converted_at"],
    }


def _build_generated_book_entry(book_dir: Path) -> dict:
    """Build generated facts for one book directory.

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

    directory_modified_at = datetime.fromtimestamp(
        book_dir.stat().st_mtime, tz=timezone.utc
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    conversion = _read_conversion_metadata(book_dir)
    source_pdf = str(conversion.get("source_pdf", "")).strip() or f"{book_dir.name}.pdf"
    converted_at = str(conversion.get("converted_at", "")).strip() or directory_modified_at
    created_at = converted_at if conversion else directory_modified_at
    split_level = conversion.get("split_level")
    page_count = conversion.get("page_count")

    return {
        "id": book_dir.name,
        "generated_title": toc["title"],
        "chapters_count": chapters_count,
        "word_count": word_count,
        "created_at": created_at,
        "converted_at": converted_at,
        "source_pdf": source_pdf,
        "split_level": split_level,
        "page_count": page_count,
    }


def build_manifest(
    books_dir: Path = Path("docs/books"),
    output_path: Path = Path("docs/manifest.json"),
    catalog_metadata_path: Path = Path("docs/catalog-metadata.json"),
    catalog_output_path: Path = Path("docs/catalog.json"),
) -> None:
    """Scan books_dir, merge metadata, and build public manifest + full catalog.

    Raises:
        FileNotFoundError: If books_dir does not exist.
        FileNotFoundError: If any book directory is missing toc.json.
    """
    if not books_dir.exists():
        raise FileNotFoundError(
            f"Books directory does not exist: {books_dir}"
        )

    metadata_by_id = _read_catalog_metadata(catalog_metadata_path)
    catalog_entries: list[dict] = []

    for book_dir in sorted(books_dir.iterdir()):
        if not book_dir.is_dir():
            continue
        generated = _build_generated_book_entry(book_dir)
        metadata = metadata_by_id.get(generated["id"], {})

        display_title = metadata.get("display_title")
        title = display_title or generated["generated_title"]

        entry = {
            "id": generated["id"],
            "title": title,
            "generated_title": generated["generated_title"],
            "display_title": display_title,
            "author": metadata.get("author"),
            "summary": metadata.get("summary"),
            "tags": metadata.get("tags") or [],
            "featured": bool(metadata.get("featured", False)),
            "manual_order": metadata.get("manual_order"),
            "visibility": metadata.get("visibility", "published"),
            "metadata_updated_at": metadata.get("metadata_updated_at"),
            "chapters_count": generated["chapters_count"],
            "word_count": generated["word_count"],
            "created_at": generated["created_at"],
            "converted_at": generated["converted_at"],
            "source_pdf": metadata.get("source_pdf") or generated["source_pdf"],
            "split_level": generated["split_level"],
            "page_count": generated["page_count"],
        }
        catalog_entries.append(entry)

    catalog_entries.sort(key=_sort_key)

    public_books = [
        _to_public_book(entry)
        for entry in catalog_entries
        if entry.get("visibility") == "published"
    ]

    manifest = {"books": public_books}
    catalog = {
        "generated_at": _utc_now_iso(),
        "books": catalog_entries,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    catalog_output_path.parent.mkdir(parents=True, exist_ok=True)
    catalog_output_path.write_text(
        json.dumps(catalog, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
