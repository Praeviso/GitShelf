// Fetch helpers for public data (manifest, toc, chapters, articles)

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

export function getItemDisplayTitle(item) {
  if (!item) return 'Untitled';
  return String(item.title || item.display_title || item.id || 'Untitled');
}

export function formatWordCount(count) {
  if (count >= 1000) return `${Math.round(count / 1000)}k`;
  return String(count);
}

export function getItemType(item) {
  return item?.type || 'book';
}

// Route helpers for each content type
export function getItemHref(item) {
  const type = getItemType(item);
  if (type === 'book') return `#/books/${item.id}`;
  if (type === 'doc') return `#/articles/${item.id}`;
  if (type === 'site') return `./${item.entry}`;
  return `#/books/${item.id}`;
}

export function getItemTarget(item) {
  return getItemType(item) === 'site' ? '_blank' : undefined;
}
