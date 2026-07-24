import { test, expect } from 'vitest';
import { parseAnsi, collapseCarriageReturns } from './ansi-to-html.js';

test('plain text is a single class-free run', () => {
  const runs = parseAnsi('hello world');
  expect(runs).toEqual([{ text: 'hello world', classes: [] }]);
});

test('basic fg color wraps only the colored span', () => {
  const runs = parseAnsi('\x1b[32mINFO\x1b[0m done');
  expect(runs).toEqual([
    { text: 'INFO', classes: ['ansi-fg-green'] },
    { text: ' done', classes: [] },
  ]);
});

test('dim + color combine as multiple classes', () => {
  const runs = parseAnsi('\x1b[2m\x1b[34mts\x1b[0m');
  expect(runs).toEqual([{ text: 'ts', classes: ['ansi-fg-blue', 'ansi-dim'] }]);
});

test('bright fg and bg map to bright classes', () => {
  const runs = parseAnsi('\x1b[91;107mx\x1b[0m');
  expect(runs).toEqual([{ text: 'x', classes: ['ansi-fg-bright-red', 'ansi-bg-bright-white'] }]);
});

test('reset clears all attributes', () => {
  const runs = parseAnsi('\x1b[1;31ma\x1b[0mb');
  expect(runs).toEqual([
    { text: 'a', classes: ['ansi-fg-red', 'ansi-bold'] },
    { text: 'b', classes: [] },
  ]);
});

test('256-color mode maps first 16, degrades the rest without corrupting text', () => {
  // 38;5;2 -> green; then literal text must follow uncorrupted.
  expect(parseAnsi('\x1b[38;5;2mg\x1b[0m')).toEqual([{ text: 'g', classes: ['ansi-fg-green'] }]);
  // 38;5;200 -> out of basic range -> no color, text intact.
  expect(parseAnsi('\x1b[38;5;200mx')).toEqual([{ text: 'x', classes: [] }]);
});

test('truecolor params are consumed, following text intact', () => {
  expect(parseAnsi('\x1b[38;2;10;20;30mZ')).toEqual([{ text: 'Z', classes: [] }]);
});

test('cursor/clear CSI sequences are dropped, not shown as text', () => {
  expect(parseAnsi('\x1b[2J\x1b[Hclean')).toEqual([{ text: 'clean', classes: [] }]);
});

test('OSC title sequence is skipped', () => {
  expect(parseAnsi('\x1b]0;my title\x07body')).toEqual([{ text: 'body', classes: [] }]);
});

test('OSC terminated by ST (ESC backslash) consumes both bytes, no stray backslash', () => {
  expect(parseAnsi('\x1b]0;title\x1b\\body')).toEqual([{ text: 'body', classes: [] }]);
});

test('no HTML-ish characters are ever interpreted (parser only tags runs)', () => {
  const runs = parseAnsi('\x1b[31m<script>alert(1)</script>\x1b[0m');
  expect(runs).toEqual([{ text: '<script>alert(1)</script>', classes: ['ansi-fg-red'] }]);
});

test('collapseCarriageReturns keeps the final state of a progress line', () => {
  expect(collapseCarriageReturns('10%\r55%\r100%')).toBe('100%');
  expect(collapseCarriageReturns('a\nb')).toBe('a\nb');
  expect(collapseCarriageReturns('done\r')).toBe('done');
  expect(collapseCarriageReturns('no cr here')).toBe('no cr here');
});

test('multi-line output collapses CR per line independently', () => {
  expect(collapseCarriageReturns('p1\r p1done\np2\r p2done')).toBe(' p1done\n p2done');
});
