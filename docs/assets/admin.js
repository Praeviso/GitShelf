/**
 * Admin panel for PDF2Book.
 *
 * Lazy-loaded by app.js when the user navigates to #/admin.
 * Provides PAT authentication, PDF upload, Actions workflow
 * monitoring, book management, conversion history, and settings.
 *
 * Entry point: window.initAdmin(containerElement)
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAT_STORAGE_KEY = 'github_pat';
const SPLIT_LEVEL_KEY = 'admin_split_level';
const REPO_OWNER_KEY = 'admin_repo_owner';
const REPO_NAME_KEY = 'admin_repo_name';
const GITHUB_API_BASE = 'https://api.github.com';
const POLL_INTERVAL_MS = 10_000;
const MAX_FILE_SIZE = 100 * 1024 * 1024;

// Active polling timer, so it can be cancelled on re-render or navigation
let pollTimerId = null;

// ---------------------------------------------------------------------------
// GitHub API helper
// ---------------------------------------------------------------------------

async function githubApi(path, options = {}) {
  const pat = localStorage.getItem(PAT_STORAGE_KEY);
  if (!pat) throw new Error('No GitHub PAT configured');

  const url = path.startsWith('http') ? path : `${GITHUB_API_BASE}${path}`;

  // Only send the PAT to api.github.com
  const parsed = new URL(url);
  if (parsed.hostname !== 'api.github.com') {
    throw new Error('PAT must only be sent to api.github.com');
  }

  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (res.status === 204) return null;

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401) {
      throw new Error('Authentication failed. Please check your PAT.');
    }
    throw new Error(`GitHub API error ${res.status} on ${path}: ${body}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ---------------------------------------------------------------------------
// Repository detection
// ---------------------------------------------------------------------------

function detectRepo() {
  const savedOwner = localStorage.getItem(REPO_OWNER_KEY);
  const savedName = localStorage.getItem(REPO_NAME_KEY);
  if (savedOwner && savedName) {
    return { owner: savedOwner, name: savedName };
  }

  const hostname = window.location.hostname;
  const pathname = window.location.pathname;

  // GitHub Pages: <user>.github.io
  const ghPagesMatch = hostname.match(/^([^.]+)\.github\.io$/);
  if (ghPagesMatch) {
    const owner = ghPagesMatch[1];
    // The repo name is the first segment of the pathname, or <owner>.github.io for user sites
    const segments = pathname.split('/').filter(Boolean);
    const name = segments.length > 0 ? segments[0] : `${owner}.github.io`;
    return { owner, name };
  }

  return { owner: '', name: '' };
}

function saveRepo(owner, name) {
  localStorage.setItem(REPO_OWNER_KEY, owner);
  localStorage.setItem(REPO_NAME_KEY, name);
}

// ---------------------------------------------------------------------------
// DOM utility helpers
// ---------------------------------------------------------------------------

function createElement(tag, className, textContent) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (textContent != null) el.textContent = textContent;
  return el;
}

function formatDate(iso) {
  if (!iso) return 'N/A';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

// ---------------------------------------------------------------------------
// Error display helpers
// ---------------------------------------------------------------------------

function showError(el, msg) {
  el.textContent = msg;
  el.style.display = 'block';
}

function clearError(el) {
  el.textContent = '';
  el.style.display = 'none';
}

// ---------------------------------------------------------------------------
// UI rendering — Auth view
// ---------------------------------------------------------------------------

function renderAuthView(container) {
  container.replaceChildren();

  const section = createElement('div', 'admin-auth');

  section.appendChild(createElement('h2', null, 'Admin Setup'));

  section.appendChild(
    createElement(
      'p',
      null,
      'To manage books and upload PDFs, you need a GitHub Personal Access Token (PAT) with "repo" scope. ' +
        'This token is stored only in your browser and is sent exclusively to api.github.com.'
    )
  );

  const link = createElement('a', 'admin-link', 'Create a PAT on GitHub');
  link.href =
    'https://github.com/settings/tokens/new?scopes=repo&description=PDF2Book';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  section.appendChild(link);

  const inputWrapper = createElement('div', 'admin-input-group');

  const input = document.createElement('input');
  input.type = 'password';
  input.className = 'admin-pat-input';
  input.placeholder = 'ghp_...';
  input.autocomplete = 'off';
  inputWrapper.appendChild(input);

  const saveBtn = createElement('button', 'btn-primary', 'Save Token');
  inputWrapper.appendChild(saveBtn);

  section.appendChild(inputWrapper);

  const errorEl = createElement('p', 'admin-error');
  errorEl.style.display = 'none';
  section.appendChild(errorEl);

  saveBtn.addEventListener('click', async () => {
    const value = input.value.trim();
    if (!value) {
      showError(errorEl, 'Please enter a PAT.');
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Verifying...';
    try {
      localStorage.setItem(PAT_STORAGE_KEY, value);
      await githubApi('/user');
      renderDashboard(container);
    } catch (err) {
      localStorage.removeItem(PAT_STORAGE_KEY);
      showError(errorEl, `Token verification failed: ${err.message}`);
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Token';
    }
  });

  container.appendChild(section);
}

// ---------------------------------------------------------------------------
// Dashboard (main authenticated view)
// ---------------------------------------------------------------------------

function renderDashboard(container) {
  cancelWorkflowPolling();
  container.replaceChildren();

  const dashboard = createElement('div', 'admin-dashboard');

  const repo = detectRepo();
  const repoBanner = createElement('div', 'admin-repo-banner');
  if (repo.owner && repo.name) {
    repoBanner.textContent = `Repository: ${repo.owner}/${repo.name}`;
  } else {
    repoBanner.textContent =
      'Repository not detected. Please configure it in Settings below.';
  }
  dashboard.appendChild(repoBanner);

  dashboard.appendChild(renderUploadSection(repo));

  const booksSection = renderBooksSection();
  dashboard.appendChild(booksSection);

  const historySection = renderHistorySection();
  dashboard.appendChild(historySection);

  dashboard.appendChild(renderSettingsSection(container, repo));

  container.appendChild(dashboard);

  // Load data asynchronously
  loadBooks(booksSection);
  loadHistory(historySection, repo);
}

// ---------------------------------------------------------------------------
// Upload section
// ---------------------------------------------------------------------------

function renderUploadSection(repo) {
  const section = createElement('section', 'admin-upload');
  section.appendChild(createElement('h2', null, 'Upload PDF'));

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.pdf';
  fileInput.className = 'admin-file-input';
  section.appendChild(fileInput);

  const progress = createElement('div', 'upload-progress');
  progress.style.display = 'none';
  section.appendChild(progress);

  const errorEl = createElement('p', 'admin-error');
  errorEl.style.display = 'none';
  section.appendChild(errorEl);

  fileInput.addEventListener('change', () => {
    clearError(errorEl);
    const file = fileInput.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      showError(errorEl, 'Only .pdf files are accepted.');
      fileInput.value = '';
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      showError(
        errorEl,
        `File is too large (${formatBytes(file.size)}). Maximum size is 100 MB.`
      );
      fileInput.value = '';
      return;
    }

    uploadPdf(file, repo, progress, errorEl, fileInput);
  });

  return section;
}

async function uploadPdf(file, repo, progressEl, errorEl, fileInput) {
  if (!repo.owner || !repo.name) {
    showError(errorEl, 'Repository not configured. Please set it in Settings.');
    return;
  }

  progressEl.style.display = 'block';
  fileInput.disabled = true;

  try {
    setProgress(progressEl, 'reading', `Reading ${file.name}...`);

    const base64 = await readFileAsBase64(file);

    setProgress(progressEl, 'committing', `Committing to input/${file.name}...`);

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

    setProgress(progressEl, 'done', 'Upload complete! Monitoring workflow...');
    fileInput.value = '';
    fileInput.disabled = false;

    monitorWorkflow(repo, progressEl);
  } catch (err) {
    showError(errorEl, `Upload failed: ${err.message}`);
    setProgress(progressEl, 'error', 'Upload failed.');
    fileInput.disabled = false;
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

function setProgress(el, status, message) {
  el.style.display = 'block';
  el.className = `upload-progress upload-progress--${status}`;
  el.textContent = message;
}

// ---------------------------------------------------------------------------
// Workflow monitoring
// ---------------------------------------------------------------------------

function cancelWorkflowPolling() {
  if (pollTimerId != null) {
    clearTimeout(pollTimerId);
    pollTimerId = null;
  }
}

function schedulePoll(fn, delay) {
  cancelWorkflowPolling();
  pollTimerId = setTimeout(fn, delay);
}

async function monitorWorkflow(repo, progressEl) {
  let attempts = 0;
  const maxAttempts = 60;

  const poll = async () => {
    attempts++;
    if (attempts > maxAttempts) {
      setProgress(
        progressEl,
        'error',
        'Workflow monitoring timed out. Check GitHub Actions manually.'
      );
      return;
    }

    try {
      const data = await githubApi(
        `/repos/${repo.owner}/${repo.name}/actions/runs?event=push&per_page=5`
      );

      if (!data || !data.workflow_runs || data.workflow_runs.length === 0) {
        setProgress(progressEl, 'reading', 'Waiting for workflow to start...');
        schedulePoll(poll, POLL_INTERVAL_MS);
        return;
      }

      const run = data.workflow_runs[0];

      if (run.status === 'queued') {
        setProgress(progressEl, 'reading', 'Workflow queued...');
        schedulePoll(poll, POLL_INTERVAL_MS);
      } else if (run.status === 'in_progress') {
        setProgress(progressEl, 'committing', 'Workflow in progress...');
        schedulePoll(poll, POLL_INTERVAL_MS);
      } else if (run.status === 'completed') {
        if (run.conclusion === 'success') {
          setProgress(progressEl, 'done', 'Conversion complete! Your book is ready. ');
          const linkEl = createElement('a', 'admin-link', 'View bookshelf');
          linkEl.href = '#/';
          progressEl.appendChild(linkEl);
        } else {
          setProgress(
            progressEl,
            'error',
            `Workflow finished with conclusion: ${run.conclusion}. Check GitHub Actions for details.`
          );
        }
      } else {
        setProgress(progressEl, 'reading', `Workflow status: ${run.status}...`);
        schedulePoll(poll, POLL_INTERVAL_MS);
      }
    } catch (err) {
      setProgress(
        progressEl,
        'error',
        `Error checking workflow: ${err.message}`
      );
    }
  };

  schedulePoll(poll, 3000);
}

// ---------------------------------------------------------------------------
// Books section
// ---------------------------------------------------------------------------

function renderBooksSection() {
  const section = createElement('section', 'admin-books');
  section.appendChild(createElement('h2', null, 'Books'));

  const list = createElement('div', 'admin-books-list', 'Loading books...');
  section.appendChild(list);

  return section;
}

async function loadBooks(section) {
  const list = section.querySelector('.admin-books-list');

  try {
    const res = await fetch('manifest.json');
    if (!res.ok) {
      list.textContent =
        'No manifest.json found. No books have been converted yet.';
      return;
    }
    const manifest = await res.json();

    if (!manifest.books || manifest.books.length === 0) {
      list.textContent = 'No books yet. Upload a PDF to get started.';
      return;
    }

    list.replaceChildren();

    const table = createElement('table', 'admin-table');

    // Build header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['Title', 'Chapters', 'Words', 'Created', 'Actions'].forEach((text) => {
      headerRow.appendChild(createElement('th', null, text));
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Build body
    const tbody = document.createElement('tbody');
    for (const book of manifest.books) {
      const tr = document.createElement('tr');

      const tdTitle = document.createElement('td');
      const titleLink = createElement('a', null, book.title || book.id);
      titleLink.href = `#/${encodeURIComponent(book.id)}`;
      tdTitle.appendChild(titleLink);
      tr.appendChild(tdTitle);

      tr.appendChild(
        createElement('td', null, String(book.chapters_count ?? 'N/A'))
      );

      tr.appendChild(
        createElement(
          'td',
          null,
          book.word_count != null
            ? book.word_count.toLocaleString()
            : 'N/A'
        )
      );

      tr.appendChild(createElement('td', null, formatDate(book.created_at)));

      const tdActions = document.createElement('td');
      const deleteBtn = createElement('button', 'btn-danger', 'Delete');
      deleteBtn.addEventListener('click', () => {
        confirmDeleteBook(book, section);
      });
      tdActions.appendChild(deleteBtn);
      tr.appendChild(tdActions);

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    list.appendChild(table);
  } catch (err) {
    list.textContent = `Failed to load books: ${err.message}`;
  }
}

// ---------------------------------------------------------------------------
// Book deletion
// ---------------------------------------------------------------------------

function confirmDeleteBook(book, booksSection) {
  const existing = document.querySelector('.admin-modal-overlay');
  if (existing) existing.remove();

  const overlay = createElement('div', 'admin-modal-overlay');

  const modal = createElement('div', 'admin-modal');

  modal.appendChild(createElement('h3', null, 'Delete Book'));

  modal.appendChild(
    createElement(
      'p',
      null,
      `Are you sure you want to delete "${book.title || book.id}"? This cannot be undone.`
    )
  );

  const errorEl = createElement('p', 'admin-error');
  errorEl.style.display = 'none';
  modal.appendChild(errorEl);

  const btnGroup = createElement('div', 'admin-btn-group');

  const cancelBtn = createElement('button', 'btn-secondary', 'Cancel');
  cancelBtn.addEventListener('click', () => overlay.remove());
  btnGroup.appendChild(cancelBtn);

  const confirmBtn = createElement('button', 'btn-danger', 'Delete');
  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Deleting...';
    try {
      await deleteBook(book);
      overlay.remove();
      loadBooks(booksSection);
    } catch (err) {
      showError(errorEl, `Delete failed: ${err.message}`);
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Delete';
    }
  });
  btnGroup.appendChild(confirmBtn);

  modal.appendChild(btnGroup);
  overlay.appendChild(modal);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
}

async function deleteBook(book) {
  const repo = detectRepo();
  if (!repo.owner || !repo.name) {
    throw new Error('Repository not configured.');
  }

  const files = await listFilesRecursive(repo, `docs/books/${book.id}`);

  // GitHub Contents API requires sequential deletes to avoid SHA conflicts
  for (const file of files) {
    await githubApi(
      `/repos/${repo.owner}/${repo.name}/contents/${file.path}`,
      {
        method: 'DELETE',
        body: JSON.stringify({
          message: `chore(admin): delete ${file.path}`,
          sha: file.sha,
        }),
      }
    );
  }

  await updateManifestRemoveBook(repo, book.id);
}

async function listFilesRecursive(repo, path) {
  const items = await githubApi(
    `/repos/${repo.owner}/${repo.name}/contents/${path}`
  );

  let files = [];
  for (const item of items) {
    if (item.type === 'file') {
      files.push({ path: item.path, sha: item.sha });
    } else if (item.type === 'dir') {
      const subFiles = await listFilesRecursive(repo, item.path);
      files = files.concat(subFiles);
    }
  }
  return files;
}

async function updateManifestRemoveBook(repo, bookId) {
  const manifestData = await githubApi(
    `/repos/${repo.owner}/${repo.name}/contents/docs/manifest.json`
  );

  const content = atob(manifestData.content.replace(/\n/g, ''));
  const manifest = JSON.parse(content);

  manifest.books = manifest.books.filter((b) => b.id !== bookId);

  const updated = JSON.stringify(manifest, null, 2);
  const encoded = btoa(unescape(encodeURIComponent(updated)));

  await githubApi(
    `/repos/${repo.owner}/${repo.name}/contents/docs/manifest.json`,
    {
      method: 'PUT',
      body: JSON.stringify({
        message: `chore(admin): remove ${bookId} from manifest`,
        sha: manifestData.sha,
        content: encoded,
      }),
    }
  );
}

// ---------------------------------------------------------------------------
// Conversion history
// ---------------------------------------------------------------------------

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

    const ul = createElement('ul', 'admin-history-items');

    for (const item of items) {
      if (item.name === '.gitkeep') continue;

      const li = document.createElement('li');

      li.appendChild(createElement('span', 'history-name', item.name));

      if (item.size != null) {
        li.appendChild(
          createElement('span', 'history-size', formatBytes(item.size))
        );
      }

      ul.appendChild(li);
    }

    list.appendChild(ul);
  } catch (err) {
    if (err.message.includes('404')) {
      list.textContent = 'No archived PDFs directory found.';
    } else {
      list.textContent = `Failed to load history: ${err.message}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Settings section
// ---------------------------------------------------------------------------

function renderSettingsSection(dashboardContainer, repo) {
  const section = createElement('section', 'admin-settings');
  section.appendChild(createElement('h2', null, 'Settings'));

  // --- Chapter split level ---
  const splitGroup = createElement('div', 'admin-setting-group');
  const splitLabel = createElement('label', 'admin-label', 'Chapter split level');
  splitGroup.appendChild(splitLabel);

  const splitSelect = createElement('select', 'admin-select');
  const currentLevel = localStorage.getItem(SPLIT_LEVEL_KEY) || 'H1';
  ['H1', 'H2', 'H3'].forEach((level) => {
    const option = createElement('option', null, level);
    option.value = level;
    if (level === currentLevel) option.selected = true;
    splitSelect.appendChild(option);
  });
  splitSelect.addEventListener('change', () => {
    localStorage.setItem(SPLIT_LEVEL_KEY, splitSelect.value);
  });
  splitGroup.appendChild(splitSelect);

  splitGroup.appendChild(
    createElement(
      'p',
      'admin-hint',
      'Controls at which heading level the conversion pipeline splits chapters.'
    )
  );

  section.appendChild(splitGroup);

  // --- Repository override ---
  const repoGroup = createElement('div', 'admin-setting-group');
  repoGroup.appendChild(createElement('label', 'admin-label', 'Repository'));

  const repoInputs = createElement('div', 'admin-input-group');

  const ownerInput = document.createElement('input');
  ownerInput.type = 'text';
  ownerInput.placeholder = 'owner';
  ownerInput.className = 'admin-text-input';
  ownerInput.value = repo.owner;
  repoInputs.appendChild(ownerInput);

  repoInputs.appendChild(createElement('span', 'admin-separator', ' / '));

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'repo';
  nameInput.className = 'admin-text-input';
  nameInput.value = repo.name;
  repoInputs.appendChild(nameInput);

  const repoSaveBtn = createElement('button', 'btn-primary', 'Save');
  repoSaveBtn.addEventListener('click', () => {
    const o = ownerInput.value.trim();
    const n = nameInput.value.trim();
    if (o && n) {
      saveRepo(o, n);
      renderDashboard(dashboardContainer);
    }
  });
  repoInputs.appendChild(repoSaveBtn);

  repoGroup.appendChild(repoInputs);
  section.appendChild(repoGroup);

  // --- PAT management ---
  const patGroup = createElement('div', 'admin-setting-group');
  patGroup.appendChild(
    createElement('label', 'admin-label', 'Personal Access Token')
  );

  const patBtnGroup = createElement('div', 'admin-btn-group');

  const updatePatBtn = createElement('button', 'btn-secondary', 'Update PAT');
  updatePatBtn.addEventListener('click', () => {
    localStorage.removeItem(PAT_STORAGE_KEY);
    renderAuthView(dashboardContainer);
  });
  patBtnGroup.appendChild(updatePatBtn);

  const clearPatBtn = createElement('button', 'btn-danger', 'Clear PAT');
  clearPatBtn.addEventListener('click', () => {
    if (
      window.confirm('Remove your stored PAT? You will need to re-enter it.')
    ) {
      localStorage.removeItem(PAT_STORAGE_KEY);
      renderAuthView(dashboardContainer);
    }
  });
  patBtnGroup.appendChild(clearPatBtn);

  patGroup.appendChild(patBtnGroup);
  section.appendChild(patGroup);

  return section;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function initAdmin(container) {
  if (!container) {
    throw new Error('initAdmin: container element is required');
  }

  container.replaceChildren();

  const wrapper = createElement('div', 'admin-panel');
  container.appendChild(wrapper);

  const pat = localStorage.getItem(PAT_STORAGE_KEY);
  if (pat) {
    renderDashboard(wrapper);
  } else {
    renderAuthView(wrapper);
  }
}

window.initAdmin = initAdmin;

// Auto-initialize when loaded as a script tag by app.js
const adminView = document.getElementById('admin-view');
if (adminView) {
  initAdmin(adminView);
}
