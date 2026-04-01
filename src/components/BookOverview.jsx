import { useState, useEffect } from 'preact/hooks';
import { fetchToc, fetchManifest, formatWordCount } from '../lib/api';

export function BookOverview({ bookId, onTocLoaded }) {
  const [tocData, setTocData] = useState(null);
  const [bookMeta, setBookMeta] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [toc, manifest] = await Promise.all([
          fetchToc(bookId),
          fetchManifest(),
        ]);
        if (cancelled) return;

        setTocData(toc);
        const meta = manifest.items?.find((b) => b.id === bookId) || null;
        setBookMeta(meta);
        onTocLoaded(toc);

        document.title = `${toc.title || bookId} \u00b7 GitShelf`;
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          document.title = `${bookId} \u00b7 GitShelf`;
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [bookId, onTocLoaded]);

  if (error) {
    return <div class="content-error view-enter">Failed to load: {error}</div>;
  }

  if (!tocData || !tocData.children) {
    return <div class="reader-content view-enter" style={{ opacity: 0.5 }}>Loading...</div>;
  }

  const items = tocData.children;
  const totalChapters = items.length;
  const wordCount = bookMeta?.word_count || 0;
  const firstChapter = items[0];
  const encodedBookId = encodeURIComponent(bookId);

  return (
    <div class="book-overview view-enter">
      <div class="book-overview-header">
        <h1 class="book-overview-title">{tocData.title}</h1>
        <div class="book-overview-meta">
          <span>{totalChapters} chapters</span>
          {wordCount > 0 && <span>{formatWordCount(wordCount)} words</span>}
          {wordCount > 0 && <span>~{Math.ceil(wordCount / 250)} min read</span>}
        </div>
        {firstChapter && (
          <a class="book-overview-cta" href={`#/books/${encodedBookId}/${encodeURIComponent(firstChapter.slug)}`}>
            Start Reading
          </a>
        )}
      </div>

      <ol class="book-overview-toc">
        {items.map((item) => (
          <li key={item.slug} class="book-overview-toc-item">
            <a class="book-overview-toc-link" href={`#/books/${encodedBookId}/${encodeURIComponent(item.slug)}`}>
              <span class="book-overview-toc-title">{item.title}</span>
              {item.children && item.children.length > 0 && (
                <span class="book-overview-toc-count">{item.children.length} sections</span>
              )}
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}
