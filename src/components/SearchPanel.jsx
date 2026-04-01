import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { useBookSearch } from '../hooks/useBookSearch';

function SearchIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="8.5" cy="8.5" r="5.5" />
      <line x1="13" y1="13" x2="17" y2="17" />
    </svg>
  );
}

function HighlightedSnippet({ text, matchStart, matchLength }) {
  const before = text.slice(0, matchStart);
  const match = text.slice(matchStart, matchStart + matchLength);
  const after = text.slice(matchStart + matchLength);
  return (
    <span class="search-result-snippet">
      {before}<mark>{match}</mark>{after}
    </span>
  );
}

export function SearchPanel({ open, onClose, bookId, tocData }) {
  const { loading, loadProgress, query, setQuery, results, totalMatches, loadChapters } = useBookSearch(bookId, tocData);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [closing, setClosing] = useState(false);
  const inputRef = useRef(null);
  const resultsRef = useRef(null);

  // Load chapters and focus input when opening
  useEffect(() => {
    if (open) {
      setClosing(false);
      setSelectedIndex(-1);
      loadChapters();
      // Focus after paint
      requestAnimationFrame(() => inputRef.current?.focus());
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open, loadChapters]);

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(results.length > 0 ? 0 : -1);
  }, [results]);

  // Scroll active result into view
  useEffect(() => {
    if (selectedIndex < 0 || !resultsRef.current) return;
    const items = resultsRef.current.querySelectorAll('[role="option"]');
    items[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      onClose();
    }, 180);
  }, [onClose]);

  const navigateTo = useCallback((slug) => {
    location.hash = `#/books/${bookId}/${slug}`;
    onClose();
  }, [bookId, onClose]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
    } else if (e.key === 'Enter' && selectedIndex >= 0 && results[selectedIndex]) {
      e.preventDefault();
      navigateTo(results[selectedIndex].slug);
    }
  }, [handleClose, results, selectedIndex, navigateTo]);

  if (!open && !closing) return null;

  const showLoading = loading && loadProgress.total > 0;
  const showResults = !loading && query.length >= 2 && results.length > 0;
  const showEmpty = !loading && query.length >= 2 && results.length === 0;
  const showHint = !loading && query.length < 2;

  return (
    <div
      class={`search-overlay${closing ? ' search-overlay--closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Search this book"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
      onKeyDown={handleKeyDown}
    >
      <div class={`search-panel${closing ? ' search-panel--closing' : ''}`}>
        <div class="search-panel-header">
          <div class="search-input-row">
            <SearchIcon />
            <input
              ref={inputRef}
              class="search-input"
              type="search"
              placeholder="Search all chapters..."
              value={query}
              onInput={(e) => setQuery(e.target.value)}
              role="combobox"
              aria-expanded={showResults}
              aria-controls="search-results-list"
              aria-activedescendant={selectedIndex >= 0 ? `search-result-${selectedIndex}` : undefined}
              autocomplete="off"
            />
            <kbd class="search-shortcut-hint">Esc</kbd>
          </div>
          {showLoading && (
            <div class="search-loading-track">
              <div
                class="search-loading-bar"
                style={{ width: `${(loadProgress.loaded / loadProgress.total) * 100}%` }}
              />
            </div>
          )}
        </div>

        <div class="search-results" id="search-results-list" role="listbox" ref={resultsRef}>
          {showResults && results.map((r, i) => (
            <div
              key={`${r.slug}-${r.matchStart}-${i}`}
              id={`search-result-${i}`}
              class={`search-result-item${i === selectedIndex ? ' active' : ''}`}
              role="option"
              aria-selected={i === selectedIndex}
              onClick={() => navigateTo(r.slug)}
            >
              <div class="search-result-chapter">{r.chapterTitle}</div>
              <HighlightedSnippet text={r.text} matchStart={r.matchStart} matchLength={r.matchLength} />
            </div>
          ))}

          {showEmpty && (
            <div class="search-empty">No results for "{query}"</div>
          )}

          {showHint && (
            <div class="search-empty">Type to search across all chapters</div>
          )}

          {showLoading && (
            <div class="search-empty">
              Loading chapters... ({loadProgress.loaded}/{loadProgress.total})
            </div>
          )}
        </div>

        {showResults && (
          <div class="search-footer">
            <span>
              {totalMatches > results.length
                ? `Showing ${results.length} of ${totalMatches} matches`
                : `${totalMatches} match${totalMatches === 1 ? '' : 'es'}`}
            </span>
            <span class="search-footer-keys">
              <kbd>↑↓</kbd> navigate <kbd>↵</kbd> open
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
