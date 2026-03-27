# PDF2Book

[中文](README.zh-CN.md)

PDF to online bookshelf. Fork, read, done.

> Fork this repo to get your own online bookshelf. Upload PDFs, they're automatically converted to Markdown and served as a GitBook-style reading site on GitHub Pages. Zero server cost.

## Quick Start (3 Steps)

### 1. Fork & Enable Pages

1. Click **Fork** on this repository
2. In your fork, go to **Settings > Pages**
3. Under **Source**, select **GitHub Actions**
4. Go to the **Actions** tab, select **Deploy to GitHub Pages**, click **Run workflow** to trigger the first deployment

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

- **Reader** — Dark/light theme, chapter sidebar, keyboard navigation, code highlighting (Shiki), math rendering (KaTeX), responsive layout
- **Admin** — Upload PDFs from browser, real-time conversion progress, catalog management (edit, publish, hide, archive, delete), search & filter
- **Pipeline** — GitHub Actions converts PDFs via MinerU API, handles large files by auto-chunking, generates chapters + metadata

## How It Works

```
Upload PDF (browser → GitHub API → input/)
  → GitHub Actions → MinerU API → Markdown
  → Split chapters → docs/books/{id}/
  → Build manifest → GitHub Pages deploys
```

## Testing

```bash
npm test                                        # JS unit tests
npm run test:frontend                           # Frontend behavior tests
python -m unittest discover -s tests/scripts -v # Python pipeline tests
```

## FAQ

**Do I need to install anything locally?** No. Everything runs in GitHub Actions and your browser.

**What if MinerU stops being free?** Swap it by modifying `scripts/mineru_client.py`. Works with any PDF-to-Markdown tool.

**Can I edit converted chapters?** Yes. Edit `.md` files in `docs/books/<id>/chapters/` and commit.

**Will catalog edits survive re-convert?** Yes. Curated metadata is stored separately and merged back on rebuild.

## Disclaimer

For **personal study and research only**. Users are responsible for ensuring they have the legal right to convert and host any PDF content. Do not upload copyrighted material without permission. See full disclaimer in the [LICENSE](LICENSE) file.

## License

MIT
