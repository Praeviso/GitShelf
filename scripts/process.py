#!/usr/bin/env python3
"""Unified content processing pipeline.

Handles four content types from input/:
  - .pdf  → book (chapters via MinerU API)
  - .epub → book (raw EPUB + extracted TOC metadata)
  - .md   → article (single markdown document)
  - .zip  → site (static site extraction)

Usage: python scripts/process.py [--input-dir INPUT] [--output-dir OUTPUT]
"""

import argparse
import hashlib
import json
import os
import posixpath
import re
import shutil
import sys
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

try:
    from .build_manifest import build_manifest
except ImportError:
    from build_manifest import build_manifest

# Reuse PDF pipeline from convert.py
try:
    from .convert import (
        convert_single_pdf,
        detect_new_pdfs,
        ensure_unique_content_id,
        generate_book_id,
        reconvert_from_cache,
        _write_failures,
        _remove_failure,
    )
except ImportError:
    from convert import (
        convert_single_pdf,
        detect_new_pdfs,
        ensure_unique_content_id,
        generate_book_id,
        reconvert_from_cache,
        _write_failures,
        _remove_failure,
    )

FAILURES_FILENAME = "failures.json"
BOOK_METADATA_FILENAME = "meta.json"
EPUB_BOOK_FILENAME = "book.epub"
EPUB_CONTAINER_PATH = "META-INF/container.xml"
EPUB_CONTAINER_NS = {"container": "urn:oasis:names:tc:opendocument:xmlns:container"}
EPUB_PACKAGE_NS = {
    "opf": "http://www.idpf.org/2007/opf",
    "dc": "http://purl.org/dc/elements/1.1/",
}
EPUB_NAV_NS = {
    "xhtml": "http://www.w3.org/1999/xhtml",
    "epub": "http://www.idpf.org/2007/ops",
}
EPUB_NCX_NS = {"ncx": "http://www.daisy.org/z3986/2005/ncx/"}


def _utc_now_iso() -> str:
    return datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _generate_id(path: Path) -> str:
    """Generate URL-safe ID from filename (reuses book ID logic)."""
    return generate_book_id(path)


def _file_md5(path: Path) -> str:
    """Compute MD5 hex digest for an input file."""
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def detect_new_epubs(input_dir: Path) -> list[Path]:
    """Find .epub files in input_dir."""
    return sorted(input_dir.glob("*.epub"))


def _read_existing_created_at(book_dir: Path, fallback: str) -> str:
    meta_path = book_dir / BOOK_METADATA_FILENAME
    if not meta_path.exists():
        return fallback

    try:
        existing = json.loads(meta_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return fallback

    return str(existing.get("created_at", "")).strip() or fallback


def _read_existing_epub_checksum(book_dir: Path) -> str | None:
    meta_path = book_dir / BOOK_METADATA_FILENAME
    if not meta_path.exists():
        return None

    try:
        existing = json.loads(meta_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None

    checksum = str(existing.get("epub_md5", "")).strip()
    return checksum or None


def _write_epub_metadata(
    book_dir: Path,
    *,
    book_id: str,
    source_epub: str,
    epub_md5: str,
    updated_at: str,
    created_at: str | None = None,
) -> None:
    normalized_created_at = created_at or _read_existing_created_at(book_dir, updated_at)
    data = {
        "id": book_id,
        "type": "book",
        "source": source_epub,
        "source_format": "epub",
        "epub_md5": epub_md5,
        "created_at": normalized_created_at,
        "updated_at": updated_at,
    }
    (book_dir / BOOK_METADATA_FILENAME).write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def _slugify_epub(text: str) -> str:
    normalized = text.strip().lower()
    normalized = re.sub(r"[\s_]+", "-", normalized)
    normalized = re.sub(r"[^\w-]+", "-", normalized, flags=re.UNICODE)
    normalized = re.sub(r"-{2,}", "-", normalized).strip("-")
    return normalized


@dataclass
class EpubTocEntry:
    title: str
    href: str
    children: list["EpubTocEntry"] = field(default_factory=list)


def _normalize_epub_href(base_path: str, href: str) -> str:
    value = str(href or "").strip()
    if not value:
        return ""

    path_part, frag = value.split("#", 1) if "#" in value else (value, "")
    resolved = posixpath.normpath(
        posixpath.join(posixpath.dirname(base_path), path_part)
    )
    if frag:
        return f"{resolved}#{frag}"
    return resolved


def _package_relative_epub_href(package_path: str, href: str) -> str:
    value = str(href or "").strip()
    if not value:
        return ""

    path_part, frag = value.split("#", 1) if "#" in value else (value, "")
    package_dir = posixpath.dirname(package_path)
    relative = (
        posixpath.relpath(path_part, package_dir)
        if package_dir
        else path_part
    )
    normalized = posixpath.normpath(relative)
    if frag:
        return f"{normalized}#{frag}"
    return normalized


def _rewrite_epub_toc_hrefs(
    entries: list[EpubTocEntry],
    *,
    package_path: str,
) -> list[EpubTocEntry]:
    rewritten: list[EpubTocEntry] = []
    for entry in entries:
        rewritten.append(
            EpubTocEntry(
                title=entry.title,
                href=_package_relative_epub_href(package_path, entry.href),
                children=_rewrite_epub_toc_hrefs(entry.children, package_path=package_path),
            )
        )
    return rewritten


def _read_epub_package_path(zf: zipfile.ZipFile) -> str:
    try:
        container_xml = zf.read(EPUB_CONTAINER_PATH)
    except KeyError as exc:
        raise ValueError("EPUB is missing META-INF/container.xml") from exc

    root = ET.fromstring(container_xml)
    rootfile = root.find(".//container:rootfile", EPUB_CONTAINER_NS)
    if rootfile is None:
        raise ValueError("EPUB container.xml does not declare a package document")

    full_path = str(rootfile.attrib.get("full-path", "")).strip()
    if not full_path:
        raise ValueError("EPUB package document path is empty")
    return full_path


def _parse_epub_nav_item(
    li: ET.Element,
    *,
    nav_path: str,
) -> EpubTocEntry | None:
    anchor = li.find("./xhtml:a", EPUB_NAV_NS)
    if anchor is None:
        anchor = li.find("./xhtml:span", EPUB_NAV_NS)
    if anchor is None:
        return None

    title = " ".join("".join(anchor.itertext()).split())
    if not title:
        return None

    href = _normalize_epub_href(nav_path, anchor.attrib.get("href", ""))
    children = []
    child_list = li.find("./xhtml:ol", EPUB_NAV_NS)
    if child_list is not None:
        for child in child_list.findall("./xhtml:li", EPUB_NAV_NS):
            parsed = _parse_epub_nav_item(child, nav_path=nav_path)
            if parsed is not None:
                children.append(parsed)

    return EpubTocEntry(title=title, href=href, children=children)


def _extract_epub_nav_toc(zf: zipfile.ZipFile, nav_path: str) -> list[EpubTocEntry]:
    root = ET.fromstring(zf.read(nav_path))
    toc_nav = None
    for nav in root.findall(".//xhtml:nav", EPUB_NAV_NS):
        nav_type = nav.attrib.get(f"{{{EPUB_NAV_NS['epub']}}}type", "") or nav.attrib.get("type", "")
        if nav_type == "toc":
            toc_nav = nav
            break

    if toc_nav is None:
        return []

    toc_list = toc_nav.find("./xhtml:ol", EPUB_NAV_NS)
    if toc_list is None:
        return []

    entries: list[EpubTocEntry] = []
    for item in toc_list.findall("./xhtml:li", EPUB_NAV_NS):
        parsed = _parse_epub_nav_item(item, nav_path=nav_path)
        if parsed is not None:
            entries.append(parsed)
    return entries


def _parse_epub_ncx_point(point: ET.Element, *, ncx_path: str) -> EpubTocEntry | None:
    label = point.find("./ncx:navLabel/ncx:text", EPUB_NCX_NS)
    content = point.find("./ncx:content", EPUB_NCX_NS)
    if label is None or content is None:
        return None

    title = " ".join("".join(label.itertext()).split())
    if not title:
        return None

    href = _normalize_epub_href(ncx_path, content.attrib.get("src", ""))
    children = []
    for child in point.findall("./ncx:navPoint", EPUB_NCX_NS):
        parsed = _parse_epub_ncx_point(child, ncx_path=ncx_path)
        if parsed is not None:
            children.append(parsed)

    return EpubTocEntry(title=title, href=href, children=children)


def _extract_epub_ncx_toc(zf: zipfile.ZipFile, ncx_path: str) -> list[EpubTocEntry]:
    root = ET.fromstring(zf.read(ncx_path))
    nav_map = root.find("./ncx:navMap", EPUB_NCX_NS)
    if nav_map is None:
        return []

    entries: list[EpubTocEntry] = []
    for point in nav_map.findall("./ncx:navPoint", EPUB_NCX_NS):
        parsed = _parse_epub_ncx_point(point, ncx_path=ncx_path)
        if parsed is not None:
            entries.append(parsed)
    return entries


def _guess_epub_fallback_toc(
    spine: list[str],
    manifest_by_id: dict[str, dict[str, str]],
) -> list[EpubTocEntry]:
    entries: list[EpubTocEntry] = []
    for item_id in spine:
        manifest_item = manifest_by_id.get(item_id)
        if not manifest_item:
            continue

        href = posixpath.normpath(str(manifest_item.get("href", "")).strip())
        media_type = manifest_item.get("media_type", "")
        if media_type not in {"application/xhtml+xml", "text/html"}:
            continue

        title = PurePosixPath(href.split("#", 1)[0]).stem.replace("_", " ").replace("-", " ").strip()
        entries.append(EpubTocEntry(title=title or item_id, href=href))
    return entries


def _build_epub_toc_data(epub_path: Path) -> tuple[str, list[EpubTocEntry]]:
    try:
        with zipfile.ZipFile(epub_path, "r") as zf:
            package_path = _read_epub_package_path(zf)
            package_root = ET.fromstring(zf.read(package_path))
    except zipfile.BadZipFile as exc:
        raise ValueError(f"Invalid EPUB file: {epub_path.name}: {exc}") from exc

    title = (
        package_root.findtext(".//dc:title", default="", namespaces=EPUB_PACKAGE_NS).strip()
        or epub_path.stem
    )

    manifest_by_id: dict[str, dict[str, str]] = {}
    nav_path = ""
    ncx_path = ""
    for item in package_root.findall(".//opf:manifest/opf:item", EPUB_PACKAGE_NS):
        item_id = str(item.attrib.get("id", "")).strip()
        href = str(item.attrib.get("href", "")).strip()
        media_type = str(item.attrib.get("media-type", "")).strip()
        properties = str(item.attrib.get("properties", "")).strip()
        if not item_id or not href:
            continue

        manifest_by_id[item_id] = {
            "href": href,
            "media_type": media_type,
            "properties": properties,
        }
        if "nav" in properties.split():
            nav_path = _normalize_epub_href(package_path, href)
        if media_type == "application/x-dtbncx+xml" and not ncx_path:
            ncx_path = _normalize_epub_href(package_path, href)

    spine_element = package_root.find(".//opf:spine", EPUB_PACKAGE_NS)
    spine_ids = [
        str(itemref.attrib.get("idref", "")).strip()
        for itemref in package_root.findall(".//opf:spine/opf:itemref", EPUB_PACKAGE_NS)
        if str(itemref.attrib.get("idref", "")).strip()
    ]

    if spine_element is not None:
        toc_id = str(spine_element.attrib.get("toc", "")).strip()
        if toc_id and toc_id in manifest_by_id:
            ncx_path = _normalize_epub_href(package_path, manifest_by_id[toc_id]["href"])

    with zipfile.ZipFile(epub_path, "r") as zf:
        toc_entries: list[EpubTocEntry]
        if nav_path:
            toc_entries = _extract_epub_nav_toc(zf, nav_path)
        elif ncx_path:
            toc_entries = _extract_epub_ncx_toc(zf, ncx_path)
        else:
            toc_entries = []

    if toc_entries:
        toc_entries = _rewrite_epub_toc_hrefs(toc_entries, package_path=package_path)

    if not toc_entries:
        toc_entries = _guess_epub_fallback_toc(spine_ids, manifest_by_id)

    if not toc_entries:
        raise ValueError(f"Could not extract a table of contents from {epub_path.name}")

    return title, toc_entries


def _serialize_epub_toc_entries(entries: list[EpubTocEntry]) -> list[dict]:
    used: dict[str, int] = {}

    def _convert(entry: EpubTocEntry) -> dict:
        title_base = _slugify_epub(entry.title)
        href_base = _slugify_epub(PurePosixPath(entry.href.split("#", 1)[0]).stem)
        base = title_base or href_base or "section"
        count = used.get(base, 0) + 1
        used[base] = count
        slug = base if count == 1 else f"{base}-{count}"

        data = {
            "title": entry.title,
            "slug": slug,
            "href": entry.href,
        }
        if entry.children:
            data["children"] = [_convert(child) for child in entry.children]
        return data

    return [_convert(entry) for entry in entries]


def _generate_epub_readme(title: str, toc_entries: list[dict]) -> str:
    lines = [f"# {title}", "", "## Chapters", ""]
    for entry in toc_entries:
        lines.append(f"- {entry['title']}")
    lines.extend(
        [
            "",
            "---",
            "",
            "> **Disclaimer:** This content is provided for personal study and research "
            "purposes only. All rights belong to the original authors and copyright holders. "
            "This is not an authorized distribution. If you are the rights holder and wish "
            "to have this content removed, please contact the repository owner.",
            "",
        ]
    )
    return "\n".join(lines)


def _build_epub_book(epub_path: Path, output_dir: Path, book_id: str) -> tuple[str, list[dict]]:
    """Store the original EPUB and generate lightweight TOC metadata."""
    epub_bytes = epub_path.read_bytes()
    title, raw_toc = _build_epub_toc_data(epub_path)
    toc_entries = _serialize_epub_toc_entries(raw_toc)

    book_dir = output_dir / book_id
    if book_dir.exists():
        shutil.rmtree(book_dir)
    book_dir.mkdir(parents=True, exist_ok=True)

    (book_dir / EPUB_BOOK_FILENAME).write_bytes(epub_bytes)
    (book_dir / "toc.json").write_text(
        json.dumps({"title": title, "children": toc_entries}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    (book_dir / "README.md").write_text(
        _generate_epub_readme(title, toc_entries),
        encoding="utf-8",
    )

    return title, toc_entries


def process_epub(epub_path: Path, output_dir: Path) -> None:
    """Process a single .epub file into a raw EPUB-backed book."""
    book_id = ensure_unique_content_id(_generate_id(epub_path), output_dir.parent, "book")
    md5 = _file_md5(epub_path)
    book_dir = output_dir / book_id
    timestamp = _utc_now_iso()
    created_at = _read_existing_created_at(book_dir, timestamp)

    print(f"Processing EPUB: {epub_path.name} -> {book_id}")

    title, toc_entries = _build_epub_book(epub_path, output_dir, book_id)
    print(f"  Extracted EPUB TOC with {len(toc_entries)} top-level entries")

    _write_epub_metadata(
        book_dir,
        book_id=book_id,
        source_epub=epub_path.name,
        epub_md5=md5,
        created_at=created_at,
        updated_at=timestamp,
    )

    epub_path.unlink(missing_ok=True)
    print(f"  Deleted source: {epub_path.name}")


def reconvert_epub_from_cache(source_epub: str, output_dir: Path) -> None:
    """Rebuild an EPUB-backed book from the stored raw EPUB source."""
    book_dir: Path | None = None
    for meta_file in output_dir.glob(f"*/{BOOK_METADATA_FILENAME}"):
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue

        if (
            meta.get("source") == source_epub
            and meta.get("source_format") == "epub"
        ):
            book_dir = meta_file.parent
            break

    if book_dir is None:
        raise FileNotFoundError(
            f"No stored EPUB source found for {source_epub}. Re-upload the EPUB."
        )

    source_path = book_dir / EPUB_BOOK_FILENAME
    if not source_path.exists():
        raise FileNotFoundError(
            f"Stored EPUB missing at {source_path}. Re-upload the EPUB."
        )

    book_id = book_dir.name
    md5 = _file_md5(source_path)
    timestamp = _utc_now_iso()
    created_at = _read_existing_created_at(book_dir, timestamp)
    print(f"Reconverting EPUB from stored source: {source_epub} -> {book_id} (md5={md5})")
    title, toc_entries = _build_epub_book(source_path, output_dir, book_id)
    print(f"  Extracted EPUB TOC with {len(toc_entries)} top-level entries")

    _write_epub_metadata(
        book_dir,
        book_id=book_id,
        source_epub=source_epub,
        epub_md5=md5,
        created_at=created_at,
        updated_at=timestamp,
    )
    print("  Reconversion complete.")


# --- Markdown processing ---

def _count_words(text: str) -> int:
    """Count words in text."""
    return len(text.split())


LOCAL_ASSET_PATTERN = re.compile(
    r"""
    !\[[^\]]*\]\(([^)]+)\)
    |
    <img\b[^>]*\bsrc=["']([^"']+)["']
    """,
    re.IGNORECASE | re.VERBOSE,
)


def _normalize_markdown_asset_path(raw: str) -> Path | None:
    value = str(raw or "").strip()
    if (
        not value
        or value.startswith(("/", "#", "//", "data:"))
        or re.match(r"^[a-z][a-z0-9+.-]*:", value, flags=re.IGNORECASE)
    ):
        return None

    match = re.match(r"^(?:\.\./|\.?/)*images/(.+)$", value)
    if not match:
        return None

    relative = Path("images") / match.group(1)
    return relative


def _find_local_markdown_assets(markdown: str) -> list[Path]:
    assets: list[Path] = []
    seen: set[str] = set()
    for match in LOCAL_ASSET_PATTERN.finditer(markdown):
        asset = _normalize_markdown_asset_path(match.group(1) or match.group(2))
        if asset is None:
            continue

        key = asset.as_posix()
        if key in seen:
            continue
        seen.add(key)
        assets.append(asset)
    return assets


def _iter_markdown_sidecar_dirs(md_path: Path) -> list[Path]:
    base = md_path.stem
    return [
        md_path.with_suffix(""),
        md_path.parent / f"{base}.assets",
        md_path.parent / f"{base}.files",
        md_path.parent / f"{base}_files",
    ]


def _copy_markdown_sidecars(md_path: Path, article_dir: Path) -> None:
    for candidate in _iter_markdown_sidecar_dirs(md_path):
        if not candidate.is_dir():
            continue

        for item in candidate.iterdir():
            dest = article_dir / item.name
            if dest.exists():
                if dest.is_dir():
                    shutil.rmtree(dest)
                else:
                    dest.unlink()

            if item.is_dir():
                shutil.copytree(item, dest)
            else:
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(item, dest)


def _validate_markdown_assets(markdown: str, article_dir: Path) -> None:
    missing = [
        asset.as_posix()
        for asset in _find_local_markdown_assets(markdown)
        if not (article_dir / asset).exists()
    ]
    if not missing:
        return

    names = ", ".join(missing[:3])
    if len(missing) > 3:
        names += ", ..."
    raise ValueError(
        f"Markdown references local assets that were not supplied: {names}. "
        "Add a sidecar asset directory next to the markdown file."
    )


def process_markdown(md_path: Path, output_dir: Path) -> None:
    """Process a single .md file into an article.

    Creates:
      docs/articles/{id}/
        content.md   - the markdown content
        meta.json    - article metadata
    """
    article_id = ensure_unique_content_id(_generate_id(md_path), output_dir.parent, "doc")
    title = md_path.stem
    print(f"Processing markdown: {md_path.name} -> {article_id}")

    content = md_path.read_text(encoding="utf-8")
    word_count = _count_words(content)

    article_dir = output_dir / article_id
    try:
        if article_dir.exists():
            shutil.rmtree(article_dir)
        article_dir.mkdir(parents=True, exist_ok=True)

        # Write content
        (article_dir / "content.md").write_text(content, encoding="utf-8")
        _copy_markdown_sidecars(md_path, article_dir)
        _validate_markdown_assets(content, article_dir)

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
    except Exception:
        shutil.rmtree(article_dir, ignore_errors=True)
        raise

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
    site_id = ensure_unique_content_id(_generate_id(zip_path), output_dir.parent, "site")
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
    parser = argparse.ArgumentParser(description="Process content (PDF, EPUB, Markdown, ZIP).")
    parser.add_argument("--input-dir", type=Path, default=Path("input"))
    parser.add_argument("--output-dir", type=Path, default=Path("docs"))
    args = parser.parse_args()

    books_dir = args.output_dir / "books"
    articles_dir = args.output_dir / "articles"
    sites_dir = args.output_dir / "sites"

    input_filename = os.environ.get("INPUT_FILENAME", "").strip()
    manifest_path = args.output_dir / "manifest.json"
    catalog_path = args.output_dir / "catalog.json"
    metadata_path = args.output_dir / "catalog-metadata.json"

    # Collect jobs by type
    pdf_jobs: list[Path] = []
    epub_jobs: list[Path] = []
    md_jobs: list[Path] = []
    zip_jobs: list[Path] = []

    if input_filename:
        try:
            path = _resolve_input_file(args.input_dir, input_filename)
            ext = path.suffix.lower()
            if ext == ".pdf":
                pdf_jobs = [path]
            elif ext == ".epub":
                epub_jobs = [path]
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
                    reconvert_from_cache(input_filename, books_dir)
                    build_manifest(
                        books_dir=books_dir,
                        output_path=manifest_path,
                        catalog_metadata_path=metadata_path,
                        catalog_output_path=catalog_path,
                        articles_dir=articles_dir,
                        sites_dir=sites_dir,
                    )
                    print("Manifest rebuilt.")
                    return
                except FileNotFoundError as exc:
                    print(str(exc), file=sys.stderr)
                    sys.exit(1)
            elif input_filename.lower().endswith(".epub"):
                print(f"EPUB not found, attempting reconvert from cache: {input_filename}")
                try:
                    reconvert_epub_from_cache(input_filename, books_dir)
                    build_manifest(
                        books_dir=books_dir,
                        output_path=manifest_path,
                        catalog_metadata_path=metadata_path,
                        catalog_output_path=catalog_path,
                        articles_dir=articles_dir,
                        sites_dir=sites_dir,
                    )
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
        epub_jobs = detect_new_epubs(args.input_dir)
        md_jobs = sorted(args.input_dir.glob("*.md"))
        zip_jobs = sorted(args.input_dir.glob("*.zip"))

    total = len(pdf_jobs) + len(epub_jobs) + len(md_jobs) + len(zip_jobs)
    if total == 0:
        print("No new content found in input/. Nothing to do.")
        return

    print(
        f"Found {total} item(s) to process: {len(pdf_jobs)} PDF, "
        f"{len(epub_jobs)} EPUB, {len(md_jobs)} MD, {len(zip_jobs)} ZIP"
    )

    failures: list[tuple[Path, Exception]] = []

    # Process PDFs (existing pipeline)
    for pdf_path in pdf_jobs:
        try:
            convert_single_pdf(pdf_path, books_dir)
        except Exception as exc:
            print(f"  FAILED: {pdf_path.name}: {exc}", file=sys.stderr)
            failures.append((pdf_path, exc))

    # Process EPUB files
    for epub_path in epub_jobs:
        try:
            process_epub(epub_path, books_dir)
            _remove_failure(epub_path.name, args.output_dir)
        except Exception as exc:
            print(f"  FAILED: {epub_path.name}: {exc}", file=sys.stderr)
            failures.append((epub_path, exc))

    # Process Markdown files
    for md_path in md_jobs:
        try:
            process_markdown(md_path, articles_dir)
            _remove_failure(md_path.name, args.output_dir)
        except Exception as exc:
            print(f"  FAILED: {md_path.name}: {exc}", file=sys.stderr)
            failures.append((md_path, exc))

    # Process ZIP files
    for zip_path in zip_jobs:
        try:
            process_site(zip_path, sites_dir)
            _remove_failure(zip_path.name, args.output_dir)
        except Exception as exc:
            print(f"  FAILED: {zip_path.name}: {exc}", file=sys.stderr)
            failures.append((zip_path, exc))

    # Rebuild manifest
    build_manifest(
        books_dir=books_dir,
        output_path=manifest_path,
        catalog_metadata_path=metadata_path,
        catalog_output_path=catalog_path,
        articles_dir=articles_dir,
        sites_dir=sites_dir,
    )
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
