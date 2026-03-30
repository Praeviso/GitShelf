import markdownit from 'markdown-it';
import texmath from 'markdown-it-texmath';
import katex from 'katex';

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const md = markdownit({ html: true, linkify: true, typographer: true });

function resolveImageSrc(src, assetBase) {
  const value = String(src || '').trim();
  if (!value || !assetBase) return value;

  if (
    value.startsWith('/') ||
    value.startsWith('#') ||
    value.startsWith('books/') ||
    value.startsWith('./books/') ||
    value.startsWith('../books/') ||
    value.startsWith('//') ||
    /^[a-z][a-z0-9+.-]*:/i.test(value)
  ) {
    return value;
  }

  const match = value.match(/^(?:\.\.\/|\.\/)*images\/(.+)$/);
  if (!match) return value;

  return `${assetBase.replace(/\/+$/, '')}/images/${match[1]}`;
}

/** Strip dangerous HTML while allowing safe structural tags (tables, formatting, etc.) */
function sanitizeHtml(html) {
  // Remove dangerous tags and their content
  html = html.replace(/<(script|style|iframe|object|embed|form|textarea|select)\b[^]*?<\/\1>/gi, '');
  // Remove self-closing / void dangerous tags
  html = html.replace(/<(script|style|iframe|object|embed|input|link|meta)\b[^>]*\/?>/gi, '');
  // Remove event handler attributes (onclick, onerror, etc.)
  html = html.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // Remove javascript: URLs in href/src
  html = html.replace(/(href|src)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, '$1=""');
  return html;
}
md.use(texmath, { engine: katex, delimiters: 'dollars' });

const originalHeadingOpen =
  md.renderer.rules.heading_open ||
  function (tokens, idx, options, _env, self) {
    return self.renderToken(tokens, idx, options);
  };

md.renderer.rules.heading_open = function (tokens, idx, options, env, self) {
  const token = tokens[idx];
  const contentToken = tokens[idx + 1];
  if (contentToken && contentToken.children) {
    const text = contentToken.children
      .filter((child) => child.type === 'text' || child.type === 'code_inline')
      .map((child) => child.content)
      .join('');
    const id = slugify(text);
    token.attrSet('id', id);
    // Store slug for heading_close to generate anchor link
    env._headingSlug = id;
  }
  return originalHeadingOpen(tokens, idx, options, env, self);
};

// Inject anchor link at the end of heading content
const originalHeadingClose =
  md.renderer.rules.heading_close ||
  function (tokens, idx, options, _env, self) {
    return self.renderToken(tokens, idx, options);
  };

md.renderer.rules.heading_close = function (tokens, idx, options, env, self) {
  let anchorHtml = '';
  if (env._headingSlug) {
    anchorHtml = ` <a class="heading-anchor" data-anchor="${md.utils.escapeHtml(env._headingSlug)}" href="javascript:void(0)" aria-label="Link to this section">#</a>`;
    env._headingSlug = null;
  }
  return anchorHtml + originalHeadingClose(tokens, idx, options, env, self);
};

// Wrap images in <figure> with <figcaption> from alt text
md.renderer.rules.image = function (tokens, idx, _options, env) {
  const token = tokens[idx];
  const src = resolveImageSrc(token.attrGet('src') || '', env?.assetBase);
  const alt = token.children
    ? token.children.map((c) => c.content).join('')
    : (token.content || '');
  const title = token.attrGet('title') || '';
  const titleAttr = title ? ` title="${md.utils.escapeHtml(title)}"` : '';
  const imgHtml = `<img src="${md.utils.escapeHtml(src)}" alt="${md.utils.escapeHtml(alt)}"${titleAttr} loading="lazy">`;
  if (alt) {
    return `<figure>${imgHtml}<figcaption>${md.utils.escapeHtml(alt)}</figcaption></figure>`;
  }
  return `<figure>${imgHtml}</figure>`;
};

/** Normalize Unicode bullet chars (•, ◦, ▪, ▸, ‣) into markdown list syntax.
 *  Skips fenced code blocks and math blocks to avoid false positives. */
function normalizeBullets(text) {
  const bulletRe = /^([ \t]*)[•◦▪▸‣]\s*/gm;
  const fenceRe = /^([ \t]*)(```|~~~|\$\$)/gm;
  // Find all fenced regions (code blocks, math blocks)
  const protected_ = [];
  let match;
  let openIdx = -1;
  let openFence = '';
  const lines = text.split('\n');
  let pos = 0;
  for (const line of lines) {
    const lineStart = pos;
    const lineEnd = pos + line.length;
    const trimmed = line.trimStart();
    if (openIdx === -1) {
      if (trimmed.startsWith('```') || trimmed.startsWith('~~~') || trimmed.startsWith('$$')) {
        openIdx = lineStart;
        openFence = trimmed.slice(0, trimmed.startsWith('$$') ? 2 : 3);
      }
    } else if (trimmed === openFence || (openFence === '```' && trimmed.startsWith('```')) || (openFence === '~~~' && trimmed.startsWith('~~~'))) {
      protected_.push([openIdx, lineEnd]);
      openIdx = -1;
    }
    pos = lineEnd + 1; // +1 for the \n
  }
  if (openIdx !== -1) protected_.push([openIdx, text.length]);

  return text.replace(bulletRe, (full, indent, offset) => {
    for (const [start, end] of protected_) {
      if (offset >= start && offset < end) return full;
    }
    return indent + '- ';
  });
}

export { normalizeBullets as _normalizeBullets };

export function renderMarkdown(text, options = {}) {
  const normalized = normalizeBullets(text);
  const html = sanitizeHtml(md.render(normalized, { assetBase: options.assetBase || '' }));
  return html.replace(/<table[\s>]/g, '<div class="table-scroll">$&').replace(/<\/table>/g, '</table></div>');
}

function createCopyIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const rect = document.createElementNS(ns, 'rect');
  rect.setAttribute('x', '5.5');
  rect.setAttribute('y', '5.5');
  rect.setAttribute('width', '8');
  rect.setAttribute('height', '8');
  rect.setAttribute('rx', '1.5');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M3 10.5H2.5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1V3');
  svg.appendChild(rect);
  svg.appendChild(path);
  return svg;
}

function createCheckIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M3 8.5l3 3 7-7');
  svg.appendChild(path);
  return svg;
}

export function addCopyButtons(container) {
  const pres = container.querySelectorAll('pre');
  for (const pre of pres) {
    if (pre.querySelector('.copy-btn')) continue;
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);

    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Copy code');
    btn.appendChild(createCopyIcon());
    btn.addEventListener('click', () => {
      const code = pre.querySelector('code');
      const text = code ? code.textContent : pre.textContent;
      navigator.clipboard.writeText(text).then(() => {
        btn.replaceChildren(createCheckIcon());
        btn.classList.add('copied');
        setTimeout(() => {
          btn.replaceChildren(createCopyIcon());
          btn.classList.remove('copied');
        }, 2000);
      });
    });
    wrapper.appendChild(btn);
  }
}

let highlighter = null;
let loading = false;

export async function highlightCodeBlocks(container) {
  const codeBlocks = container.querySelectorAll('pre code');
  if (codeBlocks.length === 0) return;

  try {
    if (!highlighter && !loading) {
      loading = true;
      const shikiModule = await import('https://cdn.jsdelivr.net/npm/shiki/+esm');
      highlighter = await shikiModule.createHighlighter({
        themes: ['github-light', 'github-dark'],
        langs: [
          'javascript', 'typescript', 'python', 'bash', 'shell', 'json',
          'html', 'css', 'markdown', 'yaml', 'sql', 'java', 'c', 'cpp',
          'go', 'rust', 'ruby', 'php',
        ],
      });
      loading = false;
    }

    if (!highlighter) return;
    const loadedLanguages = highlighter.getLoadedLanguages();

    for (const block of codeBlocks) {
      const languageClass = Array.from(block.classList).find((c) => c.startsWith('language-'));
      const language = languageClass ? languageClass.replace('language-', '') : 'text';
      const code = block.textContent;

      try {
        if (!loadedLanguages.includes(language) && language !== 'text') continue;
        const highlighted = highlighter.codeToHtml(code, {
          lang: language,
          themes: { light: 'github-light', dark: 'github-dark' },
        });
        const pre = block.parentElement;
        if (pre && pre.tagName === 'PRE') {
          const temp = document.createElement('div');
          temp.insertAdjacentHTML('afterbegin', highlighted);
          const newPre = temp.querySelector('pre');
          if (newPre) pre.replaceWith(newPre);
        }
      } catch (_) {
        // Unsupported languages remain readable without highlighting
      }
    }
  } catch (_) {
    // Syntax highlighting is best-effort
  }
}
