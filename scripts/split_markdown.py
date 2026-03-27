"""Split a Markdown document into chapters by heading level."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass


@dataclass
class Chapter:
    title: str       # Heading text (e.g., "Chapter 1: Introduction")
    slug: str        # URL-safe slug (e.g., "01-chapter-1-introduction")
    content: str     # Full markdown content including the heading


def slugify(text: str) -> str:
    """Convert text to a URL-safe slug, preserving CJK characters.

    Lowercase ASCII, replace spaces and special characters with hyphens,
    collapse consecutive hyphens, strip leading/trailing hyphens.
    CJK characters are kept as-is.
    """
    slug = text.lower()
    chars: list[str] = []
    for ch in slug:
        if ch.isascii() and ch.isalnum():
            chars.append(ch)
        elif _is_cjk(ch):
            chars.append(ch)
        else:
            chars.append("-")
    slug = "".join(chars)
    slug = re.sub(r"-{2,}", "-", slug)
    slug = slug.strip("-")
    return slug


def _is_cjk(ch: str) -> bool:
    """Return True if the character is a CJK ideograph or common CJK symbol."""
    name = unicodedata.name(ch, "")
    return "CJK" in name or "HIRAGANA" in name or "KATAKANA" in name or "HANGUL" in name


def _make_slug(index: int, title: str) -> str:
    """Build an indexed slug like '01-chapter-1-introduction'."""
    base = slugify(title)
    prefix = f"{index:02d}"
    if base:
        return f"{prefix}-{base}"
    return prefix


def find_protected_ranges(markdown: str) -> list[tuple[int, int]]:
    """Find byte ranges of fenced code blocks, math blocks, and HTML comments.

    These regions should be excluded from heading detection so that
    lines like ``# heading`` inside a code fence are not treated as
    chapter boundaries.
    """
    ranges: list[tuple[int, int]] = []

    # Fenced code blocks: ``` or ~~~ (with optional language tag)
    for m in re.finditer(r"^(`{3,}|~{3,}).*?\n[\s\S]*?^\1\s*$", markdown, re.MULTILINE):
        ranges.append((m.start(), m.end()))

    # Display math blocks: $$ ... $$
    for m in re.finditer(r"^\$\$\s*\n[\s\S]*?^\$\$\s*$", markdown, re.MULTILINE):
        ranges.append((m.start(), m.end()))

    # HTML comments: <!-- ... -->
    for m in re.finditer(r"<!--[\s\S]*?-->", markdown):
        ranges.append((m.start(), m.end()))

    # Sort by start position for efficient lookup
    ranges.sort()
    return ranges


def is_in_protected_range(
    pos: int, ranges: list[tuple[int, int]]
) -> bool:
    """Check whether a position falls inside any protected range."""
    for start, end in ranges:
        if start > pos:
            break
        if start <= pos < end:
            return True
    return False


def _find_headings(markdown: str, level: int) -> list[re.Match[str]]:
    """Find all headings at the exact specified level.

    Headings inside fenced code blocks, math blocks, or HTML comments
    are excluded.
    """
    pattern = re.compile(rf"^{'#' * level}(?!#)\s+(.+)$", re.MULTILINE)
    protected = find_protected_ranges(markdown)
    return [
        m for m in pattern.finditer(markdown)
        if not is_in_protected_range(m.start(), protected)
    ]


def split_by_headings(markdown: str, level: int = 1) -> list[Chapter]:
    """Split markdown into chapters at the specified heading level.

    Args:
        markdown: Full markdown document text.
        level: Heading level to split on (1=H1, 2=H2, 3=H3).

    Returns:
        List of Chapter objects. Content before the first heading
        becomes chapter "00-preface" if non-empty.

    Raises:
        ValueError: If no headings at the specified level are found.
    """
    if level not in (1, 2, 3):
        raise ValueError(f"Heading level must be 1, 2, or 3, got {level}")

    matches = _find_headings(markdown, level)
    if not matches:
        raise ValueError(
            f"No H{level} headings found in markdown "
            f"(first 200 chars: {markdown[:200]!r})"
        )

    chapters: list[Chapter] = []
    chapter_index = 1

    # Content before the first heading becomes the preface.
    preface_text = markdown[: matches[0].start()].strip()
    if preface_text:
        chapters.append(Chapter(title="Preface", slug="00-preface", content=preface_text))

    for i, match in enumerate(matches):
        heading_title = match.group(1).strip()
        start = match.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(markdown)
        content = markdown[start:end].rstrip()
        slug = _make_slug(chapter_index, heading_title)
        chapters.append(Chapter(title=heading_title, slug=slug, content=content))
        chapter_index += 1

    return chapters
