import { useState, useEffect, useRef, useCallback } from 'preact/hooks';

function ChevronIcon() {
  return (
    <svg class="chevron" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
    </svg>
  );
}

function SidebarItem({ item, bookId, activeSlug, depth }) {
  const hasChildren = Array.isArray(item.children) && item.children.length > 0;
  const isActive = item.slug === activeSlug && !item.anchor;
  const containsActive = hasChildren && activeSlug && subtreeContainsSlug(item.children, activeSlug);
  const [collapsed, setCollapsed] = useState(!containsActive);

  useEffect(() => {
    if (containsActive) setCollapsed(false);
  }, [containsActive]);

  const href = item.anchor
    ? `#/books/${bookId}/${item.slug}#${item.anchor}`
    : item.slug
      ? `#/books/${bookId}/${item.slug}`
      : undefined;

  const nestedId = hasChildren ? `toc-section-${item.slug || depth}` : undefined;

  return (
    <li class={`sidebar-item${collapsed ? ' collapsed' : ''}${depth === 0 ? ' sidebar-item-top' : ''}`}>
      <div class="sidebar-item-row">
        {hasChildren && (
          <button
            type="button"
            class="sidebar-toggle-btn"
            aria-label={`Toggle section: ${item.title}`}
            aria-expanded={String(!collapsed)}
            aria-controls={nestedId}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCollapsed((c) => !c); }}
          >
            <ChevronIcon />
          </button>
        )}
        <a
          class={`sidebar-link${isActive ? ' active' : ''}`}
          href={href}
          aria-current={isActive ? 'page' : undefined}
        >
          {item.title}
        </a>
      </div>
      {hasChildren && (
        <div class={`sidebar-collapse${collapsed ? ' collapsed' : ''}`}>
          <ul class="sidebar-list sidebar-list-nested" id={nestedId}>
            {item.children.map((child, i) => (
              <SidebarItem key={child.slug || i} item={child} bookId={bookId} activeSlug={activeSlug} depth={depth + 1} />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

function subtreeContainsSlug(items, slug) {
  for (const item of items) {
    if (item.slug === slug) return true;
    if (item.children && subtreeContainsSlug(item.children, slug)) return true;
  }
  return false;
}

export function Sidebar({ tocData, bookId, activeSlug, open, onClose }) {
  const navRef = useRef(null);
  const scrollRef = useRef(null);
  const isDesktop = useIsDesktop();
  const visible = Boolean(tocData);
  const expanded = visible && (isDesktop || open);
  const showBackdrop = visible && !isDesktop;

  const [fadeTop, setFadeTop] = useState(false);
  const [fadeBottom, setFadeBottom] = useState(false);

  // Track scroll position for fade indicators
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const update = () => {
      const canScrollUp = el.scrollTop > 0;
      const canScrollDown = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      setFadeTop(canScrollUp);
      setFadeBottom(canScrollDown);
    };

    el.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    update();

    return () => {
      el.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [tocData]);

  // Auto-scroll to active item
  useEffect(() => {
    if (!scrollRef.current) return;
    const timer = setTimeout(() => {
      requestAnimationFrame(() => {
        const active = scrollRef.current?.querySelector('.sidebar-link.active');
        if (active) active.scrollIntoView({ block: 'center', behavior: 'auto' });
      });
    }, 50);
    return () => clearTimeout(timer);
  }, [activeSlug]);

  // Escape key closes sidebar on mobile
  useEffect(() => {
    if (!open || isDesktop) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, isDesktop, onClose]);

  return (
    <>
      <aside
        class={`sidebar${visible ? ' visible' : ''}${open ? ' open' : ''}`}
        id="sidebar"
        aria-hidden={String(!expanded)}
        tabIndex={-1}
      >
        {tocData && (
          <div class="sidebar-header">
            <span class="sidebar-book-title">Contents</span>
            <button
              type="button"
              class="sidebar-close-btn"
              aria-label="Close navigation"
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          </div>
        )}
        <div class="sidebar-scroll-area" ref={scrollRef}>
          <nav class="sidebar-nav" aria-label="Table of contents" ref={navRef}>
            {tocData && tocData.children && (
              <ul class="sidebar-list">
                {tocData.children.map((item, i) => (
                  <SidebarItem key={item.slug || i} item={item} bookId={bookId} activeSlug={activeSlug} depth={0} />
                ))}
              </ul>
            )}
          </nav>
        </div>
        <div class={`sidebar-fade sidebar-fade-top${fadeTop ? ' visible' : ''}`} />
        <div class={`sidebar-fade sidebar-fade-bottom${fadeBottom ? ' visible' : ''}`} />
      </aside>
      {showBackdrop && (
        <div
          class={`sidebar-backdrop${open ? ' visible' : ''}`}
          onClick={onClose}
          aria-hidden="true"
        />
      )}
    </>
  );
}

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return isDesktop;
}
