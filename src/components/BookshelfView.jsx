import { useState, useEffect } from 'preact/hooks';
import { fetchManifest } from '../lib/api';
import { BookCard } from './BookCard';

function SkeletonCard() {
  return (
    <div class="skeleton-card">
      <div class="skeleton-cover skeleton" />
      <div class="skeleton-info">
        <div class="skeleton-line skeleton-line--title skeleton" />
        <div class="skeleton-line skeleton" />
        <div class="skeleton-line skeleton-line--short skeleton" />
      </div>
    </div>
  );
}

function BookIcon() {
  return (
    <svg class="bookshelf-empty-icon" width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M8 6h10a4 4 0 0 1 4 4v28a3 3 0 0 0-3-3H8V6zM40 6H30a4 4 0 0 0-4 4v28a3 3 0 0 1 3-3h11V6z" />
    </svg>
  );
}

export function BookshelfView() {
  const [books, setBooks] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    document.title = 'Bookshelf \u00b7 PDF2Book';
    let cancelled = false;
    fetchManifest()
      .then((manifest) => { if (!cancelled) setBooks(manifest.books || []); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, []);

  // Listen for catalog updates
  useEffect(() => {
    const onUpdate = () => {
      setBooks(null);
      setError(null);
      fetchManifest()
        .then((manifest) => setBooks(manifest.books || []))
        .catch((err) => setError(err.message));
    };
    window.addEventListener('pdf2book:catalog-updated', onUpdate);
    return () => window.removeEventListener('pdf2book:catalog-updated', onUpdate);
  }, []);

  return (
    <section class="bookshelf-container view-enter">
      <h1 class="bookshelf-heading">Bookshelf</h1>

      {error && <div class="bookshelf-error">Failed to load bookshelf: {error}</div>}

      {!error && books === null && (
        <div class="bookshelf-grid">
          <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      )}

      {!error && books && books.length === 0 && (
        <div class="bookshelf-empty">
          <BookIcon />
          <h2>No books yet</h2>
          <p>Upload a PDF via the <a href="#/admin">admin panel</a> to get started.</p>
        </div>
      )}

      {!error && books && books.length > 0 && (
        <div class="bookshelf-grid">
          {books.map((book) => <BookCard key={book.id} book={book} />)}
        </div>
      )}
    </section>
  );
}
