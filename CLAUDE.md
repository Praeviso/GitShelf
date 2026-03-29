# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

GitShelf is a serverless content shelf on GitHub Pages. Users upload PDFs, Markdown files, or ZIP archives through the browser admin panel, GitHub Actions processes them into books, documents, or static sites, and the result is a GitHub-hosted reading and publishing site. No backend server — everything runs in GitHub Actions and the browser.

## Commands

### Development
```bash
npm run dev          # Vite dev server (serves src/ with docs/ data via middleware)
npm run build        # Build to docs/ (does NOT empty docs/, preserves book data)
npm run preview      # Preview production build
```

**Before starting a dev server** (`npm run dev`, `npm run preview`, or any long-running service), check if the port is already in use and kill the existing process first:
```bash
# Check and kill existing process on port 5173 (or whichever port)
lsof -ti:5173 | xargs kill -9 2>/dev/null; npm run dev
```

### Testing
```bash
npm test             # Vitest: components, hooks, lib tests (jsdom)
npm run test:watch   # Vitest watch mode
npm run test:frontend  # Frontend behavior tests
python -m unittest discover -s tests/scripts -v  # Python pipeline tests
```

### CI
The `test.yml` workflow runs both Python and JS tests. The content-processing workflows handle uploads and conversions. `deploy-pages.yml` builds and deploys to GitHub Pages.

## Architecture

### Two codebases, one repo
- **Frontend (Preact + Vite):** `src/` builds to `docs/assets/`. Hash-based SPA routing. Renders books, articles, and site cards, with markdown-it, syntax highlighting, and KaTeX support.
- **Pipeline (Python 3.11):** `scripts/` runs in GitHub Actions. Processes PDFs, Markdown files, and ZIP archives into typed content directories and regenerates catalog data.

### Data flow
```
Upload content (browser → GitHub API → input/)
  → GitHub Actions runs scripts/process.py
  → .pdf: MinerU API → chapters in docs/books/{id}/
  → .md: docs/articles/{id}/content.md
  → .zip: docs/sites/{id}/index.html
  → Build manifest.json + catalog.json from typed items
  → Commit to git → GitHub Pages deploys
```

### Key data files in docs/
| File | Purpose | Who writes it |
|------|---------|---------------|
| `manifest.json` | Public homepage content (`items` array) | Pipeline (`build_manifest.py`) |
| `catalog.json` | Full admin catalog (`items` array) | Pipeline (`build_manifest.py`) |
| `catalog-metadata.json` | Curator overrides for typed content items | Admin panel via GitHub API |
| `books/{id}/meta.json` | Book metadata and source facts | Pipeline (`convert.py`) |
| `books/{id}/toc.json` | Book chapter hierarchy with slugs and anchors | Pipeline (`generate_structure.py`) |
| `articles/{id}/meta.json` | Article metadata | Pipeline (`process.py`) |
| `sites/{id}/.meta.json` | Static site metadata and entry path | Pipeline (`process.py`) |

### Frontend routing (hash-based)
| Route | Component |
|-------|-----------|
| `#/` | `HomeView` — card grid from manifest.json |
| `#/books/{bookId}` | `BookOverview` — book landing page |
| `#/books/{bookId}/{slug}` | `ChapterReader` — chapter reader |
| `#/articles/{articleId}` | `ArticleReader` — single-page markdown reader |
| `#/sites/{siteId}` | Redirects to `docs/sites/{id}/index.html` in a new tab |
| `#/admin` | `AdminView` — lazy-loaded admin panel |

### Vite config notes
- Root is `src/`, output is `docs/` (with `emptyOutDir: false`)
- Custom dev middleware serves `docs/manifest.json`, `docs/books/`, etc.
- `npm test` runs Vitest unit tests; `npm run test:frontend` uses `vite.frontend.config.js` for integration-style frontend tests

## Specs (MUST READ before making changes)

The `spec/` directory contains detailed project standards. **Read the relevant spec before working in that area:**

| Spec | When to read |
|------|-------------|
| `spec/frontend-design.md` | Any UI/CSS work: colors, typography, spacing, layout, components, responsive breakpoints, accessibility, z-index layers |
| `spec/engineering-quality.md` | All code changes: reuse-before-create rule, debug-first error policy, simplicity principles |
| `spec/implementation-style.md` | Writing new code: naming conventions, code style, file organization for both Python and JS |
| `spec/project-structure.md` | Structural changes: module responsibilities, data contracts (manifest.json, toc.json, etc.), dependency direction |
| `spec/delivery-and-security.md` | Commits, PRs, and security: conventional commit format, PR template, secrets handling rules |

These specs are authoritative — code should conform to them, not the other way around.

## Conventions

### Commit messages
Conventional Commits: `type(scope): summary`
- Types: `feat`, `fix`, `refactor`, `style`, `docs`, `ci`, `chore`
- Scopes: `reader`, `admin`, `pipeline`, `actions`

### Python (scripts/)
- Python 3.11+. Use `pathlib.Path`, f-strings, type hints on signatures.
- `snake_case` functions/variables, `PascalCase` classes, `UPPER_SNAKE_CASE` constants.
- Each script owns one concept end-to-end. No `utils.py`.

### JavaScript (src/)
- Preact (not React) with JSX. `camelCase` functions/variables.
- `const` by default. `async/await` for all async.
- CSS custom properties for all design tokens. No hardcoded colors in JS.
- `--kebab-case` for CSS properties, `kebab-case` for CSS classes and data attributes.
- markdown-it configured with `html: true` + `sanitizeHtml()` post-processing to allow safe structural HTML (tables, formatting) while stripping dangerous tags (script, iframe, etc.) and event handlers.

### Error handling
No silent fallbacks. Errors must surface clearly. Don't swallow exceptions or return fake success. Catch only what you can meaningfully handle.

## Secrets
- **GitHub PAT**: browser `localStorage` only, never sent except to `api.github.com`
- **MINERU_TOKEN**: GitHub Actions secret only, never in frontend code
