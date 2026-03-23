"""Create the book directory structure and toc.json for one book."""

from __future__ import annotations

import json
import re
from pathlib import Path

try:
    from split_markdown import Chapter
except ImportError:
    # Standalone usage: define a compatible dataclass when split_markdown
    # is not on the import path.
    from dataclasses import dataclass

    @dataclass
    class Chapter:  # type: ignore[no-redef]
        title: str
        slug: str
        content: str


def _slugify_anchor(text: str) -> str:
    """Convert a sub-heading into an anchor slug.

    Lowercase, replace non-alphanumeric runs with hyphens, strip edges.
    """
    anchor = text.lower()
    anchor = re.sub(r"[^a-z0-9]+", "-", anchor)
    return anchor.strip("-")


def _extract_subheadings(content: str, split_level: int) -> list[dict[str, str]]:
    """Find headings one level deeper than the split level within a chapter.

    For example, if chapters were split at H1, this extracts H2 headings
    to produce sub-children entries with anchors.
    """
    sub_level = split_level + 1
    pattern = re.compile(rf"^{'#' * sub_level}(?!#)\s+(.+)$", re.MULTILINE)
    subheadings: list[dict[str, str]] = []
    for match in pattern.finditer(content):
        heading_text = match.group(1).strip()
        subheadings.append({
            "title": heading_text,
            "anchor": _slugify_anchor(heading_text),
        })
    return subheadings


def _build_toc(
    title: str,
    chapters: list[Chapter],
    split_level: int = 1,
) -> dict:
    """Build the toc.json structure from a list of chapters.

    Top-level children correspond to chapters. Each chapter entry
    includes sub-children derived from the next heading level.
    """
    children: list[dict] = []
    for chapter in chapters:
        entry: dict = {"title": chapter.title, "slug": chapter.slug}
        subheadings = _extract_subheadings(chapter.content, split_level)
        if subheadings:
            entry["children"] = [
                {
                    "title": sub["title"],
                    "slug": chapter.slug,
                    "anchor": sub["anchor"],
                }
                for sub in subheadings
            ]
        children.append(entry)
    return {"title": title, "children": children}


def _generate_readme(title: str, chapters: list[Chapter]) -> str:
    """Generate a simple book overview with the title and chapter list."""
    lines = [f"# {title}", "", "## Chapters", ""]
    for chapter in chapters:
        lines.append(f"- {chapter.title}")
    lines.append("")
    return "\n".join(lines)


def generate_book_structure(
    book_id: str,
    title: str,
    chapters: list[Chapter],
    output_dir: Path = Path("docs/books"),
    split_level: int = 1,
) -> Path:
    """Create book directory, write chapter files, generate toc.json.

    Creates:
      docs/books/<book_id>/
        README.md          - book overview
        toc.json           - chapter hierarchy
        chapters/
          00-preface.md
          01-chapter-1.md
          ...

    Returns path to the book directory.

    Raises:
        ValueError: If book_id is empty or chapters list is empty.
    """
    if not book_id:
        raise ValueError("book_id must not be empty")
    if not chapters:
        raise ValueError("chapters list must not be empty")

    book_dir = output_dir / book_id
    chapters_dir = book_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)

    for chapter in chapters:
        chapter_path = chapters_dir / f"{chapter.slug}.md"
        chapter_path.write_text(chapter.content, encoding="utf-8")

    toc = _build_toc(title, chapters, split_level)
    toc_path = book_dir / "toc.json"
    toc_path.write_text(json.dumps(toc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    readme_content = _generate_readme(title, chapters)
    readme_path = book_dir / "README.md"
    readme_path.write_text(readme_content, encoding="utf-8")

    return book_dir
