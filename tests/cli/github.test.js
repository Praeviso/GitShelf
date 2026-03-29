/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const https = require('node:https');
const githubPath = require.resolve('../../cli/github.js');

function installGithubApiMock(routes) {
  return vi.spyOn(https, 'request').mockImplementation((options, handler) => {
    const method = options.method || 'GET';
    const key = `${method} ${options.path}`;
    const route = routes.get(key);

    if (!route) {
      throw new Error(`Unexpected GitHub API request: ${key}`);
    }

    routes.delete(key);

    let payload = '';
    return {
      on() {
        return this;
      },
      write(chunk) {
        payload += chunk.toString();
      },
      end() {
        if (route.assertBody) {
          route.assertBody(payload ? JSON.parse(payload) : null);
        }

        const response = new EventEmitter();
        response.statusCode = route.statusCode ?? 200;
        handler(response);

        const body = route.rawBody ?? (route.body == null ? '' : JSON.stringify(route.body));
        if (body) {
          response.emit('data', Buffer.from(body));
        }
        response.emit('end');
      },
    };
  });
}

afterEach(() => {
  delete require.cache[githubPath];
  vi.restoreAllMocks();
});

describe('cli github helpers', () => {
  it('deletes nested generated files and only removes the matching typed catalog entry', async () => {
    delete require.cache[githubPath];
    const { deleteItem } = require('../../cli/github.js');

    const routes = new Map([
      ['GET /repos/owner/repo/contents/docs/sites/shared', {
        body: [
          { type: 'file', name: 'index.html', path: 'docs/sites/shared/index.html' },
          { type: 'dir', name: 'assets', path: 'docs/sites/shared/assets' },
        ],
      }],
      ['GET /repos/owner/repo/contents/docs/sites/shared/assets', {
        body: [
          { type: 'file', name: 'app.js', path: 'docs/sites/shared/assets/app.js' },
        ],
      }],
      ['GET /repos/owner/repo/git/refs/heads/main', {
        body: { object: { sha: 'commit-base' } },
      }],
      ['GET /repos/owner/repo/git/commits/commit-base', {
        body: { sha: 'commit-base', tree: { sha: 'tree-base' } },
      }],
      ['POST /repos/owner/repo/git/trees', {
        body: { sha: 'tree-next' },
        assertBody(payload) {
          const deletePaths = payload.tree.filter((entry) => entry.sha === null).map((entry) => entry.path);
          expect(deletePaths).toEqual(expect.arrayContaining([
            'docs/sites/shared/index.html',
            'docs/sites/shared/assets/app.js',
          ]));

          const catalogEntry = payload.tree.find((entry) => entry.path === 'docs/catalog.json');
          const manifestEntry = payload.tree.find((entry) => entry.path === 'docs/manifest.json');
          const metadataEntry = payload.tree.find((entry) => entry.path === 'docs/catalog-metadata.json');

          expect(catalogEntry).toBeTruthy();
          expect(manifestEntry).toBeTruthy();
          expect(metadataEntry).toBeTruthy();

          const catalog = JSON.parse(catalogEntry.content);
          const manifest = JSON.parse(manifestEntry.content);
          const metadata = JSON.parse(metadataEntry.content);

          expect(catalog.items).toEqual([
            expect.objectContaining({ id: 'shared', type: 'book', title: 'Shared Book' }),
          ]);
          expect(manifest.items).toEqual([
            expect.objectContaining({ id: 'shared', type: 'book', title: 'Shared Book' }),
          ]);
          expect(metadata.items).toEqual([
            expect.objectContaining({ id: 'shared', type: 'book' }),
          ]);
        },
      }],
      ['POST /repos/owner/repo/git/commits', {
        body: { sha: 'commit-next' },
        assertBody(payload) {
          expect(payload).toMatchObject({
            message: 'chore(admin): delete site shared',
            tree: 'tree-next',
            parents: ['commit-base'],
          });
        },
      }],
      ['PATCH /repos/owner/repo/git/refs/heads/main', {
        body: { ref: 'refs/heads/main', object: { sha: 'commit-next' } },
        assertBody(payload) {
          expect(payload).toEqual({ sha: 'commit-next', force: false });
        },
      }],
    ]);

    installGithubApiMock(routes);

    const catalog = [
      {
        id: 'shared',
        type: 'book',
        title: 'Shared Book',
        display_title: '',
        visibility: 'published',
        source: 'shared.pdf',
        tags: [],
        featured: false,
        chapters_count: 3,
        word_count: 1200,
        created_at: '2026-03-29T00:00:00Z',
        updated_at: '2026-03-29T00:00:00Z',
      },
      {
        id: 'shared',
        type: 'site',
        title: 'Shared Site',
        display_title: '',
        visibility: 'published',
        source: 'shared.zip',
        entry: 'sites/shared/index.html',
        tags: [],
        featured: false,
        created_at: '2026-03-29T00:00:00Z',
        updated_at: '2026-03-29T00:00:00Z',
      },
    ];

    await deleteItem(catalog[1], 'owner/repo', catalog, 'token');

    expect([...routes.keys()]).toEqual([]);
  });
});
