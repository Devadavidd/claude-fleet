import { test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { highlightCode } from './code-highlighter.js';

// Representative multi-language snippet: a comment, string, number, and keyword.
const SAMPLE = `// note\nconst x = "hi";\ndef y = 42;`;

function classesIn(frag: DocumentFragment): Set<string> {
  const out = new Set<string>();
  for (const el of frag.querySelectorAll('span')) out.add(el.className);
  return out;
}

// Read the real stylesheet, tolerant of the runner's cwd (repo root or client/).
// vitest's import.meta.url isn't a file:// URL, so resolve from cwd candidates.
function readStyleCss(): string {
  const candidates = ['client/src/style.css', 'src/style.css'];
  for (const rel of candidates) {
    const abs = path.resolve(process.cwd(), rel);
    if (existsSync(abs)) return readFileSync(abs, 'utf8');
  }
  throw new Error(`style.css not found from cwd ${process.cwd()}`);
}

test('highlightCode emits colored spans for comments, strings, numbers and keywords', () => {
  const classes = classesIn(highlightCode(SAMPLE));
  expect(classes).toContain('tok-comment');
  expect(classes).toContain('tok-string');
  expect(classes).toContain('tok-number');
  expect(classes).toContain('tok-keyword');
});

// The bug this guards: spans were emitted but style.css had NO rules for them,
// so every file rendered monochrome. Every token class MUST have a colour rule.
test('every token class the highlighter emits has a colour rule in style.css', () => {
  const css = readStyleCss();
  for (const cls of classesIn(highlightCode(SAMPLE))) {
    expect(css, `missing CSS rule for .${cls}`).toContain(`.${cls}`);
  }
});
