import { test, expect } from 'vitest';
import { renderMarkdown } from './markdown-renderer.js';

// Security spec (from public/markdown-renderer.js's href guard): only
// http(s)/relative/hash/dot-relative hrefs may become clickable anchors.
// javascript:/data:/vbscript:/etc. schemes must never reach an <a href>.

test('rejects a javascript: href — no anchor is created, source stays as literal text', () => {
  const root = renderMarkdown('[click me](javascript:alert(1))');
  expect(root.querySelectorAll('a').length).toBe(0);
  expect(root.textContent).toContain('[click me](javascript:alert(1))');
});

test('rejects a data: href — no anchor is created, source stays as literal text', () => {
  const root = renderMarkdown('[open](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)');
  expect(root.querySelectorAll('a').length).toBe(0);
  expect(root.textContent).toContain('[open](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)');
});

test('an allowed https href still renders as a clickable anchor (guard is scheme-specific, not link-hostile)', () => {
  const root = renderMarkdown('[docs](https://example.com/a)');
  const a = root.querySelector('a');
  expect(a).not.toBeNull();
  expect(a?.getAttribute('href')).toBe('https://example.com/a');
  expect(a?.textContent).toBe('docs');
});

test('raw HTML-looking text is never parsed — it lands as literal text via textContent, not innerHTML', () => {
  const root = renderMarkdown('<img src=x onerror=alert(1)> and <script>alert(2)</script>');
  expect(root.querySelectorAll('script').length).toBe(0);
  expect(root.querySelectorAll('img').length).toBe(0);
  expect(root.textContent).toContain('<script>alert(2)</script>');
  expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
});
