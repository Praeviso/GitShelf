import { defineConfig } from 'vite';
import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import preact from '@preact/preset-vite';

const MIME_TYPES = {
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

// Serve data files (manifest.json, books/, catalog*.json) from docs/ during dev
function serveDocsData() {
  const docsDir = resolve(__dirname, 'docs');
  return {
    name: 'serve-docs-data',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0];
        if (url && (url.startsWith('/manifest.json') || url.startsWith('/catalog') || url.startsWith('/books/'))) {
          const filePath = resolve(docsDir, url.slice(1));
          if (existsSync(filePath)) {
            const content = readFileSync(filePath);
            const ext = '.' + url.split('.').pop();
            res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
            res.end(content);
            return;
          }
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [
    preact({
      babel: {
        plugins: [],
      },
    }),
    serveDocsData(),
  ],
  root: 'src',
  base: './',
  build: {
    outDir: '../docs',
    emptyOutDir: false,
    assetsDir: 'assets',
  },
  publicDir: false,
  server: {
    fs: {
      allow: ['..'],
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['../tests/components/**/*.test.{js,jsx}', '../tests/hooks/**/*.test.{js,jsx}', '../tests/lib/**/*.test.{js,jsx}'],
    exclude: ['../tests/frontend/**'],
    setupFiles: ['../tests/setup.js'],
  },
});
