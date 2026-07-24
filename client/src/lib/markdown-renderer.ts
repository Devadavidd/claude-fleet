// Minimal, dependency-free, XSS-safe Markdown → DOM renderer for the file
// viewer. File content is untrusted, so every text value goes through
// textContent / createTextNode — never innerHTML with raw input. Covers the
// blocks that actually show up in repo docs: headings, fenced code, lists,
// blockquotes, tables, hr, and inline bold/italic/code/strike/links.
//
// Inline formatting (links/emphasis/code spans) lives in
// ./markdown-inline-format.ts to keep this file focused on block structure.

import { appendInline } from './markdown-inline-format.js';

export function renderMarkdown(source: string): HTMLDivElement {
  const root = document.createElement('div');
  root.className = 'md';
  const lines = source.split('\n');
  let i = 0;

  // YAML frontmatter: render as a compact dim key/value block, not a mangled
  // paragraph (plan/phase docs all start with one).
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) {
      const fm = document.createElement('div');
      fm.className = 'md-frontmatter';
      fm.textContent = lines.slice(1, end).join('\n');
      root.append(fm);
      i = end + 1;
    }
  }
  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line.trim())) {              // fenced code block
      const lang = line.trim().slice(3).trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { body.push(lines[i]); i += 1; }
      i += 1; // closing fence
      const pre = document.createElement('pre');
      pre.className = 'md-code';
      const code = document.createElement('code');
      if (lang) code.dataset.lang = lang;
      code.textContent = body.join('\n');
      pre.append(code);
      root.append(pre);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const h = document.createElement(`h${heading[1].length}`);
      appendInline(h, heading[2]);
      root.append(h);
      i += 1;
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {     // horizontal rule
      root.append(document.createElement('hr'));
      i += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {                     // blockquote (consecutive)
      const quote = document.createElement('blockquote');
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i += 1; }
      appendInline(quote, buf.join(' '));
      root.append(quote);
      continue;
    }

    if (isTableHeader(lines, i)) {                // GitHub table
      i = appendTable(root, lines, i);
      continue;
    }

    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {      // list (ordered or not)
      i = appendList(root, lines, i);
      continue;
    }

    if (line.trim() === '') { i += 1; continue; }

    const para = document.createElement('p');     // paragraph (until blank line)
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,6}\s|>|```|\s*([-*+]|\d+\.)\s)/.test(lines[i])) {
      buf.push(lines[i]); i += 1;
    }
    appendInline(para, buf.join(' '));
    root.append(para);
  }
  return root;
}

function isTableHeader(lines: string[], i: number): boolean {
  return Boolean(lines[i]?.includes('|')) && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] ?? '');
}

function appendTable(root: HTMLElement, lines: string[], i: number): number {
  const splitRow = (row: string): string[] =>
    row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
  const table = document.createElement('table');
  table.className = 'md-table';
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  for (const cell of splitRow(lines[i])) {
    const th = document.createElement('th');
    appendInline(th, cell);
    htr.append(th);
  }
  thead.append(htr);
  table.append(thead);
  i += 2; // header + separator
  const tbody = document.createElement('tbody');
  while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
    const tr = document.createElement('tr');
    for (const cell of splitRow(lines[i])) {
      const td = document.createElement('td');
      appendInline(td, cell);
      tr.append(td);
    }
    tbody.append(tr);
    i += 1;
  }
  table.append(tbody);
  root.append(table);
  return i;
}

function appendList(root: HTMLElement, lines: string[], i: number): number {
  const ordered = /^\s*\d+\.\s+/.test(lines[i]);
  const list = document.createElement(ordered ? 'ol' : 'ul');
  while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
    const li = document.createElement('li');
    appendInline(li, lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ''));
    list.append(li);
    i += 1;
  }
  root.append(list);
  return i;
}
