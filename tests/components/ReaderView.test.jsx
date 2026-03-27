import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/preact';
import { ReaderView } from '../../src/components/ReaderView';

function mockFetch(responses = {}) {
  return vi.fn((url) => {
    const key = Object.keys(responses).find((candidate) => String(url).includes(candidate));
    if (!key) {
      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('Not found'),
      });
    }

    const body = responses[key];
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    });
  });
}

beforeEach(() => {
  global.fetch = undefined;
  window.location.hash = '#/';
  document.title = 'PDF2Book';
});

describe('ReaderView', () => {
  it('rewrites chapter image paths to the book image directory', async () => {
    global.fetch = mockFetch({
      'books/my-book/toc.json': { title: 'My Book', children: [] },
      'books/my-book/chapters/chapter-1.md': '![Diagram](images/diagram.png)',
    });

    const { container } = render(
      <ReaderView bookId="my-book" slug="chapter-1" anchor={null} onTocLoaded={() => {}} />
    );

    await waitFor(() => expect(container.querySelector('img')).toBeInTheDocument());
    expect(container.querySelector('img')).toHaveAttribute('src', 'books/my-book/images/diagram.png');
  });

  it('keeps already localized book image paths unchanged', async () => {
    global.fetch = mockFetch({
      'books/my-book/toc.json': { title: 'My Book', children: [] },
      'books/my-book/chapters/chapter-1.md': '![Diagram](books/my-book/images/diagram.png)',
    });

    const { container } = render(
      <ReaderView bookId="my-book" slug="chapter-1" anchor={null} onTocLoaded={() => {}} />
    );

    await waitFor(() => expect(container.querySelector('img')).toBeInTheDocument());
    expect(container.querySelector('img')).toHaveAttribute('src', 'books/my-book/images/diagram.png');
  });

  it('rewrites chapter-relative parent image paths for rendered content', async () => {
    global.fetch = mockFetch({
      'books/my-book/toc.json': { title: 'My Book', children: [] },
      'books/my-book/chapters/chapter-1.md': '![Diagram](../images/diagram.png)',
    });

    const { container } = render(
      <ReaderView bookId="my-book" slug="chapter-1" anchor={null} onTocLoaded={() => {}} />
    );

    await waitFor(() => expect(container.querySelector('img')).toBeInTheDocument());
    expect(container.querySelector('img')).toHaveAttribute('src', 'books/my-book/images/diagram.png');
  });
});
