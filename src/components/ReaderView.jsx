import { useState, useEffect, useRef } from 'preact/hooks';
import { fetchToc, fetchText, fetchManifest, flattenChapters, getBookDisplayTitle } from '../lib/api';
import { renderMarkdown, highlightCodeBlocks, addCopyButtons } from '../lib/markdown';
import { ChapterNav } from './ChapterNav';
import { BookOverview } from './BookOverview';

// Note: markdown-it is configured with html:false, so raw HTML in markdown
// source is escaped. The rendered output contains only markdown-it's own
// safe HTML tags. This is the same trust model as the original vanilla JS app.

export function ReaderView({ bookId, slug, anchor, onTocLoaded }) {
  const [content, setContent] = useState(null);
  const [tocData, setTocData] = useState(null);
  const [bookMeta, setBookMeta] = useState(null);
  const [error, setError] = useState(null);
  const [wordCount, setWordCount] = useState(0);
  const contentRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (slug) {
          // Chapter view: load TOC + chapter markdown
          const [toc, text] = await Promise.all([
            fetchToc(bookId),
            fetchText(`books/${bookId}/chapters/${slug}.md`),
          ]);
          if (cancelled) return;

          setTocData(toc);
          setContent(renderMarkdown(text, { assetBase: `books/${bookId}` }));
          setWordCount(text.split(/\s+/).filter(Boolean).length);
          onTocLoaded(toc);

          const chapters = flattenChapters(toc.children || []);
          const chapter = chapters.find((c) => c.slug === slug && !c.anchor);
          const titleParts = [];
          if (chapter) titleParts.push(chapter.title);
          titleParts.push(toc.title || bookId);
          titleParts.push('PDF2Book');
          document.title = titleParts.join(' \u00b7 ');
        } else {
          // Book overview: load TOC + manifest for metadata
          const [toc, manifest] = await Promise.all([
            fetchToc(bookId),
            fetchManifest(),
          ]);
          if (cancelled) return;

          setTocData(toc);
          setContent('__overview__');
          const meta = manifest.books?.find((b) => b.id === bookId) || null;
          setBookMeta(meta);
          onTocLoaded(toc);

          document.title = `${toc.title || bookId} \u00b7 PDF2Book`;
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          document.title = `${bookId} \u00b7 PDF2Book`;
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [bookId, slug, onTocLoaded]);

  // Highlight code blocks and add copy buttons after content renders
  useEffect(() => {
    if (contentRef.current && content) {
      highlightCodeBlocks(contentRef.current).then(() => {
        addCopyButtons(contentRef.current);
      });
    }
  }, [content]);

  // Scroll to anchor or top
  useEffect(() => {
    if (content === null) return;
    if (anchor) {
      requestAnimationFrame(() => {
        const target = document.getElementById(anchor);
        if (target) {
          const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          target.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
        }
      });
    } else {
      window.scrollTo(0, 0);
    }
  }, [content, anchor]);

  // Heading anchor: click to copy link
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const onClick = (e) => {
      const anchor = e.target.closest('.heading-anchor');
      if (!anchor) return;
      e.preventDefault();
      const id = anchor.dataset.anchor;
      const hashPath = location.hash.slice(1).split('#')[0];
      const url = `${location.origin}${location.pathname}#${hashPath}#${id}`;
      navigator.clipboard.writeText(url);
      // Scroll to the heading
      const target = document.getElementById(id);
      if (target) {
        const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        target.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
      }
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [content]);

  // Image lightbox: click to zoom
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    function openLightbox(img) {
      const overlay = document.createElement('div');
      overlay.className = 'lightbox';

      // Close button (built with DOM API, no innerHTML)
      const closeBtn = document.createElement('button');
      closeBtn.className = 'lightbox-close';
      closeBtn.setAttribute('aria-label', 'Close lightbox');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '20');
      svg.setAttribute('height', '20');
      svg.setAttribute('viewBox', '0 0 20 20');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2');
      svg.setAttribute('stroke-linecap', 'round');
      const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      line1.setAttribute('d', 'M5 5l10 10');
      const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      line2.setAttribute('d', 'M15 5l-10 10');
      svg.appendChild(line1);
      svg.appendChild(line2);
      closeBtn.appendChild(svg);
      overlay.appendChild(closeBtn);

      const clone = document.createElement('img');
      clone.src = img.src;
      clone.alt = img.alt;
      overlay.appendChild(clone);

      function close() {
        overlay.classList.add('lightbox--closing');
        window.removeEventListener('keydown', onKey);
        overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
      }

      closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close(); });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      function onKey(e) { if (e.key === 'Escape') close(); }
      window.addEventListener('keydown', onKey);
      document.body.appendChild(overlay);
      closeBtn.focus();
    }

    const onClick = (e) => {
      if (e.target.tagName === 'IMG' && e.target.closest('.reader-content')) {
        openLightbox(e.target);
      }
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [content]);

  // Keyboard navigation: ← previous, → next chapter
  useEffect(() => {
    if (!slug || !tocData) return;
    const chapters = flattenChapters(tocData.children || []);
    const idx = chapters.findIndex((c) => c.slug === slug && !c.anchor);
    if (idx === -1) return;

    const onKeyDown = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      if (e.key === 'ArrowLeft' && idx > 0) {
        location.hash = `#/${bookId}/chapters/${chapters[idx - 1].slug}`;
      } else if (e.key === 'ArrowRight' && idx < chapters.length - 1) {
        location.hash = `#/${bookId}/chapters/${chapters[idx + 1].slug}`;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [slug, tocData, bookId]);

  if (error) {
    return <div class="content-error view-enter">Failed to load: {error}</div>;
  }

  if (content === null) {
    return <div class="reader-content view-enter" style={{ opacity: 0.5 }}>Loading...</div>;
  }

  // Book overview mode (no slug = book landing page)
  if (!slug && tocData) {
    return <BookOverview tocData={tocData} bookId={bookId} bookMeta={bookMeta} />;
  }

  const chapters = tocData ? flattenChapters(tocData.children || []) : [];
  const currentIndex = slug
    ? chapters.findIndex((c) => c.slug === slug && !c.anchor)
    : -1;

  return (
    <div class="view-enter">
      {/* markdown-it is configured with html:false — raw HTML is escaped.
          Rendered output is safe markdown-it HTML (same trust model as the
          original vanilla JS implementation that used insertAdjacentHTML). */}
      <article
        class="reader-content"
        ref={contentRef}
        dangerouslySetInnerHTML={{ __html: content }}
      />
      {slug && tocData && (
        <ChapterNav bookId={bookId} chapters={chapters} currentIndex={currentIndex} wordCount={wordCount} />
      )}
    </div>
  );
}
