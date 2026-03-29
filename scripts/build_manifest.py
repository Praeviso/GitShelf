"""Build published manifest and full catalog from all content types."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

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
    """Read curator-managed metadata keyed by item id.

    Supported forms:
    - {"items": {"item-id": {...}}}
    - {"items": [{"id": "item-id", ...}, ...]}
    - Legacy: {"books": ...} (backward compat during migration)
    """
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({"items": {}}, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        return {}

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid catalog metadata JSON at {path}: {exc}") from exc

    if not isinstance(raw, dict):
        raise ValueError(f"Catalog metadata at {path} must be an object")

    # Support both "items" and legacy "books" key
    items = raw.get("items") or raw.get("books", {})
    normalized: dict[str, dict] = {}

    if isinstance(items, dict):
        iterable = ((item_id, data) for item_id, data in items.items())
    elif isinstance(items, list):
        iterable = ((entry.get("id"), entry) for entry in items if isinstance(entry, dict))
    else:
        raise ValueError(f"Catalog metadata at {path}: 'items' must be an object or array")

    for item_id, data in iterable:
        if not item_id or not isinstance(data, dict):
            continue

        try:
            normalized[str(item_id)] = {
                "display_title": str(data.get("display_title", "")).strip() or None,
                "author": str(data.get("author", "")).strip() or None,
                "summary": str(data.get("summary", "")).strip() or None,
                "tags": _normalize_tags(data.get("tags")),
                "featured": bool(data.get("featured", False)),
                "manual_order": _normalize_manual_order(data.get("manual_order")),
                "visibility": _normalize_visibility(data.get("visibility")),
                "metadata_updated_at": str(data.get("metadata_updated_at", "")).strip() or None,
                "source": str(data.get("source") or data.get("source_pdf", "")).strip() or None,
            }
        except ValueError as exc:
            raise ValueError(f"Invalid catalog metadata for {item_id}: {exc}") from exc

    return normalized


def _read_meta_json(path: Path) -> dict:
    """Read a meta.json or .meta.json file."""
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON at {path}: {exc}") from exc
    if not isinstance(raw, dict):
        raise ValueError(f"Metadata at {path} must be an object")
    return raw


def _sort_key(entry: dict) -> tuple:
    featured_rank = 0 if entry.get("featured") else 1
    manual_order = entry.get("manual_order")
    normalized_order = manual_order if isinstance(manual_order, int) else 10**9
    title = str(entry.get("title", "")).casefold()
    item_id = str(entry.get("id", ""))
    return (featured_rank, normalized_order, title, item_id)


def _to_public_item(entry: dict) -> dict:
    """Filter to public-facing fields for manifest.json."""
    result = {
        "id": entry["id"],
        "type": entry["type"],
        "title": entry["title"],
        "author": entry.get("author"),
        "summary": entry.get("summary"),
        "tags": entry.get("tags", []),
        "featured": entry.get("featured", False),
        "source": entry.get("source"),
        "created_at": entry.get("created_at"),
        "updated_at": entry.get("updated_at"),
    }
    # Type-specific fields
    if entry["type"] == "book":
        result["chapters_count"] = entry.get("chapters_count")
        result["word_count"] = entry.get("word_count")
    elif entry["type"] == "doc":
        result["word_count"] = entry.get("word_count")
    elif entry["type"] == "site":
        result["entry"] = entry.get("entry")
    return result


# --- Book scanning (from books/) ---

def _build_book_entry(book_dir: Path) -> dict:
    """Build generated facts for one book directory."""
    toc_path = book_dir / "toc.json"
    if not toc_path.exists():
        raise FileNotFoundError(f"Missing toc.json in book directory: {book_dir}")

    toc = json.loads(toc_path.read_text(encoding="utf-8"))
    chapters_dir = book_dir / "chapters"

    md_files = sorted(chapters_dir.glob("*.md")) if chapters_dir.is_dir() else []
    chapters_count = len(md_files)
    word_count = sum(len(f.read_text(encoding="utf-8").split()) for f in md_files)

    directory_modified_at = datetime.fromtimestamp(
        book_dir.stat().st_mtime, tz=timezone.utc
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Read meta.json (new) or conversion.json (legacy)
    meta = _read_meta_json(book_dir / "meta.json")
    if not meta:
        meta = _read_meta_json(book_dir / "conversion.json")

    source = str(meta.get("source") or meta.get("source_pdf", "")).strip() or f"{book_dir.name}.pdf"
    updated_at = str(meta.get("updated_at") or meta.get("converted_at", "")).strip() or directory_modified_at
    created_at = str(meta.get("created_at", "")).strip() or updated_at

    return {
        "id": book_dir.name,
        "type": "book",
        "generated_title": toc["title"],
        "chapters_count": chapters_count,
        "word_count": word_count,
        "created_at": created_at,
        "updated_at": updated_at,
        "source": source,
        "split_level": meta.get("split_level"),
        "page_count": meta.get("page_count"),
    }


# --- Article scanning (from articles/) ---

def _build_article_entry(article_dir: Path) -> dict:
    """Build entry for one article directory."""
    meta = _read_meta_json(article_dir / "meta.json")

    # Count words from content.md
    content_path = article_dir / "content.md"
    word_count = 0
    if content_path.exists():
        word_count = len(content_path.read_text(encoding="utf-8").split())

    title = meta.get("title") or article_dir.name
    source = meta.get("source", f"{article_dir.name}.md")

    return {
        "id": article_dir.name,
        "type": "doc",
        "generated_title": title,
        "word_count": word_count,
        "created_at": meta.get("created_at", _utc_now_iso()),
        "updated_at": meta.get("updated_at", _utc_now_iso()),
        "source": source,
    }


# --- Site scanning (from sites/) ---

def _build_site_entry(site_dir: Path) -> dict:
    """Build entry for one static site directory."""
    meta = _read_meta_json(site_dir / ".meta.json")

    title = meta.get("title") or site_dir.name
    source = meta.get("source", f"{site_dir.name}.zip")
    entry = meta.get("entry", f"sites/{site_dir.name}/index.html")

    return {
        "id": site_dir.name,
        "type": "site",
        "generated_title": title,
        "entry": entry,
        "created_at": meta.get("created_at", _utc_now_iso()),
        "updated_at": meta.get("updated_at", _utc_now_iso()),
        "source": source,
    }


# --- Main ---

def build_manifest(
    books_dir: Path = Path("docs/books"),
    output_path: Path = Path("docs/manifest.json"),
    catalog_metadata_path: Path = Path("docs/catalog-metadata.json"),
    catalog_output_path: Path = Path("docs/catalog.json"),
    *,
    articles_dir: Path = Path("docs/articles"),
    sites_dir: Path = Path("docs/sites"),
) -> None:
    """Scan all content directories and build manifest + catalog.

    Raises:
        FileNotFoundError: If a book directory is missing toc.json.
    """
    metadata_by_id = _read_catalog_metadata(catalog_metadata_path)
    catalog_entries: list[dict] = []

    # Scan books
    if books_dir.exists():
        for book_dir in sorted(books_dir.iterdir()):
            if not book_dir.is_dir():
                continue
            generated = _build_book_entry(book_dir)
            metadata = metadata_by_id.get(generated["id"], {})
            display_title = metadata.get("display_title")
            title = display_title or generated["generated_title"]

            entry = {
                "id": generated["id"],
                "type": "book",
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
                "updated_at": generated["updated_at"],
                "source": metadata.get("source") or generated["source"],
                "split_level": generated["split_level"],
                "page_count": generated["page_count"],
            }
            catalog_entries.append(entry)

    # Scan articles
    if articles_dir.exists():
        for article_dir in sorted(articles_dir.iterdir()):
            if not article_dir.is_dir():
                continue
            generated = _build_article_entry(article_dir)
            metadata = metadata_by_id.get(generated["id"], {})
            display_title = metadata.get("display_title")
            title = display_title or generated["generated_title"]

            entry = {
                "id": generated["id"],
                "type": "doc",
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
                "word_count": generated["word_count"],
                "created_at": generated["created_at"],
                "updated_at": generated["updated_at"],
                "source": metadata.get("source") or generated["source"],
            }
            catalog_entries.append(entry)

    # Scan sites
    if sites_dir.exists():
        for site_dir in sorted(sites_dir.iterdir()):
            if not site_dir.is_dir():
                continue
            generated = _build_site_entry(site_dir)
            metadata = metadata_by_id.get(generated["id"], {})
            display_title = metadata.get("display_title")
            title = display_title or generated["generated_title"]

            entry = {
                "id": generated["id"],
                "type": "site",
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
                "entry": generated.get("entry"),
                "created_at": generated["created_at"],
                "updated_at": generated["updated_at"],
                "source": metadata.get("source") or generated["source"],
            }
            catalog_entries.append(entry)

    catalog_entries.sort(key=_sort_key)

    public_items = [
        _to_public_item(entry)
        for entry in catalog_entries
        if entry.get("visibility") == "published"
    ]

    manifest = {"items": public_items}
    catalog = {
        "generated_at": _utc_now_iso(),
        "items": catalog_entries,
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
