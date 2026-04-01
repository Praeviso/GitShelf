import { useState, useEffect, useRef } from 'preact/hooks';

/**
 * Styled confirmation dialog replacing window.confirm / window.prompt.
 *
 * Props:
 *   open       — boolean, controls visibility
 *   title      — dialog heading
 *   children   — body content (JSX)
 *   confirmLabel — text for confirm button (default "Confirm")
 *   cancelLabel  — text for cancel button (default "Cancel")
 *   danger     — boolean, styles confirm button as destructive
 *   typeConfirm — string: if set, user must type this value to enable confirm
 *   typeConfirmHint — placeholder / label for the type-confirm input
 *   busy       — boolean, disables buttons and shows spinner on confirm
 *   onConfirm  — called when confirmed
 *   onCancel   — called when cancelled (overlay click, Escape, cancel button)
 */
export default function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  typeConfirm,
  typeConfirmHint,
  busy = false,
  onConfirm,
  onCancel,
}) {
  const [typed, setTyped] = useState('');
  const [closing, setClosing] = useState(false);
  const inputRef = useRef(null);
  const dialogRef = useRef(null);

  // Reset typed value when dialog opens/closes
  useEffect(() => {
    if (open) {
      setTyped('');
      setClosing(false);
    }
  }, [open]);

  // Focus management: focus input or confirm button when opened
  useEffect(() => {
    if (!open || closing) return;
    const timer = setTimeout(() => {
      if (typeConfirm && inputRef.current) {
        inputRef.current.focus();
      } else if (dialogRef.current) {
        const btn = dialogRef.current.querySelector('.dialog-btn-confirm');
        btn?.focus();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [open, closing, typeConfirm]);

  // Lock body scroll when open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closing]);

  if (!open && !closing) return null;

  const canConfirm = typeConfirm ? typed === typeConfirm : true;

  function handleClose() {
    if (busy) return;
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      onCancel?.();
    }, 180);
  }

  function handleConfirm() {
    if (!canConfirm || busy) return;
    onConfirm?.();
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) handleClose();
  }

  return (
    <div
      class={`dialog-overlay${closing ? ' dialog-overlay--closing' : ''}`}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
    >
      <div class={`dialog${closing ? ' dialog--closing' : ''}`} ref={dialogRef}>
        {title && <h2 class="dialog-title" id="dialog-title">{title}</h2>}
        <div class="dialog-body">{children}</div>

        {typeConfirm && (
          <div class="dialog-type-confirm">
            <label class="dialog-type-label">
              {typeConfirmHint || `Type "${typeConfirm}" to confirm`}
            </label>
            <input
              ref={inputRef}
              class="dialog-type-input"
              type="text"
              value={typed}
              onInput={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canConfirm) handleConfirm(); }}
              autocomplete="off"
              spellcheck={false}
            />
          </div>
        )}

        <div class="dialog-actions">
          <button
            class="btn btn-secondary"
            type="button"
            onClick={handleClose}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            class={`btn dialog-btn-confirm ${danger ? 'btn-danger' : 'btn-primary'}`}
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm || busy}
          >
            {busy ? <><span class="spinner" /> {confirmLabel}</> : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
