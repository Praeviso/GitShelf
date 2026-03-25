const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAdminHtml,
  createResponse,
  flushPromises,
  loadBrowserScript,
  setupDom,
} = require('./test-utils');

function encodeJsonBase64(value) {
  return Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8').toString('base64');
}

function createAdminFetch(options) {
  const config = options || {};
  const requests = [];
  const writes = [];
  const workflowDispatches = [];

  let metadataSha = 'catalog-metadata-sha-1';
  let catalogSha = 'catalog-sha-1';
  let manifestSha = 'manifest-sha-1';
  let metadataPayload = config.metadataPayload || { version: 1, books: [] };
  let catalogPayload = config.catalogPayload || { version: 1, books: config.books || [] };
  let manifestPayload = config.manifestPayload || { books: config.publicBooks || [] };

  const bookTree =
    config.bookTree || {
      'docs/books/book-1': [],
    };

  async function fetchImpl(url, requestOptions) {
    const target = String(url);
    const method = (requestOptions && requestOptions.method) || 'GET';
    const requestBody = requestOptions && requestOptions.body;
    requests.push({ target, method, body: requestBody });

    if (target === 'manifest.json') {
      throw new Error('Admin should load catalog via GitHub API, not public manifest.json');
    }

    if (target === 'https://api.github.com/user') {
      return createResponse({ json: { login: 'owner' } });
    }

    if (
      target ===
        'https://api.github.com/repos/owner/repo/contents/docs/catalog.full.json' ||
      target ===
        'https://api.github.com/repos/owner/repo/contents/docs/manifest.full.json' ||
      target ===
        'https://api.github.com/repos/owner/repo/contents/docs/catalog.admin.json'
    ) {
      return createResponse({ ok: false, status: 404, text: 'Not Found' });
    }

    if (target === 'https://api.github.com/repos/owner/repo/contents/docs/catalog-metadata.json') {
      if (method === 'GET') {
        return createResponse({
          json: {
            sha: metadataSha,
            content: encodeJsonBase64(metadataPayload),
          },
        });
      }

      if (method === 'PUT') {
        const parsedBody = JSON.parse(requestBody);
        const decoded = JSON.parse(
          Buffer.from(parsedBody.content, 'base64').toString('utf8')
        );
        metadataPayload = decoded;
        metadataSha = `catalog-metadata-sha-${writes.length + 2}`;
        writes.push({
          path: 'docs/catalog-metadata.json',
          body: decoded,
          message: parsedBody.message,
        });
        return createResponse({
          json: {
            content: { sha: metadataSha },
          },
        });
      }
    }

    if (target === 'https://api.github.com/repos/owner/repo/contents/docs/catalog.json') {
      if (method === 'GET') {
        if (config.missingCatalog) {
          return createResponse({ ok: false, status: 404, text: 'Not Found' });
        }
        return createResponse({
          json: {
            sha: catalogSha,
            content: encodeJsonBase64(catalogPayload),
          },
        });
      }

      if (method === 'PUT') {
        const parsedBody = JSON.parse(requestBody);
        const decoded = JSON.parse(
          Buffer.from(parsedBody.content, 'base64').toString('utf8')
        );
        catalogPayload = decoded;
        catalogSha = `catalog-sha-${writes.length + 2}`;
        writes.push({ path: 'docs/catalog.json', body: decoded, message: parsedBody.message });
        return createResponse({
          json: {
            content: { sha: catalogSha },
          },
        });
      }
    }

    if (target === 'https://api.github.com/repos/owner/repo/contents/docs/manifest.json') {
      if (method === 'GET') {
        if (config.missingManifest) {
          return createResponse({ ok: false, status: 404, text: 'Not Found' });
        }
        return createResponse({
          json: {
            sha: manifestSha,
            content: encodeJsonBase64(manifestPayload),
          },
        });
      }

      if (method === 'PUT') {
        const parsedBody = JSON.parse(requestBody);
        const decoded = JSON.parse(
          Buffer.from(parsedBody.content, 'base64').toString('utf8')
        );
        manifestPayload = decoded;
        manifestSha = `manifest-sha-${writes.length + 2}`;
        writes.push({
          path: 'docs/manifest.json',
          body: decoded,
          message: parsedBody.message,
        });
        return createResponse({
          json: {
            content: { sha: manifestSha },
          },
        });
      }
    }

    if (target === 'https://api.github.com/repos/owner/repo/contents/input/archived') {
      return createResponse({
        json: config.archivedItems || [],
      });
    }

    if (target === 'https://api.github.com/repos/owner/repo/contents/.pdf2book.json') {
      if (method === 'GET') {
        return createResponse({ ok: false, status: 404, text: 'Not Found' });
      }
      if (method === 'PUT') {
        return createResponse({
          ok: false,
          status: 500,
          text: 'save failed',
        });
      }
    }

    if (
      target === 'https://api.github.com/repos/owner/repo/actions/workflows/convert.yml/dispatches'
    ) {
      if (method === 'POST') {
        workflowDispatches.push(JSON.parse(requestBody));
        return createResponse({ status: 204, text: '' });
      }
    }

    if (target.startsWith('https://api.github.com/repos/owner/repo/contents/docs/books/')) {
      const relativePath = target.replace(
        'https://api.github.com/repos/owner/repo/contents/',
        ''
      );

      if (method === 'GET') {
        if (Object.prototype.hasOwnProperty.call(bookTree, relativePath)) {
          return createResponse({ json: bookTree[relativePath] });
        }
        return createResponse({ ok: false, status: 404, text: 'Not Found' });
      }

      if (method === 'DELETE') {
        return createResponse({ status: 200, json: {} });
      }
    }

    throw new Error(`Unexpected fetch request: ${method} ${target}`);
  }

  return {
    fetchImpl,
    requests,
    writes,
    workflowDispatches,
    getCatalogPayload() {
      return catalogPayload;
    },
    getManifestPayload() {
      return manifestPayload;
    },
  };
}

function bootAdmin(options) {
  const config = options || {};
  const fetchHarness = createAdminFetch(config);

  const dom = setupDom({
    html: createAdminHtml(),
    url: 'https://example.com/#/admin',
    fetchImpl: fetchHarness.fetchImpl,
  });
  const { window } = dom;

  if (config.withPat !== false) {
    window.localStorage.setItem('github_pat', 'token');
    window.localStorage.setItem('admin_repo_owner', 'owner');
    window.localStorage.setItem('admin_repo_name', 'repo');
  }

  loadBrowserScript(window, 'docs/assets/shared.js');
  loadBrowserScript(window, 'docs/assets/admin.js');

  return { dom, window, fetchHarness };
}

async function waitForAdminRender() {
  await flushPromises();
  await flushPromises();
  await flushPromises();
}

test('admin reads full catalog via GitHub API and renders hidden entries', async () => {
  const { window, fetchHarness } = bootAdmin({
    books: [
      {
        id: 'book-1',
        title: 'Generated One',
        display_title: 'Catalog One',
        visibility: 'hidden',
        source_pdf: 'book-1.pdf',
      },
      {
        id: 'book-2',
        title: 'Generated Two',
        visibility: 'published',
        source_pdf: 'book-2.pdf',
      },
    ],
  });
  await waitForAdminRender();

  const rootText = window.document.body.textContent;
  assert.match(rootText, /Catalog One/);
  assert.match(rootText, /hidden/);

  const catalogGet = fetchHarness.requests.find(
    (item) =>
      item.method === 'GET' &&
      item.target ===
        'https://api.github.com/repos/owner/repo/contents/docs/catalog.json'
  );
  assert.ok(catalogGet);
});

test('single-book metadata save writes catalog + manifest and dispatches refresh event', async () => {
  const { window, fetchHarness } = bootAdmin({
    books: [
      {
        id: 'book-1',
        title: 'Generated One',
        visibility: 'published',
        source_pdf: 'book-1.pdf',
      },
    ],
  });
  await waitForAdminRender();

  let updateEvents = 0;
  window.addEventListener('pdf2book:catalog-updated', () => {
    updateEvents += 1;
  });

  const editButton = Array.from(window.document.querySelectorAll('button')).find(
    (button) => button.textContent === 'Edit'
  );
  editButton.click();
  await waitForAdminRender();

  const displayTitleInput = window.document.querySelector('input[name="display_title"]');
  const authorInput = window.document.querySelector('input[name="author"]');
  displayTitleInput.value = 'Curated Book Title';
  authorInput.value = 'Ada Lovelace';

  const saveButton = Array.from(window.document.querySelectorAll('button')).find(
    (button) => button.textContent === 'Save Metadata'
  );
  saveButton.click();
  await waitForAdminRender();
  await waitForAdminRender();

  const catalogWrite = fetchHarness.writes.find((item) => item.path === 'docs/catalog.json');
  assert.ok(catalogWrite);
  assert.equal(catalogWrite.body.books[0].display_title, 'Curated Book Title');
  assert.equal(catalogWrite.body.books[0].author, 'Ada Lovelace');

  const metadataWrite = fetchHarness.writes.find(
    (item) => item.path === 'docs/catalog-metadata.json'
  );
  assert.ok(metadataWrite);
  assert.equal(metadataWrite.body.books[0].display_title, 'Curated Book Title');
  assert.equal(metadataWrite.body.books[0].author, 'Ada Lovelace');

  const manifestWrite = fetchHarness.writes.find((item) => item.path === 'docs/manifest.json');
  assert.ok(manifestWrite);
  assert.equal(manifestWrite.body.books[0].title, 'Curated Book Title');

  assert.equal(updateEvents, 1);
});

test('search and visibility filter update catalog table', async () => {
  const { window } = bootAdmin({
    books: [
      {
        id: 'book-hidden',
        title: 'Alpha Hidden',
        visibility: 'hidden',
        source_pdf: 'book-hidden.pdf',
      },
      {
        id: 'book-published',
        title: 'Beta Published',
        visibility: 'published',
        source_pdf: 'book-published.pdf',
      },
    ],
  });
  await waitForAdminRender();

  const visibilityFilter = window.document.querySelector('select[name="catalog_visibility_filter"]');
  visibilityFilter.value = 'hidden';
  visibilityFilter.dispatchEvent(new window.Event('change', { bubbles: true }));
  await waitForAdminRender();

  let tableText = window.document.querySelector('.admin-books-list').textContent;
  assert.match(tableText, /Alpha Hidden/);
  assert.doesNotMatch(tableText, /Beta Published/);

  const searchInput = window.document.querySelector('input[name="catalog_search"]');
  searchInput.value = 'no-match-value';
  searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await waitForAdminRender();

  tableText = window.document.querySelector('.admin-books-list').textContent;
  assert.match(tableText, /No books match the current search and filters/);
});

test('re-convert dispatch uses source_pdf provenance', async () => {
  const { window, fetchHarness } = bootAdmin({
    books: [
      {
        id: 'book-1',
        title: 'Generated One',
        source_pdf: 'input/archived/book-1.pdf',
      },
    ],
  });
  await waitForAdminRender();

  const reconvertButton = Array.from(window.document.querySelectorAll('button')).find(
    (button) => button.textContent === 'Re-convert'
  );
  reconvertButton.click();
  await waitForAdminRender();

  assert.equal(fetchHarness.workflowDispatches.length, 1);
  assert.equal(
    fetchHarness.workflowDispatches[0].inputs.filename,
    'input/archived/book-1.pdf'
  );
});

test('bulk lifecycle update writes catalog and dispatches catalog-updated event', async () => {
  const { window, fetchHarness } = bootAdmin({
    books: [
      {
        id: 'book-1',
        title: 'Book One',
        visibility: 'published',
        source_pdf: 'book-1.pdf',
      },
      {
        id: 'book-2',
        title: 'Book Two',
        visibility: 'published',
        source_pdf: 'book-2.pdf',
      },
    ],
  });
  await waitForAdminRender();

  let updateEvents = 0;
  window.addEventListener('pdf2book:catalog-updated', () => {
    updateEvents += 1;
  });

  const selectAllCheckbox = window.document.querySelector(
    'thead input[type="checkbox"]'
  );
  selectAllCheckbox.click();
  await waitForAdminRender();

  const hideSelectedButton = Array.from(window.document.querySelectorAll('button')).find(
    (button) => button.textContent === 'Hide Selected'
  );
  hideSelectedButton.click();
  await waitForAdminRender();
  await waitForAdminRender();

  const latestCatalog = fetchHarness.getCatalogPayload();
  assert.equal(latestCatalog.books[0].visibility, 'hidden');
  assert.equal(latestCatalog.books[1].visibility, 'hidden');
  assert.equal(updateEvents, 1);
});

test('permanent delete requires typed id and removes book from catalog', async () => {
  const { window, fetchHarness } = bootAdmin({
    books: [
      {
        id: 'book-1',
        title: 'Book One',
        visibility: 'published',
        source_pdf: 'book-1.pdf',
      },
    ],
    bookTree: {
      'docs/books/book-1': [],
    },
  });
  await waitForAdminRender();

  let updateEvents = 0;
  window.addEventListener('pdf2book:catalog-updated', () => {
    updateEvents += 1;
  });

  const deleteButton = Array.from(window.document.querySelectorAll('button')).find(
    (button) => button.textContent === 'Delete Permanently'
  );
  deleteButton.click();
  await waitForAdminRender();

  const confirmInput = window.document.querySelector('.admin-dialog-confirm input');
  const confirmButton = Array.from(window.document.querySelectorAll('.admin-modal button')).find(
    (button) => button.textContent === 'Delete Permanently'
  );
  assert.ok(confirmInput);
  assert.ok(confirmButton);
  assert.equal(confirmButton.disabled, true);

  confirmInput.value = 'book-1';
  confirmInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await waitForAdminRender();
  assert.equal(confirmButton.disabled, false);

  confirmButton.click();
  await waitForAdminRender();
  await waitForAdminRender();

  const latestCatalog = fetchHarness.getCatalogPayload();
  assert.equal(latestCatalog.books.length, 0);
  assert.equal(updateEvents, 1);
});
