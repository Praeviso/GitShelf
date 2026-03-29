import { useState, useEffect } from 'preact/hooks';

function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseRoute(hash) {
  const rawPath = hash.split('#')[0];
  const path = rawPath.endsWith('/') && rawPath.length > 1 ? rawPath.slice(0, -1) : rawPath;
  const anchor = hash.includes('#') ? decodeSegment(hash.slice(hash.indexOf('#') + 1)) : null;

  if (path === '/' || path === '') return { type: 'home' };
  if (path === '/admin') return { type: 'admin' };

  // Book chapter: /books/{id}/{slug}
  const chapterMatch = path.match(/^\/books\/([^/]+)\/([^/]+)$/);
  if (chapterMatch) {
    return {
      type: 'chapter',
      bookId: decodeSegment(chapterMatch[1]),
      slug: decodeSegment(chapterMatch[2]),
      anchor,
    };
  }

  // Book overview: /books/{id}
  const bookMatch = path.match(/^\/books\/([^/]+)$/);
  if (bookMatch) return { type: 'book-overview', bookId: decodeSegment(bookMatch[1]) };

  // Article: /articles/{id}
  const articleMatch = path.match(/^\/articles\/([^/]+)$/);
  if (articleMatch) return { type: 'article', articleId: decodeSegment(articleMatch[1]), anchor };

  // Site: /sites/{id}
  const siteMatch = path.match(/^\/sites\/([^/]+)$/);
  if (siteMatch) return { type: 'site', siteId: decodeSegment(siteMatch[1]) };

  return { type: 'home' };
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
