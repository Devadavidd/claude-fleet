import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  applyBlock, stripBlock, BEGIN, END, BLOCK,
} = require('../../scripts/enable-terminal-remote-approve.cjs');

test('enable appends the fleet block to an empty profile', () => {
  const out = applyBlock('', true);
  assert.ok(out.includes(BEGIN) && out.includes(END));
  assert.ok(out.includes('export FLEET_REMOTE_APPROVE=on'));
});

test('enable preserves existing profile content', () => {
  const out = applyBlock('export PATH=/usr/bin\nalias ll="ls -la"\n', true);
  assert.ok(out.includes('export PATH=/usr/bin'));
  assert.ok(out.includes('alias ll="ls -la"'));
  assert.ok(out.includes('export FLEET_REMOTE_APPROVE=on'));
});

test('enable is idempotent — no duplicate block on re-apply', () => {
  const once = applyBlock('# my profile\n', true);
  const twice = applyBlock(once, true);
  assert.equal(twice, once);
  assert.equal(twice.split(BEGIN).length - 1, 1, 'exactly one begin marker');
});

test('disable removes the block and restores original text', () => {
  const original = '# my profile\nexport FOO=bar\n';
  const enabled = applyBlock(original, true);
  const disabled = applyBlock(enabled, false);
  assert.ok(!disabled.includes(BEGIN) && !disabled.includes(END));
  assert.ok(disabled.includes('export FOO=bar'));
  assert.ok(!disabled.includes('FLEET_REMOTE_APPROVE'));
});

test('stripBlock leaves unrelated text untouched', () => {
  const text = 'line1\nline2\n';
  assert.equal(stripBlock(text), text);
});

test('disable is a no-op when the block is absent', () => {
  const text = 'export A=1\n';
  assert.equal(applyBlock(text, false), text);
});

test('BLOCK carries the opt-out hint', () => {
  assert.ok(BLOCK.includes('disable-terminal-approve'));
});
