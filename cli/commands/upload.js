const fs = require('node:fs');
const path = require('node:path');
const { uploadContent, ACCEPTED_EXTENSIONS } = require('../github');
const { loadConfig, getPositional, hasFlag, jsonOut, die } = require('../util');

async function run(argv) {
  const filePath = getPositional(argv, 0);
  if (!filePath) die('Usage: gitshelf upload <file>');

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) die(`File not found: ${resolved}`);

  const ext = path.extname(resolved).slice(1).toLowerCase();
  if (!ACCEPTED_EXTENSIONS.includes(ext)) die(`Unsupported file type: .${ext}. Accepted: ${ACCEPTED_EXTENSIONS.join(', ')}`);

  const { token, repo } = loadConfig(argv);
  const buffer = fs.readFileSync(resolved);

  if (!hasFlag(argv, '--json')) {
    console.log(`Uploading ${path.basename(resolved)} to ${repo}...`);
  }

  const result = await uploadContent(resolved, buffer, repo, token);

  if (hasFlag(argv, '--json')) {
    jsonOut({ status: 'uploaded', ...result });
  } else {
    console.log(`Uploaded: ${result.file}`);
    console.log(`GitHub Actions: ${result.actionsUrl}`);
  }
}

module.exports = { run };
