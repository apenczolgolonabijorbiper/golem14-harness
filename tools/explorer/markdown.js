/* Shared offline renderer for reference documents, related-document dialogs,
 * and release notes. Libraries are pinned, bundled and inlined by the builder. */
const markdownViews = new Map();
let markdownDiagramId = 0;

function markdownAnchor(text) {
  return text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-');
}

function markdownLink(path, href) {
  if (!href || /^(javascript|data|vbscript):/i.test(href)) return null;
  if (/^(https?:|mailto:)/i.test(href)) return {external: href};
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) return null;
  try {
    const url = new URL(href, 'https://embedded.invalid/' + path);
    if (url.origin !== 'https://embedded.invalid') return null;
    const target = decodeURIComponent(url.pathname.slice(1));
    return {path: target, anchor: decodeURIComponent(url.hash.slice(1))};
  } catch { return null; }
}

async function renderMarkdown(container, text, path) {
  const ticket = Symbol();
  markdownViews.set(container, {text, path, ticket});
  container.classList.add('markdown-body');
  container.textContent = 'Rendering document…';
  try {
    const {marked, DOMPurify, mermaid} = await window.golemMarkdownReady;
    if (markdownViews.get(container)?.ticket !== ticket) return;
    container.innerHTML = DOMPurify.sanitize(marked.parse(text, {gfm: true}), {
      USE_PROFILES: {html: true},
      ALLOW_DATA_ATTR: false,
      FORBID_TAGS: ['style', 'img', 'picture', 'source', 'video', 'audio', 'iframe', 'object', 'embed', 'svg', 'math'],
      FORBID_ATTR: ['style', 'src', 'srcset', 'id', 'name']
    });
    container.dataset.markdownPath = path;
    const used = new Map();
    container.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(heading => {
      const slug = markdownAnchor(heading.textContent), n = used.get(slug) || 0;
      used.set(slug, n + 1);
      heading.dataset.anchor = slug + (n ? '-' + n : '');
    });
    container.querySelectorAll('table').forEach(table => {
      const wrapper = document.createElement('div');
      wrapper.className = 'markdown-table';
      table.replaceWith(wrapper); wrapper.append(table);
    });
    container.querySelectorAll('input').forEach(input => { input.disabled = true; });
    container.querySelectorAll('a').forEach(link => {
      const resolved = markdownLink(path, link.getAttribute('href'));
      link.removeAttribute('href');
      if (!resolved) return;
      if (resolved.external) {
        link.href = resolved.external; link.target = '_blank'; link.rel = 'noopener noreferrer';
        return;
      }
      const doc = D.docs.find(d => d.path === resolved.path);
      if (doc) {
        link.href = '#' + resolved.anchor;
        link.onclick = async event => {
          event.preventDefault();
          if (resolved.path !== path) {
            await renderMarkdown(container, doc.text, doc.path);
            if (container === $('docText')) {
              currentDoc = doc.path; $('docTitle').textContent = doc.path;
              $('docGithub').href = github(doc.path); docsList();
            } else if (container === $('sourceBody')) {
              $('sourceTitle').textContent = doc.path; $('sourceGithub').href = github(doc.path);
            }
          }
          const target = [...container.querySelectorAll('[data-anchor]')].find(x => x.dataset.anchor === resolved.anchor);
          if (target) target.scrollIntoView({block: 'start'}); else container.scrollTop = 0;
        };
      } else {
        link.href = github(resolved.path) + (resolved.anchor ? '#' + resolved.anchor : '');
        link.target = '_blank'; link.rel = 'noopener noreferrer';
      }
    });
    const diagrams = [...container.querySelectorAll('pre > code.language-mermaid')];
    if (!diagrams.length) return;
    const css = getComputedStyle(document.body);
    const rootCss = getComputedStyle(document.documentElement);
    const color = (name, fallback) => css.getPropertyValue(name).trim() || rootCss.getPropertyValue(name).trim() || fallback;
    const configuration = {startOnLoad: false, securityLevel: 'strict', theme: 'base',
      suppressErrorRendering: true, fontFamily: 'system-ui, sans-serif',
      flowchart: {htmlLabels: false},
      themeVariables: {darkMode: !document.body.classList.contains('light'),
        background: color('--panel', '#131a26'),
        primaryColor: color('--panel2', '#192333'),
        primaryTextColor: color('--text', '#e8edf5'),
        primaryBorderColor: color('--accent', '#84efd2'),
        lineColor: color('--muted', '#98a9c0')}};
    for (const code of diagrams) {
      if (markdownViews.get(container)?.ticket !== ticket) return;
      const pre = code.parentElement;
      try {
        mermaid.initialize(configuration);
        // Diagram-local configuration cannot change the page's fixed policy.
        const definition = code.textContent.replace(/%%\{[\s\S]*?\}%%/g, '')
          .replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '');
        if (/(?:https?:|data:|file:|blob:|\/\/)|<(?:img|image|iframe|object|style)\b/i.test(definition)) {
          throw Error('External diagram resources are unavailable in this offline document');
        }
        const id = 'embedded-diagram-' + (++markdownDiagramId);
        const {svg} = await mermaid.render(id, definition);
        if (markdownViews.get(container)?.ticket !== ticket) return;
        const figure = document.createElement('figure'); figure.className = 'markdown-diagram';
        figure.innerHTML = DOMPurify.sanitize(svg, {USE_PROFILES: {svg: true, svgFilters: true},
          FORBID_TAGS: ['foreignObject', 'image', 'a', 'script'], FORBID_ATTR: ['href', 'xlink:href']});
        // Keep local marker references and generated theme styles, never URLs
        // for remote images, fonts or stylesheets.
        figure.querySelectorAll('style').forEach(style => {
          if (/@import|@font-face|url\(\s*['"]?(?!#)/i.test(style.textContent)) style.remove();
        });
        figure.querySelectorAll('*').forEach(node => {
          for (const attr of [...node.attributes]) {
            if (/url\(\s*['"]?(?!#)/i.test(attr.value)) node.removeAttribute(attr.name);
          }
        });
        const rendered = figure.querySelector('svg');
        if (rendered) { rendered.setAttribute('role', 'img'); rendered.setAttribute('aria-label', 'Mermaid diagram'); }
        const details = document.createElement('details'), summary = document.createElement('summary');
        summary.textContent = 'Diagram source'; details.append(summary, pre.cloneNode(true)); figure.append(details);
        pre.replaceWith(figure);
      } catch (error) {
        const message = document.createElement('p'); message.className = 'small';
        message.textContent = 'Diagram could not be rendered; its source is shown below.';
        pre.before(message);
      }
    }
  } catch (error) {
    if (markdownViews.get(container)?.ticket === ticket) {
      container.textContent = 'Markdown renderer unavailable. Original source:\n\n' + text;
    }
  }
}

function refreshMarkdownTheme() {
  for (const [container, view] of markdownViews) {
    if (container.isConnected && container.classList.contains('markdown-body')) renderMarkdown(container, view.text, view.path);
  }
}
