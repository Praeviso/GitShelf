import { useState, useEffect, useCallback } from 'preact/hooks';

export function useScrollProgress(enabled) {
  const [progress, setProgress] = useState(0);
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setProgress(0);
      setShowScrollTop(false);
      return;
    }

    let ticking = false;

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const scrollHeight = document.documentElement.scrollHeight;
        const clientHeight = document.documentElement.clientHeight;
        const max = scrollHeight - clientHeight;
        setProgress(max > 0 ? Math.min(100, Math.max(0, (scrollTop / max) * 100)) : 0);
        setShowScrollTop(scrollTop > 400);
        ticking = false;
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [enabled]);

  const scrollToTop = useCallback(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: prefersReduced ? 'auto' : 'smooth' });
  }, []);

  return { progress, showScrollTop, scrollToTop };
}
