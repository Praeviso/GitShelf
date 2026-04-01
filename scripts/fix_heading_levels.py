"""Fix flattened heading levels in MinerU-extracted Markdown using PDF bookmarks.

MinerU's VLM model often collapses all heading levels to H1 (`#`).  This
module uses the PDF's bookmark/outline tree (which preserves the original
hierarchy) to restore correct heading levels and demotes unmatched `#` lines
to plain bold text.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path

try:
    from .split_markdown import find_protected_ranges, is_in_protected_range
except ImportError:
    from split_markdown import find_protected_ranges, is_in_protected_range


@dataclass
class TocEntry:
    level: int
    title: str


# ---------------------------------------------------------------------------
# TOC extraction
# ---------------------------------------------------------------------------


def extract_toc(pdf_path: str | Path) -> list[TocEntry]:
    """Extract the bookmark tree from a PDF as a flat list of TocEntry.

    Returns an empty list when PyMuPDF is unavailable or the PDF has no
    bookmarks, so callers can safely skip heading-level fixing.
    """
    try:
        import fitz
    except ImportError:
        return []

    pdf_path = Path(pdf_path)
    if not pdf_path.is_file():
        return []

    with fitz.open(pdf_path) as doc:
        raw_toc = doc.get_toc()  # [(level, title, page), ...]

    if not raw_toc:
        return []

    return [TocEntry(level=level, title=title) for level, title, _ in raw_toc]


# ---------------------------------------------------------------------------
# Heading detection helpers
# ---------------------------------------------------------------------------

# Matches any ATX heading (# through ######) at the start of a line.
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$", re.MULTILINE)


def _normalize(text: str) -> str:
    """Normalize text for fuzzy comparison: lowercase, collapse whitespace."""
    return re.sub(r"\s+", " ", text.lower().strip())


def _similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, _normalize(a), _normalize(b)).ratio()


_MATCH_THRESHOLD = 0.75
_LOOKAHEAD = 5


# ---------------------------------------------------------------------------
# Core logic
# ---------------------------------------------------------------------------


def fix_heading_levels(markdown: str, toc: list[TocEntry]) -> str:
    """Rewrite heading levels in *markdown* to match the PDF bookmark hierarchy.

    Algorithm:
        1. Collect all ATX headings that are NOT inside protected regions
           (fenced code blocks, math blocks, HTML comments).
        2. Walk through these headings in document order while advancing a
           pointer through *toc*.  For each heading, try to match it against
           the current TOC entry and a small lookahead window.
        3. On match  -> rewrite the heading prefix to the bookmark level.
        4. No match  -> demote the line to bold text (``**title**``).

    Returns the fixed markdown string.
    """
    if not toc:
        return markdown

    protected = find_protected_ranges(markdown)
    matches = [
        m for m in _HEADING_RE.finditer(markdown)
        if not is_in_protected_range(m.start(), protected)
    ]

    if not matches:
        return markdown

    # Build list of replacements (offset, old_text, new_text) in reverse order
    # so that earlier replacements don't shift positions of later ones.
    replacements: list[tuple[int, int, str]] = []
    toc_ptr = 0

    for m in matches:
        heading_text = m.group(2).strip()
        best_idx = -1
        best_score = 0.0

        # Try to match against toc[toc_ptr .. toc_ptr + LOOKAHEAD]
        search_end = min(toc_ptr + _LOOKAHEAD, len(toc))
        for i in range(toc_ptr, search_end):
            score = _similarity(heading_text, toc[i].title)
            if score > best_score:
                best_score = score
                best_idx = i

        if best_score >= _MATCH_THRESHOLD and best_idx >= 0:
            # Matched — rewrite with correct level
            entry = toc[best_idx]
            new_line = f"{'#' * entry.level} {heading_text}"
            replacements.append((m.start(), m.end(), new_line))
            toc_ptr = best_idx + 1
        else:
            # Unmatched — demote to bold text
            replacements.append((m.start(), m.end(), f"**{heading_text}**"))

    # Apply replacements in reverse order to preserve positions
    parts = list(markdown)
    for start, end, new_text in reversed(replacements):
        markdown = markdown[:start] + new_text + markdown[end:]

    return markdown
