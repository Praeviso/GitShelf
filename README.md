# PDF2Book

PDF to online bookshelf. Fork, read, done.

> Fork this repo to get your own online bookshelf. Upload PDFs, they're automatically converted to Markdown and served as a GitBook-style reading site on GitHub Pages. Zero server cost.

## Quick Start (3 Steps)

### 1. Fork & Enable Pages

1. Click **Fork** on this repository
2. In your fork, go to **Settings > Pages**
3. Under **Source**, select **GitHub Actions**

Your site is now live at `https://<your-username>.github.io/pdf2book/`

### 2. Add MinerU Token

1. Register at [mineru.net](https://mineru.net) (free during beta)
2. Copy your API token
3. In your fork, go to **Settings > Secrets and variables > Actions**
4. Click **New repository secret**, name it `MINERU_TOKEN`, paste the token

### 3. Upload Your First Book

1. Visit your site and click the gear icon in the top bar
2. Enter a GitHub **Personal Access Token** with `repo` scope
   ([Create one here](https://github.com/settings/tokens/new?scopes=repo&description=PDF2Book))
3. Upload a PDF file
4. Wait for the conversion to complete (progress is shown on screen)
5. Your book appears on the bookshelf!

## Features

### Reading Experience
- Warm, Claude-inspired design with serif typography optimized for long-form reading
- Collapsible chapter sidebar with active chapter highlighting
- Dark / Light theme toggle (persists across sessions)
- Keyboard navigation (Left / Right arrows to flip chapters)
- Code syntax highlighting (shiki) and math rendering (KaTeX)
- Responsive layout (mobile sidebar collapses to drawer)

### Admin Panel (`#/admin`)
- Upload PDFs directly from the browser (via GitHub API)
- Real-time conversion progress monitoring
- Full catalog management: edit title/author/summary/tags/featured/manual order
- Lifecycle management: publish, hide, archive, bulk update, permanent delete
- Search, filter, sort, and provenance-aware re-convert
- Configurable chapter split level (H1 / H2 / H3)
- PAT stored only in browser localStorage, never sent anywhere except `api.github.com`

### Conversion Pipeline
- Automatic: push a PDF to `input/`, GitHub Actions converts it
- MinerU API for high-quality PDF-to-Markdown conversion
- Handles large PDFs (> 600 pages) by automatic chunking
- Generates chapter files, conversion metadata, public manifest, and full catalog

## Architecture

```
Reader (GitHub Pages)          Admin (Browser)            Pipeline (GitHub Actions)
       |                            |                            |
  fetch docs/                 GitHub API                   MinerU API
  manifest.json,          (PAT in localStorage)          (MINERU_TOKEN secret)
  catalog.json                 |                            |
  toc.json, .md files          |                            |
       |                  Upload PDF to input/         PDF -> Markdown
       |                       |                       Split chapters
  markdown-it render     Edit catalog metadata         Write conversion.json
  shiki + KaTeX          Poll Actions status           Build manifest + catalog
                                                       Commit docs/ + archived/
```

## Project Structure

```
pdf2book/
├── .github/workflows/
│   ├── convert.yml              # PDF conversion workflow
│   └── deploy-pages.yml         # GitHub Pages deployment
├── docs/                        # GitHub Pages root (static site)
│   ├── index.html               # SPA entry point
│   ├── manifest.json            # Public bookshelf metadata (published books only)
│   ├── catalog.json             # Full merged catalog for admin
│   ├── catalog-metadata.json    # Curator-managed metadata that survives reconvert
│   ├── assets/
│   │   ├── shared.js            # Shared frontend accessibility/runtime helpers
│   │   ├── app.js               # Reader core logic
│   │   ├── admin.js             # Admin panel (lazy-loaded)
│   │   └── style.css            # All styles (light/dark themes)
│   └── books/<book-id>/         # Converted books
│       ├── README.md
│       ├── toc.json
│       ├── conversion.json      # Conversion facts (source PDF, converted_at, split level)
│       └── chapters/*.md
├── input/                       # PDF upload target
│   └── archived/                # Processed PDFs
├── scripts/                     # Python conversion pipeline
│   ├── convert.py               # Main pipeline entry point
│   ├── mineru_client.py         # MinerU API client
│   ├── split_markdown.py        # Markdown chapter splitter
│   ├── generate_structure.py    # toc.json generator
│   └── build_manifest.py        # manifest.json builder
├── tests/frontend/              # Node + jsdom frontend behavior tests
├── spec/                        # Design & engineering specs
└── requirements.txt             # Python dependencies
```

## Frontend Tests

Run the frontend behavior tests locally with:

```bash
npm install
npm run test:frontend
```

## Python Tests

Run the catalog and conversion unit tests locally with:

```bash
python -m unittest discover -s tests/scripts -v
```

## Constraints

| Resource | Limit | Impact |
|----------|-------|--------|
| MinerU API | 600 pages/file, 2000 pages/day (beta) | Large PDFs auto-chunked |
| GitHub Contents API | 100 MB per file | Most PDFs fit |
| GitHub Pages | 1 GB site size | Monitor `docs/books/` growth |
| GitHub API (with PAT) | 5000 requests/hour | Admin use only, sufficient |

## FAQ

**Q: Do I need to install anything locally?**
No. Everything runs in GitHub Actions and your browser.

**Q: What happens when MinerU stops being free?**
The pipeline is designed with a replaceable API layer. You can swap MinerU for [Marker](https://github.com/VikParuchuri/marker) or any other PDF-to-Markdown tool by modifying `scripts/mineru_client.py`.

**Q: Can I manually edit converted chapters?**
Yes. Edit the `.md` files in `docs/books/<book-id>/chapters/` and commit. The site updates automatically.

**Q: Will catalog edits survive re-convert?**
Yes. Curated metadata is stored separately in `docs/catalog-metadata.json`, and the pipeline merges it back into the published manifest and full catalog on rebuild.

**Q: How do I delete archived PDFs to save space?**
Delete files in `input/archived/` via the GitHub web interface or git.

## License

MIT
