import { useState, useEffect } from 'preact/hooks';

function parseRoute(hash) {
  const rawPath = hash.split('#')[0];
  const path = rawPath.endsWith('/') && rawPath.length > 1 ? rawPath.slice(0, -1) : rawPath;
  const anchor = hash.includes('#') ? hash.slice(hash.indexOf('#') + 1) : null;

  if (path === '/') return { type: 'bookshelf' };
  if (path === '/admin') return { type: 'admin' };

  const chapterMatch = path.match(/^\/([^/]+)\/chapters\/([^/]+)$/);
  if (chapterMatch) {
    return { type: 'chapter', bookId: chapterMatch[1], slug: chapterMatch[2], anchor };
  }

  const bookMatch = path.match(/^\/([^/]+)$/);
  if (bookMatch) return { type: 'book', bookId: bookMatch[1] };

  return { type: 'bookshelf' };
}

export function useRouter() {
  const getRoute = () => {
    const hash = location.hash.slice(1) || '/';
    return parseRoute(hash);
  };

  const [route, setRoute] = useState(getRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(getRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return route;
}
