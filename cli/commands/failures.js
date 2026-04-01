const { fetchFailures, dismissFailure, retryFailure } = require('../github');
const { loadConfig, getPositional, hasFlag, jsonOut, tableOut, die } = require('../util');

async function run(argv) {
  const { token, repo } = loadConfig(argv);
  const subcommand = getPositional(argv, 0);

  if (subcommand === 'dismiss') {
    const filename = getPositional(argv, 1);
    if (!filename) die('Usage: gitshelf failures dismiss <filename>');
    await dismissFailure(repo, filename, token);
    if (hasFlag(argv, '--json')) {
      jsonOut({ status: 'dismissed', filename });
    } else {
      console.log(`Dismissed: ${filename}`);
    }
    return;
  }

  if (subcommand === 'retry') {
    const filename = getPositional(argv, 1);
    if (!filename) die('Usage: gitshelf failures retry <filename>');
    await retryFailure(repo, filename, token);
    if (hasFlag(argv, '--json')) {
      jsonOut({ status: 'retrying', filename });
    } else {
      console.log(`Retry triggered: ${filename}`);
      console.log(`Track progress: https://github.com/${repo}/actions`);
    }
    return;
  }

  // Default: list failures
  const failures = await fetchFailures(repo, token);

  if (hasFlag(argv, '--json')) {
    jsonOut(failures);
    return;
  }

  if (failures.length === 0) {
    console.log('No failures.');
    return;
  }

  console.log(`${failures.length} failure(s):\n`);
  tableOut(failures, [
    { header: 'FILENAME', value: (f) => f.filename, maxWidth: 40 },
    { header: 'ERROR', value: (f) => f.error, maxWidth: 50 },
    { header: 'FAILED AT', value: (f) => f.failed_at, maxWidth: 22 },
  ]);
}

module.exports = { run };
