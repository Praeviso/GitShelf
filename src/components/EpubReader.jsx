import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import { fetchToc, flattenChapters } from '../lib/api';
import { ChapterNav } from './ChapterNav';

const STORAGE_PREFIX = 'gitshelf:epub-location:';
const LOCATION_GENERATE_CHARS = 1600;

function normalizeHref(href) {
  return String(href || '').trim().replace(/^\.\//, '');
}

function stripFragment(href) {
  return normalizeHref(href).split('#', 1)[0];
}

function isCfiTarget(target) {
  return typeof target === 'string' && target.startsWith('epubcfi(');
}

function findChapterBySlug(chapters, slug) {
  return chapters.find((chapter) => chapter.slug === slug) || null;
}

function findChapterCandidatesByHref(chapters, href) {
  const normalizedHref = normalizeHref(href);
  if (!normalizedHref) return [];

  const exactMatches = chapters.filter((chapter) => normalizeHref(chapter.href) === normalizedHref);
  if (exactMatches.length > 0) {
    return exactMatches;
  }

  const sectionPath = stripFragment(normalizedHref);
  return chapters.filter((chapter) => stripFragment(chapter.href) === sectionPath);
}

function findChapterByHref(chapters, href) {
  return findChapterCandidatesByHref(chapters, href)[0] || null;
}

function normalizeMatchText(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\s+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase();
}

function findElementByChapterTitle(doc, title) {
  if (!doc?.body || !title) return null;

  const target = normalizeMatchText(title);
  if (!target) return null;

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let best = null;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = normalizeMatchText(node.textContent);
    if (!text) continue;
    if (text !== target && !text.includes(target)) continue;

    const element = node.parentElement;
    if (!element) continue;

    const score = Math.abs(text.length - target.length);
    if (!best || score < best.score) {
      best = { element, score };
      if (score === 0) break;
    }
  }

  return best?.element || null;
}

function raf() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function scrollChapterIntoView(rendition, chapter) {
  if (!rendition || !chapter?.title) return false;

  await raf();
  await raf();

  const contentsList = rendition.getContents?.() || [];
  for (const contents of contentsList) {
    const target = findElementByChapterTitle(contents.document, chapter.title);
    if (!target) continue;

    target.scrollIntoView({ block: 'start', behavior: 'auto' });
    return true;
  }

  return false;
}

function readStoredLocation(bookId) {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${bookId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      slug: typeof parsed.slug === 'string' ? parsed.slug : null,
      cfi: typeof parsed.cfi === 'string' ? parsed.cfi : null,
    };
  } catch {
    return null;
  }
}

function writeStoredLocation(bookId, value) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${bookId}`, JSON.stringify(value));
  } catch {
    // Ignore storage failures and keep reading.
  }
}

function dispatchHashChange() {
  try {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } catch {
    window.dispatchEvent(new Event('hashchange'));
  }
}

function replaceBookHash(bookId, slug) {
  const nextHash = `#/books/${encodeURIComponent(bookId)}/${encodeURIComponent(slug)}`;
  if (window.location.hash === nextHash) return;
  window.history.replaceState(window.history.state, '', nextHash);
  dispatchHashChange();
}

function buildReaderThemeCss() {
  const rootStyles = getComputedStyle(document.documentElement);
  const background = rootStyles.getPropertyValue('--color-bg-surface').trim();
  const text = rootStyles.getPropertyValue('--color-text-primary').trim();
  const heading = rootStyles.getPropertyValue('--color-text-heading').trim();
  const secondary = rootStyles.getPropertyValue('--color-text-secondary').trim();
  const tertiary = rootStyles.getPropertyValue('--color-text-tertiary').trim();
  const accent = rootStyles.getPropertyValue('--color-accent').trim();
  const accentHover = rootStyles.getPropertyValue('--color-accent-hover').trim();
  const border = rootStyles.getPropertyValue('--color-border').trim();
  const subtle = rootStyles.getPropertyValue('--color-bg-subtle').trim();
  const code = rootStyles.getPropertyValue('--color-bg-code').trim();
  const readingFont = rootStyles.getPropertyValue('--font-reading').trim();
  const uiFont = rootStyles.getPropertyValue('--font-ui').trim();
  const codeFont = rootStyles.getPropertyValue('--font-code').trim();

  return `
    html,
    body {
      margin: 0 !important;
      padding: 0 !important;
      background: transparent !important;
      color: ${text} !important;
      font-family: ${readingFont} !important;
      line-height: 1.8 !important;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    body {
      padding: 24px 24px 28vh !important;
      box-sizing: border-box !important;
      word-break: break-word;
      font-size: 17px !important;
    }

    h1, h2, h3, h4, h5, h6 {
      color: ${heading} !important;
      font-family: ${readingFont} !important;
      line-height: 1.35 !important;
      margin: 1.8em 0 0.7em !important;
    }

    h1 { font-size: 1.85em !important; margin-top: 0 !important; }
    h2 { font-size: 1.45em !important; }
    h3 { font-size: 1.2em !important; }
    h4, h5, h6 { font-size: 1.05em !important; }

    p, li, blockquote, dd {
      line-height: 1.8 !important;
    }

    p {
      margin: 0 0 1.35em !important;
    }

    ul, ol {
      margin: 0 0 1.35em !important;
      padding-left: 1.5em !important;
    }

    li + li {
      margin-top: 0.35em !important;
    }

    a {
      color: ${accent} !important;
      text-decoration-thickness: 1px !important;
      text-underline-offset: 2px !important;
    }

    a:hover {
      color: ${accentHover} !important;
    }

    blockquote {
      margin: 1.8em 0 !important;
      padding: 16px 24px !important;
      border-left: 3px solid ${accent} !important;
      background: ${subtle} !important;
      color: ${secondary} !important;
    }

    pre,
    code,
    kbd,
    samp {
      font-family: ${codeFont} !important;
    }

    pre {
      background: ${code} !important;
      border: 1px solid ${border} !important;
      border-radius: 8px !important;
      padding: 16px !important;
      overflow: auto !important;
      line-height: 1.6 !important;
    }

    code {
      background: ${code} !important;
      border-radius: 6px !important;
      padding: 0.12em 0.35em !important;
    }

    pre code {
      background: transparent !important;
      padding: 0 !important;
    }

    img,
    svg,
    video {
      max-width: 100% !important;
      height: auto !important;
    }

    img {
      display: block !important;
      margin: 1.8em auto !important;
      border-radius: 10px !important;
    }

    hr {
      border: none !important;
      border-top: 1px solid ${border} !important;
      margin: 3em 0 !important;
    }

    table {
      width: 100% !important;
      border-collapse: collapse !important;
      margin: 1.6em 0 !important;
      font-family: ${uiFont} !important;
      font-size: 0.95em !important;
    }

    th,
    td {
      border: 1px solid ${border} !important;
      padding: 8px 12px !important;
      text-align: left !important;
    }

    th {
      background: ${subtle} !important;
      color: ${heading} !important;
    }

    figcaption {
      color: ${tertiary} !important;
      font-family: ${uiFont} !important;
      font-size: 0.9em !important;
      text-align: center !important;
    }
  `;
}

export function EpubReader({
  bookId,
  slug,
  onTocLoaded,
  onActiveAnchor,
  onProgressChange,
  theme,
}) {
  const [tocData, setTocData] = useState(null);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [displaying, setDisplaying] = useState(true);
  const [currentChapter, setCurrentChapter] = useState(null);
  const viewerRef = useRef(null);
  const bookRef = useRef(null);
  const renditionRef = useRef(null);
  const chaptersRef = useRef([]);
  const currentSlugRef = useRef(slug);
  const currentChapterRef = useRef(null);
  const displayTokenRef = useRef(0);

  useEffect(() => {
    currentSlugRef.current = slug;
  }, [slug]);

  const applyTheme = useCallback(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    rendition.themes.registerCss('gitshelf-reader', buildReaderThemeCss());
    rendition.themes.select('gitshelf-reader');
    rendition.themes.override('font-size', '17px');
  }, []);

  const displayChapter = useCallback(async (nextSlug, { preferStored = false } = {}) => {
    const rendition = renditionRef.current;
    const chapters = chaptersRef.current;
    if (!rendition || chapters.length === 0) return;

    const chapter = findChapterBySlug(chapters, nextSlug) || chapters[0];
    if (!chapter) return;

    if (currentChapterRef.current?.slug === chapter.slug) {
      setCurrentChapter(chapter);
      setDisplaying(false);
      return;
    }

    const stored = preferStored ? readStoredLocation(bookId) : null;
    const target = stored?.slug === chapter.slug && stored?.cfi ? stored.cfi : chapter.href;
    const token = displayTokenRef.current + 1;
    displayTokenRef.current = token;
    currentSlugRef.current = chapter.slug;
    currentChapterRef.current = chapter;
    setCurrentChapter(chapter);
    setDisplaying(true);
    onActiveAnchor?.(null);

    try {
      await rendition.display(target);
      const duplicateCandidates = findChapterCandidatesByHref(chapters, chapter.href);
      if (
        displayTokenRef.current === token &&
        !isCfiTarget(target) &&
        !normalizeHref(chapter.href).includes('#') &&
        duplicateCandidates.length > 1
      ) {
        const moved = await scrollChapterIntoView(rendition, chapter);
        if (moved) {
          rendition.reportLocation?.();
        }
      }
      if (displayTokenRef.current === token) {
        setDisplaying(false);
      }
    } catch (err) {
      if (displayTokenRef.current === token) {
        setError(err instanceof Error ? err.message : String(err));
        setDisplaying(false);
      }
    }
  }, [bookId, onActiveAnchor]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setReady(false);
    setDisplaying(true);
    setCurrentChapter(null);
    currentChapterRef.current = null;
    chaptersRef.current = [];
    onProgressChange?.(0);
    onActiveAnchor?.(null);

    fetchToc(bookId)
      .then((toc) => {
        if (cancelled) return;
        setTocData(toc);
        chaptersRef.current = flattenChapters(toc.children || []);
        onTocLoaded(toc);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [bookId, onActiveAnchor, onProgressChange, onTocLoaded]);

  useEffect(() => {
    if (!tocData || !viewerRef.current) return undefined;

    let cancelled = false;
    let rendition = null;
    let book = null;

    const handleRelocated = (location) => {
      if (!location?.start) return;

      const chapters = chaptersRef.current;
      const activeChapter = currentChapterRef.current || findChapterBySlug(chapters, currentSlugRef.current);
      const candidates = findChapterCandidatesByHref(chapters, location.start.href);
      const matchedChapter = candidates[0] || null;
      const exactActiveChapter = (
        activeChapter &&
        stripFragment(activeChapter.href) === stripFragment(location.start.href)
      ) ? activeChapter : null;
      const progress = Number.isFinite(location.start.percentage)
        ? Math.max(0, Math.min(100, location.start.percentage * 100))
        : 0;

      onProgressChange?.(progress);

      const storedChapter = exactActiveChapter || matchedChapter || activeChapter;
      if (storedChapter?.slug && location.start.cfi) {
        writeStoredLocation(bookId, {
          slug: storedChapter.slug,
          cfi: location.start.cfi,
        });
      }

      if (
        matchedChapter &&
        candidates.length === 1 &&
        matchedChapter.slug !== currentSlugRef.current &&
        stripFragment(matchedChapter.href) !== stripFragment(activeChapter?.href || '')
      ) {
        currentSlugRef.current = matchedChapter.slug;
        currentChapterRef.current = matchedChapter;
        setCurrentChapter(matchedChapter);
        replaceBookHash(bookId, matchedChapter.slug);
      }

      setDisplaying(false);
    };

    const handleRendered = (section) => {
      if (!section || !tocData) return;
      const matchedChapter = currentChapterRef.current || findChapterByHref(chaptersRef.current, section.href);
      const titleParts = [
        matchedChapter?.title,
        tocData.title || bookId,
        'GitShelf',
      ].filter(Boolean);
      document.title = titleParts.join(' \u00b7 ');
    };

    async function setupRendition() {
      try {
        const { default: ePub } = await import('epubjs');
        if (cancelled || !viewerRef.current) return;

        viewerRef.current.innerHTML = '';
        book = ePub(`./books/${encodeURIComponent(bookId)}/book.epub`);
        rendition = book.renderTo(viewerRef.current, {
          width: '100%',
          height: '100%',
          manager: 'continuous',
          flow: 'scrolled-doc',
          spread: 'none',
        });

        bookRef.current = book;
        renditionRef.current = rendition;
        rendition.on('relocated', handleRelocated);
        rendition.on('rendered', handleRendered);

        applyTheme();
        await book.ready;
        if (cancelled) return;
        setReady(true);

        book.locations.generate(LOCATION_GENERATE_CHARS)
          .then(() => rendition.reportLocation())
          .catch(() => {
            // Percentage progress is optional for older or unusual EPUB files.
          });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setDisplaying(false);
      }
    }

    setupRendition();

    return () => {
      cancelled = true;
      onProgressChange?.(0);
      setReady(false);
      if (rendition) {
        rendition.off('relocated', handleRelocated);
        rendition.off('rendered', handleRendered);
      }
      if (book) {
        book.destroy();
      }
      if (viewerRef.current) {
        viewerRef.current.innerHTML = '';
      }
      renditionRef.current = null;
      bookRef.current = null;
    };
  }, [applyTheme, bookId, onProgressChange, tocData]);

  useEffect(() => {
    applyTheme();
  }, [applyTheme, theme]);

  useEffect(() => {
    if (!ready || !tocData) return;
    displayChapter(slug, { preferStored: true });
  }, [displayChapter, ready, slug, tocData]);

  const chapters = tocData ? flattenChapters(tocData.children || []) : [];
  const currentIndex = currentChapter ? chapters.findIndex((chapter) => chapter.slug === currentChapter.slug) : -1;

  useEffect(() => {
    if (currentIndex === -1) return undefined;

    const onKeyDown = (event) => {
      const tag = event.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target.isContentEditable) return;
      if (event.key === 'ArrowLeft' && currentIndex > 0) {
        window.location.hash = `#/books/${encodeURIComponent(bookId)}/${encodeURIComponent(chapters[currentIndex - 1].slug)}`;
      } else if (event.key === 'ArrowRight' && currentIndex < chapters.length - 1) {
        window.location.hash = `#/books/${encodeURIComponent(bookId)}/${encodeURIComponent(chapters[currentIndex + 1].slug)}`;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bookId, chapters, currentIndex]);

  if (error) {
    return <div class="content-error view-enter">Failed to load: {error}</div>;
  }

  if (!tocData) {
    return <div class="reader-content view-enter" style={{ opacity: 0.5 }}>Loading EPUB...</div>;
  }

  return (
    <div class="epub-reader view-enter">
      <div class={`epub-reader-shell${displaying ? ' epub-reader-shell--loading' : ''}`}>
        <div class="epub-reader-frame" ref={viewerRef} />
        {displaying && <div class="epub-reader-loading">Loading chapter...</div>}
      </div>
      <ChapterNav
        bookId={bookId}
        chapters={chapters}
        currentIndex={currentIndex}
        wordCount={0}
      />
    </div>
  );
}
