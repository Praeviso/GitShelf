import { useState, useEffect } from 'preact/hooks';
import { fetchManifest, getItemType } from '../lib/api';
import { ContentCard } from './ContentCard';

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

function EmptyIcon() {
  return (
    <svg class="home-empty-icon" width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M8 6h10a4 4 0 0 1 4 4v28a3 3 0 0 0-3-3H8V6zM40 6H30a4 4 0 0 0-4 4v28a3 3 0 0 1 3-3h11V6z" />
    </svg>
  );
}

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'book', label: 'Books' },
  { key: 'doc', label: 'Documents' },
  { key: 'site', label: 'Sites' },
];

const EMPTY_MESSAGES = {
  all: 'No content yet',
  book: 'No books yet',
  doc: 'No documents yet',
  site: 'No sites yet',
};

export function HomeView() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('all');

  useEffect(() => {
    document.title = 'GitShelf';
    let cancelled = false;
    fetchManifest()
      .then((manifest) => { if (!cancelled) setItems(manifest.items || []); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, []);

  // Listen for catalog updates
  useEffect(() => {
    const onUpdate = () => {
      setItems(null);
      setError(null);
      fetchManifest()
        .then((manifest) => setItems(manifest.items || []))
        .catch((err) => setError(err.message));
    };
    window.addEventListener('gitshelf:catalog-updated', onUpdate);
    return () => window.removeEventListener('gitshelf:catalog-updated', onUpdate);
  }, []);

  // Compute type counts
  const counts = { all: 0, book: 0, doc: 0, site: 0 };
  if (items) {
    counts.all = items.length;
    items.forEach((item) => {
      const type = getItemType(item);
      if (type in counts) counts[type]++;
    });
  }

  // Filter by active tab
  const filtered = items
    ? activeTab === 'all'
      ? items
      : items.filter((item) => getItemType(item) === activeTab)
    : null;

  // Only show tabs if more than one type exists
  const typesPresent = ['book', 'doc', 'site'].filter((t) => counts[t] > 0).length;
  const showTabs = typesPresent > 1;

  return (
    <section class="home-container view-enter">
      <p class="home-subtitle">Your personal reading shelf</p>

      {showTabs && (
        <div class="home-tabs" role="tablist">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              class={`home-tab${activeTab === key ? ' home-tab--active' : ''}`}
              role="tab"
              aria-selected={activeTab === key}
              onClick={() => setActiveTab(key)}
            >
              {label}{counts[key] > 0 ? ` (${counts[key]})` : ''}
            </button>
          ))}
        </div>
      )}

      {error && <div class="home-error">Failed to load: {error}</div>}

      {!error && filtered === null && (
        <div class="home-grid">
          <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      )}

      {!error && filtered && filtered.length === 0 && (
        <div class="home-empty">
          <EmptyIcon />
          <h2>{EMPTY_MESSAGES[activeTab]}</h2>
          <p>Upload content via the <a href="#/admin">admin panel</a> to get started.</p>
        </div>
      )}

      {!error && filtered && filtered.length > 0 && (
        <div class="home-grid">
          {filtered.map((item) => <ContentCard key={item.id} item={item} />)}
        </div>
      )}
    </section>
  );
}
