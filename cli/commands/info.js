const { fetchCatalog } = require('../github');
const { loadConfig, getPositional, hasFlag, selectCatalogItem, jsonOut, die } = require('../util');

async function run(argv) {
  const id = getPositional(argv, 0);
  if (!id) die('Usage: gitshelf info <id|type:id>');

  const { token, repo } = loadConfig(argv);
  const { items } = await fetchCatalog(repo, token);
  const { item } = selectCatalogItem(items, id);

  if (hasFlag(argv, '--json')) {
    jsonOut(item);
    return;
  }

  const lines = [
    ['ID', item.id],
    ['Type', item.type],
    ['Title', item.title],
    ['Display Title', item.display_title || '(none)'],
    ['Author', item.author || '(none)'],
    ['Summary', item.summary || '(none)'],
    ['Tags', item.tags?.length ? item.tags.join(', ') : '(none)'],
    ['Featured', item.featured ? 'yes' : 'no'],
    ['Visibility', item.visibility],
    ['Source', item.source || '(none)'],
  ];

  if (item.type === 'book') {
    lines.push(['Chapters', item.chapters_count ?? '?']);
    lines.push(['Words', item.word_count ?? '?']);
  } else if (item.type === 'doc') {
    lines.push(['Words', item.word_count ?? '?']);
  } else if (item.type === 'site') {
    lines.push(['Entry', item.entry || '?']);
  }

  lines.push(['Created', item.created_at || '?']);
  lines.push(['Updated', item.updated_at || '?']);

  const maxLabel = Math.max(...lines.map(([l]) => l.length));
  for (const [label, value] of lines) {
    console.log(`${label.padEnd(maxLabel + 2)}${value}`);
  }
}

module.exports = { run };
