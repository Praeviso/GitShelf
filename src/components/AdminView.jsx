import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { showToast } from '../lib/toast';
import ConfirmDialog from './ConfirmDialog';
import {
  getPat, setPat, clearPat, verifyPat, detectRepo, saveRepo,
  getSplitLevel, fetchCatalog, persistCatalog, deepCloneBooks,
  uploadPdf as apiUploadPdf, triggerReconvert, deleteBookPermanently,
  saveSplitLevelConfig, loadHistory, fetchFailures, dismissFailure, retryFailure,
  getDisplayTitle, normalizeVisibility,
  normalizeTags, parseTagsInput, formatBytes, dateFormatter, dateTimeFormatter,
  numberFormatter, MAX_FILE_SIZE, VISIBILITY_VALUES, toIsoNow,
} from '../lib/github-api';

// --- Auth View ---
function AuthView({ onAuthenticated }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!token.trim()) { setError('Enter a GitHub PAT with repo scope.'); return; }
    setLoading(true); setError('');
    try {
      setPat(token.trim());
      await verifyPat();
      onAuthenticated();
    } catch (err) {
      clearPat(); setError(err.message);
    } finally { setLoading(false); }
  };

  return (
    <div class="admin-auth">
      <h2>GitHub Authentication</h2>
      <p>Enter a Personal Access Token with <strong>repo</strong> scope.</p>
      <form onSubmit={handleSubmit}>
        <div class="admin-input-group">
          <input type="password" class="admin-pat-input" value={token} onInput={(e) => setToken(e.target.value)} placeholder="ghp_…" autocomplete="off" aria-label="GitHub Personal Access Token" />
          <button class="btn btn-primary" type="submit" disabled={loading}>
            {loading ? <><span class="spinner" /> Verifying…</> : 'Save Token'}
          </button>
        </div>
      </form>
      {error && <p class="admin-error">{error}</p>}
      <p><a class="admin-text-link" href="https://github.com/settings/tokens/new?scopes=repo&description=PDF2Book%20Admin" target="_blank" rel="noopener noreferrer">Create a new token on GitHub</a></p>
    </div>
  );
}

// --- Upload Section ---
function UploadSection({ repo, disabled }) {
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  let dragCounter = 0;

  const handleFile = async (file) => {
    if (!file || disabled) return;
    setError('');
    if (!file.name.toLowerCase().endsWith('.pdf')) { setError('Only .pdf files are accepted.'); return; }
    if (file.size > MAX_FILE_SIZE) { setError(`File too large (${formatBytes(file.size)}). Max 100 MB.`); return; }
    try {
      await apiUploadPdf(file, repo, (stage, msg) => setProgress({ stage, msg }));
      setProgress({ stage: 'done', msg: 'uploaded', filename: file.name });
      showToast('PDF uploaded successfully', 'success');
    } catch (err) { setError(err.message); setProgress({ stage: 'error', msg: 'Upload failed.' }); }
  };

  const toneMap = { reading: 'info', committing: 'info', done: 'success', error: 'error' };
  const actionsUrl = repo.owner && repo.name ? `https://github.com/${repo.owner}/${repo.name}/actions` : null;

  return (
    <section class="admin-upload">
      <h2>Upload PDF</h2>
      {disabled ? (
        <div class="upload-dropzone upload-dropzone--disabled">
          <svg class="upload-dropzone-icon" width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M32 32l-8-8-8 8M24 24v18M40.78 37.09A10 10 0 0 0 36 18h-2.52A16 16 0 1 0 8 32.29" />
          </svg>
          <div class="upload-dropzone-text">Configure repository first</div>
        </div>
      ) : (
        <div
          class={`upload-dropzone${dragOver ? ' upload-dropzone--dragover' : ''}`}
          role="button"
          tabIndex="0"
          aria-label="Upload PDF file"
          onClick={() => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.pdf'; i.onchange = () => handleFile(i.files[0]); i.click(); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); }}}
          onDragEnter={(e) => { e.preventDefault(); dragCounter++; setDragOver(true); }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => { e.preventDefault(); dragCounter--; if (dragCounter <= 0) { dragCounter = 0; setDragOver(false); }}}
          onDrop={(e) => { e.preventDefault(); dragCounter = 0; setDragOver(false); handleFile(e.dataTransfer?.files?.[0]); }}
        >
          <svg class="upload-dropzone-icon" width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M32 32l-8-8-8 8M24 24v18M40.78 37.09A10 10 0 0 0 36 18h-2.52A16 16 0 1 0 8 32.29" />
          </svg>
          <div class="upload-dropzone-text">Drop PDF here or click to browse</div>
          <div class="upload-dropzone-hint">Maximum 100 MB</div>
        </div>
      )}
      {progress && progress.stage === 'done' && actionsUrl ? (
        <div class="upload-progress upload-progress--success">
          <strong>{progress.filename}</strong> uploaded. A GitHub Action is now converting it.{' '}
          <a class="upload-progress-link" href={actionsUrl} target="_blank" rel="noopener noreferrer">View conversion progress</a>
        </div>
      ) : progress ? (
        <div class={`upload-progress upload-progress--${toneMap[progress.stage] || 'info'}`}>{progress.msg}</div>
      ) : null}
      {error && <p class="admin-error">{error}</p>}
    </section>
  );
}

// --- Failures Section ---
function FailuresSection({ repo }) {
  const [failures, setFailures] = useState([]);
  const [loading, setLoading] = useState(true);
  const repoReady = Boolean(repo.owner && repo.name);

  const load = useCallback(async () => {
    if (!repoReady) return;
    setLoading(true);
    try { setFailures(await fetchFailures(repo)); }
    catch { setFailures([]); }
    finally { setLoading(false); }
  }, [repo, repoReady]);

  useEffect(() => { load(); }, [load]);

  // Listen for catalog updates (e.g. after upload triggers a new conversion)
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('pdf2book:catalog-updated', handler);
    return () => window.removeEventListener('pdf2book:catalog-updated', handler);
  }, [load]);

  if (!repoReady) return null;

  if (loading) return (
    <section class="admin-failures">
      <h2>Failed Conversions</h2>
      <div class="admin-skeleton-failures">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} class="admin-skeleton-failure-row">
            <div class="admin-skeleton-failure-info">
              <div class="skeleton admin-skeleton-failure-name" />
              <div class="skeleton admin-skeleton-failure-msg" />
            </div>
            <div class="skeleton admin-skeleton-actions" />
          </div>
        ))}
      </div>
    </section>
  );

  if (failures.length === 0) return null;

  const handleRetry = async (filename) => {
    try {
      await retryFailure(repo, filename);
      showToast('Re-conversion triggered', 'info');
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleDismiss = async (filename) => {
    try {
      await dismissFailure(repo, filename);
      setFailures((prev) => prev.filter((f) => f.filename !== filename));
      showToast('Failure dismissed', 'success');
    } catch (err) { showToast(err.message, 'error'); }
  };

  return (
    <section class="admin-failures">
      <h2>Failed Conversions</h2>
      <div class="admin-failures-list">
        {failures.map((f) => (
          <div key={f.filename} class="admin-failure-row">
            <div class="admin-failure-info">
              <span class="admin-failure-filename">{f.filename}</span>
              <span class="admin-failure-error">{f.error}</span>
              {f.failed_at && <span class="admin-book-subtle">{dateTimeFormatter.format(new Date(f.failed_at))}</span>}
            </div>
            <div class="admin-actions">
              <button class="btn btn-secondary btn-sm" onClick={() => handleRetry(f.filename)}>Retry</button>
              <button class="btn btn-ghost-danger btn-sm" onClick={() => handleDismiss(f.filename)}>Dismiss</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// --- Book Editor ---
function BookEditor({ book, onSave, onCancel }) {
  const [form, setForm] = useState({
    display_title: book.display_title || '',
    author: book.author || '',
    summary: book.summary || '',
    tags: (book.tags || []).join(', '),
    manual_order: book.manual_order != null ? String(book.manual_order) : '',
    visibility: normalizeVisibility(book.visibility),
    featured: Boolean(book.featured),
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const handleSave = async () => {
    setError('');
    const mo = form.manual_order.trim();
    if (mo !== '' && (!Number.isInteger(Number(mo)) || Number(mo) < 0)) {
      setError('Manual order must be a whole number >= 0.'); return;
    }
    setSaving(true);
    try {
      await onSave({
        ...book,
        display_title: form.display_title.trim(),
        author: form.author.trim(),
        summary: form.summary.trim(),
        tags: parseTagsInput(form.tags),
        manual_order: mo === '' ? null : Math.trunc(Number(mo)),
        visibility: form.visibility,
        featured: form.featured,
        updated_at: toIsoNow(),
      });
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  return (
    <div class="admin-book-editor">
      <div class="admin-book-editor-grid">
        <label class="admin-input-stack">
          <span class="admin-label">Display Title</span>
          <input class="admin-text-input" value={form.display_title} onInput={set('display_title')} autocomplete="off" />
        </label>
        <label class="admin-input-stack">
          <span class="admin-label">Author</span>
          <input class="admin-text-input" value={form.author} onInput={set('author')} autocomplete="off" />
        </label>
        <label class="admin-input-stack" style={{ gridColumn: '1 / -1' }}>
          <span class="admin-label">Summary</span>
          <textarea class="admin-textarea" rows="3" value={form.summary} onInput={set('summary')} />
        </label>
        <label class="admin-input-stack">
          <span class="admin-label">Tags (comma-separated)</span>
          <input class="admin-text-input" value={form.tags} onInput={set('tags')} autocomplete="off" />
        </label>
        <label class="admin-input-stack">
          <span class="admin-label">Manual Order</span>
          <input class="admin-text-input" type="number" min="0" step="1" value={form.manual_order} onInput={set('manual_order')} />
        </label>
        <label class="admin-input-stack">
          <span class="admin-label">Visibility</span>
          <select class="admin-select" value={form.visibility} onChange={set('visibility')}>
            {VISIBILITY_VALUES.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <div class="admin-input-stack">
          <label class="admin-checkbox-line">
            <input type="checkbox" class="admin-checkbox" checked={form.featured} onChange={set('featured')} />
            Featured
          </label>
        </div>
      </div>
      {error && <p class="admin-error">{error}</p>}
      <div class="admin-book-editor-actions">
        <button class="btn btn-primary btn-sm" type="button" onClick={handleSave} disabled={saving}>
          {saving ? <><span class="spinner" /> Saving…</> : 'Save'}
        </button>
        <button class="btn btn-secondary btn-sm" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// --- Action Menu (overflow dropdown) ---
function ActionMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [open]);

  return (
    <div class="action-menu" ref={ref}>
      <button class="btn btn-secondary btn-sm btn-icon" onClick={() => setOpen(!open)} aria-label="More actions" title="More actions">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="8" cy="3" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="8" cy="13" r="1.5" />
        </svg>
      </button>
      {open && (
        <div class="action-menu-dropdown">
          {items.map((item, i) =>
            item.separator
              ? <div key={i} class="action-menu-divider" />
              : <button key={i} class={`action-menu-item${item.danger ? ' action-menu-item--danger' : ''}`} onClick={() => { setOpen(false); item.onClick(); }}>
                  {item.label}
                </button>
          )}
        </div>
      )}
    </div>
  );
}

// --- Catalog Section ---
function CatalogSection({ repo }) {
  const [catalog, setCatalog] = useState([]);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [visFilter, setVisFilter] = useState('all');
  const [sort, setSort] = useState('public_order');
  const [selected, setSelected] = useState(new Set());
  const [editingId, setEditingId] = useState(null);
  const [bulkError, setBulkError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const repoReady = Boolean(repo.owner && repo.name);

  const load = useCallback(async () => {
    if (!repoReady) return;
    setLoading(true); setError('');
    try {
      const result = await fetchCatalog(repo);
      setCatalog(result.books); setNotice(result.notice);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [repo, repoReady]);

  useEffect(() => { load(); }, [load]);

  const filtered = catalog.filter((b) => {
    if (visFilter !== 'all' && normalizeVisibility(b.visibility) !== visFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return [b.id, b.title, b.display_title, b.author, b.summary, b.source_pdf, ...(b.tags || [])].some((f) => String(f || '').toLowerCase().includes(q));
    }
    return true;
  }).sort((a, b) => {
    if (sort === 'updated_desc') return (b.updated_at || '').localeCompare(a.updated_at || '');
    if (sort === 'created_desc') return (b.created_at || '').localeCompare(a.created_at || '');
    if (sort === 'title_asc') return getDisplayTitle(a).localeCompare(getDisplayTitle(b));
    if (sort === 'words_desc') return (b.word_count || 0) - (a.word_count || 0);
    return 0; // public_order — default
  });

  const toggleSelect = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected((s) => s.size === filtered.length ? new Set() : new Set(filtered.map((b) => b.id)));

  const bulkVisibility = async (vis) => {
    if (selected.size === 0) { setBulkError('Select at least one book.'); return; }
    setBulkError('');
    const next = deepCloneBooks(catalog).map((b) => selected.has(b.id) ? { ...b, visibility: vis, updated_at: toIsoNow() } : b);
    try {
      await persistCatalog(repo, next, `chore(admin): bulk set visibility=${vis} (${selected.size} books)`);
      setCatalog(next); setSelected(new Set());
      showToast(`${selected.size} book${selected.size > 1 ? 's' : ''} set to ${vis}`, 'success');
    } catch (err) { setBulkError(err.message); }
  };

  const handleSaveBook = async (updated) => {
    const next = deepCloneBooks(catalog).map((b) => b.id === updated.id ? updated : b);
    await persistCatalog(repo, next, `chore(admin): update catalog metadata for ${updated.id}`);
    setCatalog(next); setEditingId(null);
    showToast('Metadata saved', 'success');
  };

  const handleReconvert = async (book) => {
    await triggerReconvert(book, repo);
    showToast('Re-conversion triggered', 'info');
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const next = await deleteBookPermanently(deleteTarget, repo, catalog);
      setCatalog(next); setSelected((s) => { const n = new Set(s); n.delete(deleteTarget.id); return n; });
      setEditingId(null);
      setDeleteTarget(null);
      showToast('Book deleted permanently', 'success');
    } catch (err) { showToast(err.message, 'error'); }
    finally { setDeleting(false); }
  };

  const quickVisibilityChange = async (book) => {
    const cycle = { published: 'hidden', hidden: 'archived', archived: 'published' };
    const nextVis = cycle[normalizeVisibility(book.visibility)];
    const next = deepCloneBooks(catalog).map((b) => b.id === book.id ? { ...b, visibility: nextVis, updated_at: toIsoNow() } : b);
    try {
      await persistCatalog(repo, next, `chore(admin): set visibility=${nextVis} for ${book.id}`);
      setCatalog(next);
      showToast(`"${getDisplayTitle(book)}" set to ${nextVis}`, 'success');
    } catch (err) { showToast(err.message, 'error'); }
  };

  const counts = { total: catalog.length, published: 0, hidden: 0, archived: 0 };
  catalog.forEach((b) => { const v = normalizeVisibility(b.visibility); if (counts[v] != null) counts[v]++; });

  if (!repoReady) return <section class="admin-books"><h2>Book Catalog</h2><div class="admin-empty-state">Configure repository to view catalog.</div></section>;
  if (loading) return (
    <section class="admin-books">
      <h2>Book Catalog</h2>
      <div class="admin-skeleton-table">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} class="admin-skeleton-row">
            <div class="skeleton admin-skeleton-check" />
            <div class="skeleton admin-skeleton-title" />
            <div class="skeleton admin-skeleton-pill" />
            <div class="skeleton admin-skeleton-text" />
            <div class="skeleton admin-skeleton-text admin-skeleton-text--short" />
            <div class="skeleton admin-skeleton-actions" />
          </div>
        ))}
      </div>
    </section>
  );
  if (error) return <section class="admin-books"><h2>Book Catalog</h2><p class="admin-error">{error}</p></section>;

  return (
    <section class="admin-books">
      <h2>Book Catalog</h2>
      {notice && <div class="admin-repo-banner">{notice}</div>}

      <div class="admin-summary-pills" role="status">
        <div class="admin-summary-pill">
          <span class="admin-summary-pill-count">{counts.total}</span>
          <span class="admin-summary-pill-label">Total</span>
        </div>
        <div class="admin-summary-pill admin-summary-pill--published">
          <span class="admin-summary-pill-count">{counts.published}</span>
          <span class="admin-summary-pill-label">Published</span>
        </div>
        <div class="admin-summary-pill admin-summary-pill--hidden">
          <span class="admin-summary-pill-count">{counts.hidden}</span>
          <span class="admin-summary-pill-label">Hidden</span>
        </div>
        <div class="admin-summary-pill admin-summary-pill--archived">
          <span class="admin-summary-pill-count">{counts.archived}</span>
          <span class="admin-summary-pill-label">Archived</span>
        </div>
      </div>

      <div class="admin-catalog-toolbar">
        <input type="search" class="admin-text-input" placeholder="Search…" value={search} onInput={(e) => setSearch(e.target.value)} aria-label="Search books" />
        <select class="admin-select" value={visFilter} onChange={(e) => setVisFilter(e.target.value)} aria-label="Filter by visibility">
          <option value="all">All</option>
          {VISIBILITY_VALUES.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select class="admin-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort order">
          <option value="public_order">Featured + Manual Order</option>
          <option value="updated_desc">Recently Updated</option>
          <option value="created_desc">Recently Converted</option>
          <option value="title_asc">Title A-Z</option>
          <option value="words_desc">Word Count</option>
        </select>
        <button class="btn btn-secondary btn-icon" type="button" onClick={load} aria-label="Refresh catalog" title="Refresh">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M1.5 8a6.5 6.5 0 0 1 11.25-4.5M14.5 8a6.5 6.5 0 0 1-11.25 4.5" />
            <path d="M13.5 1v3.5H10M2.5 15v-3.5H6" />
          </svg>
        </button>
      </div>

      {(search || visFilter !== 'all') && (
        <p class="admin-result-count">Showing {filtered.length} of {catalog.length} book{catalog.length !== 1 ? 's' : ''}</p>
      )}

      {selected.size > 0 && (
        <div class="admin-bulk-bar">
          <span>{selected.size} selected</span>
          <button class="btn btn-secondary" onClick={() => bulkVisibility('published')}>Publish</button>
          <button class="btn btn-secondary" onClick={() => bulkVisibility('hidden')}>Hide</button>
          <button class="btn btn-secondary" onClick={() => bulkVisibility('archived')}>Archive</button>
          <button class="btn btn-secondary" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      {bulkError && <p class="admin-error">{bulkError}</p>}

      {filtered.length === 0 ? (
        <div class="admin-empty-state">
          {catalog.length === 0 ? (
            <>
              <svg class="admin-empty-icon" width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M8 6h10a4 4 0 0 1 4 4v28a3 3 0 0 0-3-3H8V6zM40 6H30a4 4 0 0 0-4 4v28a3 3 0 0 1 3-3h11V6z" />
              </svg>
              <p class="admin-empty-text">No books yet. Upload a PDF to get started.</p>
            </>
          ) : (
            <>
              <svg class="admin-empty-icon" width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="20" cy="20" r="14" /><path d="M38 38l-8-8" />
              </svg>
              <p class="admin-empty-text">No books match the current filters.</p>
            </>
          )}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div class="admin-books-list">
            <table class="admin-table admin-catalog-table">
              <thead>
                <tr>
                  <th style={{ width: '40px' }}><input type="checkbox" class="admin-checkbox" checked={selected.size === filtered.length && filtered.length > 0} indeterminate={selected.size > 0 && selected.size < filtered.length} onChange={toggleAll} aria-label="Select all books" /></th>
                  <th>Title</th><th style={{ width: '96px' }}>Lifecycle</th><th style={{ width: '240px' }}>Provenance</th><th style={{ width: '120px' }}>Stats</th><th style={{ width: '112px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((book) => (
                  <>
                    <tr key={book.id}>
                      <td><input type="checkbox" class="admin-checkbox" checked={selected.has(book.id)} onChange={() => toggleSelect(book.id)} aria-label={`Select ${getDisplayTitle(book)}`} /></td>
                      <td>
                        <div class="admin-book-title-wrap">
                          <a class="admin-book-title-link" href={`#/${encodeURIComponent(book.id)}`}>{getDisplayTitle(book)}</a>
                          {book.author && <span class="admin-book-subtle">{book.author}</span>}
                          <span class="admin-book-subtle">id: {book.id}</span>
                          {book.tags && book.tags.length > 0 && (
                            <div class="admin-tag-list">
                              {book.tags.slice(0, 4).map((t) => <span key={t} class="admin-tag">{t}</span>)}
                              {book.tags.length > 4 && <span class="admin-tag">+{book.tags.length - 4}</span>}
                            </div>
                          )}
                        </div>
                      </td>
                      <td>
                        <button class="admin-state-pill-btn" onClick={() => quickVisibilityChange(book)} title={`Click to cycle visibility (currently ${normalizeVisibility(book.visibility)})`} aria-label={`Change visibility for ${getDisplayTitle(book)}, currently ${normalizeVisibility(book.visibility)}`}>
                          <span class={`admin-state-pill admin-state-pill--${normalizeVisibility(book.visibility)}`}>{normalizeVisibility(book.visibility)}</span>
                        </button>
                      </td>
                      <td>
                        <div class="admin-provenance">
                          <span class="admin-mono">{book.source_pdf || 'source_pdf not set'}</span>
                          <span class="admin-book-subtle">Converted: {book.converted_at ? dateTimeFormatter.format(new Date(book.converted_at)) : 'N/A'}</span>
                        </div>
                      </td>
                      <td>
                        <div class="admin-meta-lines">
                          <span>Chapters: {book.chapters_count != null ? numberFormatter.format(book.chapters_count) : 'N/A'}</span>
                          <span>Words: {book.word_count != null ? numberFormatter.format(book.word_count) : 'N/A'}</span>
                        </div>
                      </td>
                      <td>
                        <div class="admin-actions">
                          <button class="btn btn-primary btn-sm" onClick={() => setEditingId(editingId === book.id ? null : book.id)}>{editingId === book.id ? 'Close' : 'Edit'}</button>
                          <ActionMenu items={[
                            { label: 'Re-convert', onClick: () => handleReconvert(book) },
                            { separator: true },
                            { label: 'Force Delete', danger: true, onClick: () => setDeleteTarget(book) },
                          ]} />
                        </div>
                      </td>
                    </tr>
                    {editingId === book.id && (
                      <tr class="admin-editor-row"><td colspan="6"><BookEditor book={book} onSave={handleSaveBook} onCancel={() => setEditingId(null)} /></td></tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div class="admin-catalog-cards">
            {filtered.map((book) => (
              <div key={book.id} class="admin-catalog-card">
                <div class="admin-catalog-card-header">
                  <input type="checkbox" class="admin-checkbox" checked={selected.has(book.id)} onChange={() => toggleSelect(book.id)} aria-label={`Select ${getDisplayTitle(book)}`} />
                  <a class="admin-book-title-link" href={`#/${encodeURIComponent(book.id)}`}>{getDisplayTitle(book)}</a>
                  <button class="admin-state-pill-btn" onClick={() => quickVisibilityChange(book)} title={`Click to cycle visibility`} aria-label={`Change visibility for ${getDisplayTitle(book)}, currently ${normalizeVisibility(book.visibility)}`}>
                    <span class={`admin-state-pill admin-state-pill--${normalizeVisibility(book.visibility)}`}>{normalizeVisibility(book.visibility)}</span>
                  </button>
                </div>
                <div class="admin-catalog-card-meta">
                  {book.author && <span>{book.author}</span>}
                  {book.source_pdf && <span class="admin-mono">{book.source_pdf}</span>}
                  <span class="admin-book-subtle">
                    {[book.chapters_count != null && `${numberFormatter.format(book.chapters_count)} ch`, book.word_count != null && `${numberFormatter.format(book.word_count)} words`].filter(Boolean).join(' \u00b7 ')}
                  </span>
                  {book.converted_at && <span class="admin-book-subtle">Converted: {dateFormatter.format(new Date(book.converted_at))}</span>}
                </div>
                <div class="admin-catalog-card-actions">
                  <button class="btn btn-primary btn-sm" onClick={() => setEditingId(editingId === book.id ? null : book.id)}>{editingId === book.id ? 'Close' : 'Edit'}</button>
                  <ActionMenu items={[
                    { label: 'Re-convert', onClick: () => handleReconvert(book) },
                    { separator: true },
                    { label: 'Force Delete', danger: true, onClick: () => setDeleteTarget(book) },
                  ]} />
                </div>
                {editingId === book.id && (
                  <div class="admin-catalog-card-editor"><BookEditor book={book} onSave={handleSaveBook} onCancel={() => setEditingId(null)} /></div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Force Delete"
        danger
        confirmLabel="Force Delete"
        typeConfirm={deleteTarget?.id}
        typeConfirmHint={`Type "${deleteTarget?.id}" to confirm`}
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      >
        <p>This will permanently delete <strong>{deleteTarget ? getDisplayTitle(deleteTarget) : ''}</strong> and all its chapters. This action cannot be undone.</p>
      </ConfirmDialog>
    </section>
  );
}

// --- History Section ---
function HistorySection({ repo }) {
  const repoReady = Boolean(repo.owner && repo.name);
  const [items, setItems] = useState(null);
  useEffect(() => { if (repoReady) loadHistory(repo).then(setItems); }, [repo, repoReady]);
  return (
    <section class="admin-history">
      <h2>Conversion History</h2>
      {!repoReady ? (
        <div class="admin-empty-state">Configure repository to view history.</div>
      ) : items === null ? (
        <div class="admin-skeleton-history">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} class="admin-skeleton-history-row">
              <div class="skeleton admin-skeleton-history-name" />
              <div class="skeleton admin-skeleton-history-size" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div class="admin-empty-state">
          <p class="admin-empty-text">No archived PDFs yet. Source files appear here after a book is re-converted, keeping the original upload as a reference.</p>
        </div>
      ) : (
        <ul class="admin-history-items">
          {items.map((f) => <li key={f.name}><span class="history-name">{f.name}</span><span class="history-size">{formatBytes(f.size)}</span></li>)}
        </ul>
      )}
    </section>
  );
}

// --- Settings Section ---
function SettingsSection({ repo, onRepoChange }) {
  const [owner, setOwner] = useState(repo.owner);
  const [name, setName] = useState(repo.name);
  const [splitLevel, setSplitLevelLocal] = useState(getSplitLevel());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showClearPat, setShowClearPat] = useState(false);

  const handleSaveRepo = (e) => {
    e.preventDefault();
    if (!owner.trim() || !name.trim()) { setError('Enter both owner and name.'); return; }
    saveRepo(owner.trim(), name.trim());
    onRepoChange({ owner: owner.trim(), name: name.trim() });
    showToast('Repository saved', 'success');
  };

  const handleSplitLevel = async (e) => {
    const level = e.target.value;
    setSplitLevelLocal(level); setSaving(true); setError('');
    try { await saveSplitLevelConfig(level, { owner: repo.owner, name: repo.name }); showToast('Split level saved', 'success'); }
    catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  return (
    <section class="admin-settings">
      <h2>Settings</h2>

      <div class="admin-setting-group">
        <h3 class="admin-subheading">Repository</h3>
        <form onSubmit={handleSaveRepo}>
          <div class="admin-form-grid" style={{ gridTemplateColumns: '1fr 1fr auto' }}>
            <label class="admin-input-stack"><span class="admin-label">Owner</span><input class="admin-text-input" value={owner} onInput={(e) => setOwner(e.target.value)} autocomplete="off" /></label>
            <label class="admin-input-stack"><span class="admin-label">Repository</span><input class="admin-text-input" value={name} onInput={(e) => setName(e.target.value)} autocomplete="off" /></label>
            <div class="admin-inline-actions"><button class="btn btn-primary" type="submit">Save</button></div>
          </div>
        </form>
      </div>

      <div class="admin-setting-group">
        <h3 class="admin-subheading">Chapter Split Level</h3>
        <select class="admin-select" value={splitLevel} onChange={handleSplitLevel} disabled={saving} aria-label="Chapter split level">
          <option value="H1">H1</option><option value="H2">H2</option><option value="H3">H3</option>
        </select>
        <p class="admin-hint">Controls how PDF content is split into chapters.</p>
      </div>

      <div class="admin-setting-group">
        <h3 class="admin-subheading">Authentication</h3>
        <div class="admin-actions">
          <button class="btn btn-secondary" onClick={() => { clearPat(); window.location.reload(); }}>Update PAT</button>
          <button class="btn btn-danger" onClick={() => setShowClearPat(true)}>Clear PAT</button>
        </div>
      </div>

      {error && <p class="admin-error">{error}</p>}

      <ConfirmDialog
        open={showClearPat}
        title="Clear Personal Access Token"
        danger
        confirmLabel="Clear Token"
        onConfirm={() => { clearPat(); window.location.reload(); }}
        onCancel={() => setShowClearPat(false)}
      >
        <p>Your GitHub PAT will be removed from local storage. You'll need to re-authenticate to use the admin panel.</p>
      </ConfirmDialog>
    </section>
  );
}

// --- Main Admin Panel ---
export default function AdminPanel() {
  const [authenticated, setAuthenticated] = useState(Boolean(getPat()));
  const [repo, setRepo] = useState(detectRepo);

  useEffect(() => { document.title = 'Admin \u00b7 PDF2Book'; }, []);

  if (!authenticated) {
    return (
      <div class="admin-panel view-enter">
        <h1 class="admin-page-title">Admin</h1>
        <AuthView onAuthenticated={() => setAuthenticated(true)} />
      </div>
    );
  }

  const repoReady = Boolean(repo.owner && repo.name);
  const [tab, setTab] = useState(repoReady ? 'books' : 'settings');

  // Auto-switch to books tab once repo is configured
  useEffect(() => {
    if (repoReady && tab === 'settings') {
      const wasUnconfigured = !repo._wasReady;
      if (wasUnconfigured) setTab('books');
    }
  }, [repoReady]);

  const handleRepoChange = (newRepo) => {
    setRepo(newRepo);
    if (newRepo.owner && newRepo.name) setTab('books');
  };

  return (
    <div class="admin-panel view-enter">
      <h1 class="admin-page-title">Admin</h1>
      {repoReady && (
        <div class="admin-repo-banner">{`Repository: ${repo.owner}/${repo.name}`}</div>
      )}
      <nav class="admin-tabs" role="tablist">
        <button
          class={`admin-tab${tab === 'books' ? ' admin-tab--active' : ''}`}
          role="tab"
          aria-selected={tab === 'books'}
          onClick={() => setTab('books')}
        >Books</button>
        <button
          class={`admin-tab${tab === 'settings' ? ' admin-tab--active' : ''}`}
          role="tab"
          aria-selected={tab === 'settings'}
          onClick={() => setTab('settings')}
        >Settings</button>
      </nav>

      {tab === 'books' && (
        <>
          {!repoReady && (
            <div class="admin-repo-banner admin-repo-banner--warning">
              Configure your repository in the <button class="admin-inline-link" onClick={() => setTab('settings')}>Settings</button> tab first.
            </div>
          )}
          <UploadSection repo={repo} disabled={!repoReady} />
          <FailuresSection repo={repo} />
          <CatalogSection repo={repo} />
        </>
      )}

      {tab === 'settings' && (
        <>
          <SettingsSection repo={repo} onRepoChange={handleRepoChange} />
          <HistorySection repo={repo} />
        </>
      )}
    </div>
  );
}
