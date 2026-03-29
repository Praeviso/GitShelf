const readline = require('node:readline');
const { fetchCatalog, deleteItem, getDisplayTitle } = require('../github');
const { loadConfig, getPositional, hasFlag, selectCatalogItem, jsonOut, die } = require('../util');

function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

async function run(argv) {
  const id = getPositional(argv, 0);
  if (!id) die('Usage: gitshelf delete <id|type:id> [--yes]');

  const { token, repo } = loadConfig(argv);
  const { items } = await fetchCatalog(repo, token);
  const { item } = selectCatalogItem(items, id);

  if (!hasFlag(argv, '--yes')) {
    const ok = await confirm(`Delete ${item.type} "${getDisplayTitle(item)}" (${item.type}:${item.id})? [y/N] `);
    if (!ok) { console.log('Cancelled.'); return; }
  }

  await deleteItem(item, repo, items, token);

  if (hasFlag(argv, '--json')) {
    jsonOut({ status: 'deleted', id: item.id, type: item.type });
  } else {
    console.log(`Deleted: ${item.type}:${item.id}`);
  }
}

module.exports = { run };
