import { useState, useEffect, useCallback } from 'preact/hooks';

const STORAGE_KEY = 'content-width';

const WIDTHS = ['narrow', 'medium', 'wide'];
const DEFAULT = 'medium';

function getInitial() {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  return WIDTHS.includes(stored) ? stored : DEFAULT;
}

export function useContentWidth() {
  const [width, setWidth] = useState(getInitial);

  useEffect(() => {
    document.documentElement.setAttribute('data-content-width', width);
  }, [width]);

  const cycleWidth = useCallback(() => {
    setWidth((prev) => {
      const idx = WIDTHS.indexOf(prev);
      const next = WIDTHS[(idx + 1) % WIDTHS.length];
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  return [width, cycleWidth];
}
