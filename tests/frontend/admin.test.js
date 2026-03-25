const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAdminHtml,
  createResponse,
  flushPromises,
  loadBrowserScript,
  setupDom,
} = require('./test-utils');

function createAdminFetch(options) {
  const config = options || {};

  return async function fetchStub(url, requestOptions) {
    const target = String(url);
    const method = (requestOptions && requestOptions.method) || 'GET';

    if (target === 'manifest.json') {
      return createResponse({
        json: {
          books: config.books || [],
        },
      });
    }

    if (target === 'https://api.github.com/repos/owner/repo/contents/input/archived') {
      return createResponse({
        ok: false,
        status: 404,
        text: 'Not Found',
      });
    }

    if (target === 'https://api.github.com/repos/owner/repo/contents/.pdf2book.json') {
      if (method === 'GET') {
        return createResponse({
          ok: false,
          status: 404,
          text: 'Not Found',
        });
      }

      if (method === 'PUT') {
        return createResponse({
          ok: false,
          status: 500,
          text: 'save failed',
        });
      }
    }

    if (target === 'https://api.github.com/repos/owner/repo/actions/workflows/convert.yml/dispatches') {
      return createResponse({
        ok: false,
        status: 500,
        text: 'dispatch failed',
      });
    }

    if (
      target === 'https://api.github.com/repos/owner/repo/contents/docs/books/book-1' ||
      target === 'https://api.github.com/repos/owner/repo/contents/docs/manifest.json'
    ) {
      return createResponse({
        json: [],
      });
    }

    if (target === 'https://api.github.com/user') {
      return createResponse({
        json: { login: 'owner' },
      });
    }

    throw new Error(`Unexpected fetch request: ${method} ${target}`);
  };
}

function bootAdmin(options) {
  const config = options || {};
  const dom = setupDom({
    html: createAdminHtml(),
    url: 'https://example.com/#/admin',
    fetchImpl: createAdminFetch(config),
  });
  const { window } = dom;

  if (config.withPat) {
    window.localStorage.setItem('github_pat', 'token');
    window.localStorage.setItem('admin_repo_owner', 'owner');
    window.localStorage.setItem('admin_repo_name', 'repo');
  }

  loadBrowserScript(window, 'docs/assets/shared.js');
  loadBrowserScript(window, 'docs/assets/admin.js');

  return { dom, window };
}

test('auth view renders a labeled PAT field', async () => {
  const { window } = bootAdmin();
  await flushPromises();

  const input = window.document.querySelector('#admin-pat-input');
  const label = window.document.querySelector('label[for="admin-pat-input"]');

  assert.ok(input);
  assert.ok(label);
  assert.equal(input.getAttribute('name'), 'github_pat');
  assert.equal(label.textContent, 'Personal Access Token');
  assert.match(
    window.document.querySelector('button[type="submit"]').className,
    /\bbtn\b/
  );
});

test('split-level failures keep the settings controls intact', async () => {
  const { window } = bootAdmin({ withPat: true });
  await flushPromises();
  await flushPromises();

  const select = window.document.querySelector('#admin-split-level');
  assert.ok(select);

  select.value = 'H2';
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  await flushPromises();
  await flushPromises();

  const error = Array.from(window.document.querySelectorAll('.admin-error')).find((element) =>
    element.textContent.includes('Failed to save split level')
  );

  assert.ok(window.document.querySelector('#admin-split-level'));
  assert.ok(error);
  assert.equal(error.hidden, false);
});

test('re-convert failures render inline without removing action buttons', async () => {
  const { window } = bootAdmin({
    withPat: true,
    books: [
      {
        id: 'book-1',
        title: 'Book 1',
        chapters_count: 3,
        word_count: 1234,
        created_at: '2026-03-23T10:00:00Z',
      },
    ],
  });
  await flushPromises();
  await flushPromises();

  const reconvertButton = Array.from(window.document.querySelectorAll('button')).find(
    (button) => button.textContent === 'Re-convert'
  );
  reconvertButton.click();
  await flushPromises();
  await flushPromises();

  const actionsCell = reconvertButton.closest('td');
  assert.equal(actionsCell.querySelectorAll('.admin-actions button').length, 2);
  assert.match(actionsCell.textContent, /Re-convert failed/);
});

test('delete dialog exposes dialog semantics and restores focus on close', async () => {
  const { window } = bootAdmin({
    withPat: true,
    books: [
      {
        id: 'book-1',
        title: 'Book 1',
        chapters_count: 3,
        word_count: 1234,
        created_at: '2026-03-23T10:00:00Z',
      },
    ],
  });
  await flushPromises();
  await flushPromises();

  const deleteButton = Array.from(window.document.querySelectorAll('button')).find(
    (button) => button.textContent === 'Delete'
  );

  deleteButton.click();
  await flushPromises();

  const dialog = window.document.querySelector('[role="dialog"]');
  const overlay = window.document.querySelector('.admin-modal-overlay');

  assert.ok(dialog);
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  assert.equal(window.document.activeElement.textContent, 'Cancel');

  overlay.dispatchEvent(
    new window.KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
    })
  );
  await flushPromises();

  assert.equal(window.document.querySelector('[role="dialog"]'), null);
  assert.equal(window.document.activeElement, deleteButton);
});
