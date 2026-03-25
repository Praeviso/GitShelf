/**
 * Admin panel for PDF2Book.
 *
 * Lazy-loaded by app.js when the user navigates to #/admin.
 * Provides PAT authentication, PDF upload, Actions workflow
 * monitoring, book management, conversion history, and settings.
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
  const POLL_INTERVAL_MS = 10_000;
  const MAX_FILE_SIZE = 100 * 1024 * 1024;

  const state = {
    pollTimerId: null,
    activeDialog: null,
  };

  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const numberFormatter = new Intl.NumberFormat(undefined);

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

  function formatDate(isoDate) {
    if (!isoDate) return 'N/A';
    return dateFormatter.format(new Date(isoDate));
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

  async function saveSplitLevelConfig(level) {
    const { owner, repo } = getRepoInfo();
    if (!owner || !repo) {
      throw new Error('Repository not configured. Save the repository override first.');
    }

    const levelNumber = parseInt(level.replace('H', ''), 10) || 1;
    const config = JSON.stringify({ split_level: levelNumber }, null, 2) + '\n';
    const encoded = btoa(unescape(encodeURIComponent(config)));
    const path = '.pdf2book.json';

    let sha;
    try {
      const existing = await githubApi(`/repos/${owner}/${repo}/contents/${path}`);
      sha = existing.sha;
    } catch (error) {
      if (!String(error.message).includes('404')) {
        throw error;
      }
    }

    const body = {
      message: `chore(admin): update split level to ${level}`,
      content: encoded,
    };

    if (sha) {
      body.sha = sha;
    }

    await githubApi(`/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  function renderAuthView(container) {
    container.replaceChildren();

    const section = createElement('section', 'admin-auth');

    const title = createElement('h1', 'admin-page-title', 'Admin Setup');
    section.appendChild(title);

    const intro = createElement(
      'p',
      'admin-section-intro',
      'To manage books and upload PDFs, create a GitHub Personal Access Token with repo scope. The token is stored only in your browser and is sent exclusively to api.github.com.'
    );
    section.appendChild(intro);

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
    input.placeholder = 'ghp_…';
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
      saveButton.textContent = 'Verifying…';

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
    container.replaceChildren();

    const dashboard = createElement('div', 'admin-dashboard');

    const pageTitle = createElement('h1', 'admin-page-title', 'Admin');
    dashboard.appendChild(pageTitle);

    const intro = createElement(
      'p',
      'admin-section-intro',
      'Upload new books, monitor conversion progress, and manage repository-backed settings from the browser.'
    );
    dashboard.appendChild(intro);

    const repo = detectRepo();
    const repoBanner = createElement('div', 'admin-repo-banner');
    repoBanner.textContent =
      repo.owner && repo.name
        ? `Repository: ${repo.owner}/${repo.name}`
        : 'Repository not detected. Configure it in Settings before uploading.';
    dashboard.appendChild(repoBanner);

    const uploadSection = renderUploadSection(repo);
    const booksSection = renderBooksSection();
    const historySection = renderHistorySection();
    const settingsSection = renderSettingsSection(container, repo);

    dashboard.appendChild(uploadSection);
    dashboard.appendChild(booksSection);
    dashboard.appendChild(historySection);
    dashboard.appendChild(settingsSection);

    container.appendChild(dashboard);

    loadBooks(booksSection);
    loadHistory(historySection, repo);
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

  async function uploadPdf(file, repo, progressElement, errorElement, fileInput) {
    if (!repo.owner || !repo.name) {
      showError(errorElement, 'Repository not configured. Save it in Settings first.');
      return;
    }

    fileInput.disabled = true;
    clearError(errorElement);

    try {
      setProgress(progressElement, 'reading', `Reading ${file.name}…`);

      const base64 = await readFileAsBase64(file);

      setProgress(progressElement, 'committing', `Committing to input/${file.name}…`);

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

      setProgress(progressElement, 'done', 'Upload complete. Monitoring workflow…');
      fileInput.value = '';
      fileInput.disabled = false;

      monitorWorkflow(repo, progressElement);
    } catch (error) {
      showError(errorElement, `Upload failed: ${error.message}`);
      setProgress(progressElement, 'error', 'Upload failed.');
      fileInput.disabled = false;
    }
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

        if (!data || !data.workflow_runs || data.workflow_runs.length === 0) {
          setProgress(progressElement, 'reading', 'Waiting for workflow to start…');
          schedulePoll(poll, POLL_INTERVAL_MS);
          return;
        }

        const run = data.workflow_runs[0];

        if (run.status === 'queued') {
          setProgress(progressElement, 'queued', 'Workflow queued…');
          schedulePoll(poll, POLL_INTERVAL_MS);
          return;
        }

        if (run.status === 'in_progress') {
          setProgress(progressElement, 'running', 'Workflow in progress…');
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

        setProgress(progressElement, 'reading', `Workflow status: ${run.status}…`);
        schedulePoll(poll, POLL_INTERVAL_MS);
      } catch (error) {
        setProgress(
          progressElement,
          'error',
          `Error checking workflow: ${error.message}`
        );
      }
    };

    schedulePoll(poll, 3000);
  }

  function renderBooksSection() {
    const section = createElement('section', 'admin-books');
    section.appendChild(createElement('h2', null, 'Books'));

    const list = createElement('div', 'admin-books-list', 'Loading books…');
    section.appendChild(list);

    return section;
  }

  async function loadBooks(section) {
    const list = section.querySelector('.admin-books-list');

    try {
      const response = await fetch('manifest.json');
      if (!response.ok) {
        list.textContent = 'No manifest.json found. No books have been converted yet.';
        return;
      }

      const manifest = await response.json();
      if (!manifest.books || manifest.books.length === 0) {
        list.textContent = 'No books yet. Upload a PDF to get started.';
        return;
      }

      list.replaceChildren();

      const table = createElement('table', 'admin-table');
      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      ['Title', 'Chapters', 'Words', 'Created', 'Actions'].forEach((headerText) => {
        const th = createElement('th', null, headerText);
        th.scope = 'col';
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');

      for (const book of manifest.books) {
        const row = document.createElement('tr');

        const titleCell = document.createElement('td');
        const titleLink = createElement('a', null, book.title || book.id);
        titleLink.href = `#/${encodeURIComponent(book.id)}`;
        titleCell.appendChild(titleLink);
        row.appendChild(titleCell);

        row.appendChild(createElement('td', 'admin-table-number', String(book.chapters_count ?? 'N/A')));

        row.appendChild(
          createElement(
            'td',
            'admin-table-number',
            book.word_count != null ? numberFormatter.format(book.word_count) : 'N/A'
          )
        );

        row.appendChild(createElement('td', null, formatDate(book.created_at)));

        const actionsCell = document.createElement('td');
        const actions = createElement('div', 'admin-actions');
        const actionError = createInlineError();

        const reconvertButton = createButton('secondary', 'Re-convert');
        reconvertButton.addEventListener('click', () => {
          clearError(actionError);
          triggerReconvert(book.id, reconvertButton, actionError);
        });

        const deleteButton = createButton('danger', 'Delete');
        deleteButton.addEventListener('click', () => {
          clearError(actionError);
          confirmDeleteBook(book, section, deleteButton);
        });

        actions.appendChild(reconvertButton);
        actions.appendChild(deleteButton);
        actionsCell.appendChild(actions);
        actionsCell.appendChild(actionError);
        row.appendChild(actionsCell);

        tbody.appendChild(row);
      }

      table.appendChild(tbody);
      list.appendChild(table);
    } catch (error) {
      list.textContent = `Failed to load books: ${error.message}`;
    }
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
      confirmButton.textContent = `${options.confirmLabel || 'Confirm'}…`;

      try {
        await options.onConfirm();
        cleanup();
      } catch (error) {
        showError(errorElement, options.getErrorMessage(error));
        confirmButton.disabled = false;
        confirmButton.textContent = options.confirmLabel || 'Confirm';
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

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    state.activeDialog = { close: cleanup };

    cancelButton.focus();
  }

  function confirmDeleteBook(book, booksSection, triggerButton) {
    if (triggerButton && typeof triggerButton.focus === 'function') {
      triggerButton.focus();
    }

    openDialog({
      title: 'Delete Book',
      description: `Delete "${book.title || book.id}" from the bookshelf? This cannot be undone.`,
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
      getErrorMessage(error) {
        return `Delete failed: ${error.message}`;
      },
      onConfirm: async function () {
        await deleteBook(book);
        await loadBooks(booksSection);
      },
    });
  }

  async function deleteBook(book) {
    const repo = detectRepo();
    if (!repo.owner || !repo.name) {
      throw new Error('Repository not configured.');
    }

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

    await updateManifestRemoveBook(repo, book.id);
  }

  async function listFilesRecursive(repo, path) {
    const items = await githubApi(`/repos/${repo.owner}/${repo.name}/contents/${path}`);

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

  async function updateManifestRemoveBook(repo, bookId) {
    const manifestData = await githubApi(
      `/repos/${repo.owner}/${repo.name}/contents/docs/manifest.json`
    );

    const content = atob(manifestData.content.replace(/\n/g, ''));
    const manifest = JSON.parse(content);
    manifest.books = manifest.books.filter((book) => book.id !== bookId);

    const updated = JSON.stringify(manifest, null, 2);
    const encoded = btoa(unescape(encodeURIComponent(updated)));

    await githubApi(`/repos/${repo.owner}/${repo.name}/contents/docs/manifest.json`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `chore(admin): remove ${bookId} from manifest`,
        sha: manifestData.sha,
        content: encoded,
      }),
    });
  }

  async function triggerReconvert(bookId, button, errorElement) {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Triggering…';

    try {
      const { owner, repo } = getRepoInfo();
      if (!owner || !repo) {
        throw new Error('Repository not configured. Save it in Settings first.');
      }

      await githubApi(`/repos/${owner}/${repo}/actions/workflows/convert.yml/dispatches`, {
        method: 'POST',
        body: JSON.stringify({
          ref: 'main',
          inputs: { filename: bookId },
        }),
      });

      button.textContent = 'Triggered!';
      setTimeout(() => {
        button.textContent = originalText;
        button.disabled = false;
      }, 3000);
    } catch (error) {
      button.textContent = originalText;
      button.disabled = false;
      showError(errorElement, `Re-convert failed: ${error.message}`);
    }
  }

  function renderHistorySection() {
    const section = createElement('section', 'admin-history');
    section.appendChild(createElement('h2', null, 'Conversion History'));

    const list = createElement('div', 'admin-history-list', 'Loading…');
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
      list.textContent = String(error.message).includes('404')
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
    const repoLegend = createElement('h3', 'admin-subheading', 'Repository Override');
    repoGroup.appendChild(repoLegend);

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
