import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/preact';
import { EpubReader } from '../../src/components/EpubReader';

const renditionDisplayMock = vi.fn(() => Promise.resolve());
const renditionOnMock = vi.fn();
const renditionOffMock = vi.fn();
const renditionReportLocationMock = vi.fn(() => Promise.resolve());
const renditionMock = {
  display: renditionDisplayMock,
  on: renditionOnMock,
  off: renditionOffMock,
  reportLocation: renditionReportLocationMock,
  getContents: vi.fn(() => []),
  themes: {
    registerCss: vi.fn(),
    select: vi.fn(),
    override: vi.fn(),
  },
};

const bookDestroyMock = vi.fn();
const bookLocationsGenerateMock = vi.fn(() => Promise.resolve());
const bookRenderToMock = vi.fn(() => renditionMock);
const epubFactoryMock = vi.fn(() => ({
  renderTo: bookRenderToMock,
  ready: Promise.resolve(),
  locations: {
    generate: bookLocationsGenerateMock,
  },
  destroy: bookDestroyMock,
}));

vi.mock('epubjs', () => ({
  default: epubFactoryMock,
}));

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
  localStorage.clear();
  renditionDisplayMock.mockClear();
  renditionOnMock.mockClear();
  renditionOffMock.mockClear();
  renditionReportLocationMock.mockClear();
  bookDestroyMock.mockClear();
  bookLocationsGenerateMock.mockClear();
  bookRenderToMock.mockClear();
  epubFactoryMock.mockClear();
  renditionMock.getContents.mockReturnValue([]);
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);

  global.fetch = mockFetch({
    'books/demo-book/toc.json': {
      title: 'Demo EPUB',
      children: [
        { title: 'Chapter One', slug: 'chapter-1', href: 'chapter-1.xhtml' },
        { title: 'Chapter Two', slug: 'chapter-2', href: 'chapter-2.xhtml' },
      ],
    },
  });
});

describe('EpubReader', () => {
  it('prefers a stored CFI when reopening the same EPUB chapter', async () => {
    localStorage.setItem(
      'gitshelf:epub-location:demo-book',
      JSON.stringify({
        slug: 'chapter-1',
        cfi: 'epubcfi(/6/2[chapter-1]!/4/2/14)',
      }),
    );

    render(
      <EpubReader
        bookId="demo-book"
        slug="chapter-1"
        onTocLoaded={() => {}}
        onActiveAnchor={() => {}}
        onProgressChange={() => {}}
        theme="light"
      />,
    );

    await waitFor(() => expect(epubFactoryMock).toHaveBeenCalledWith('./books/demo-book/book.epub'));
    await waitFor(() =>
      expect(renditionDisplayMock).toHaveBeenCalledWith('epubcfi(/6/2[chapter-1]!/4/2/14)'),
    );
    expect(bookRenderToMock).toHaveBeenCalled();
    expect(bookLocationsGenerateMock).toHaveBeenCalled();
  });

  it('scrolls to the matching heading when multiple TOC entries share one XHTML file', async () => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(
      `
        <html>
          <body>
            <p><span>1.2 线程的优势</span></p>
            <p><span>1.2.1 发挥多处理器的强大能力</span></p>
            <p>Body text.</p>
          </body>
        </html>
      `,
      'text/html',
    );
    const scrollIntoView = vi.fn();
    doc.querySelectorAll('span').forEach((element) => {
      element.scrollIntoView = scrollIntoView;
    });
    renditionMock.getContents.mockReturnValue([{ document: doc }]);

    global.fetch = mockFetch({
      'books/demo-book/toc.json': {
        title: 'Demo EPUB',
        children: [
          { title: '1.2 线程的优势', slug: 'section-1-2', href: 'text00005.xhtml' },
          { title: '1.2.1 发挥多处理器的强大能力', slug: 'section-1-2-1', href: 'text00005.xhtml' },
        ],
      },
    });

    render(
      <EpubReader
        bookId="demo-book"
        slug="section-1-2-1"
        onTocLoaded={() => {}}
        onActiveAnchor={() => {}}
        onProgressChange={() => {}}
        theme="light"
      />,
    );

    await waitFor(() => expect(renditionDisplayMock).toHaveBeenCalledWith('text00005.xhtml'));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(renditionReportLocationMock).toHaveBeenCalled();
  });
});
