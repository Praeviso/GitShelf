import { useState, useEffect, useRef } from 'preact/hooks';
import { fetchText } from '../lib/api';
import { renderMarkdown, highlightCodeBlocks, addCopyButtons } from '../lib/markdown';

export function ArticleReader({ articleId }) {
  const [content, setContent] = useState(null);
  const [error, setError] = useState(null);
  const contentRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const text = await fetchText(`articles/${articleId}/content.md`);
        if (cancelled) return;

        const html = renderMarkdown(text, { assetBase: `articles/${articleId}` });
        setContent(html);

        // Extract title from first heading or use ID
        const titleMatch = text.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1].trim() : articleId;
        document.title = `${title} \u00b7 GitShelf`;
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          document.title = `${articleId} \u00b7 GitShelf`;
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [articleId]);

  // Highlight code blocks after render
  useEffect(() => {
    if (contentRef.current && content) {
      highlightCodeBlocks(contentRef.current).then(() => {
        addCopyButtons(contentRef.current);
      });
    }
  }, [content]);

  // Scroll to top on load
  useEffect(() => {
    if (content !== null) window.scrollTo(0, 0);
  }, [content]);

  // Heading anchor click to copy link
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const onClick = (e) => {
      const anchor = e.target.closest('.heading-anchor');
      if (!anchor) return;
      e.preventDefault();
      const id = anchor.dataset.anchor;
      const url = `${location.origin}${location.pathname}#/articles/${articleId}#${id}`;
      navigator.clipboard.writeText(url);
      const target = document.getElementById(id);
      if (target) {
        const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        target.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
      }
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [content, articleId]);

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

  if (error) {
    return <div class="content-error view-enter">Failed to load: {error}</div>;
  }

  if (content === null) {
    return <div class="reader-content view-enter" style={{ opacity: 0.5 }}>Loading...</div>;
  }

  return (
    <div class="view-enter">
      <nav class="article-breadcrumb">
        <a href="#/">GitShelf</a>
      </nav>
      <article
        class="reader-content"
        ref={contentRef}
        dangerouslySetInnerHTML={{ __html: content }}
      />
    </div>
  );
}
