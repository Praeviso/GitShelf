const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createReaderShellHtml,
  createResponse,
  flushPromises,
  loadBrowserScript,
  setupDom,
  stubMarkdown,
} = require('./test-utils');

function createAppFetch(options) {
  const config = options || {};

  return async function fetchStub(url) {
    const target = String(url);

    if (target === 'books/demo-book/toc.json') {
      return createResponse({
        json: {
          title: 'Demo Book',
          children: [
            {
              title: 'Chapter 1',
              slug: 'chapter-1',
              children: [
                {
                  title: 'Section A',
                  slug: 'chapter-1',
                  anchor: 'section-a',
                },
              ],
            },
          ],
        },
      });
    }

    if (target === 'books/demo-book/chapters/chapter-1.md') {
      return createResponse({
        text: '# Chapter 1\n\n## Section A',
      });
    }

    if (target === 'books/demo-book/README.md') {
      return createResponse({
        text: '# Demo Book',
      });
    }

    if (target === 'manifest.json') {
      if (typeof config.onManifestRequest === 'function') {
        config.onManifestRequest();
      }

      return createResponse({
        json: {
          books:
            typeof config.getManifestBooks === 'function'
              ? config.getManifestBooks()
              : config.books || [],
        },
      });
    }

    throw new Error(`Unexpected fetch URL: ${target}`);
  };
}

test('reader sidebar exposes aria state and restores focus on escape', async () => {
  const dom = setupDom({
    html: createReaderShellHtml(),
    url: 'https://example.com/#/demo-book/chapters/chapter-1',
    innerWidth: 820,
    fetchImpl: createAppFetch(),
  });
  const { window } = dom;

  stubMarkdown(window, '<h1>Chapter 1</h1><h2 id="section-a">Section A</h2>');
  loadBrowserScript(window, 'docs/assets/shared.js');
  loadBrowserScript(window, 'docs/assets/app.js');
  await flushPromises();
  await flushPromises();

  const toggle = window.document.querySelector('.sidebar-toggle');
  const sidebar = window.document.getElementById('sidebar');

  assert.equal(toggle.hidden, false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(window.document.title, 'Chapter 1 · Demo Book · PDF2Book');

  toggle.click();
  await flushPromises();

  assert.equal(sidebar.classList.contains('open'), true);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.notEqual(window.document.activeElement, toggle);

  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  await flushPromises();

  assert.equal(sidebar.classList.contains('open'), false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(window.document.activeElement, toggle);
});

test('reader anchor scrolling respects reduced motion preferences', async () => {
  const dom = setupDom({
    html: createReaderShellHtml(),
    url: 'https://example.com/#/demo-book/chapters/chapter-1#section-a',
    innerWidth: 1280,
    matchMedia: {
      '(prefers-reduced-motion: reduce)': true,
      '(prefers-color-scheme: dark)': false,
    },
    fetchImpl: createAppFetch(),
  });
  const { window } = dom;

  stubMarkdown(window, '<h1>Chapter 1</h1><h2 id="section-a">Section A</h2>');
  loadBrowserScript(window, 'docs/assets/shared.js');
  loadBrowserScript(window, 'docs/assets/app.js');
  await flushPromises();
  await flushPromises();

  assert.ok(window.__lastScrollIntoView);
  assert.equal(window.__lastScrollIntoView.behavior, 'auto');
  assert.equal(window.__lastScrollIntoView.block, 'start');
});

test('bookshelf renders curated metadata and refreshes after catalog updates', async () => {
  let manifestRequests = 0;
  let currentBooks = [
    {
      id: 'demo-book',
      title: 'Curated Title',
      author: 'Ada Lovelace',
      summary: 'A practical guide to analytical engines.',
      tags: ['history', 'math'],
      featured: true,
      chapters_count: 12,
      word_count: 34567,
    },
  ];

  const dom = setupDom({
    html: createReaderShellHtml(),
    url: 'https://example.com/#/',
    fetchImpl: createAppFetch({
      getManifestBooks() {
        return currentBooks;
      },
      onManifestRequest() {
        manifestRequests += 1;
      },
    }),
  });
  const { window } = dom;

  stubMarkdown(window, '');
  loadBrowserScript(window, 'docs/assets/shared.js');
  loadBrowserScript(window, 'docs/assets/app.js');
  await flushPromises();
  await flushPromises();

  const shelfText = window.document.getElementById('bookshelf-view').textContent;
  assert.match(shelfText, /Curated Title/);
  assert.match(shelfText, /Ada Lovelace/);
  assert.match(shelfText, /history/);
  assert.equal(manifestRequests, 1);

  currentBooks = [
    {
      id: 'demo-book',
      title: 'Updated Catalog Title',
      author: 'Ada Lovelace',
      summary: 'A practical guide to analytical engines.',
      tags: ['history'],
      chapters_count: 12,
      word_count: 34567,
    },
  ];

  window.dispatchEvent(new window.CustomEvent('pdf2book:catalog-updated'));
  await flushPromises();
  await flushPromises();

  const updatedShelfText = window.document.getElementById('bookshelf-view').textContent;
  assert.match(updatedShelfText, /Updated Catalog Title/);
  assert.equal(manifestRequests, 2);
});
