import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useRouter } from '../../src/hooks/useRouter';

beforeEach(() => {
  window.location.hash = '';
});

describe('useRouter', () => {
  it('returns bookshelf route for root', () => {
    window.location.hash = '#/';
    const { result } = renderHook(() => useRouter());
    expect(result.current.type).toBe('bookshelf');
  });

  it('returns admin route for #/admin', () => {
    window.location.hash = '#/admin';
    const { result } = renderHook(() => useRouter());
    expect(result.current.type).toBe('admin');
  });

  it('returns book route for #/book-id', () => {
    window.location.hash = '#/my-book';
    const { result } = renderHook(() => useRouter());
    expect(result.current.type).toBe('book');
    expect(result.current.bookId).toBe('my-book');
  });

  it('returns chapter route with slug', () => {
    window.location.hash = '#/my-book/chapters/ch-01';
    const { result } = renderHook(() => useRouter());
    expect(result.current.type).toBe('chapter');
    expect(result.current.bookId).toBe('my-book');
    expect(result.current.slug).toBe('ch-01');
  });

  it('updates on hashchange', async () => {
    window.location.hash = '#/';
    const { result } = renderHook(() => useRouter());
    expect(result.current.type).toBe('bookshelf');

    await act(() => {
      window.location.hash = '#/admin';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(result.current.type).toBe('admin');
  });
});
