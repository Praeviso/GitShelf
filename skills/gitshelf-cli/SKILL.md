---
name: gitshelf-cli
description: Use when the user wants to operate a GitShelf site with the gitshelf CLI or npx gitshelf, including config setup, uploads, catalog inspection, metadata edits, deletes, reconvert, and failure checks.
---

# GitShelf CLI

Operate a GitShelf repository from the command line.

- Treat `.pdf` uploads as `book` items.
- Treat `.md` uploads as `doc` items.
- Treat `.zip` uploads as `site` items.
- Require `index.html` inside each uploaded site archive.

## Config

- Store the default repo and token in `~/.config/gitshelf/config.json`.
- Store a local override in `.gitshelfrc` inside the current working directory when needed.
- Use these keys:

```json
{
  "repo": "owner/repo",
  "token": "github_pat_xxx"
}
```

- Resolve config in this order:
  CLI flags -> `GITSHELF_TOKEN` / `GITSHELF_REPO` -> `.gitshelfrc` -> `~/.config/gitshelf/config.json`

## Common commands

- Run `list` to discover item ids.
- Run `upload` to send new content.
- Run `info`, `edit`, `delete`, and `reconvert` against existing items.
- Run `failures` to inspect or retry processing errors.

```bash
gitshelf list
gitshelf list --type site --json
gitshelf info book:my-book
gitshelf upload ./article.md
gitshelf upload ./book.pdf
gitshelf upload ./site.zip
gitshelf edit doc:my-article --title "New title"
gitshelf delete site:my-site
gitshelf reconvert book:my-book
gitshelf failures --json
```

## npx usage

- Run `npx gitshelf ...` for one-off CLI usage without a global install.

```bash
npx gitshelf list
npx gitshelf upload ./site.zip
```

- Set `NPM_CONFIG_CACHE=/tmp/gitshelf-npm-cache` in sandboxed environments when `npx` cannot write to its default cache.

## Item selectors

- Pass either `id` or `type:id` to commands that target existing content.
- Prefer `type:id` when ids may collide.
- Use only `book`, `doc`, and `site` as item types.

## Practical defaults

- Add `--json` when the user wants machine-readable output.
- Check `failures` after `upload` when processing does not complete.
- Restrict `reconvert` to `book` items.
