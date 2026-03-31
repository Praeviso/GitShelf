import { useState, useEffect, useRef } from 'preact/hooks';
import { fetchToc, fetchText, flattenChapters } from '../lib/api';
import { renderMarkdown, highlightCodeBlocks, addCopyButtons } from '../lib/markdown';
import { ChapterNav } from './ChapterNav';

const TRANSITION_MS = 200;

export function ChapterReader({ bookId, slug, anchor, onTocLoaded, onActiveAnchor }) {
  const [content, setContent] = useState(null);
  const [tocData, setTocData] = useState(null);
  const [error, setError] = useState(null);
  const [wordCount, setWordCount] = useState(0);
  const [phase, setPhase] = useState('enter'); // 'enter' | 'idle' | 'exit'
  const contentRef = useRef(null);
  const prevSlugRef = useRef(slug);
  const pendingRef = useRef(null);

  // Detect slug change -> trigger exit -> load new content -> enter
  useEffect(() => {
    if (slug === prevSlugRef.current && content !== null) return;

    let cancelled = false;

    async function load() {
      try {
        const [toc, text] = await Promise.all([
          fetchToc(bookId),
          fetchText(`books/${bookId}/chapters/${slug}.md`),
        ]);
        if (cancelled) return;

        const html = renderMarkdown(text, { assetBase: `books/${bookId}` });
        const wc = text.split(/\s+/).filter(Boolean).length;

        const chapters = flattenChapters(toc.children || []);
        const chapter = chapters.find((c) => c.slug === slug && !c.anchor);
        const titleParts = [];
        if (chapter) titleParts.push(chapter.title);
        titleParts.push(toc.title || bookId);
        titleParts.push('GitShelf');
        document.title = titleParts.join(' \u00b7 ');

        // If we had previous content, play exit first
        if (content !== null && prevSlugRef.current !== slug) {
          pendingRef.current = { toc, html, wc };
          setPhase('exit');
        } else {
          // First load - just enter
          setTocData(toc);
          setContent(html);
          setWordCount(wc);
          onTocLoaded(toc);
          prevSlugRef.current = slug;
          setPhase('enter');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          document.title = `${bookId} \u00b7 GitShelf`;
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [bookId, slug]);

  // After exit animation ends, swap in new content
  useEffect(() => {
    if (phase !== 'exit') return;
    const timer = setTimeout(() => {
      const pending = pendingRef.current;
      if (pending) {
        setTocData(pending.toc);
        setContent(pending.html);
        setWordCount(pending.wc);
        onTocLoaded(pending.toc);
        pendingRef.current = null;
      }
      prevSlugRef.current = slug;
      setPhase('enter');
      window.scrollTo(0, 0);
    }, TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [phase, slug, onTocLoaded]);

  // After enter animation completes, go idle
  useEffect(() => {
    if (phase !== 'enter') return;
    const timer = setTimeout(() => setPhase('idle'), 350);
    return () => clearTimeout(timer);
  }, [phase]);

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
    if (content === null || phase === 'exit') return;
    if (anchor) {
      requestAnimationFrame(() => {
        const target = document.getElementById(anchor);
        if (target) {
          const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          target.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
        }
      });
    }
  }, [content, anchor, phase]);

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

  // Scroll-spy: track which heading the reader has scrolled past
  useEffect(() => {
    const el = contentRef.current;
    if (!el || !onActiveAnchor) return;

    const headings = Array.from(el.querySelectorAll('h2[id]'));
    if (!headings.length) return;

    const offset = 80;
    let ticking = false;

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        let active = null;
        for (const h of headings) {
          if (h.getBoundingClientRect().top <= offset) {
            active = h.id;
          } else {
            break;
          }
        }
        onActiveAnchor(active);
        ticking = false;
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [content, onActiveAnchor]);

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

  const transitionClass = phase === 'exit' ? ' chapter-exit' : phase === 'enter' ? ' chapter-enter' : '';

  return (
    <div class={transitionClass}>
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
