export function ScrollToTop({ visible, onClick }) {
  return (
    <button
      class={`scroll-top-btn${visible ? ' visible' : ''}`}
      type="button"
      aria-label="Scroll to top"
      hidden={!visible}
      onClick={onClick}
    >
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 16V4M4 10l6-6 6 6" />
      </svg>
    </button>
  );
}
