export function ChapterNav({ bookId, chapters, currentIndex, wordCount }) {
  if (currentIndex === -1) return null;

  const prev = currentIndex > 0 ? chapters[currentIndex - 1] : null;
  const next = currentIndex < chapters.length - 1 ? chapters[currentIndex + 1] : null;
  const readingTime = wordCount > 0 ? Math.max(1, Math.ceil(wordCount / 250)) : 0;

  return (
    <nav class="chapter-nav" aria-label="Chapter navigation">
      {prev ? (
        <a class="chapter-nav-link chapter-nav-link--prev" href={`#/${bookId}/chapters/${prev.slug}`}>
          <span class="chapter-nav-label">Previous</span>
          <span class="chapter-nav-title">{prev.title}</span>
        </a>
      ) : (
        <div class="chapter-nav-placeholder chapter-nav-link--prev" aria-hidden="true" />
      )}

      <span class="chapter-nav-position">
        {currentIndex + 1} / {chapters.length}
        {readingTime > 0 && <span class="chapter-nav-reading-time"> · ~{readingTime} min</span>}
      </span>

      {next ? (
        <a class="chapter-nav-link chapter-nav-link--next" href={`#/${bookId}/chapters/${next.slug}`}>
          <span class="chapter-nav-label">Next</span>
          <span class="chapter-nav-title">{next.title}</span>
        </a>
      ) : (
        <div class="chapter-nav-placeholder chapter-nav-link--next" aria-hidden="true" />
      )}
    </nav>
  );
}
