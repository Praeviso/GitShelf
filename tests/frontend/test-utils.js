const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function createReaderShellHtml() {
  return `<!DOCTYPE html>
  <html lang="en" data-theme="light">
    <body>
      <a href="#main-content" class="skip-link">Skip to content</a>
      <header class="top-bar">
        <div class="top-bar-left">
          <button class="sidebar-toggle" type="button" aria-label="Open table of contents" hidden>&#9776;</button>
          <a href="#/" class="top-bar-title">PDF2Book</a>
          <span class="top-bar-breadcrumb"></span>
        </div>
        <div class="top-bar-right">
          <button class="theme-toggle" type="button" aria-label="Switch to dark theme">
            <span class="theme-icon-light" aria-hidden="true">&#9728;</span>
            <span class="theme-icon-dark" aria-hidden="true">&#127769;</span>
          </button>
          <a href="#/" class="top-bar-bookshelf-link" hidden>Bookshelf</a>
          <a href="#/admin" class="admin-link" aria-label="Settings">&#9881;</a>
        </div>
      </header>
      <aside class="sidebar" id="sidebar">
        <nav class="sidebar-nav" aria-label="Table of contents"></nav>
      </aside>
      <div class="sidebar-backdrop" id="sidebar-backdrop" hidden></div>
      <main id="main-content" class="main-content">
        <div id="bookshelf-view" class="view"></div>
        <div id="reader-view" class="view"></div>
        <div id="admin-view" class="view"></div>
      </main>
    </body>
  </html>`;
}

function createAdminHtml() {
  return `<!DOCTYPE html>
  <html lang="en" data-theme="light">
    <body>
      <div id="admin-view"></div>
    </body>
  </html>`;
}

function createMatchMedia(matchers) {
  return function matchMedia(query) {
    const matches = typeof matchers === 'function' ? matchers(query) : Boolean(matchers && matchers[query]);
    return {
      matches,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    };
  };
}

function createResponse(config) {
  const bodyText = Object.prototype.hasOwnProperty.call(config, 'text')
    ? config.text
    : Object.prototype.hasOwnProperty.call(config, 'json')
      ? JSON.stringify(config.json)
      : '';

  return {
    ok: config.ok !== false,
    status: config.status || 200,
    async json() {
      if (Object.prototype.hasOwnProperty.call(config, 'json')) {
        return typeof config.json === 'function' ? config.json() : config.json;
      }
      return JSON.parse(bodyText);
    },
    async text() {
      return typeof bodyText === 'function' ? bodyText() : bodyText;
    },
  };
}

function setupDom(options) {
  const config = options || {};
  const dom = new JSDOM(config.html, {
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    url: config.url || 'https://example.com/#/',
  });

  const { window } = dom;
  window.matchMedia = createMatchMedia(config.matchMedia || {});
  window.requestAnimationFrame = (callback) => callback();
  window.cancelAnimationFrame = () => {};
  window.scrollTo = (...args) => {
    window.__scrollToCalls.push(args);
  };
  window.__scrollToCalls = [];
  window.__lastScrollIntoView = null;

  Object.defineProperty(window.Element.prototype, 'scrollIntoView', {
    configurable: true,
    value(optionsArg) {
      window.__lastScrollIntoView = optionsArg;
    },
  });

  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: config.innerWidth || 1280,
    writable: true,
  });

  window.fetch = config.fetchImpl || (() => Promise.reject(new Error('Missing fetch stub')));

  return dom;
}

function stubMarkdown(window, renderedHtml) {
  window.markdownit = function markdownItStub() {
    return {
      renderer: { rules: {} },
      use() {
        return this;
      },
      render() {
        return renderedHtml;
      },
    };
  };

  window.texmath = function texMathPlugin() {};
  window.katex = {};
}

function loadBrowserScript(window, relativePath) {
  const absolutePath = path.join(REPO_ROOT, relativePath);
  const source = fs.readFileSync(absolutePath, 'utf8');
  window.eval(source);
}

async function flushPromises() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

module.exports = {
  createAdminHtml,
  createReaderShellHtml,
  createResponse,
  flushPromises,
  loadBrowserScript,
  setupDom,
  stubMarkdown,
};
