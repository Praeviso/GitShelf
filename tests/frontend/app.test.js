import { render, screen, waitFor, cleanup } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/components/App';

function createFetchStub(options = {}) {
  const config = options;
  let manifestRequestCount = 0;

  const fetchStub = vi.fn(async (url) => {
    const target = String(url);

    if (target.includes('manifest.json')) {
      const items = typeof config.getManifestItems === 'function'
        ? config.getManifestItems(manifestRequestCount)
        : (config.manifestItems || []);
      manifestRequestCount += 1;
      return {
        ok: true,
        json: async () => ({ items }),
        text: async () => JSON.stringify({ items }),
      };
    }

    if (target.includes('books/demo-book/toc.json')) {
      return {
        ok: true,
        json: async () => ({
          title: 'Demo Book',
          children: [
            {
              title: 'Chapter 1',
              slug: 'chapter-1',
              children: [
                { title: 'Section A', slug: 'chapter-1', anchor: 'section-a' },
              ],
            },
          ],
        }),
      };
    }

    if (target.includes('books/demo-book/chapters/chapter-1.md')) {
      return {
        ok: true,
        text: async () => '# Chapter 1\n\n## Section A',
      };
    }

    if (target.includes('articles/my-doc/content.md')) {
      return {
        ok: true,
        text: async () => '# My Doc\n\n## Section A',
      };
    }

    return {
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => 'Not found',
    };
  });

  fetchStub.getManifestRequestCount = () => manifestRequestCount;
  return fetchStub;
}

describe('frontend app flows', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    sessionStorage.clear();
    document.documentElement.setAttribute('data-theme', 'light');
    window.location.hash = '#/';
    global.fetch = undefined;
    window.scrollTo = vi.fn();
    window.open = vi.fn();
    navigator.clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === '(prefers-reduced-motion: reduce)' ? false : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('falls back home for removed legacy chapter routes', async () => {
    window.location.hash = '#/demo-book/chapters/chapter-1';
    global.fetch = createFetchStub({
      manifestItems: [
        { id: 'book-one', type: 'book', title: 'Current Catalog', chapters_count: 2, word_count: 1200 },
      ],
    });

    render(<App />);

    expect((await screen.findAllByText('Current Catalog')).length).toBeGreaterThan(0);
  });

  it('scrolls article anchor links instead of forcing the page back to top', async () => {
    const scrollIntoView = vi.fn();
    window.location.hash = '#/articles/my-doc#section-a';
    global.fetch = createFetchStub();
    window.scrollTo = vi.fn();
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    render(<App />);

    expect(await screen.findByText('Section A')).toBeInTheDocument();
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('refreshes the homepage when catalog updates are emitted', async () => {
    global.fetch = createFetchStub({
      getManifestItems(requestCount) {
        if (requestCount === 0) {
          return [{ id: 'book-one', type: 'book', title: 'Original Title', chapters_count: 2, word_count: 1200 }];
        }
        return [{ id: 'book-one', type: 'book', title: 'Updated Title', chapters_count: 2, word_count: 1200 }];
      },
    });

    render(<App />);

    expect((await screen.findAllByText('Original Title')).length).toBeGreaterThan(0);
    window.dispatchEvent(new CustomEvent('gitshelf:catalog-updated'));
    expect((await screen.findAllByText('Updated Title')).length).toBeGreaterThan(0);
  });
});
