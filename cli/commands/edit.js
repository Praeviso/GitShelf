const { fetchCatalog, persistCatalog, normalizeTags, VISIBILITY_VALUES } = require('../github');
const { loadConfig, getFlag, getPositional, hasFlag, selectCatalogItem, jsonOut, die } = require('../util');

async function run(argv) {
  const id = getPositional(argv, 0);
  if (!id) die('Usage: gitshelf edit <id|type:id> [--title "..."] [--author "..."] [--summary "..."] [--tags "a,b"] [--visibility published|hidden|archived]');

  const { token, repo } = loadConfig(argv);
  const { items } = await fetchCatalog(repo, token);
  const { item: existingItem, index: idx } = selectCatalogItem(items, id);

  const item = { ...existingItem, tags: [...(existingItem.tags || [])] };
  let changed = false;

  const title = getFlag(argv, '--title');
  if (title !== null) { item.display_title = title; changed = true; }

  const author = getFlag(argv, '--author');
  if (author !== null) { item.author = author; changed = true; }

  const summary = getFlag(argv, '--summary');
  if (summary !== null) { item.summary = summary; changed = true; }

  const tags = getFlag(argv, '--tags');
  if (tags !== null) { item.tags = normalizeTags(tags); changed = true; }

  const visibility = getFlag(argv, '--visibility');
  if (visibility !== null) {
    if (!VISIBILITY_VALUES.includes(visibility)) die(`Invalid visibility. Must be: ${VISIBILITY_VALUES.join(', ')}`);
    item.visibility = visibility;
    changed = true;
  }

  const featured = hasFlag(argv, '--featured');
  const unfeatured = hasFlag(argv, '--no-featured');
  if (featured) { item.featured = true; changed = true; }
  if (unfeatured) { item.featured = false; changed = true; }

  if (!changed) die('No changes specified. Use --title, --author, --summary, --tags, --visibility, --featured, --no-featured.');

  item.updated_at = new Date().toISOString();
  const next = items.map((i, j) => (j === idx ? item : i));
  await persistCatalog(repo, next, `chore(admin): edit ${item.type} ${item.id}`, token);

  if (hasFlag(argv, '--json')) {
    jsonOut({ status: 'updated', item });
  } else {
    console.log(`Updated: ${item.type}:${item.id}`);
  }
}

module.exports = { run };
