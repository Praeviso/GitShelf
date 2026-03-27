import { signal } from '@preact/signals';

export const toasts = signal([]);

let nextId = 0;

export function showToast(message, type = 'info', duration = 4000) {
  const id = ++nextId;
  toasts.value = [...toasts.value, { id, message, type }];

  // Max 3 visible
  if (toasts.value.length > 3) {
    toasts.value = toasts.value.slice(-3);
  }

  setTimeout(() => dismissToast(id), duration);
}

export function dismissToast(id) {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}
