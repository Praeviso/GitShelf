import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { App } from '../../src/components/App';

// Mock fetch for manifest
function mockFetch(responses = {}) {
  return vi.fn((url) => {
    const key = Object.keys(responses).find((k) => url.includes(k));
    if (key) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(responses[key]),
        text: () => Promise.resolve(JSON.stringify(responses[key])),
      });
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('Not found'),
    });
  });
}

beforeEach(() => {
  window.location.hash = '#/';
  localStorage.clear();
});

describe('App', () => {
  it('renders home heading on root route', async () => {
    global.fetch = mockFetch({
      'manifest.json': { items: [] },
    });

    render(<App />);

    const elements = await screen.findAllByText('GitShelf');
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  it('renders content cards when manifest has items', async () => {
    global.fetch = mockFetch({
      'manifest.json': {
        items: [
          { id: 'test-book', type: 'book', title: 'Test Book', chapters_count: 5, word_count: 10000 },
        ],
      },
    });

    render(<App />);

    const titles = await screen.findAllByText('Test Book');
    expect(titles.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/5 chapters/)).toBeInTheDocument();
  });

  it('shows empty state when no items', async () => {
    global.fetch = mockFetch({
      'manifest.json': { items: [] },
    });

    render(<App />);

    expect(await screen.findByText('No content yet')).toBeInTheDocument();
    expect(screen.getByText('admin panel')).toHaveAttribute('href', '#/admin');
  });

  it('renders theme toggle button', () => {
    global.fetch = mockFetch({ 'manifest.json': { items: [] } });
    render(<App />);

    const btn = screen.getByLabelText(/switch to dark theme/i);
    expect(btn).toBeInTheDocument();
  });

  it('renders admin link', () => {
    global.fetch = mockFetch({ 'manifest.json': { items: [] } });
    render(<App />);

    const link = screen.getByLabelText('Settings');
    expect(link).toHaveAttribute('href', '#/admin');
  });
});
