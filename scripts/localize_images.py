"""Download external images referenced in markdown and rewrite URLs to local paths.

Scans markdown for image references pointing to HTTP(S) URLs, downloads
each image to a local directory, and rewrites the markdown to use the
local path instead.  Already-local paths are left untouched.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from urllib.parse import urlparse

import requests

# Match markdown image syntax with an external URL: ![alt](https://...)
_IMAGE_RE = re.compile(r"(!\[[^\]]*\])\((https?://[^)\s]+)\)")


def localize_images(
    markdown: str,
    images_dir: Path,
    url_prefix: str,
    *,
    timeout: int = 30,
) -> str:
    """Download external images to *images_dir* and rewrite URLs in markdown.

    Args:
        markdown: Markdown text containing external image URLs.
        images_dir: Local directory to save downloaded images into.
        url_prefix: Path prefix for rewritten URLs (e.g. ``"books/mybook/images/"``).
        timeout: Per-request HTTP timeout in seconds.

    Returns:
        Markdown with external image URLs replaced by local paths.
        URLs that fail to download are left unchanged.
    """
    matches = list(_IMAGE_RE.finditer(markdown))
    if not matches:
        return markdown

    images_dir.mkdir(parents=True, exist_ok=True)

    # Collect unique URLs and map each to a local filename.
    url_to_filename: dict[str, str] = {}
    seen_filenames: set[str] = set()

    for match in matches:
        url = match.group(2)
        if url in url_to_filename:
            continue

        filename = _url_to_filename(url)

        # Deduplicate filenames that originate from different URLs.
        if filename in seen_filenames:
            stem = Path(filename).stem
            suffix = Path(filename).suffix or ".jpg"
            counter = 1
            while f"{stem}_{counter}{suffix}" in seen_filenames:
                counter += 1
            filename = f"{stem}_{counter}{suffix}"
        seen_filenames.add(filename)

        local_path = images_dir / filename

        if local_path.exists():
            url_to_filename[url] = filename
            continue

        try:
            resp = requests.get(url, timeout=timeout)
            resp.raise_for_status()
            local_path.write_bytes(resp.content)
            url_to_filename[url] = filename
        except Exception as exc:
            print(f"    Warning: failed to download image {url}: {exc}")

    downloaded = len(url_to_filename)
    total = len({m.group(2) for m in matches})
    if downloaded:
        print(f"    Localized {downloaded}/{total} images")

    def _replace(match: re.Match) -> str:
        prefix = match.group(1)  # ![alt]
        url = match.group(2)
        filename = url_to_filename.get(url)
        if filename:
            return f"{prefix}({url_prefix}{filename})"
        return match.group(0)

    return _IMAGE_RE.sub(_replace, markdown)


def _url_to_filename(url: str) -> str:
    """Derive a stable filename from an image URL.

    Uses the last path component if it looks like a filename (contains a dot),
    otherwise falls back to an MD5 hash of the full URL.
    """
    path = urlparse(url).path
    name = path.rsplit("/", 1)[-1] if "/" in path else path
    if not name or "." not in name:
        name = hashlib.md5(url.encode()).hexdigest() + ".jpg"
    return name
