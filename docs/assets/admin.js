/**
 * Admin panel for PDF2Book.
 *
 * Lazy-loaded by app.js when the user navigates to #/admin.
 * Provides PAT authentication, upload/progress monitoring, full catalog
 * management, conversion history, and repository-backed settings.
 *
 * Entry point: window.initAdmin(containerElement)
 */

(function () {
  'use strict';

  const shared = window.PDF2BookShared;
  if (!shared) {
    throw new Error('shared.js must be loaded before admin.js.');
  }

  const PAT_STORAGE_KEY = 'github_pat';
  const SPLIT_LEVEL_KEY = 'admin_split_level';
  const REPO_OWNER_KEY = 'admin_repo_owner';
  const REPO_NAME_KEY = 'admin_repo_name';

  const GITHUB_API_BASE = 'https://api.github.com';
  const MAX_FILE_SIZE = 100 * 1024 * 1024;
  const POLL_INTERVAL_MS = 10_000;
  const CATALOG_UPDATED_EVENT = 'pdf2book:catalog-updated';

  const MANIFEST_PATH = 'docs/manifest.json';
  const CATALOG_DEFAULT_PATH = 'docs/catalog.json';
  const CATALOG_METADATA_PATH = 'docs/catalog-metadata.json';
  const CATALOG_CANDIDATE_PATHS = [
    CATALOG_DEFAULT_PATH,
    'docs/catalog.full.json',
    'docs/manifest.full.json',
    'docs/catalog.admin.json',
  ];

  const VISIBILITY_VALUES = ['published', 'hidden', 'archived'];

  const state = {
    pollTimerId: null,
    activeDialog: null,
    catalog: [],
    catalogSourcePath: CATALOG_DEFAULT_PATH,
    catalogSourceSha: null,
    catalogMetadataSha: null,
    catalogNotice: '',
    selectedBookIds: new Set(),
    editingBookId: null,
  };

  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const numberFormatter = new Intl.NumberFormat(undefined);

  function createElement(tag, className, textContent) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (textContent != null) element.textContent = textContent;
    return element;
  }

  function createButton(variant, textContent) {
    const className = variant ? `btn btn-${variant}` : 'btn';
    const button = createElement('button', className, textContent);
    button.type = 'button';
    return button;
  }

  function createInlineError() {
    const errorElement = createElement('p', 'admin-error');
    errorElement.hidden = true;
    errorElement.setAttribute('role', 'status');
    errorElement.setAttribute('aria-live', 'polite');
    errorElement.setAttribute('aria-atomic', 'true');
    return errorElement;
  }

  function createStatusRegion() {
    const statusRegion = createElement('div', 'upload-progress');
    statusRegion.hidden = true;
    statusRegion.setAttribute('role', 'status');
    statusRegion.setAttribute('aria-live', 'polite');
    statusRegion.setAttribute('aria-atomic', 'true');
    return statusRegion;
  }

  function showError(errorElement, message) {
    errorElement.textContent = message;
    errorElement.hidden = false;
  }

  function clearError(errorElement) {
    errorElement.textContent = '';
    errorElement.hidden = true;
  }

  function setProgress(statusRegion, stage, message) {
    const tone = shared.getProgressTone(stage);
    statusRegion.className = `upload-progress upload-progress--${tone}`;
    statusRegion.dataset.stage = stage;
    statusRegion.textContent = message;
    statusRegion.hidden = false;
  }

  function appendProgressLink(statusRegion, href, text) {
    const spacer = document.createTextNode(' ');
    const link = createElement('a', 'upload-progress-link', text);
    link.href = href;
    statusRegion.appendChild(spacer);
    statusRegion.appendChild(link);
  }

  function toIsoNow() {
    return new Date().toISOString();
  }

  function formatDate(isoDate) {
    if (!isoDate) return 'N/A';
    return dateFormatter.format(new Date(isoDate));
  }

  function formatDateTime(isoDate) {
    if (!isoDate) return 'N/A';
    return dateTimeFormatter.format(new Date(isoDate));
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(
      units.length - 1,
      Math.floor(Math.log(bytes) / Math.log(1024))
    );
    const value = bytes / 1024 ** index;
    return `${value.toFixed(1)} ${units[index]}`;
  }

  function normalizeNullableNumber(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return Math.trunc(number);
  }

  function normalizeVisibility(value) {
    const candidate = String(value || '').trim().toLowerCase();
    if (VISIBILITY_VALUES.includes(candidate)) {
      return candidate;
    }
    return 'published';
  }

  function normalizeTags(value) {
    if (Array.isArray(value)) {
      return value
        .map((item) => String(item || '').trim())
        .filter(Boolean);
    }

    if (typeof value === 'string') {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }

    return [];
  }

  function encodePath(path) {
    return path
      .split('/')
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join('/');
  }

  function encodeBase64Utf8(text) {
    return btoa(unescape(encodeURIComponent(text)));
  }

  function decodeBase64Utf8(text) {
    return decodeURIComponent(escape(atob(text)));
  }

  function isNotFoundError(error) {
    return String(error && error.message).includes('404');
  }

  function detectRepo() {
    const savedOwner = localStorage.getItem(REPO_OWNER_KEY);
    const savedName = localStorage.getItem(REPO_NAME_KEY);
    if (savedOwner && savedName) {
      return { owner: savedOwner, name: savedName };
    }

    const hostname = window.location.hostname;
    const pathname = window.location.pathname;
    const githubPagesMatch = hostname.match(/^([^.]+)\.github\.io$/);
    if (githubPagesMatch) {
      const owner = githubPagesMatch[1];
      const segments = pathname.split('/').filter(Boolean);
      const name = segments.length > 0 ? segments[0] : `${owner}.github.io`;
      return { owner, name };
    }

    return { owner: '', name: '' };
  }

  function getRepoInfo() {
    const repo = detectRepo();
    return {
      owner: repo.owner,
      repo: repo.name,
    };
  }

  function saveRepo(owner, name) {
    localStorage.setItem(REPO_OWNER_KEY, owner);
    localStorage.setItem(REPO_NAME_KEY, name);
  }

  function githubApi(path, options) {
    const requestOptions = options || {};
    const pat = localStorage.getItem(PAT_STORAGE_KEY);
    if (!pat) throw new Error('No GitHub PAT configured');

    const url = path.startsWith('http') ? path : `${GITHUB_API_BASE}${path}`;
    const parsed = new URL(url);
    if (parsed.hostname !== 'api.github.com') {
      throw new Error('PAT must only be sent to api.github.com');
    }

    return fetch(url, {
      ...requestOptions,
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        ...requestOptions.headers,
      },
    }).then(async (response) => {
      if (response.status === 204) return null;

      if (!response.ok) {
        const body = await response.text();
        if (response.status === 401) {
          throw new Error('Authentication failed. Please check your PAT.');
        }
        throw new Error(`GitHub API error ${response.status} on ${path}: ${body}`);
      }

      const text = await response.text();
      return text ? JSON.parse(text) : null;
    });
  }

  function notifyCatalogUpdated() {
    window.dispatchEvent(new CustomEvent(CATALOG_UPDATED_EVENT));
  }

  function deepCloneBooks(books) {
    return books.map((book) => ({
      ...book,
      tags: (book.tags || []).slice(),
    }));
  }

  function normalizeBookRecord(rawBook) {
    const generated =
      rawBook && typeof rawBook.generated === 'object' ? rawBook.generated : {};
    const metadata =
      rawBook && typeof rawBook.metadata === 'object' ? rawBook.metadata : {};
    const merged = { ...generated, ...rawBook, ...metadata };

    const id = String(merged.id || merged.book_id || '').trim();
    if (!id) return null;

    const sourcePdf = String(
      merged.source_pdf ||
        merged.source_file ||
        merged.source_filename ||
        merged.source ||
        ''
    ).trim();

    return {
      id,
      title: String(merged.title || merged.generated_title || id).trim(),
      display_title: String(merged.display_title || merged.displayTitle || '').trim(),
      author: String(merged.author || '').trim(),
      summary: String(merged.summary || '').trim(),
      tags: normalizeTags(merged.tags),
      featured: Boolean(merged.featured),
      manual_order: normalizeNullableNumber(merged.manual_order),
      visibility: normalizeVisibility(merged.visibility),
      chapters_count: normalizeNullableNumber(merged.chapters_count),
      word_count: normalizeNullableNumber(merged.word_count),
      created_at: String(merged.created_at || '').trim() || null,
      converted_at:
        String(merged.converted_at || merged.created_at || '').trim() || null,
      updated_at:
        String(
          merged.updated_at ||
            merged.metadata_updated_at ||
            merged.catalog_updated_at ||
            merged.created_at ||
            ''
        ).trim() || null,
      source_pdf: sourcePdf || null,
    };
  }

  function normalizeCatalogPayload(payload) {
    const records = Array.isArray(payload && payload.books)
      ? payload.books
      : Array.isArray(payload && payload.entries)
        ? payload.entries
        : [];

    return records
      .map((record) => normalizeBookRecord(record))
      .filter(Boolean);
  }

  function getDisplayTitle(book) {
    const value = String(book.display_title || '').trim();
    return value || book.title || book.id;
  }

  function isBookVisible(book) {
    return normalizeVisibility(book.visibility) === 'published';
  }

  function compareNullableNumberAscending(left, right) {
    if (left == null && right == null) return 0;
    if (left == null) return 1;
    if (right == null) return -1;
    return left - right;
  }

  function compareString(left, right) {
    return String(left || '').localeCompare(String(right || ''), undefined, {
      sensitivity: 'base',
      numeric: true,
    });
  }

  function sortBooksForPublic(books) {
    return books.slice().sort((a, b) => {
      if (Boolean(a.featured) !== Boolean(b.featured)) {
        return a.featured ? -1 : 1;
      }

      const manualOrderCompare = compareNullableNumberAscending(
        a.manual_order,
        b.manual_order
      );
      if (manualOrderCompare !== 0) return manualOrderCompare;

      return compareString(getDisplayTitle(a), getDisplayTitle(b));
    });
  }

  function buildPublicManifest(books) {
    const publishedBooks = sortBooksForPublic(
      books.filter((book) => isBookVisible(book))
    );

    return {
      books: publishedBooks.map((book) => ({
        id: book.id,
        title: getDisplayTitle(book),
        author: book.author || undefined,
        summary: book.summary || undefined,
        tags: (book.tags || []).slice(),
        featured: Boolean(book.featured),
        manual_order: book.manual_order,
        visibility: normalizeVisibility(book.visibility),
        source_pdf: book.source_pdf || undefined,
        chapters_count: book.chapters_count,
        word_count: book.word_count,
        created_at: book.created_at,
        converted_at: book.converted_at,
        updated_at: book.updated_at,
      })),
    };
  }

  function serializeCatalog(books) {
    const ordered = books
      .slice()
      .sort((a, b) => compareString(a.id, b.id))
      .map((book) => ({
        id: book.id,
        title: book.title,
        display_title: book.display_title || '',
        author: book.author || '',
        summary: book.summary || '',
        tags: (book.tags || []).slice(),
        featured: Boolean(book.featured),
        manual_order: book.manual_order,
        visibility: normalizeVisibility(book.visibility),
        source_pdf: book.source_pdf || '',
        chapters_count: book.chapters_count,
        word_count: book.word_count,
        created_at: book.created_at,
        converted_at: book.converted_at,
        updated_at: book.updated_at,
      }));

    return {
      version: 1,
      updated_at: toIsoNow(),
      books: ordered,
    };
  }

  function serializeCatalogMetadata(books) {
    const entries = books
      .slice()
      .sort((a, b) => compareString(a.id, b.id))
      .map((book) => ({
        id: book.id,
        display_title: book.display_title || '',
        author: book.author || '',
        summary: book.summary || '',
        tags: (book.tags || []).slice(),
        featured: Boolean(book.featured),
        manual_order: book.manual_order,
        visibility: normalizeVisibility(book.visibility),
        metadata_updated_at: book.updated_at || null,
        source_pdf: book.source_pdf || '',
      }));

    return {
      version: 1,
      updated_at: toIsoNow(),
      books: entries,
    };
  }

  function parseTagsInput(rawTags) {
    const seen = new Set();
    const tags = [];
    for (const tag of normalizeTags(rawTags)) {
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
    }
    return tags;
  }

  function extractSha(response) {
    if (!response || typeof response !== 'object') return null;
    if (response.content && response.content.sha) return response.content.sha;
    if (response.sha) return response.sha;
    return null;
  }

  async function readRepositoryJson(repo, path) {
    const data = await githubApi(`/repos/${repo.owner}/${repo.name}/contents/${path}`);
    if (!data || typeof data.content !== 'string') {
      throw new Error(`Unexpected file payload for ${path}`);
    }

    const decoded = decodeBase64Utf8(data.content.replace(/\n/g, ''));
    let parsed;
    try {
      parsed = JSON.parse(decoded);
    } catch (error) {
      throw new Error(`Invalid JSON in ${path}: ${error.message}`);
    }

    return {
      path,
      sha: data.sha || null,
      data: parsed,
    };
  }

  async function writeRepositoryJson(repo, path, payload, message, sha) {
    const content = `${JSON.stringify(payload, null, 2)}\n`;
    const body = {
      message,
      content: encodeBase64Utf8(content),
    };

    if (sha) body.sha = sha;

    return githubApi(`/repos/${repo.owner}/${repo.name}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  async function fetchCatalog(repo) {
    let metadataSha = null;
    try {
      const metadataFile = await readRepositoryJson(repo, CATALOG_METADATA_PATH);
      metadataSha = metadataFile.sha;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }

    for (const path of CATALOG_CANDIDATE_PATHS) {
      try {
        const file = await readRepositoryJson(repo, path);
        return {
          books: normalizeCatalogPayload(file.data),
          sourcePath: file.path,
          sourceSha: file.sha,
          metadataSha,
          notice: '',
        };
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
      }
    }

    try {
      const file = await readRepositoryJson(repo, MANIFEST_PATH);
      const books = normalizeCatalogPayload(file.data).map((book) => ({
        ...book,
        visibility: 'published',
      }));
      return {
        books,
        sourcePath: CATALOG_DEFAULT_PATH,
        sourceSha: null,
        metadataSha,
        notice:
          'Full catalog file not found. Loaded generated manifest as fallback. Saving metadata will create docs/catalog-metadata.json and docs/catalog.json.',
      };
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      return {
        books: [],
        sourcePath: CATALOG_DEFAULT_PATH,
        sourceSha: null,
        metadataSha,
        notice:
          'Catalog files not found. Your first metadata update will create docs/catalog-metadata.json and docs/catalog.json.',
      };
    }
  }

  function pruneSelection() {
    const validIds = new Set(state.catalog.map((book) => book.id));
    for (const id of Array.from(state.selectedBookIds)) {
      if (!validIds.has(id)) {
        state.selectedBookIds.delete(id);
      }
    }
  }

  async function syncManifestFromCatalog(repo, books, message) {
    let manifestSha = null;
    try {
      const manifestFile = await readRepositoryJson(repo, MANIFEST_PATH);
      manifestSha = manifestFile.sha;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }

    const manifest = buildPublicManifest(books);
    await writeRepositoryJson(
      repo,
      MANIFEST_PATH,
      manifest,
      `${message} (manifest sync)`,
      manifestSha
    );
  }

  async function persistCatalog(repo, nextBooks, message) {
    const metadataPayload = serializeCatalogMetadata(nextBooks);
    const catalogPayload = serializeCatalog(nextBooks);
    const catalogPath = state.catalogSourcePath || CATALOG_DEFAULT_PATH;

    const metadataWriteResult = await writeRepositoryJson(
      repo,
      CATALOG_METADATA_PATH,
      metadataPayload,
      `${message} (metadata)`,
      state.catalogMetadataSha
    );

    const catalogWriteResult = await writeRepositoryJson(
      repo,
      catalogPath,
      catalogPayload,
      `${message} (catalog sync)`,
      state.catalogSourceSha
    );

    state.catalogMetadataSha = extractSha(metadataWriteResult);
    state.catalogSourcePath = catalogPath;
    state.catalogSourceSha = extractSha(catalogWriteResult);

    await syncManifestFromCatalog(repo, nextBooks, message);
    notifyCatalogUpdated();
  }

  function cancelWorkflowPolling() {
    if (state.pollTimerId != null) {
      clearTimeout(state.pollTimerId);
      state.pollTimerId = null;
    }
  }

  function schedulePoll(fn, delay) {
    cancelWorkflowPolling();
    state.pollTimerId = setTimeout(fn, delay);
  }

  async function monitorWorkflow(repo, progressElement) {
    let attempts = 0;
    const maxAttempts = 60;

    const poll = async () => {
      attempts += 1;
      if (attempts > maxAttempts) {
        setProgress(
          progressElement,
          'error',
          'Workflow monitoring timed out. Check GitHub Actions manually.'
        );
        return;
      }

      try {
        const data = await githubApi(
          `/repos/${repo.owner}/${repo.name}/actions/runs?event=push&per_page=5`
        );

        if (!data || !Array.isArray(data.workflow_runs) || data.workflow_runs.length === 0) {
          setProgress(progressElement, 'reading', 'Waiting for workflow to start...');
          schedulePoll(poll, POLL_INTERVAL_MS);
          return;
        }

        const run = data.workflow_runs[0];
        if (run.status === 'queued') {
          setProgress(progressElement, 'queued', 'Workflow queued...');
          schedulePoll(poll, POLL_INTERVAL_MS);
          return;
        }

        if (run.status === 'in_progress') {
          setProgress(progressElement, 'running', 'Workflow in progress...');
          schedulePoll(poll, POLL_INTERVAL_MS);
          return;
        }

        if (run.status === 'completed' && run.conclusion === 'success') {
          setProgress(progressElement, 'done', 'Conversion complete. Your book is ready.');
          appendProgressLink(progressElement, '#/', 'View Bookshelf');
          return;
        }

        if (run.status === 'completed') {
          setProgress(
            progressElement,
            'error',
            `Workflow finished with conclusion: ${run.conclusion}. Check GitHub Actions for details.`
          );
          return;
        }

        setProgress(progressElement, 'reading', `Workflow status: ${run.status}...`);
        schedulePoll(poll, POLL_INTERVAL_MS);
      } catch (error) {
        setProgress(progressElement, 'error', `Error checking workflow: ${error.message}`);
      }
    };

    schedulePoll(poll, 3000);
  }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        resolve(result.split(',')[1]);
      };
      reader.onerror = () => reject(new Error('Failed to read the selected file.'));
      reader.readAsDataURL(file);
    });
  }

  async function uploadPdf(file, repo, progressElement, errorElement, fileInput) {
    if (!repo.owner || !repo.name) {
      showError(errorElement, 'Repository not configured. Save it in Settings first.');
      return;
    }

    fileInput.disabled = true;
    clearError(errorElement);

    try {
      setProgress(progressElement, 'reading', `Reading ${file.name}...`);
      const base64 = await readFileAsBase64(file);

      setProgress(progressElement, 'committing', `Committing to input/${file.name}...`);

      await githubApi(
        `/repos/${repo.owner}/${repo.name}/contents/input/${encodeURIComponent(file.name)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            message: `feat(pipeline): upload ${file.name}`,
            content: base64,
          }),
        }
      );

      setProgress(progressElement, 'done', 'Upload complete. Monitoring workflow...');
      fileInput.value = '';
      fileInput.disabled = false;
      monitorWorkflow(repo, progressElement);
    } catch (error) {
      showError(errorElement, `Upload failed: ${error.message}`);
      setProgress(progressElement, 'error', 'Upload failed.');
      fileInput.disabled = false;
    }
  }

  async function saveSplitLevelConfig(level) {
    const { owner, repo } = getRepoInfo();
    if (!owner || !repo) {
      throw new Error('Repository not configured. Save the repository override first.');
    }

    const levelNumber = parseInt(level.replace('H', ''), 10) || 1;
    const config = { split_level: levelNumber };
    const path = '.pdf2book.json';

    let sha = null;
    try {
      const existing = await readRepositoryJson({ owner, name: repo }, path);
      sha = existing.sha;
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }

    await writeRepositoryJson(
      { owner, name: repo },
      path,
      config,
      `chore(admin): update split level to ${level}`,
      sha
    );
  }

  function closeActiveDialog() {
    if (state.activeDialog && typeof state.activeDialog.close === 'function') {
      state.activeDialog.close();
    }
  }

  function openDialog(options) {
    closeActiveDialog();

    const previousActiveElement = document.activeElement;
    const titleId = shared.nextId('dialog-title');
    const descriptionId = shared.nextId('dialog-description');
    const inputId = shared.nextId('dialog-confirm-input');

    const overlay = createElement('div', 'admin-modal-overlay');
    const modal = createElement('div', 'admin-modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', titleId);
    modal.setAttribute('aria-describedby', descriptionId);
    modal.setAttribute('tabindex', '-1');

    const title = createElement('h2', null, options.title);
    title.id = titleId;
    modal.appendChild(title);

    const description = createElement('p', null, options.description);
    description.id = descriptionId;
    modal.appendChild(description);

    let confirmationInput = null;
    let expectedText = '';
    if (options.confirmText) {
      expectedText = String(options.confirmText);
      const fieldWrap = createElement('div', 'admin-dialog-confirm');
      const label = createElement(
        'label',
        'admin-label',
        `Type "${expectedText}" to confirm`
      );
      label.htmlFor = inputId;
      confirmationInput = document.createElement('input');
      confirmationInput.id = inputId;
      confirmationInput.type = 'text';
      confirmationInput.className = 'admin-text-input';
      confirmationInput.autocomplete = 'off';
      confirmationInput.spellcheck = false;
      fieldWrap.appendChild(label);
      fieldWrap.appendChild(confirmationInput);
      modal.appendChild(fieldWrap);
    }

    const errorElement = createInlineError();
    modal.appendChild(errorElement);

    const buttonGroup = createElement('div', 'admin-btn-group');
    const cancelButton = createButton('secondary', options.cancelLabel || 'Cancel');
    const confirmButton = createButton(
      options.confirmVariant || 'danger',
      options.confirmLabel || 'Confirm'
    );
    buttonGroup.appendChild(cancelButton);
    buttonGroup.appendChild(confirmButton);
    modal.appendChild(buttonGroup);
    overlay.appendChild(modal);

    const originalOverflow = document.body.style.overflow;

    function updateConfirmEnabled() {
      if (!confirmationInput) {
        confirmButton.disabled = false;
        return;
      }
      confirmButton.disabled = confirmationInput.value.trim() !== expectedText;
    }

    function cleanup() {
      overlay.removeEventListener('click', onOverlayClick);
      overlay.removeEventListener('keydown', onOverlayKeyDown);
      overlay.remove();
      document.body.style.overflow = originalOverflow;
      state.activeDialog = null;

      if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
        previousActiveElement.focus();
      }
    }

    async function onConfirmClick() {
      clearError(errorElement);
      confirmButton.disabled = true;
      confirmButton.textContent = `${options.confirmLabel || 'Confirm'}...`;

      try {
        await options.onConfirm();
        cleanup();
      } catch (error) {
        showError(errorElement, options.getErrorMessage(error));
        confirmButton.textContent = options.confirmLabel || 'Confirm';
        updateConfirmEnabled();
      }
    }

    function onOverlayClick(event) {
      if (event.target === overlay) {
        cleanup();
      }
    }

    function onOverlayKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        cleanup();
        return;
      }
      shared.trapFocusKey(event, modal);
    }

    cancelButton.addEventListener('click', cleanup);
    confirmButton.addEventListener('click', onConfirmClick);
    overlay.addEventListener('click', onOverlayClick);
    overlay.addEventListener('keydown', onOverlayKeyDown);
    if (confirmationInput) {
      confirmationInput.addEventListener('input', updateConfirmEnabled);
    }

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    state.activeDialog = { close: cleanup };

    updateConfirmEnabled();
    if (confirmationInput) {
      confirmationInput.focus();
    } else {
      cancelButton.focus();
    }
  }

  function buildCatalogSummary(books) {
    const summary = {
      total: books.length,
      published: 0,
      hidden: 0,
      archived: 0,
    };

    for (const book of books) {
      const visibility = normalizeVisibility(book.visibility);
      summary[visibility] += 1;
    }

    return summary;
  }

  function queryCatalogBooks(books, filters) {
    const query = String(filters.query || '').trim().toLowerCase();
    const visibility = normalizeVisibility(filters.visibility) === filters.visibility
      ? filters.visibility
      : filters.visibility === 'all'
        ? 'all'
        : 'all';
    const sort = filters.sort || 'public_order';

    let filtered = books.slice();

    if (visibility !== 'all') {
      filtered = filtered.filter((book) => normalizeVisibility(book.visibility) === visibility);
    }

    if (query) {
      filtered = filtered.filter((book) => {
        const haystack = [
          book.id,
          book.title,
          book.display_title,
          book.author,
          book.summary,
          (book.tags || []).join(' '),
          book.source_pdf,
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      });
    }

    if (sort === 'title_asc') {
      filtered.sort((a, b) => compareString(getDisplayTitle(a), getDisplayTitle(b)));
      return filtered;
    }

    if (sort === 'updated_desc') {
      filtered.sort((a, b) => {
        const left = Date.parse(a.updated_at || a.created_at || '');
        const right = Date.parse(b.updated_at || b.created_at || '');
        return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
      });
      return filtered;
    }

    if (sort === 'created_desc') {
      filtered.sort((a, b) => {
        const left = Date.parse(a.created_at || '');
        const right = Date.parse(b.created_at || '');
        return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
      });
      return filtered;
    }

    if (sort === 'words_desc') {
      filtered.sort((a, b) => (b.word_count || 0) - (a.word_count || 0));
      return filtered;
    }

    return sortBooksForPublic(filtered);
  }

  function getCatalogView(section) {
    return section.__catalogView;
  }

  function updateSummaryPills(summaryContainer, books) {
    summaryContainer.replaceChildren();
    const summary = buildCatalogSummary(books);

    const pills = [
      ['Total', summary.total, 'all'],
      ['Published', summary.published, 'published'],
      ['Hidden', summary.hidden, 'hidden'],
      ['Archived', summary.archived, 'archived'],
    ];

    for (const [label, value, tone] of pills) {
      const pill = createElement('span', `admin-summary-pill admin-summary-pill--${tone}`);
      pill.textContent = `${label}: ${value}`;
      summaryContainer.appendChild(pill);
    }
  }

  function buildSourceArtifactPath(book) {
    const source = String(book.source_pdf || '').trim();
    if (!source) return null;
    if (source.includes('/')) return source.replace(/^\/+/, '');
    return `input/archived/${source}`;
  }

  function createBookEditorRow(book, columnCount, section, repo) {
    const row = document.createElement('tr');
    row.className = 'admin-editor-row';

    const cell = document.createElement('td');
    cell.colSpan = columnCount;
    row.appendChild(cell);

    const form = createElement('form', 'admin-book-editor');
    cell.appendChild(form);

    const grid = createElement('div', 'admin-book-editor-grid');
    form.appendChild(grid);

    const displayTitleId = shared.nextId('catalog-display-title');
    const authorId = shared.nextId('catalog-author');
    const summaryId = shared.nextId('catalog-summary');
    const tagsId = shared.nextId('catalog-tags');
    const manualOrderId = shared.nextId('catalog-manual-order');
    const visibilityId = shared.nextId('catalog-visibility');

    function appendInputField(options) {
      const stack = createElement('div', 'admin-input-stack');
      const label = createElement('label', 'admin-label', options.label);
      label.htmlFor = options.id;
      stack.appendChild(label);

      let input;
      if (options.multiline) {
        input = document.createElement('textarea');
        input.rows = 3;
      } else {
        input = document.createElement('input');
        input.type = options.type || 'text';
      }

      input.id = options.id;
      input.name = options.name;
      input.className = options.multiline ? 'admin-textarea' : 'admin-text-input';
      input.value = options.value || '';
      if (options.placeholder) input.placeholder = options.placeholder;
      stack.appendChild(input);
      grid.appendChild(stack);
      return input;
    }

    const displayTitleInput = appendInputField({
      id: displayTitleId,
      name: 'display_title',
      label: 'Display Title',
      value: book.display_title || '',
      placeholder: 'Shown on bookshelf',
    });

    const authorInput = appendInputField({
      id: authorId,
      name: 'author',
      label: 'Author',
      value: book.author || '',
      placeholder: 'Author name',
    });

    const summaryInput = appendInputField({
      id: summaryId,
      name: 'summary',
      label: 'Summary',
      value: book.summary || '',
      placeholder: 'Short description for readers',
      multiline: true,
    });

    const tagsInput = appendInputField({
      id: tagsId,
      name: 'tags',
      label: 'Tags',
      value: (book.tags || []).join(', '),
      placeholder: 'comma, separated, tags',
    });

    const manualOrderInput = appendInputField({
      id: manualOrderId,
      name: 'manual_order',
      label: 'Manual Order',
      value: book.manual_order == null ? '' : String(book.manual_order),
      type: 'number',
      placeholder: 'Lower value appears first',
    });
    manualOrderInput.min = '0';
    manualOrderInput.step = '1';

    const visibilityStack = createElement('div', 'admin-input-stack');
    const visibilityLabel = createElement('label', 'admin-label', 'Visibility');
    visibilityLabel.htmlFor = visibilityId;
    visibilityStack.appendChild(visibilityLabel);
    const visibilitySelect = createElement('select', 'admin-select');
    visibilitySelect.id = visibilityId;
    visibilitySelect.name = 'visibility';
    for (const value of VISIBILITY_VALUES) {
      const option = createElement('option', null, value);
      option.value = value;
      option.selected = normalizeVisibility(book.visibility) === value;
      visibilitySelect.appendChild(option);
    }
    visibilityStack.appendChild(visibilitySelect);
    grid.appendChild(visibilityStack);

    const checkboxStack = createElement('label', 'admin-checkbox-line');
    const featuredInput = document.createElement('input');
    featuredInput.type = 'checkbox';
    featuredInput.name = 'featured';
    featuredInput.checked = Boolean(book.featured);
    checkboxStack.appendChild(featuredInput);
    checkboxStack.appendChild(createElement('span', null, 'Featured'));
    grid.appendChild(checkboxStack);

    const actions = createElement('div', 'admin-book-editor-actions');
    const saveButton = createButton('primary', 'Save Metadata');
    saveButton.type = 'submit';
    const cancelButton = createButton('secondary', 'Cancel');
    actions.appendChild(saveButton);
    actions.appendChild(cancelButton);
    form.appendChild(actions);

    const errorElement = createInlineError();
    form.appendChild(errorElement);

    cancelButton.addEventListener('click', () => {
      state.editingBookId = null;
      renderCatalogTable(section, repo);
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearError(errorElement);

      const manualValue = manualOrderInput.value.trim();
      let manualOrder = null;
      if (manualValue) {
        const parsed = Number(manualValue);
        if (!Number.isInteger(parsed) || parsed < 0) {
          showError(errorElement, 'Manual order must be a whole number >= 0.');
          manualOrderInput.focus();
          return;
        }
        manualOrder = parsed;
      }

      const nextBooks = deepCloneBooks(state.catalog).map((entry) => {
        if (entry.id !== book.id) return entry;
        return {
          ...entry,
          display_title: displayTitleInput.value.trim(),
          author: authorInput.value.trim(),
          summary: summaryInput.value.trim(),
          tags: parseTagsInput(tagsInput.value),
          manual_order: manualOrder,
          visibility: normalizeVisibility(visibilitySelect.value),
          featured: featuredInput.checked,
          updated_at: toIsoNow(),
        };
      });

      saveButton.disabled = true;
      saveButton.textContent = 'Saving...';

      try {
        await persistCatalog(
          repo,
          nextBooks,
          `chore(admin): update catalog metadata for ${book.id}`
        );
        state.catalog = nextBooks;
        state.editingBookId = null;
        renderCatalogTable(section, repo);
      } catch (error) {
        showError(errorElement, `Failed to save metadata: ${error.message}`);
      } finally {
        saveButton.disabled = false;
        saveButton.textContent = 'Save Metadata';
      }
    });

    return row;
  }

  async function applyBulkVisibility(section, repo, visibility, errorElement, actionLabel) {
    clearError(errorElement);
    const selectedIds = Array.from(state.selectedBookIds);
    if (selectedIds.length === 0) {
      showError(errorElement, 'Select at least one book first.');
      return;
    }

    const nextBooks = deepCloneBooks(state.catalog).map((book) => {
      if (!state.selectedBookIds.has(book.id)) return book;
      return {
        ...book,
        visibility,
        updated_at: toIsoNow(),
      };
    });

    try {
      await persistCatalog(
        repo,
        nextBooks,
        `chore(admin): bulk set visibility=${visibility} (${selectedIds.length} books)`
      );
      state.catalog = nextBooks;
      renderCatalogTable(section, repo);
    } catch (error) {
      showError(errorElement, `${actionLabel} failed: ${error.message}`);
    }
  }

  function resolveReconvertFilename(book) {
    const source = String(book.source_pdf || '').trim();
    return source || null;
  }

  async function triggerReconvert(book, button, errorElement) {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Triggering...';

    try {
      const { owner, repo } = getRepoInfo();
      if (!owner || !repo) {
        throw new Error('Repository not configured. Save it in Settings first.');
      }

      const filename = resolveReconvertFilename(book);
      if (!filename) {
        throw new Error('Missing source PDF metadata. Set source provenance before re-convert.');
      }

      await githubApi(`/repos/${owner}/${repo}/actions/workflows/convert.yml/dispatches`, {
        method: 'POST',
        body: JSON.stringify({
          ref: 'main',
          inputs: { filename },
        }),
      });

      button.textContent = 'Triggered!';
      setTimeout(() => {
        button.textContent = originalText;
        button.disabled = false;
      }, 2500);
    } catch (error) {
      button.textContent = originalText;
      button.disabled = false;
      showError(errorElement, `Re-convert failed: ${error.message}`);
    }
  }

  async function listFilesRecursive(repo, path) {
    let items;
    try {
      items = await githubApi(`/repos/${repo.owner}/${repo.name}/contents/${path}`);
    } catch (error) {
      if (isNotFoundError(error)) return [];
      throw error;
    }

    if (!Array.isArray(items)) return [];

    let files = [];
    for (const item of items) {
      if (item.type === 'file') {
        files.push({ path: item.path, sha: item.sha });
      } else if (item.type === 'dir') {
        files = files.concat(await listFilesRecursive(repo, item.path));
      }
    }
    return files;
  }

  async function deleteBookPermanently(book, repo) {
    const files = await listFilesRecursive(repo, `docs/books/${book.id}`);
    for (const file of files) {
      await githubApi(`/repos/${repo.owner}/${repo.name}/contents/${file.path}`, {
        method: 'DELETE',
        body: JSON.stringify({
          message: `chore(admin): delete ${file.path}`,
          sha: file.sha,
        }),
      });
    }

    const nextBooks = deepCloneBooks(state.catalog).filter((entry) => entry.id !== book.id);
    await persistCatalog(repo, nextBooks, `chore(admin): permanently delete book ${book.id}`);
    state.catalog = nextBooks;
    state.selectedBookIds.delete(book.id);
    if (state.editingBookId === book.id) {
      state.editingBookId = null;
    }
  }

  function confirmPermanentDeleteBook(book, section, repo, triggerButton) {
    if (triggerButton && typeof triggerButton.focus === 'function') {
      triggerButton.focus();
    }

    openDialog({
      title: 'Delete Book Permanently',
      description:
        `Delete "${getDisplayTitle(book)}" permanently from docs/books/${book.id}? ` +
        'This removes generated content and cannot be undone.',
      confirmLabel: 'Delete Permanently',
      confirmVariant: 'danger',
      confirmText: book.id,
      getErrorMessage(error) {
        return `Delete failed: ${error.message}`;
      },
      onConfirm: async function () {
        await deleteBookPermanently(book, repo);
        renderCatalogTable(section, repo);
      },
    });
  }

  function renderCatalogTable(section, repo) {
    const view = getCatalogView(section);
    if (!view) return;

    updateSummaryPills(view.summary, state.catalog);
    view.notice.textContent = state.catalogNotice;
    view.notice.hidden = !state.catalogNotice;

    const filters = {
      query: view.searchInput.value,
      visibility: view.visibilityFilter.value,
      sort: view.sortSelect.value,
    };
    const visibleBooks = queryCatalogBooks(state.catalog, filters);

    view.selectedCount.textContent = `${state.selectedBookIds.size} selected`;
    const hasSelection = state.selectedBookIds.size > 0;
    view.bulkPublishButton.disabled = !hasSelection;
    view.bulkHideButton.disabled = !hasSelection;
    view.bulkArchiveButton.disabled = !hasSelection;
    view.clearSelectionButton.disabled = !hasSelection;

    view.list.replaceChildren();

    if (visibleBooks.length === 0) {
      const empty = createElement('div', 'admin-empty-state');
      empty.textContent =
        state.catalog.length === 0
          ? 'No books in catalog yet. Upload a PDF to create one.'
          : 'No books match the current search and filters.';
      view.list.appendChild(empty);
      return;
    }

    const table = createElement('table', 'admin-table admin-catalog-table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');

    const selectHeader = createElement('th');
    selectHeader.scope = 'col';
    const selectAll = document.createElement('input');
    selectAll.type = 'checkbox';
    selectAll.className = 'admin-checkbox';
    const selectedInView = visibleBooks.filter((book) =>
      state.selectedBookIds.has(book.id)
    ).length;
    selectAll.checked = visibleBooks.length > 0 && selectedInView === visibleBooks.length;
    selectAll.indeterminate = selectedInView > 0 && selectedInView < visibleBooks.length;
    selectAll.addEventListener('change', () => {
      if (selectAll.checked) {
        for (const book of visibleBooks) {
          state.selectedBookIds.add(book.id);
        }
      } else {
        for (const book of visibleBooks) {
          state.selectedBookIds.delete(book.id);
        }
      }
      renderCatalogTable(section, repo);
    });
    selectHeader.appendChild(selectAll);
    headerRow.appendChild(selectHeader);

    const headers = ['Title', 'Lifecycle', 'Metadata', 'Provenance', 'Stats', 'Actions'];
    for (const title of headers) {
      const th = createElement('th', null, title);
      th.scope = 'col';
      headerRow.appendChild(th);
    }

    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    for (const book of visibleBooks) {
      const row = document.createElement('tr');
      row.dataset.bookId = book.id;

      const selectCell = document.createElement('td');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'admin-checkbox';
      checkbox.checked = state.selectedBookIds.has(book.id);
      checkbox.setAttribute('aria-label', `Select ${getDisplayTitle(book)}`);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          state.selectedBookIds.add(book.id);
        } else {
          state.selectedBookIds.delete(book.id);
        }
        renderCatalogTable(section, repo);
      });
      selectCell.appendChild(checkbox);
      row.appendChild(selectCell);

      const titleCell = document.createElement('td');
      const titleWrap = createElement('div', 'admin-book-title-wrap');
      const readerLink = createElement('a', 'admin-book-title-link', getDisplayTitle(book));
      readerLink.href = `#/${encodeURIComponent(book.id)}`;
      titleWrap.appendChild(readerLink);
      titleWrap.appendChild(createElement('span', 'admin-book-subtle', `id: ${book.id}`));
      titleCell.appendChild(titleWrap);
      row.appendChild(titleCell);

      const visibilityCell = document.createElement('td');
      const visibility = normalizeVisibility(book.visibility);
      const visibilityPill = createElement(
        'span',
        `admin-state-pill admin-state-pill--${visibility}`,
        visibility
      );
      visibilityCell.appendChild(visibilityPill);
      row.appendChild(visibilityCell);

      const metadataCell = document.createElement('td');
      const metadataLines = createElement('div', 'admin-meta-lines');
      if (book.author) {
        metadataLines.appendChild(createElement('span', null, `Author: ${book.author}`));
      }
      if (book.summary) {
        metadataLines.appendChild(createElement('span', null, book.summary));
      }
      if (book.tags && book.tags.length > 0) {
        const tagWrap = createElement('div', 'admin-tag-list');
        for (const tag of book.tags) {
          tagWrap.appendChild(createElement('span', 'admin-tag', tag));
        }
        metadataLines.appendChild(tagWrap);
      }
      if (!metadataLines.childNodes.length) {
        metadataLines.appendChild(createElement('span', 'admin-book-subtle', 'No metadata'));
      }
      metadataCell.appendChild(metadataLines);
      row.appendChild(metadataCell);

      const provenanceCell = document.createElement('td');
      const provenance = createElement('div', 'admin-provenance');
      provenance.appendChild(
        createElement(
          'span',
          'admin-mono',
          book.source_pdf || 'source_pdf not set'
        )
      );
      provenance.appendChild(
        createElement(
          'span',
          'admin-book-subtle',
          `Converted: ${formatDateTime(book.converted_at || book.created_at)}`
        )
      );

      const sourceArtifactPath = buildSourceArtifactPath(book);
      if (sourceArtifactPath && repo.owner && repo.name) {
        const artifactLink = createElement('a', 'admin-table-link', 'Open source artifact');
        artifactLink.href = `https://github.com/${repo.owner}/${repo.name}/blob/main/${encodePath(
          sourceArtifactPath
        )}`;
        artifactLink.target = '_blank';
        artifactLink.rel = 'noopener noreferrer';
        provenance.appendChild(artifactLink);
      }
      provenanceCell.appendChild(provenance);
      row.appendChild(provenanceCell);

      const statsCell = document.createElement('td');
      const stats = createElement('div', 'admin-meta-lines');
      stats.appendChild(
        createElement(
          'span',
          null,
          `Chapters: ${book.chapters_count == null ? 'N/A' : numberFormatter.format(book.chapters_count)}`
        )
      );
      stats.appendChild(
        createElement(
          'span',
          null,
          `Words: ${book.word_count == null ? 'N/A' : numberFormatter.format(book.word_count)}`
        )
      );
      stats.appendChild(
        createElement(
          'span',
          'admin-book-subtle',
          `Updated: ${formatDate(book.updated_at || book.created_at)}`
        )
      );
      statsCell.appendChild(stats);
      row.appendChild(statsCell);

      const actionsCell = document.createElement('td');
      const actions = createElement('div', 'admin-actions');
      const actionError = createInlineError();

      const editButton = createButton(
        'secondary',
        state.editingBookId === book.id ? 'Close Editor' : 'Edit'
      );
      editButton.addEventListener('click', () => {
        state.editingBookId = state.editingBookId === book.id ? null : book.id;
        renderCatalogTable(section, repo);
      });

      const reconvertButton = createButton('secondary', 'Re-convert');
      reconvertButton.addEventListener('click', () => {
        clearError(actionError);
        triggerReconvert(book, reconvertButton, actionError);
      });

      const deleteButton = createButton('danger', 'Delete Permanently');
      deleteButton.addEventListener('click', () => {
        clearError(actionError);
        confirmPermanentDeleteBook(book, section, repo, deleteButton);
      });

      actions.appendChild(editButton);
      actions.appendChild(reconvertButton);
      actions.appendChild(deleteButton);
      actionsCell.appendChild(actions);
      actionsCell.appendChild(actionError);
      row.appendChild(actionsCell);

      tbody.appendChild(row);

      if (state.editingBookId === book.id) {
        tbody.appendChild(createBookEditorRow(book, 7, section, repo));
      }
    }

    table.appendChild(tbody);
    view.list.appendChild(table);
  }

  async function loadCatalog(section, repo) {
    const view = getCatalogView(section);
    if (!view) return;

    clearError(view.error);
    clearError(view.bulkError);
    view.list.textContent = 'Loading catalog...';

    try {
      const catalog = await fetchCatalog(repo);
      state.catalog = catalog.books;
      state.catalogSourcePath = catalog.sourcePath;
      state.catalogSourceSha = catalog.sourceSha;
      state.catalogMetadataSha = catalog.metadataSha;
      state.catalogNotice = catalog.notice;
      pruneSelection();
      renderCatalogTable(section, repo);
    } catch (error) {
      view.list.textContent = '';
      showError(view.error, `Failed to load catalog: ${error.message}`);
    }
  }

  function renderCatalogSection(repo) {
    const section = createElement('section', 'admin-books');
    section.appendChild(createElement('h2', null, 'Book Catalog'));

    const toolbar = createElement('div', 'admin-catalog-toolbar');
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.name = 'catalog_search';
    searchInput.className = 'admin-text-input';
    searchInput.placeholder = 'Search title, id, author, tag, source...';
    toolbar.appendChild(searchInput);

    const visibilityFilter = createElement('select', 'admin-select');
    visibilityFilter.name = 'catalog_visibility_filter';
    [
      ['all', 'All states'],
      ['published', 'Published'],
      ['hidden', 'Hidden'],
      ['archived', 'Archived'],
    ].forEach(([value, label]) => {
      const option = createElement('option', null, label);
      option.value = value;
      visibilityFilter.appendChild(option);
    });
    toolbar.appendChild(visibilityFilter);

    const sortSelect = createElement('select', 'admin-select');
    sortSelect.name = 'catalog_sort';
    [
      ['public_order', 'Featured + Manual Order'],
      ['updated_desc', 'Recently Updated'],
      ['created_desc', 'Recently Converted'],
      ['title_asc', 'Title A-Z'],
      ['words_desc', 'Word Count'],
    ].forEach(([value, label]) => {
      const option = createElement('option', null, label);
      option.value = value;
      sortSelect.appendChild(option);
    });
    toolbar.appendChild(sortSelect);

    const refreshButton = createButton('secondary', 'Refresh Catalog');
    toolbar.appendChild(refreshButton);
    section.appendChild(toolbar);

    const summary = createElement('div', 'admin-summary-pills');
    summary.setAttribute('role', 'status');
    summary.setAttribute('aria-live', 'polite');
    section.appendChild(summary);

    const notice = createElement('p', 'admin-hint');
    notice.hidden = true;
    section.appendChild(notice);

    const bulkBar = createElement('div', 'admin-bulk-bar');
    const selectedCount = createElement('span', 'admin-book-subtle', '0 selected');
    bulkBar.appendChild(selectedCount);
    const bulkPublishButton = createButton('secondary', 'Publish Selected');
    const bulkHideButton = createButton('secondary', 'Hide Selected');
    const bulkArchiveButton = createButton('secondary', 'Archive Selected');
    const clearSelectionButton = createButton('secondary', 'Clear Selection');
    bulkBar.appendChild(bulkPublishButton);
    bulkBar.appendChild(bulkHideButton);
    bulkBar.appendChild(bulkArchiveButton);
    bulkBar.appendChild(clearSelectionButton);
    section.appendChild(bulkBar);

    const bulkError = createInlineError();
    section.appendChild(bulkError);

    const error = createInlineError();
    section.appendChild(error);

    const list = createElement('div', 'admin-books-list', 'Loading catalog...');
    section.appendChild(list);

    section.__catalogView = {
      list,
      error,
      bulkError,
      searchInput,
      visibilityFilter,
      sortSelect,
      summary,
      notice,
      selectedCount,
      bulkPublishButton,
      bulkHideButton,
      bulkArchiveButton,
      clearSelectionButton,
      refreshButton,
    };

    searchInput.addEventListener('input', () => renderCatalogTable(section, repo));
    visibilityFilter.addEventListener('change', () => renderCatalogTable(section, repo));
    sortSelect.addEventListener('change', () => renderCatalogTable(section, repo));
    refreshButton.addEventListener('click', () => loadCatalog(section, repo));

    bulkPublishButton.addEventListener('click', () =>
      applyBulkVisibility(section, repo, 'published', bulkError, 'Publish selected')
    );
    bulkHideButton.addEventListener('click', () =>
      applyBulkVisibility(section, repo, 'hidden', bulkError, 'Hide selected')
    );
    bulkArchiveButton.addEventListener('click', () =>
      applyBulkVisibility(section, repo, 'archived', bulkError, 'Archive selected')
    );
    clearSelectionButton.addEventListener('click', () => {
      state.selectedBookIds.clear();
      renderCatalogTable(section, repo);
    });

    return section;
  }

  function renderUploadSection(repo) {
    const section = createElement('section', 'admin-upload');
    section.appendChild(createElement('h2', null, 'Upload PDF'));

    const fileId = 'admin-file-input';
    const label = createElement('label', 'admin-label', 'Choose a PDF file');
    label.htmlFor = fileId;
    section.appendChild(label);

    const fileInput = document.createElement('input');
    fileInput.id = fileId;
    fileInput.type = 'file';
    fileInput.name = 'book_pdf';
    fileInput.accept = '.pdf,application/pdf';
    fileInput.className = 'admin-file-input';
    section.appendChild(fileInput);

    const progress = createStatusRegion();
    section.appendChild(progress);

    const errorElement = createInlineError();
    section.appendChild(errorElement);

    fileInput.addEventListener('change', () => {
      clearError(errorElement);

      const file = fileInput.files && fileInput.files[0];
      if (!file) return;

      if (!file.name.toLowerCase().endsWith('.pdf')) {
        showError(errorElement, 'Only .pdf files are accepted.');
        fileInput.value = '';
        return;
      }

      if (file.size > MAX_FILE_SIZE) {
        showError(
          errorElement,
          `File is too large (${formatBytes(file.size)}). Maximum size is 100 MB.`
        );
        fileInput.value = '';
        return;
      }

      uploadPdf(file, repo, progress, errorElement, fileInput);
    });

    return section;
  }

  function renderHistorySection() {
    const section = createElement('section', 'admin-history');
    section.appendChild(createElement('h2', null, 'Conversion History'));
    const list = createElement('div', 'admin-history-list', 'Loading...');
    section.appendChild(list);
    return section;
  }

  async function loadHistory(section, repo) {
    const list = section.querySelector('.admin-history-list');

    if (!repo.owner || !repo.name) {
      list.textContent = 'Repository not configured.';
      return;
    }

    try {
      const items = await githubApi(
        `/repos/${repo.owner}/${repo.name}/contents/input/archived`
      );

      if (!items || items.length === 0) {
        list.textContent = 'No archived PDFs found.';
        return;
      }

      list.replaceChildren();
      const historyItems = createElement('ul', 'admin-history-items');

      for (const item of items) {
        if (item.name === '.gitkeep') continue;
        const listItem = document.createElement('li');
        listItem.appendChild(createElement('span', 'history-name', item.name));
        if (item.size != null) {
          listItem.appendChild(createElement('span', 'history-size', formatBytes(item.size)));
        }
        historyItems.appendChild(listItem);
      }

      list.appendChild(historyItems);
    } catch (error) {
      list.textContent = isNotFoundError(error)
        ? 'No archived PDFs directory found.'
        : `Failed to load history: ${error.message}`;
    }
  }

  function renderSettingsSection(dashboardContainer, repo) {
    const section = createElement('section', 'admin-settings');
    section.appendChild(createElement('h2', null, 'Settings'));

    const splitGroup = createElement('div', 'admin-setting-group');
    const splitLabel = createElement('label', 'admin-label', 'Chapter Split Level');
    const splitId = 'admin-split-level';
    splitLabel.htmlFor = splitId;
    splitGroup.appendChild(splitLabel);

    const splitSelect = createElement('select', 'admin-select');
    splitSelect.id = splitId;
    splitSelect.name = 'split_level';
    splitSelect.autocomplete = 'off';
    const currentLevel = localStorage.getItem(SPLIT_LEVEL_KEY) || 'H1';
    ['H1', 'H2', 'H3'].forEach((level) => {
      const option = createElement('option', null, level);
      option.value = level;
      option.selected = level === currentLevel;
      splitSelect.appendChild(option);
    });
    splitGroup.appendChild(splitSelect);
    splitGroup.appendChild(
      createElement(
        'p',
        'admin-hint',
        'Controls the heading level where the conversion pipeline splits chapters.'
      )
    );
    const splitError = createInlineError();
    splitGroup.appendChild(splitError);
    splitSelect.addEventListener('change', async () => {
      localStorage.setItem(SPLIT_LEVEL_KEY, splitSelect.value);
      clearError(splitError);
      try {
        await saveSplitLevelConfig(splitSelect.value);
      } catch (error) {
        showError(splitError, `Failed to save split level: ${error.message}`);
      }
    });
    section.appendChild(splitGroup);

    const repoGroup = createElement('div', 'admin-setting-group');
    repoGroup.appendChild(createElement('h3', 'admin-subheading', 'Repository Override'));
    const repoForm = createElement('form', 'admin-form-grid');

    const ownerStack = createElement('div', 'admin-input-stack');
    const ownerId = 'admin-repo-owner';
    const ownerLabel = createElement('label', 'admin-label', 'Owner');
    ownerLabel.htmlFor = ownerId;
    const ownerInput = document.createElement('input');
    ownerInput.id = ownerId;
    ownerInput.type = 'text';
    ownerInput.name = 'repo_owner';
    ownerInput.placeholder = 'owner';
    ownerInput.className = 'admin-text-input';
    ownerInput.value = repo.owner;
    ownerInput.autocomplete = 'off';
    ownerInput.spellcheck = false;
    ownerInput.autocapitalize = 'off';
    ownerStack.appendChild(ownerLabel);
    ownerStack.appendChild(ownerInput);

    const nameStack = createElement('div', 'admin-input-stack');
    const nameId = 'admin-repo-name';
    const nameLabel = createElement('label', 'admin-label', 'Repository Name');
    nameLabel.htmlFor = nameId;
    const nameInput = document.createElement('input');
    nameInput.id = nameId;
    nameInput.type = 'text';
    nameInput.name = 'repo_name';
    nameInput.placeholder = 'pdf2book';
    nameInput.className = 'admin-text-input';
    nameInput.value = repo.name;
    nameInput.autocomplete = 'off';
    nameInput.spellcheck = false;
    nameInput.autocapitalize = 'off';
    nameStack.appendChild(nameLabel);
    nameStack.appendChild(nameInput);

    const repoActions = createElement('div', 'admin-inline-actions');
    const repoSaveButton = createButton('primary', 'Save Repository');
    repoSaveButton.type = 'submit';
    repoActions.appendChild(repoSaveButton);

    repoForm.appendChild(ownerStack);
    repoForm.appendChild(nameStack);
    repoForm.appendChild(repoActions);
    const repoError = createInlineError();

    repoForm.addEventListener('submit', (event) => {
      event.preventDefault();
      clearError(repoError);

      const owner = ownerInput.value.trim();
      const name = nameInput.value.trim();
      if (!owner || !name) {
        showError(repoError, 'Enter both the repository owner and repository name.');
        if (!owner) {
          ownerInput.focus();
        } else {
          nameInput.focus();
        }
        return;
      }

      saveRepo(owner, name);
      renderDashboard(dashboardContainer);
    });

    repoGroup.appendChild(repoForm);
    repoGroup.appendChild(repoError);
    section.appendChild(repoGroup);

    const patGroup = createElement('div', 'admin-setting-group');
    patGroup.appendChild(createElement('h3', 'admin-subheading', 'Personal Access Token'));
    const patActions = createElement('div', 'admin-btn-group');

    const updatePatButton = createButton('secondary', 'Update PAT');
    updatePatButton.addEventListener('click', () => {
      localStorage.removeItem(PAT_STORAGE_KEY);
      renderAuthView(dashboardContainer);
    });
    const clearPatButton = createButton('danger', 'Clear PAT');
    clearPatButton.addEventListener('click', () => {
      if (window.confirm('Remove the stored PAT? You will need to enter it again.')) {
        localStorage.removeItem(PAT_STORAGE_KEY);
        renderAuthView(dashboardContainer);
      }
    });

    patActions.appendChild(updatePatButton);
    patActions.appendChild(clearPatButton);
    patGroup.appendChild(patActions);
    section.appendChild(patGroup);

    return section;
  }

  function renderAuthView(container) {
    container.replaceChildren();

    const section = createElement('section', 'admin-auth');
    section.appendChild(createElement('h1', 'admin-page-title', 'Admin Setup'));
    section.appendChild(
      createElement(
        'p',
        'admin-section-intro',
        'To manage books and upload PDFs, create a GitHub Personal Access Token with repo scope. The token is stored only in your browser and is sent exclusively to api.github.com.'
      )
    );

    const link = createElement('a', 'admin-text-link', 'Create a PAT on GitHub');
    link.href =
      'https://github.com/settings/tokens/new?scopes=repo&description=PDF2Book';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    section.appendChild(link);

    const form = createElement('form', 'admin-form');
    const fieldId = 'admin-pat-input';
    const label = createElement('label', 'admin-label', 'Personal Access Token');
    label.htmlFor = fieldId;
    form.appendChild(label);

    const inputGroup = createElement('div', 'admin-input-group');
    const input = document.createElement('input');
    input.id = fieldId;
    input.type = 'password';
    input.name = 'github_pat';
    input.className = 'admin-pat-input';
    input.placeholder = 'ghp_...';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.autocapitalize = 'off';
    inputGroup.appendChild(input);

    const saveButton = createButton('primary', 'Save Token');
    saveButton.type = 'submit';
    inputGroup.appendChild(saveButton);
    form.appendChild(inputGroup);

    const errorElement = createInlineError();
    form.appendChild(errorElement);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearError(errorElement);

      const value = input.value.trim();
      if (!value) {
        showError(errorElement, 'Enter a GitHub PAT with repo scope.');
        input.focus();
        return;
      }

      saveButton.disabled = true;
      saveButton.textContent = 'Verifying...';

      try {
        localStorage.setItem(PAT_STORAGE_KEY, value);
        await githubApi('/user');
        renderDashboard(container);
      } catch (error) {
        localStorage.removeItem(PAT_STORAGE_KEY);
        showError(errorElement, `Token verification failed: ${error.message}`);
        saveButton.disabled = false;
        saveButton.textContent = 'Save Token';
        input.focus();
      }
    });

    section.appendChild(form);
    container.appendChild(section);
  }

  function renderDashboard(container) {
    cancelWorkflowPolling();
    closeActiveDialog();
    state.editingBookId = null;
    state.selectedBookIds.clear();
    container.replaceChildren();

    const dashboard = createElement('div', 'admin-dashboard');
    dashboard.appendChild(createElement('h1', 'admin-page-title', 'Admin'));
    dashboard.appendChild(
      createElement(
        'p',
        'admin-section-intro',
        'Upload new books, manage full catalog metadata, and control lifecycle visibility from the browser.'
      )
    );

    const repo = detectRepo();
    const repoBanner = createElement('div', 'admin-repo-banner');
    repoBanner.textContent =
      repo.owner && repo.name
        ? `Repository: ${repo.owner}/${repo.name}`
        : 'Repository not detected. Configure it in Settings before managing catalog.';
    dashboard.appendChild(repoBanner);

    const uploadSection = renderUploadSection(repo);
    const catalogSection = renderCatalogSection(repo);
    const historySection = renderHistorySection();
    const settingsSection = renderSettingsSection(container, repo);

    dashboard.appendChild(uploadSection);
    dashboard.appendChild(catalogSection);
    dashboard.appendChild(historySection);
    dashboard.appendChild(settingsSection);
    container.appendChild(dashboard);

    if (repo.owner && repo.name) {
      loadCatalog(catalogSection, repo);
      loadHistory(historySection, repo);
    } else {
      const view = getCatalogView(catalogSection);
      if (view) {
        showError(
          view.error,
          'Repository not configured. Save owner/repository in Settings to load catalog.'
        );
        view.list.textContent = '';
      }
      const list = historySection.querySelector('.admin-history-list');
      list.textContent = 'Repository not configured.';
    }
  }

  function initAdmin(container) {
    if (!container) {
      throw new Error('initAdmin: container element is required');
    }

    container.replaceChildren();
    const wrapper = createElement('div', 'admin-panel');
    container.appendChild(wrapper);

    if (localStorage.getItem(PAT_STORAGE_KEY)) {
      renderDashboard(wrapper);
    } else {
      renderAuthView(wrapper);
    }
  }

  window.initAdmin = initAdmin;

  const adminView = document.getElementById('admin-view');
  if (adminView) {
    initAdmin(adminView);
  }
})();
