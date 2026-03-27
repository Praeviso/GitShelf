import { useState, useEffect, useCallback } from 'preact/hooks';

const THEME_KEY = 'theme';

function getInitialTheme() {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(THEME_KEY) : null;
  if (stored === 'dark' || stored === 'light') return stored;
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function useTheme() {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem(THEME_KEY, next);
      return next;
    });
  }, []);

  return [theme, toggleTheme];
}
