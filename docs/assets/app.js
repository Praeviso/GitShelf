// PDF2Book — Reader Application
// Vanilla JS SPA: bookshelf, book overview, chapter reader.

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  const MANIFEST_URL = 'manifest.json';
  const THEME_KEY = 'theme';
  const SHIKI_CDN = 'https://cdn.jsdelivr.net/npm/shiki/+esm';

  // ---------------------------------------------------------------------------
  // Module state
  // ---------------------------------------------------------------------------

  let currentBookId = null;
  let currentSlug = null;
  let tocCache = {};
  let manifestCache = null;
  let shikiHighlighter = null;
  let shikiLoading = false;
  let adminLoaded = false;
  let md = null;

  // ---------------------------------------------------------------------------
  // DOM references (resolved once on init)
  // ---------------------------------------------------------------------------

  let els = {};

  function resolveElements() {
    els = {
      bookshelfView: document.getElementById('bookshelf-view'),
      readerView: document.getElementById('reader-view'),
      adminView: document.getElementById('admin-view'),
      sidebar: document.getElementById('sidebar'),
      sidebarNav: document.querySelector('.sidebar-nav'),
      sidebarBackdrop: document.getElementById('sidebar-backdrop'),
      sidebarToggle: document.querySelector('.sidebar-toggle'),
      breadcrumb: document.querySelector('.top-bar-breadcrumb'),
      bookshelfLink: document.querySelector('.top-bar-bookshelf-link'),
      themeToggle: document.querySelector('.theme-toggle'),
      themeIconLight: document.querySelector('.theme-icon-light'),
      themeIconDark: document.querySelector('.theme-icon-dark'),
    };
  }

  // ---------------------------------------------------------------------------
  // Public API — initialization
  // ---------------------------------------------------------------------------

  function init() {
    resolveElements();
    initMarkdownIt();
    initTheme();
    initRouter();
    initSidebar();
    initKeyboard();
  }

  // ---------------------------------------------------------------------------
  // Markdown-it setup
  // ---------------------------------------------------------------------------

  function initMarkdownIt() {
    if (typeof markdownit === 'undefined') {
      throw new Error('markdown-it is not loaded. Ensure the CDN script is included before app.js.');
    }
    md = markdownit({
      html: false,
      linkify: true,
      typographer: true,
    });

    // texmath plugin for KaTeX math rendering
    if (typeof texmath !== 'undefined' && typeof katex !== 'undefined') {
      md.use(texmath, {
        engine: katex,
        delimiters: 'dollars',
      });
    }

    // Add heading anchor IDs
    const originalHeadingOpen = md.renderer.rules.heading_open ||
      function (tokens, idx, options, _env, self) {
        return self.renderToken(tokens, idx, options);
      };

    md.renderer.rules.heading_open = function (tokens, idx, options, env, self) {
      const token = tokens[idx];
      const contentToken = tokens[idx + 1];
      if (contentToken && contentToken.children) {
        const text = contentToken.children
          .filter(t => t.type === 'text' || t.type === 'code_inline')
          .map(t => t.content)
          .join('');
        const id = slugify(text);
        token.attrSet('id', id);
      }
      return originalHeadingOpen(tokens, idx, options, env, self);
    };
  }

  function slugify(text) {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // ---------------------------------------------------------------------------
  // Hash Router
  // ---------------------------------------------------------------------------

  function initRouter() {
    window.addEventListener('hashchange', handleRoute);
    handleRoute();
  }

  function handleRoute() {
    const hash = location.hash.slice(1) || '/';
    const route = parseRoute(hash);

    hideAllViews();

    if (route.type === 'bookshelf') {
      showBookshelf();
    } else if (route.type === 'admin') {
      showAdmin();
    } else if (route.type === 'chapter') {
      showChapter(route.bookId, route.slug, route.anchor);
    } else if (route.type === 'book') {
      showBookOverview(route.bookId);
    }
  }

  function parseRoute(hash) {
    // Normalize: remove trailing slash
    const path = hash.endsWith('/') && hash.length > 1 ? hash.slice(0, -1) : hash;

    if (path === '/') {
      return { type: 'bookshelf' };
    }
    if (path === '/admin') {
      return { type: 'admin' };
    }

    // /<book-id>/chapters/<slug>
    const chapterMatch = path.match(/^\/([^/]+)\/chapters\/([^/]+)$/);
    if (chapterMatch) {
      // Anchors within hash routing appear after a second # in location.hash
      const anchorIdx = location.hash.indexOf('#', 1);
      const anchor = anchorIdx !== -1 ? location.hash.slice(anchorIdx + 1) : null;
      return { type: 'chapter', bookId: chapterMatch[1], slug: chapterMatch[2], anchor };
    }

    // /<book-id>
    const bookMatch = path.match(/^\/([^/]+)$/);
    if (bookMatch) {
      return { type: 'book', bookId: bookMatch[1] };
    }

    // Fallback: bookshelf
    return { type: 'bookshelf' };
  }

  function hideAllViews() {
    els.bookshelfView.style.display = 'none';
    els.readerView.style.display = 'none';
    els.adminView.style.display = 'none';
    els.sidebar.classList.remove('open', 'visible');
    els.sidebarBackdrop.classList.remove('visible');
    document.querySelector('.main-content').classList.remove('with-sidebar');
  }

  // ---------------------------------------------------------------------------
  // Top bar updates
  // ---------------------------------------------------------------------------

  function updateTopBar(options) {
    const { showSidebarToggle = false, showBookshelfLink = false, breadcrumb = '' } = options;
    els.sidebarToggle.style.display = showSidebarToggle ? '' : 'none';
    els.bookshelfLink.style.display = showBookshelfLink ? '' : 'none';
    els.breadcrumb.textContent = breadcrumb;
  }

  // ---------------------------------------------------------------------------
  // Bookshelf View
  // ---------------------------------------------------------------------------

  async function showBookshelf() {
    currentBookId = null;
    currentSlug = null;

    updateTopBar({ showSidebarToggle: false, showBookshelfLink: false, breadcrumb: '' });
    els.sidebar.classList.remove('visible');
    els.bookshelfView.style.display = 'block';

    try {
      const manifest = await fetchManifest();
      renderBookshelf(manifest.books);
    } catch (err) {
      els.bookshelfView.replaceChildren();
      const errEl = document.createElement('div');
      errEl.className = 'bookshelf-error';
      errEl.textContent = `Failed to load bookshelf: ${err.message}`;
      els.bookshelfView.appendChild(errEl);
    }
  }

  async function fetchManifest() {
    if (manifestCache) return manifestCache;
    const res = await fetch(MANIFEST_URL);
    if (!res.ok) {
      throw new Error(`Failed to load manifest: ${res.status} ${MANIFEST_URL}`);
    }
    manifestCache = await res.json();
    return manifestCache;
  }

  function renderBookshelf(books) {
    els.bookshelfView.replaceChildren();

    if (!books || books.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'bookshelf-empty';
      const heading = document.createElement('h2');
      heading.textContent = 'No books yet';
      const msg = document.createElement('p');
      msg.textContent = 'Upload a PDF via the admin panel to get started.';
      empty.appendChild(heading);
      empty.appendChild(msg);
      els.bookshelfView.appendChild(empty);
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'bookshelf-grid';

    for (const book of books) {
      const card = document.createElement('a');
      card.className = 'book-card';
      card.href = `#/${book.id}`;

      const cover = document.createElement('div');
      cover.className = 'book-card-cover';
      const coverLetter = document.createElement('span');
      coverLetter.className = 'book-card-cover-letter';
      coverLetter.textContent = book.title ? book.title.charAt(0) : '?';
      cover.appendChild(coverLetter);

      const info = document.createElement('div');
      info.className = 'book-card-info';

      const title = document.createElement('h3');
      title.className = 'book-card-title';
      title.textContent = book.title;

      const meta = document.createElement('div');
      meta.className = 'book-card-meta';
      const parts = [];
      if (typeof book.chapters_count === 'number') {
        parts.push(`${book.chapters_count} chapter${book.chapters_count !== 1 ? 's' : ''}`);
      }
      if (typeof book.word_count === 'number') {
        parts.push(`${formatWordCount(book.word_count)} words`);
      }
      meta.textContent = parts.join(' \u00b7 ');

      info.appendChild(title);
      info.appendChild(meta);
      card.appendChild(cover);
      card.appendChild(info);
      grid.appendChild(card);
    }

    els.bookshelfView.appendChild(grid);
  }

  function formatWordCount(count) {
    if (count >= 1000) {
      return `${Math.round(count / 1000)}k`;
    }
    return String(count);
  }

  // ---------------------------------------------------------------------------
  // Book Overview View
  // ---------------------------------------------------------------------------

  async function showBookOverview(bookId) {
    currentBookId = bookId;
    currentSlug = null;

    updateTopBar({ showSidebarToggle: true, showBookshelfLink: true, breadcrumb: '' });
    els.sidebar.classList.add('visible');
    document.querySelector('.main-content').classList.add('with-sidebar');
    els.readerView.style.display = 'block';

    try {
      const [tocData, readmeText] = await Promise.all([
        fetchToc(bookId),
        fetchText(`books/${bookId}/README.md`),
      ]);

      updateTopBar({
        showSidebarToggle: true,
        showBookshelfLink: true,
        breadcrumb: tocData.title || bookId,
      });

      renderSidebar(bookId, tocData, null);
      renderMarkdownContent(readmeText);
    } catch (err) {
      renderContentError(`Failed to load book overview: ${err.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Chapter Reader View
  // ---------------------------------------------------------------------------

  async function showChapter(bookId, slug, anchor) {
    currentBookId = bookId;
    currentSlug = slug;

    updateTopBar({ showSidebarToggle: true, showBookshelfLink: true, breadcrumb: '' });
    els.sidebar.classList.add('visible');
    document.querySelector('.main-content').classList.add('with-sidebar');
    els.readerView.style.display = 'block';

    try {
      const [tocData, chapterText] = await Promise.all([
        fetchToc(bookId),
        fetchText(`books/${bookId}/chapters/${slug}.md`),
      ]);

      updateTopBar({
        showSidebarToggle: true,
        showBookshelfLink: true,
        breadcrumb: tocData.title || bookId,
      });

      renderSidebar(bookId, tocData, slug);
      renderMarkdownContent(chapterText);

      // Scroll to anchor if provided, otherwise to top
      if (anchor) {
        requestAnimationFrame(() => {
          const target = document.getElementById(anchor);
          if (target) {
            target.scrollIntoView({ behavior: 'smooth' });
          }
        });
      } else {
        window.scrollTo(0, 0);
      }

      renderChapterNav(bookId, tocData, slug);
    } catch (err) {
      renderContentError(`Failed to load chapter: ${err.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Fetch helpers
  // ---------------------------------------------------------------------------

  async function fetchToc(bookId) {
    if (tocCache[bookId]) return tocCache[bookId];
    const url = `books/${bookId}/toc.json`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to load table of contents: ${res.status} ${url}`);
    }
    const data = await res.json();
    tocCache[bookId] = data;
    return data;
  }

  async function fetchText(url) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to load ${url}: ${res.status}`);
    }
    return res.text();
  }

  // ---------------------------------------------------------------------------
  // Markdown rendering
  // ---------------------------------------------------------------------------

  function renderMarkdownContent(text) {
    const rendered = md.render(text);
    const wrapper = document.createElement('article');
    wrapper.className = 'reader-content';
    // markdown-it is configured with html:false, so the output is safe from
    // raw HTML injection. insertAdjacentHTML is used per the project spec.
    wrapper.insertAdjacentHTML('afterbegin', rendered);
    els.readerView.replaceChildren(wrapper);
    highlightCodeBlocks(wrapper);
  }

  function renderContentError(message) {
    els.readerView.replaceChildren();
    const errEl = document.createElement('div');
    errEl.className = 'content-error';
    errEl.textContent = message;
    els.readerView.appendChild(errEl);
  }

  // ---------------------------------------------------------------------------
  // Code syntax highlighting (shiki, async)
  // ---------------------------------------------------------------------------

  async function highlightCodeBlocks(container) {
    const codeBlocks = container.querySelectorAll('pre code');
    if (codeBlocks.length === 0) return;

    try {
      const highlighter = await getShikiHighlighter();
      if (!highlighter) return;

      const loadedLangs = highlighter.getLoadedLanguages();

      for (const block of codeBlocks) {
        const langClass = Array.from(block.classList).find(c => c.startsWith('language-'));
        const lang = langClass ? langClass.replace('language-', '') : 'text';
        const code = block.textContent;

        try {
          if (!loadedLangs.includes(lang) && lang !== 'text') {
            continue;
          }
          const highlighted = highlighter.codeToHtml(code, {
            lang,
            themes: { light: 'github-light', dark: 'github-dark' },
          });
          // Replace the <pre> element with shiki's rendered output.
          // shiki output is a trusted, deterministic HTML structure from the
          // library itself (not user input), so insertAdjacentHTML is safe here.
          const pre = block.parentElement;
          if (pre && pre.tagName === 'PRE') {
            const temp = document.createElement('div');
            temp.insertAdjacentHTML('afterbegin', highlighted);
            const newPre = temp.querySelector('pre');
            if (newPre) {
              pre.replaceWith(newPre);
            }
          }
        } catch (_langErr) {
          // Language not supported — code block remains readable unhighlighted
        }
      }
    } catch (_shikiErr) {
      // Shiki failed to load — code blocks remain readable unhighlighted
    }
  }

  async function getShikiHighlighter() {
    if (shikiHighlighter) return shikiHighlighter;
    if (shikiLoading) return null;
    shikiLoading = true;

    try {
      const shikiModule = await import(SHIKI_CDN);
      shikiHighlighter = await shikiModule.createHighlighter({
        themes: ['github-light', 'github-dark'],
        langs: [
          'javascript', 'typescript', 'python', 'bash', 'shell',
          'json', 'html', 'css', 'markdown', 'yaml', 'sql',
          'java', 'c', 'cpp', 'go', 'rust', 'ruby', 'php',
        ],
      });
      return shikiHighlighter;
    } catch (_err) {
      shikiLoading = false;
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Sidebar
  // ---------------------------------------------------------------------------

  function initSidebar() {
    els.sidebarToggle.addEventListener('click', () => {
      const isOpen = els.sidebar.classList.toggle('open');
      els.sidebarBackdrop.classList.toggle('visible', isOpen);
    });

    els.sidebarBackdrop.addEventListener('click', () => {
      els.sidebar.classList.remove('open');
      els.sidebarBackdrop.classList.remove('visible');
    });

    // Event delegation for sidebar nav
    els.sidebarNav.addEventListener('click', (e) => {
      const toggle = e.target.closest('.sidebar-toggle-btn');
      if (toggle) {
        e.preventDefault();
        e.stopPropagation();
        const item = toggle.closest('.sidebar-item');
        if (item) {
          item.classList.toggle('collapsed');
        }
        return;
      }

      // Close sidebar on mobile after link navigation
      if (window.innerWidth < 1024) {
        const link = e.target.closest('a');
        if (link) {
          els.sidebar.classList.remove('open');
          els.sidebarBackdrop.classList.remove('visible');
        }
      }
    });
  }

  function renderSidebar(bookId, tocData, activeSlug) {
    els.sidebarNav.replaceChildren();
    if (!tocData.children || tocData.children.length === 0) return;

    const list = buildSidebarList(bookId, tocData.children, activeSlug, 0);
    els.sidebarNav.appendChild(list);
  }

  function buildSidebarList(bookId, items, activeSlug, depth) {
    const ul = document.createElement('ul');
    ul.className = 'sidebar-list';
    if (depth > 0) {
      ul.classList.add('sidebar-list-nested');
    }

    for (const item of items) {
      const li = document.createElement('li');
      li.className = 'sidebar-item';
      li.style.paddingLeft = `${depth * 16}px`;

      const hasChildren = item.children && item.children.length > 0;

      const row = document.createElement('div');
      row.className = 'sidebar-item-row';

      const link = document.createElement('a');
      link.className = 'sidebar-link';
      if (item.anchor) {
        link.href = `#/${bookId}/chapters/${item.slug}#${item.anchor}`;
      } else if (item.slug) {
        link.href = `#/${bookId}/chapters/${item.slug}`;
      }
      link.textContent = item.title;

      if (item.slug === activeSlug && !item.anchor) {
        link.classList.add('active');
      }

      if (hasChildren) {
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'sidebar-toggle-btn';
        toggleBtn.setAttribute('aria-label', 'Toggle section');
        const chevron = document.createElement('span');
        chevron.className = 'chevron';
        toggleBtn.appendChild(chevron);
        row.appendChild(toggleBtn);
      }

      row.appendChild(link);
      li.appendChild(row);

      if (hasChildren) {
        const nestedList = buildSidebarList(bookId, item.children, activeSlug, depth + 1);
        li.appendChild(nestedList);

        const containsActive = activeSlug && subtreeContainsSlug(item.children, activeSlug);
        if (!containsActive) {
          li.classList.add('collapsed');
        }
      }

      ul.appendChild(li);
    }

    return ul;
  }

  function subtreeContainsSlug(items, slug) {
    for (const item of items) {
      if (item.slug === slug) return true;
      if (item.children && subtreeContainsSlug(item.children, slug)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Chapter navigation (prev/next)
  // ---------------------------------------------------------------------------

  function renderChapterNav(bookId, tocData, activeSlug) {
    const chapters = flattenChapters(tocData.children);
    const currentIndex = chapters.findIndex(c => c.slug === activeSlug && !c.anchor);

    if (currentIndex === -1) return;

    const nav = document.createElement('nav');
    nav.className = 'chapter-nav';
    nav.setAttribute('aria-label', 'Chapter navigation');

    const prev = currentIndex > 0 ? chapters[currentIndex - 1] : null;
    const next = currentIndex < chapters.length - 1 ? chapters[currentIndex + 1] : null;

    nav.appendChild(buildNavLink(bookId, prev, 'prev', 'Previous'));
    nav.appendChild(buildNavLink(bookId, next, 'next', 'Next'));

    const article = els.readerView.querySelector('.reader-content');
    if (article) {
      article.appendChild(nav);
    }
  }

  function buildNavLink(bookId, chapter, direction, labelText) {
    const link = document.createElement('a');
    link.className = `chapter-nav-link chapter-nav-link--${direction}`;
    if (chapter) {
      link.href = `#/${bookId}/chapters/${chapter.slug}`;
      const label = document.createElement('span');
      label.className = 'chapter-nav-label';
      label.textContent = labelText;
      const title = document.createElement('span');
      title.className = 'chapter-nav-title';
      title.textContent = chapter.title;
      link.appendChild(label);
      link.appendChild(title);
    }
    return link;
  }

  function flattenChapters(items) {
    const result = [];
    for (const item of items) {
      if (item.slug && !item.anchor) {
        result.push(item);
      }
      if (item.children) {
        result.push(...flattenChapters(item.children));
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Theme toggle
  // ---------------------------------------------------------------------------

  function initTheme() {
    const stored = localStorage.getItem(THEME_KEY);
    let theme;
    if (stored === 'dark' || stored === 'light') {
      theme = stored;
    } else {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    applyTheme(theme);

    els.themeToggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      localStorage.setItem(THEME_KEY, next);
    });
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (els.themeIconLight) els.themeIconLight.style.display = theme === 'dark' ? '' : 'none';
    if (els.themeIconDark) els.themeIconDark.style.display = theme === 'light' ? '' : 'none';
  }

  // ---------------------------------------------------------------------------
  // Keyboard navigation
  // ---------------------------------------------------------------------------

  function initKeyboard() {
    document.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (els.readerView.style.display === 'none') return;
      if (!currentBookId || !currentSlug) return;

      if (e.key === 'ArrowLeft') {
        navigateChapter(-1);
      } else if (e.key === 'ArrowRight') {
        navigateChapter(1);
      }
    });
  }

  function navigateChapter(direction) {
    const tocData = tocCache[currentBookId];
    if (!tocData) return;

    const chapters = flattenChapters(tocData.children);
    const currentIndex = chapters.findIndex(c => c.slug === currentSlug && !c.anchor);
    if (currentIndex === -1) return;

    const targetIndex = currentIndex + direction;
    if (targetIndex >= 0 && targetIndex < chapters.length) {
      location.hash = `#/${currentBookId}/chapters/${chapters[targetIndex].slug}`;
    }
  }

  // ---------------------------------------------------------------------------
  // Admin lazy loading
  // ---------------------------------------------------------------------------

  function showAdmin() {
    currentBookId = null;
    currentSlug = null;

    updateTopBar({ showSidebarToggle: false, showBookshelfLink: true, breadcrumb: 'Admin' });
    els.sidebar.classList.remove('visible');
    els.adminView.style.display = 'block';

    if (!adminLoaded) {
      const script = document.createElement('script');
      script.src = 'assets/admin.js';
      document.body.appendChild(script);
      adminLoaded = true;
    }
  }

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
