// Fetch helpers for public data (manifest, toc, chapters)

export async function fetchManifest() {
  const res = await fetch('./manifest.json');
  if (!res.ok) throw new Error(`Failed to load manifest: ${res.status}`);
  return res.json();
}

export async function fetchToc(bookId) {
  const res = await fetch(`./books/${bookId}/toc.json`);
  if (!res.ok) throw new Error(`Failed to load toc: ${res.status}`);
  return res.json();
}

export async function fetchText(url) {
  const res = await fetch(`./${url}`);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.text();
}

export function flattenChapters(items) {
  const result = [];
  for (const item of items) {
    if (item.slug && !item.anchor) result.push(item);
    if (item.children) result.push(...flattenChapters(item.children));
  }
  return result;
}

export function getBookDisplayTitle(book) {
  if (!book) return 'Untitled';
  return String(book.title || book.display_title || book.id || 'Untitled');
}

export function formatWordCount(count) {
  if (count >= 1000) return `${Math.round(count / 1000)}k`;
  return String(count);
}
