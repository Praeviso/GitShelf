const { fetchCatalog, getDisplayTitle } = require('../github');
const { loadConfig, getFlag, hasFlag, jsonOut, tableOut } = require('../util');

async function run(argv) {
  const { token, repo } = loadConfig(argv);
  const typeFilter = getFlag(argv, '--type');
  const { items } = await fetchCatalog(repo, token);

  const filtered = typeFilter
    ? items.filter((i) => i.type === typeFilter)
    : items;

  if (hasFlag(argv, '--json')) {
    jsonOut(filtered);
    return;
  }

  console.log(`${filtered.length} item(s) in ${repo}:\n`);
  tableOut(filtered, [
    { header: 'ID', value: (i) => i.id, maxWidth: 35 },
    { header: 'TYPE', value: (i) => i.type, maxWidth: 6 },
    { header: 'TITLE', value: (i) => getDisplayTitle(i), maxWidth: 40 },
    { header: 'VIS', value: (i) => i.visibility, maxWidth: 10 },
    { header: 'SOURCE', value: (i) => i.source, maxWidth: 30 },
  ]);
}

module.exports = { run };
