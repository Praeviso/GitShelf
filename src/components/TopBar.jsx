import { useCallback } from 'preact/hooks';

function SunIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
      <circle cx="10" cy="10" r="4" />
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.93 4.93l1.41 1.41M13.66 13.66l1.41 1.41M4.93 15.07l1.41-1.41M13.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M17.39 12.24A7.5 7.5 0 0 1 7.76 2.61a7.5 7.5 0 1 0 9.63 9.63z" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="10" cy="10" r="2.5" />
      <path d="M16.47 12.2a1.33 1.33 0 0 0 .27 1.47l.05.05a1.61 1.61 0 1 1-2.28 2.28l-.05-.05a1.33 1.33 0 0 0-1.47-.27 1.33 1.33 0 0 0-.81 1.22v.14a1.61 1.61 0 1 1-3.22 0v-.07a1.33 1.33 0 0 0-.88-1.22 1.33 1.33 0 0 0-1.47.27l-.05.05a1.61 1.61 0 1 1-2.28-2.28l.05-.05a1.33 1.33 0 0 0 .27-1.47 1.33 1.33 0 0 0-1.22-.81h-.14a1.61 1.61 0 0 1 0-3.22h.07a1.33 1.33 0 0 0 1.22-.88 1.33 1.33 0 0 0-.27-1.47l-.05-.05a1.61 1.61 0 1 1 2.28-2.28l.05.05a1.33 1.33 0 0 0 1.47.27h.07a1.33 1.33 0 0 0 .81-1.22v-.14a1.61 1.61 0 1 1 3.22 0v.07a1.33 1.33 0 0 0 .81 1.22 1.33 1.33 0 0 0 1.47-.27l.05-.05a1.61 1.61 0 1 1 2.28 2.28l-.05.05a1.33 1.33 0 0 0-.27 1.47v.07a1.33 1.33 0 0 0 1.22.81h.14a1.61 1.61 0 0 1 0 3.22h-.07a1.33 1.33 0 0 0-1.22.81z" />
    </svg>
  );
}

export function TopBar({
  theme, onToggleTheme, breadcrumb, showBookshelfLink,
  showSidebarToggle, onToggleSidebar, sidebarExpanded,
  progress, showProgress,
}) {
  const themeLabel = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';

  return (
    <header class="top-bar">
      <div class="top-bar-left">
        {showSidebarToggle && (
          <button
            class="sidebar-toggle"
            type="button"
            aria-label="Open table of contents"
            aria-expanded={String(sidebarExpanded)}
            onClick={onToggleSidebar}
          >
            &#9776;
          </button>
        )}
        <a href="#/" class="top-bar-title">PDF2Book</a>
        {breadcrumb && <span class="top-bar-breadcrumb">{breadcrumb}</span>}
      </div>
      <div class="top-bar-right">
        <button class="theme-toggle" type="button" aria-label={themeLabel} onClick={onToggleTheme}>
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
        {showBookshelfLink && <a href="#/" class="top-bar-bookshelf-link">Bookshelf</a>}
        <a href="#/admin" class="admin-link" aria-label="Settings"><GearIcon /></a>
      </div>
      {showProgress && (
        <div class="reading-progress-bar" style={{ width: `${progress}%` }} />
      )}
    </header>
  );
}
