// PDF2Book — Reader Application
// Vanilla JS SPA: bookshelf, book overview, chapter reader.

(function () {
  'use strict';

  const shared = window.PDF2BookShared;
  if (!shared) {
    throw new Error('shared.js must be loaded before app.js.');
  }

  const THEME_KEY = 'theme';
  const SHIKI_CDN = 'https://cdn.jsdelivr.net/npm/shiki/+esm';
  const DESKTOP_BREAKPOINT = 1024;

  // Cache-bust version: extracted from app.js?v=xxx injected by deploy workflow.
  // Data files (manifest, toc, chapters) use this to bypass CDN cache after deploy.
  const CACHE_VERSION = (() => {
    const scriptElement = document.querySelector('script[src*="app.js"]');
    return scriptElement && scriptElement.src
      ? (scriptElement.src.match(/\?v=([^&]+)/) || [])[1] || ''
      : '';
  })();

  const state = {
    currentBookId: null,
    currentSlug: null,
    tocCache: Object.create(null),
    manifestCache: null,
    shikiHighlighter: null,
    shikiLoading: false,
    adminLoaded: false,
    md: null,
    lastSidebarTrigger: null,
  };

  let els = {};

  function cacheBust(url) {
    return CACHE_VERSION ? `${url}?v=${CACHE_VERSION}` : url;
  }

  function resolveElements() {
    els = {
      adminView: document.getElementById('admin-view'),
      breadcrumb: document.querySelector('.top-bar-breadcrumb'),
      bookshelfLink: document.querySelector('.top-bar-bookshelf-link'),
      bookshelfView: document.getElementById('bookshelf-view'),
      mainContent: document.querySelector('.main-content'),
      readerView: document.getElementById('reader-view'),
      sidebar: document.getElementById('sidebar'),
      sidebarBackdrop: document.getElementById('sidebar-backdrop'),
      sidebarNav: document.querySelector('.sidebar-nav'),
      sidebarToggle: document.querySelector('.sidebar-toggle'),
      themeIconDark: document.querySelector('.theme-icon-dark'),
      themeIconLight: document.querySelector('.theme-icon-light'),
      themeToggle: document.querySelector('.theme-toggle'),
    };
  }

  function init() {
    resolveElements();
    initMarkdownIt();
    initTheme();
    initSidebar();
    initKeyboard();
    initRouter();
  }

  function initMarkdownIt() {
    if (typeof markdownit === 'undefined') {
      throw new Error(
        'markdown-it is not loaded. Ensure the CDN script is included before app.js.'
      );
    }

    state.md = markdownit({
      html: false,
      linkify: true,
      typographer: true,
    });

    if (typeof texmath !== 'undefined' && typeof katex !== 'undefined') {
      state.md.use(texmath, {
        engine: katex,
        delimiters: 'dollars',
      });
    }

    const originalHeadingOpen =
      state.md.renderer.rules.heading_open ||
      function (tokens, idx, options, _env, self) {
        return self.renderToken(tokens, idx, options);
      };

    state.md.renderer.rules.heading_open = function (tokens, idx, options, env, self) {
      const token = tokens[idx];
      const contentToken = tokens[idx + 1];

      if (contentToken && contentToken.children) {
        const text = contentToken.children
          .filter((child) => child.type === 'text' || child.type === 'code_inline')
          .map((child) => child.content)
          .join('');

        token.attrSet('id', slugify(text));
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

  function initRouter() {
    window.addEventListener('hashchange', handleRoute);
    handleRoute();
  }

  function parseRoute(hash) {
    const rawPath = hash.split('#')[0];
    const path = rawPath.endsWith('/') && rawPath.length > 1 ? rawPath.slice(0, -1) : rawPath;
    const anchor = hash.includes('#') ? hash.slice(hash.indexOf('#') + 1) : null;

    if (path === '/') {
      return { type: 'bookshelf' };
    }

    if (path === '/admin') {
      return { type: 'admin' };
    }

    const chapterMatch = path.match(/^\/([^/]+)\/chapters\/([^/]+)$/);
    if (chapterMatch) {
      return {
        type: 'chapter',
        bookId: chapterMatch[1],
        slug: chapterMatch[2],
        anchor,
      };
    }

    const bookMatch = path.match(/^\/([^/]+)$/);
    if (bookMatch) {
      return { type: 'book', bookId: bookMatch[1] };
    }

    return { type: 'bookshelf' };
  }

  function handleRoute() {
    const hash = location.hash.slice(1) || '/';
    const route = parseRoute(hash);

    hideAllViews();

    if (route.type === 'bookshelf') {
      showBookshelf();
      return;
    }

    if (route.type === 'admin') {
      showAdmin();
      return;
    }

    if (route.type === 'book') {
      showBookOverview(route.bookId);
      return;
    }

    if (route.type === 'chapter') {
      showChapter(route.bookId, route.slug, route.anchor);
    }
  }

  function hideAllViews() {
    els.bookshelfView.style.display = 'none';
    els.readerView.style.display = 'none';
    els.adminView.style.display = 'none';
    setSidebarRouteVisible(false);
    closeSidebar({ restoreFocus: false });
  }

  function updateTopBar(options) {
    const config = options || {};
    const breadcrumb = config.breadcrumb || '';
    const showBookshelfLink = Boolean(config.showBookshelfLink);
    const showSidebarToggle = Boolean(config.showSidebarToggle);

    els.breadcrumb.textContent = breadcrumb;
    els.bookshelfLink.hidden = !showBookshelfLink;
    els.sidebarToggle.hidden = !showSidebarToggle;

    syncSidebarState();
  }

  function setDocumentTitle(parts) {
    const titleParts = (parts || []).filter(Boolean);
    titleParts.push('PDF2Book');
    document.title = titleParts.join(' · ');
  }

  function isDesktopViewport() {
    return window.innerWidth >= DESKTOP_BREAKPOINT;
  }

  function setSidebarRouteVisible(visible) {
    els.sidebar.classList.toggle('visible', Boolean(visible));
    els.mainContent.classList.toggle('with-sidebar', Boolean(visible));
    syncSidebarState();
  }

  function openSidebar(options) {
    if (!els.sidebar.classList.contains('visible')) {
      return;
    }

    const config = options || {};
    const shouldMoveFocus = config.focusSidebar !== false;

    els.sidebar.classList.add('open');
    syncSidebarState();

    if (shouldMoveFocus && !isDesktopViewport()) {
      const focusableElements = shared.getFocusableElements(els.sidebarNav);
      if (focusableElements.length > 0) {
        focusableElements[0].focus();
      } else {
        els.sidebar.focus();
      }
    }
  }

  function closeSidebar(options) {
    const config = options || {};
    const shouldRestoreFocus = Boolean(config.restoreFocus);

    els.sidebar.classList.remove('open');
    syncSidebarState();

    if (
      shouldRestoreFocus &&
      state.lastSidebarTrigger &&
      typeof state.lastSidebarTrigger.focus === 'function'
    ) {
      state.lastSidebarTrigger.focus();
    }
  }

  function syncSidebarState() {
    const routeVisible = els.sidebar.classList.contains('visible');
    const expanded = routeVisible && (isDesktopViewport() || els.sidebar.classList.contains('open'));
    const backdropVisible = routeVisible && !isDesktopViewport() && els.sidebar.classList.contains('open');

    els.sidebarBackdrop.hidden = !backdropVisible;
    els.sidebarBackdrop.classList.toggle('visible', backdropVisible);
    els.sidebar.setAttribute('aria-hidden', String(!expanded));
    els.sidebar.setAttribute('tabindex', '-1');
    shared.setExpandedState(els.sidebarToggle, expanded, els.sidebar.id);
  }

  function initSidebar() {
    els.sidebarToggle.setAttribute('aria-controls', els.sidebar.id);
    shared.setExpandedState(els.sidebarToggle, false, els.sidebar.id);

    els.sidebarToggle.addEventListener('click', () => {
      state.lastSidebarTrigger = els.sidebarToggle;

      if (els.sidebar.classList.contains('open')) {
        closeSidebar({ restoreFocus: true });
      } else {
        openSidebar({ focusSidebar: true });
      }
    });

    els.sidebarBackdrop.addEventListener('click', () => {
      closeSidebar({ restoreFocus: true });
    });

    els.sidebarNav.addEventListener('click', (event) => {
      const toggleButton = event.target.closest('.sidebar-toggle-btn');
      if (toggleButton) {
        event.preventDefault();
        event.stopPropagation();

        const item = toggleButton.closest('.sidebar-item');
        if (!item) return;

        const isCollapsed = item.classList.toggle('collapsed');
        shared.setExpandedState(toggleButton, !isCollapsed, toggleButton.getAttribute('aria-controls'));
        return;
      }

      if (!isDesktopViewport()) {
        const link = event.target.closest('a');
        if (link) {
          closeSidebar({ restoreFocus: false });
        }
      }
    });

    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!els.sidebar.classList.contains('open') || isDesktopViewport()) return;

      event.preventDefault();
      closeSidebar({ restoreFocus: true });
    });

    window.addEventListener('resize', () => {
      if (isDesktopViewport()) {
        els.sidebar.classList.remove('open');
      }
      syncSidebarState();
    });
  }

  async function showBookshelf() {
    state.currentBookId = null;
    state.currentSlug = null;

    updateTopBar({
      showSidebarToggle: false,
      showBookshelfLink: false,
      breadcrumb: '',
    });
    setDocumentTitle(['Bookshelf']);
    els.bookshelfView.style.display = 'block';

    try {
      const manifest = await fetchManifest();
      renderBookshelf(manifest.books || []);
    } catch (error) {
      els.bookshelfView.replaceChildren();

      const errorElement = document.createElement('div');
      errorElement.className = 'bookshelf-error';
      errorElement.textContent = `Failed to load bookshelf: ${error.message}`;

      els.bookshelfView.appendChild(errorElement);
    }
  }

  async function fetchManifest() {
    if (state.manifestCache) return state.manifestCache;

    const url = 'manifest.json';
    const response = await fetch(cacheBust(url));
    if (!response.ok) {
      throw new Error(`Failed to load manifest: ${response.status} ${url}`);
    }

    state.manifestCache = await response.json();
    return state.manifestCache;
  }

  function renderBookshelf(books) {
    els.bookshelfView.replaceChildren();

    const container = document.createElement('section');
    container.className = 'bookshelf-container';

    const heading = document.createElement('h1');
    heading.className = 'bookshelf-heading';
    heading.textContent = 'Bookshelf';
    container.appendChild(heading);

    if (!books || books.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'bookshelf-empty';

      const emptyHeading = document.createElement('h2');
      emptyHeading.textContent = 'No books yet';

      const message = document.createElement('p');
      message.textContent = 'Upload a PDF via the admin panel to get started.';

      empty.appendChild(emptyHeading);
      empty.appendChild(message);
      container.appendChild(empty);
      els.bookshelfView.appendChild(container);
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

      const title = document.createElement('h2');
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
      meta.textContent = parts.join(' · ');

      info.appendChild(title);
      info.appendChild(meta);
      card.appendChild(cover);
      card.appendChild(info);
      grid.appendChild(card);
    }

    container.appendChild(grid);
    els.bookshelfView.appendChild(container);
  }

  function formatWordCount(count) {
    if (count >= 1000) {
      return `${Math.round(count / 1000)}k`;
    }

    return String(count);
  }

  async function showBookOverview(bookId) {
    state.currentBookId = bookId;
    state.currentSlug = null;

    updateTopBar({
      showSidebarToggle: true,
      showBookshelfLink: true,
      breadcrumb: '',
    });
    setSidebarRouteVisible(true);
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
      setDocumentTitle([tocData.title || bookId]);

      renderSidebar(bookId, tocData, null);
      renderMarkdownContent(readmeText);
      window.scrollTo(0, 0);
    } catch (error) {
      setDocumentTitle([bookId]);
      renderContentError(`Failed to load book overview: ${error.message}`);
    }
  }

  async function showChapter(bookId, slug, anchor) {
    state.currentBookId = bookId;
    state.currentSlug = slug;

    updateTopBar({
      showSidebarToggle: true,
      showBookshelfLink: true,
      breadcrumb: '',
    });
    setSidebarRouteVisible(true);
    els.readerView.style.display = 'block';

    try {
      const [tocData, chapterText] = await Promise.all([
        fetchToc(bookId),
        fetchText(`books/${bookId}/chapters/${slug}.md`),
      ]);

      const currentChapter = flattenChapters(tocData.children || []).find(
        (chapter) => chapter.slug === slug && !chapter.anchor
      );

      updateTopBar({
        showSidebarToggle: true,
        showBookshelfLink: true,
        breadcrumb: tocData.title || bookId,
      });
      setDocumentTitle([
        currentChapter ? currentChapter.title : slug,
        tocData.title || bookId,
      ]);

      renderSidebar(bookId, tocData, slug);
      renderMarkdownContent(chapterText);
      renderChapterNav(bookId, tocData, slug);

      if (anchor) {
        scrollToAnchor(anchor);
      } else {
        window.scrollTo(0, 0);
      }
    } catch (error) {
      setDocumentTitle([bookId]);
      renderContentError(`Failed to load chapter: ${error.message}`);
    }
  }

  function scrollToAnchor(anchor) {
    window.requestAnimationFrame(() => {
      const target = document.getElementById(anchor);
      if (!target) return;

      target.scrollIntoView({
        behavior: shared.getScrollBehavior(window),
        block: 'start',
      });
    });
  }

  async function fetchToc(bookId) {
    if (state.tocCache[bookId]) return state.tocCache[bookId];

    const url = `books/${bookId}/toc.json`;
    const response = await fetch(cacheBust(url));
    if (!response.ok) {
      throw new Error(`Failed to load table of contents: ${response.status} ${url}`);
    }

    const data = await response.json();
    state.tocCache[bookId] = data;
    return data;
  }

  async function fetchText(url) {
    const response = await fetch(cacheBust(url));
    if (!response.ok) {
      throw new Error(`Failed to load ${url}: ${response.status}`);
    }

    return response.text();
  }

  function renderMarkdownContent(text) {
    const rendered = state.md.render(text);
    const wrapper = document.createElement('article');
    wrapper.className = 'reader-content';
    wrapper.insertAdjacentHTML('afterbegin', rendered);
    els.readerView.replaceChildren(wrapper);
    highlightCodeBlocks(wrapper);
  }

  function renderContentError(message) {
    els.readerView.replaceChildren();

    const errorElement = document.createElement('div');
    errorElement.className = 'content-error';
    errorElement.textContent = message;

    els.readerView.appendChild(errorElement);
  }

  async function highlightCodeBlocks(container) {
    const codeBlocks = container.querySelectorAll('pre code');
    if (codeBlocks.length === 0) return;

    try {
      const highlighter = await getShikiHighlighter();
      if (!highlighter) return;

      const loadedLanguages = highlighter.getLoadedLanguages();

      for (const block of codeBlocks) {
        const languageClass = Array.from(block.classList).find((className) =>
          className.startsWith('language-')
        );
        const language = languageClass ? languageClass.replace('language-', '') : 'text';
        const code = block.textContent;

        try {
          if (!loadedLanguages.includes(language) && language !== 'text') {
            continue;
          }

          const highlighted = highlighter.codeToHtml(code, {
            lang: language,
            themes: {
              light: 'github-light',
              dark: 'github-dark',
            },
          });

          const preElement = block.parentElement;
          if (preElement && preElement.tagName === 'PRE') {
            const temp = document.createElement('div');
            temp.insertAdjacentHTML('afterbegin', highlighted);
            const newPre = temp.querySelector('pre');
            if (newPre) {
              preElement.replaceWith(newPre);
            }
          }
        } catch (_languageError) {
          // Unsupported languages remain readable without syntax highlighting.
        }
      }
    } catch (_highlightError) {
      // Syntax highlighting is best-effort and should never block reading.
    }
  }

  async function getShikiHighlighter() {
    if (state.shikiHighlighter) return state.shikiHighlighter;
    if (state.shikiLoading) return null;

    state.shikiLoading = true;

    try {
      const shikiModule = await import(SHIKI_CDN);
      state.shikiHighlighter = await shikiModule.createHighlighter({
        themes: ['github-light', 'github-dark'],
        langs: [
          'javascript',
          'typescript',
          'python',
          'bash',
          'shell',
          'json',
          'html',
          'css',
          'markdown',
          'yaml',
          'sql',
          'java',
          'c',
          'cpp',
          'go',
          'rust',
          'ruby',
          'php',
        ],
      });

      return state.shikiHighlighter;
    } catch (_error) {
      return null;
    } finally {
      state.shikiLoading = false;
    }
  }

  function renderSidebar(bookId, tocData, activeSlug) {
    els.sidebarNav.replaceChildren();

    if (!tocData.children || tocData.children.length === 0) {
      return;
    }

    const list = buildSidebarList(bookId, tocData.children, activeSlug, 0);
    els.sidebarNav.appendChild(list);
  }

  function buildSidebarList(bookId, items, activeSlug, depth) {
    const list = document.createElement('ul');
    list.className = 'sidebar-list';

    if (depth > 0) {
      list.classList.add('sidebar-list-nested');
    }

    for (const item of items) {
      const listItem = document.createElement('li');
      listItem.className = 'sidebar-item';
      listItem.style.paddingLeft = `${depth * 16}px`;

      const hasChildren = Array.isArray(item.children) && item.children.length > 0;
      const row = document.createElement('div');
      row.className = 'sidebar-item-row';

      let nestedList = null;
      let collapsed = false;

      if (hasChildren) {
        nestedList = buildSidebarList(bookId, item.children, activeSlug, depth + 1);
        nestedList.id = shared.nextId('toc-section');
        collapsed = !(activeSlug && subtreeContainsSlug(item.children, activeSlug));
        if (collapsed) {
          listItem.classList.add('collapsed');
        }

        const toggleButton = document.createElement('button');
        toggleButton.type = 'button';
        toggleButton.className = 'sidebar-toggle-btn';
        toggleButton.setAttribute('aria-label', `Toggle section: ${item.title}`);
        shared.setExpandedState(toggleButton, !collapsed, nestedList.id);

        const chevron = document.createElement('span');
        chevron.className = 'chevron';
        chevron.setAttribute('aria-hidden', 'true');
        toggleButton.appendChild(chevron);
        row.appendChild(toggleButton);
      }

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
        link.setAttribute('aria-current', 'page');
      }

      row.appendChild(link);
      listItem.appendChild(row);

      if (nestedList) {
        listItem.appendChild(nestedList);
      }

      list.appendChild(listItem);
    }

    return list;
  }

  function subtreeContainsSlug(items, slug) {
    for (const item of items) {
      if (item.slug === slug) return true;
      if (item.children && subtreeContainsSlug(item.children, slug)) return true;
    }

    return false;
  }

  function renderChapterNav(bookId, tocData, activeSlug) {
    const chapters = flattenChapters(tocData.children || []);
    const currentIndex = chapters.findIndex(
      (chapter) => chapter.slug === activeSlug && !chapter.anchor
    );

    if (currentIndex === -1) return;

    const nav = document.createElement('nav');
    nav.className = 'chapter-nav';
    nav.setAttribute('aria-label', 'Chapter navigation');

    const previousChapter = currentIndex > 0 ? chapters[currentIndex - 1] : null;
    const nextChapter = currentIndex < chapters.length - 1 ? chapters[currentIndex + 1] : null;

    nav.appendChild(buildNavLink(bookId, previousChapter, 'prev', 'Previous'));
    nav.appendChild(buildNavLink(bookId, nextChapter, 'next', 'Next'));

    const article = els.readerView.querySelector('.reader-content');
    if (article) {
      article.appendChild(nav);
    }
  }

  function buildNavLink(bookId, chapter, direction, labelText) {
    if (!chapter) {
      const placeholder = document.createElement('div');
      placeholder.className = `chapter-nav-placeholder chapter-nav-link--${direction}`;
      placeholder.setAttribute('aria-hidden', 'true');
      return placeholder;
    }

    const link = document.createElement('a');
    link.className = `chapter-nav-link chapter-nav-link--${direction}`;
    link.href = `#/${bookId}/chapters/${chapter.slug}`;

    const label = document.createElement('span');
    label.className = 'chapter-nav-label';
    label.textContent = labelText;

    const title = document.createElement('span');
    title.className = 'chapter-nav-title';
    title.textContent = chapter.title;

    link.appendChild(label);
    link.appendChild(title);

    return link;
  }

  function flattenChapters(items) {
    const flattened = [];

    for (const item of items) {
      if (item.slug && !item.anchor) {
        flattened.push(item);
      }

      if (item.children) {
        flattened.push.apply(flattened, flattenChapters(item.children));
      }
    }

    return flattened;
  }

  function initTheme() {
    const storedTheme = localStorage.getItem(THEME_KEY);
    const theme =
      storedTheme === 'dark' || storedTheme === 'light'
        ? storedTheme
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';

    applyTheme(theme);

    els.themeToggle.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme');
      const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
      applyTheme(nextTheme);
      localStorage.setItem(THEME_KEY, nextTheme);
    });
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);

    if (els.themeIconLight) {
      els.themeIconLight.style.display = theme === 'dark' ? '' : 'none';
    }

    if (els.themeIconDark) {
      els.themeIconDark.style.display = theme === 'light' ? '' : 'none';
    }

    els.themeToggle.setAttribute(
      'aria-label',
      theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
    );
  }

  function initKeyboard() {
    document.addEventListener('keydown', (event) => {
      const activeTag = document.activeElement ? document.activeElement.tagName : null;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') {
        return;
      }

      if (els.readerView.style.display === 'none') return;
      if (!state.currentBookId || !state.currentSlug) return;

      if (event.key === 'ArrowLeft') {
        navigateChapter(-1);
      } else if (event.key === 'ArrowRight') {
        navigateChapter(1);
      }
    });
  }

  function navigateChapter(direction) {
    const tocData = state.tocCache[state.currentBookId];
    if (!tocData) return;

    const chapters = flattenChapters(tocData.children || []);
    const currentIndex = chapters.findIndex(
      (chapter) => chapter.slug === state.currentSlug && !chapter.anchor
    );
    if (currentIndex === -1) return;

    const targetIndex = currentIndex + direction;
    if (targetIndex >= 0 && targetIndex < chapters.length) {
      location.hash = `#/${state.currentBookId}/chapters/${chapters[targetIndex].slug}`;
    }
  }

  function showAdmin() {
    state.currentBookId = null;
    state.currentSlug = null;

    updateTopBar({
      showSidebarToggle: false,
      showBookshelfLink: true,
      breadcrumb: 'Admin',
    });
    setDocumentTitle(['Admin']);
    els.adminView.style.display = 'block';

    if (!state.adminLoaded) {
      const script = document.createElement('script');
      const appScript = document.querySelector('script[src*="app.js"]');
      const version = appScript && appScript.src
        ? (appScript.src.match(/\?v=([^&]+)/) || [])[1] || Date.now()
        : Date.now();

      script.src = `assets/admin.js?v=${version}`;
      document.body.appendChild(script);
      state.adminLoaded = true;
    } else if (typeof window.initAdmin === 'function' && !els.adminView.firstChild) {
      window.initAdmin(els.adminView);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
