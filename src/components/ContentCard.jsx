import { generateCoverGradient } from '../lib/covers';
import { getItemDisplayTitle, formatWordCount, getItemType, getItemHref, getItemTarget } from '../lib/api';

const TYPE_BADGES = {
  doc: 'DOC',
  site: 'SITE',
};

function ExternalLinkIcon() {
  return (
    <svg class="content-card-external" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 9v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4M9 3h4v4M6.5 9.5L14 2" />
    </svg>
  );
}

export function ContentCard({ item }) {
  const type = getItemType(item);
  const title = getItemDisplayTitle(item);
  const byline = typeof item.author === 'string' ? item.author.trim() : '';
  const summary = typeof item.summary === 'string' ? item.summary.trim() : '';
  const tags = Array.isArray(item.tags)
    ? item.tags.map((t) => (typeof t === 'string' ? t.trim() : '')).filter(Boolean)
    : [];

  const metaParts = [];
  if (type === 'book' && typeof item.chapters_count === 'number') {
    metaParts.push(`${item.chapters_count} chapter${item.chapters_count !== 1 ? 's' : ''}`);
  }
  if ((type === 'book' || type === 'doc') && typeof item.word_count === 'number') {
    metaParts.push(`${formatWordCount(item.word_count)} words`);
  }
  if (type === 'site') {
    metaParts.push('Static site');
  }

  const badge = TYPE_BADGES[type];
  const href = getItemHref(item);
  const target = getItemTarget(item);
  const rel = target === '_blank' ? 'noopener noreferrer' : undefined;

  return (
    <a class="content-card" href={href} target={target} rel={rel}>
      <div
        class={`content-card-cover${item.featured ? ' content-card-cover--featured' : ''}`}
        style={{ background: generateCoverGradient(item.id) }}
      >
        <span class="content-card-cover-title">{title}</span>
        {badge && <span class="content-card-type-badge">{badge}</span>}
        {type === 'site' && <ExternalLinkIcon />}
      </div>
      <div class="content-card-info">
        {item.featured && <span class="content-card-badge">Featured</span>}
        <h2 class="content-card-title">{title}</h2>
        {byline && <p class="content-card-byline">{byline}</p>}
        {summary && <p class="content-card-summary">{summary}</p>}
        {metaParts.length > 0 && <div class="content-card-meta">{metaParts.join(' \u00b7 ')}</div>}
        {tags.length > 0 && (
          <ul class="content-card-tags">
            {tags.slice(0, 3).map((tag) => (
              <li key={tag} class="content-card-tag">{tag}</li>
            ))}
          </ul>
        )}
      </div>
    </a>
  );
}
