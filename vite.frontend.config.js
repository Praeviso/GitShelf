import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [
    preact({
      babel: {
        plugins: [],
      },
    }),
  ],
  root: 'src',
  base: './',
  publicDir: false,
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['../tests/frontend/**/*.test.{js,jsx}'],
    setupFiles: ['../tests/setup.js'],
  },
});
