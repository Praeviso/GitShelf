import { generateCoverGradient } from '../lib/covers';
import { getBookDisplayTitle, formatWordCount } from '../lib/api';

export function BookCard({ book }) {
  const title = getBookDisplayTitle(book);
  const byline = typeof book.author === 'string' ? book.author.trim() : '';
  const summary = typeof book.summary === 'string' ? book.summary.trim() : '';
  const tags = Array.isArray(book.tags)
    ? book.tags.map((t) => (typeof t === 'string' ? t.trim() : '')).filter(Boolean)
    : [];

  const metaParts = [];
  if (typeof book.chapters_count === 'number') {
    metaParts.push(`${book.chapters_count} chapter${book.chapters_count !== 1 ? 's' : ''}`);
  }
  if (typeof book.word_count === 'number') {
    metaParts.push(`${formatWordCount(book.word_count)} words`);
  }

  return (
    <a class="book-card" href={`#/${book.id}`}>
      <div
        class={`book-card-cover${book.featured ? ' book-card-cover--featured' : ''}`}
        style={{ background: generateCoverGradient(book.id) }}
      >
        <span class="book-card-cover-title">{title}</span>
      </div>
      <div class="book-card-info">
        {book.featured && <span class="book-card-badge">Featured</span>}
        <h2 class="book-card-title">{title}</h2>
        {byline && <p class="book-card-byline">{byline}</p>}
        {summary && <p class="book-card-summary">{summary}</p>}
        {metaParts.length > 0 && <div class="book-card-meta">{metaParts.join(' \u00b7 ')}</div>}
        {tags.length > 0 && (
          <ul class="book-card-tags">
            {tags.slice(0, 3).map((tag) => (
              <li key={tag} class="book-card-tag">{tag}</li>
            ))}
          </ul>
        )}
      </div>
    </a>
  );
}
