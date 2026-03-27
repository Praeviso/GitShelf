import { toasts, dismissToast } from '../lib/toast';

function ToastIcon({ type }) {
  if (type === 'success') {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="9" cy="9" r="7.5" /><path d="M6 9l2 2 4-4" />
      </svg>
    );
  }
  if (type === 'error') {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <circle cx="9" cy="9" r="7.5" /><path d="M11.25 6.75l-4.5 4.5M6.75 6.75l4.5 4.5" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <circle cx="9" cy="9" r="7.5" /><path d="M9 12.75V9M9 5.25h0" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="M10.5 3.5l-7 7M3.5 3.5l7 7" />
    </svg>
  );
}

export function ToastContainer() {
  const items = toasts.value;
  if (items.length === 0) return null;

  return (
    <div class="toast-container" aria-live="polite" aria-atomic="false">
      {items.map((toast) => (
        <div key={toast.id} class={`toast toast--${toast.type}`}>
          <span class="toast-icon"><ToastIcon type={toast.type} /></span>
          <span class="toast-text">{toast.message}</span>
          <button type="button" class="toast-close" aria-label="Dismiss" onClick={() => dismissToast(toast.id)}>
            <CloseIcon />
          </button>
        </div>
      ))}
    </div>
  );
}
