# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

PDF2Book is a serverless app that converts PDFs to online books on GitHub Pages. Users upload PDFs through a browser admin panel, GitHub Actions converts them via MinerU API, and the result is a GitBook-style reading site. No backend server — everything runs in GitHub Actions and the browser.

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
npm run test:frontend  # Node test runner: frontend behavior tests (tests/frontend/)
python -m unittest discover -s tests/scripts -v  # Python pipeline tests
```

### CI
The `test.yml` workflow runs both Python and JS tests. `convert.yml` runs the PDF pipeline. `deploy-pages.yml` builds and deploys to GitHub Pages.

## Architecture

### Two codebases, one repo
- **Frontend (Preact + Vite):** `src/` builds to `docs/assets/`. Hash-based SPA routing. Renders markdown with markdown-it, Shiki (syntax), KaTeX (math).
- **Pipeline (Python 3.11):** `scripts/` runs in GitHub Actions. Converts PDFs via MinerU API, splits into chapters, generates `toc.json` and `manifest.json`.

### Data flow
```
Upload PDF (browser → GitHub API → input/)
  → GitHub Actions runs scripts/convert.py
  → MinerU API returns markdown (cached by PDF MD5 in cache/markdown/)
  → Split into chapters by heading level → docs/books/{id}/chapters/*.md
  → Build manifest.json + catalog.json
  → Commit to git → GitHub Pages deploys
```

### Key data files in docs/
| File | Purpose | Who writes it |
|------|---------|---------------|
| `manifest.json` | Public bookshelf (published books only) | Pipeline (`build_manifest.py`) |
| `catalog.json` | Full catalog for admin (all visibility states) | Pipeline (`build_manifest.py`) |
| `catalog-metadata.json` | Curator edits (title, author, tags, etc.) | Admin panel via GitHub API |
| `books/{id}/toc.json` | Chapter hierarchy with slugs and anchors | Pipeline (`generate_structure.py`) |
| `books/{id}/conversion.json` | Conversion facts (source PDF, split level, date) | Pipeline (`convert.py`) |

### Frontend routing (hash-based)
| Route | Component |
|-------|-----------|
| `#/` | `BookshelfView` — card grid from manifest.json |
| `#/{bookId}` | `BookOverview` — book landing page |
| `#/{bookId}/chapters/{slug}` | `ReaderView` — chapter reader |
| `#/admin` | `AdminView` — lazy-loaded admin panel |

### Vite config notes
- Root is `src/`, output is `docs/` (with `emptyOutDir: false`)
- Custom dev middleware serves `docs/manifest.json`, `docs/books/`, etc.
- Vitest runs tests from `tests/` (components, hooks, lib) but excludes `tests/frontend/` (those use Node test runner)

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
