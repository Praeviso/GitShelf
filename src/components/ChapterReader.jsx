import { useState, useEffect, useRef } from 'preact/hooks';
import { fetchToc, fetchText, flattenChapters } from '../lib/api';
import { renderMarkdown, highlightCodeBlocks, addCopyButtons } from '../lib/markdown';
import { ChapterNav } from './ChapterNav';

export function ChapterReader({ bookId, slug, anchor, onTocLoaded }) {
  const [content, setContent] = useState(null);
  const [tocData, setTocData] = useState(null);
  const [error, setError] = useState(null);
  const [wordCount, setWordCount] = useState(0);
  const contentRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
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
        titleParts.push('GitShelf');
        document.title = titleParts.join(' \u00b7 ');
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          document.title = `${bookId} \u00b7 GitShelf`;
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [bookId, slug, onTocLoaded]);

  // Highlight code blocks
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
      const anchorEl = e.target.closest('.heading-anchor');
      if (!anchorEl) return;
      e.preventDefault();
      const id = anchorEl.dataset.anchor;
      const hashPath = location.hash.slice(1).split('#')[0];
      const url = `${location.origin}${location.pathname}#${hashPath}#${id}`;
      navigator.clipboard.writeText(url);
      const target = document.getElementById(id);
      if (target) {
        const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        target.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
      }
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [content]);

  // Image lightbox
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    function openLightbox(img) {
      const overlay = document.createElement('div');
      overlay.className = 'lightbox';
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

  // Keyboard navigation
  useEffect(() => {
    if (!slug || !tocData) return;
    const chapters = flattenChapters(tocData.children || []);
    const idx = chapters.findIndex((c) => c.slug === slug && !c.anchor);
    if (idx === -1) return;

      const onKeyDown = (e) => {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
        if (e.key === 'ArrowLeft' && idx > 0) {
          location.hash = `#/books/${encodeURIComponent(bookId)}/${encodeURIComponent(chapters[idx - 1].slug)}`;
        } else if (e.key === 'ArrowRight' && idx < chapters.length - 1) {
          location.hash = `#/books/${encodeURIComponent(bookId)}/${encodeURIComponent(chapters[idx + 1].slug)}`;
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

  const chapters = tocData ? flattenChapters(tocData.children || []) : [];
  const currentIndex = chapters.findIndex((c) => c.slug === slug && !c.anchor);

  return (
    <div class="view-enter">
      <article
        class="reader-content"
        ref={contentRef}
        dangerouslySetInnerHTML={{ __html: content }}
      />
      {tocData && (
        <ChapterNav bookId={bookId} chapters={chapters} currentIndex={currentIndex} wordCount={wordCount} />
      )}
    </div>
  );
}
