import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useRouter } from '../../src/hooks/useRouter';

beforeEach(() => {
  window.location.hash = '';
});

describe('useRouter', () => {
  it('returns home route for root', () => {
    window.location.hash = '#/';
    const { result } = renderHook(() => useRouter());
    expect(result.current.type).toBe('home');
  });

  it('returns admin route for #/admin', () => {
    window.location.hash = '#/admin';
    const { result } = renderHook(() => useRouter());
    expect(result.current.type).toBe('admin');
  });

  it('returns book-overview route for #/books/book-id', () => {
    window.location.hash = '#/books/my-book';
    const { result } = renderHook(() => useRouter());
    expect(result.current.type).toBe('book-overview');
    expect(result.current.bookId).toBe('my-book');
  });

  it('returns chapter route with slug', () => {
    window.location.hash = '#/books/my-book/ch-01';
    const { result } = renderHook(() => useRouter());
    expect(result.current.type).toBe('chapter');
    expect(result.current.bookId).toBe('my-book');
    expect(result.current.slug).toBe('ch-01');
  });

  it('returns article route for #/articles/doc-id', () => {
    window.location.hash = '#/articles/my-doc';
    const { result } = renderHook(() => useRouter());
    expect(result.current.type).toBe('article');
    expect(result.current.articleId).toBe('my-doc');
  });

  it('returns site route for #/sites/site-id', () => {
    window.location.hash = '#/sites/my-site';
    const { result } = renderHook(() => useRouter());
    expect(result.current.type).toBe('site');
    expect(result.current.siteId).toBe('my-site');
  });

  it('updates on hashchange', async () => {
    window.location.hash = '#/';
    const { result } = renderHook(() => useRouter());
    expect(result.current.type).toBe('home');

    await act(() => {
      window.location.hash = '#/admin';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(result.current.type).toBe('admin');
  });
});
