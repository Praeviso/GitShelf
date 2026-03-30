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

const WIDTH_LABELS = {
  narrow: 'Narrow width',
  medium: 'Medium width',
  wide: 'Wide width',
};

function WidthIcon({ width }) {
  // Three horizontal lines with varying lengths to indicate width
  const bars = { narrow: [6, 8, 6], medium: [8, 12, 8], wide: [12, 16, 12] };
  const b = bars[width] || bars.medium;
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
      <line x1={(20 - b[0]) / 2} y1="6" x2={(20 + b[0]) / 2} y2="6" />
      <line x1={(20 - b[1]) / 2} y1="10" x2={(20 + b[1]) / 2} y2="10" />
      <line x1={(20 - b[2]) / 2} y1="14" x2={(20 + b[2]) / 2} y2="14" />
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
  theme, onToggleTheme,
  contentWidth, onCycleContentWidth, showWidthToggle,
  breadcrumb, showHomeLink,
  showSidebarToggle, onToggleSidebar, sidebarExpanded,
  progress, showProgress,
}) {
  const themeLabel = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  const widthLabel = WIDTH_LABELS[contentWidth] || 'Content width';

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
        <a href="#/" class="top-bar-title">GitShelf</a>
        {breadcrumb && <span class="top-bar-breadcrumb">{breadcrumb}</span>}
      </div>
      <div class="top-bar-right">
        {showWidthToggle && (
          <button class="width-toggle" type="button" aria-label={widthLabel} title={widthLabel} onClick={onCycleContentWidth}>
            <WidthIcon width={contentWidth} />
          </button>
        )}
        <button class="theme-toggle" type="button" aria-label={themeLabel} onClick={onToggleTheme}>
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
        {showHomeLink && <a href="#/" class="top-bar-home-link">Home</a>}
        <a href="#/admin" class="admin-link" aria-label="Settings"><GearIcon /></a>
      </div>
      {showProgress && (
        <div class="reading-progress-bar" style={{ width: `${progress}%` }} />
      )}
    </header>
  );
}
