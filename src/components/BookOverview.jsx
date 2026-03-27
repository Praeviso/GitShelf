import { formatWordCount } from '../lib/api';

export function BookOverview({ tocData, bookId, bookMeta }) {
  if (!tocData || !tocData.children) return null;

  const items = tocData.children;
  const totalChapters = items.length;
  const wordCount = bookMeta?.word_count || 0;
  const firstChapter = items[0];

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
          <a class="book-overview-cta" href={`#/${bookId}/chapters/${firstChapter.slug}`}>
            Start Reading
          </a>
        )}
      </div>

      <ol class="book-overview-toc">
        {items.map((item) => (
          <li key={item.slug} class="book-overview-toc-item">
            <a class="book-overview-toc-link" href={`#/${bookId}/chapters/${item.slug}`}>
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
