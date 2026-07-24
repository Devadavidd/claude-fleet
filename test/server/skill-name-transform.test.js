import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stripCkPrefix,
  buildSkillRenames,
  renamedBaseNames,
  rewriteCkReferences,
} from '../../dist/server/skills/skill-name-transform.js';

// Pins the ck→cf transform contract: boundary-guarded rewrites (words merely
// ending in "ck" are untouched), fenced code blocks byte-identical, and
// collision-safe dir renames.

test('stripCkPrefix strips only the leading ck- prefix', () => {
  assert.equal(stripCkPrefix('ck-plan'), 'plan');
  assert.equal(stripCkPrefix('cook'), 'cook');
  assert.equal(stripCkPrefix('back-track'), 'back-track');
});

test('buildSkillRenames never renames onto an existing dir', () => {
  const renames = buildSkillRenames(['ck-plan', 'ck-loop', 'loop', 'cook']);
  assert.equal(renames.get('ck-plan'), 'plan');
  assert.equal(renames.get('ck-loop'), 'ck-loop'); // 'loop' exists — collision, keep original
  assert.equal(renames.get('loop'), 'loop');
  assert.equal(renames.get('cook'), 'cook');
  assert.deepEqual([...renamedBaseNames(renames)], ['plan']);
});

test('rewrites /ck: and bare ck: outside fences', () => {
  const out = rewriteCkReferences('Run /ck:plan then `ck:scout` and (ck:debug).', new Set());
  assert.equal(out, 'Run /cf:plan then `cf:scout` and (cf:debug).');
});

test('words ending in ck are never rewritten', () => {
  const src = 'check: the pack: and Mock: values stay; also luck:y.';
  assert.equal(rewriteCkReferences(src, new Set()), src);
});

test('ck-<renamed> references collapse to the renamed base name', () => {
  const renamed = new Set(['plan', 'code-review']);
  const out = rewriteCkReferences('Use ck-plan and ck-code-review, not ck-planx or ck-scenario.', renamed);
  assert.equal(out, 'Use plan and code-review, not ck-planx or ck-scenario.');
});

test('fenced code blocks are preserved byte-for-byte', () => {
  const src = [
    'Outside /ck:plan rewrites.',
    '```bash',
    'run /ck:plan --tdd',
    '```',
    'Outside again: ck:scout.',
  ].join('\n');
  const out = rewriteCkReferences(src, new Set());
  assert.equal(out, [
    'Outside /cf:plan rewrites.',
    '```bash',
    'run /ck:plan --tdd',
    '```',
    'Outside again: cf:scout.',
  ].join('\n'));
});

test('a dangling fence leaves the remainder untouched', () => {
  const src = 'before /ck:plan\n```\ninside /ck:plan forever';
  const out = rewriteCkReferences(src, new Set());
  assert.equal(out, 'before /cf:plan\n```\ninside /ck:plan forever');
});

test('never produces /cf:ck- composites for renamed skills', () => {
  const out = rewriteCkReferences('/ck:plan and ck-plan', new Set(['plan']));
  assert.ok(!out.includes('cf:ck-'));
  assert.equal(out, '/cf:plan and plan');
});

test('a ````markdown fence showing ``` examples inside stays fully untouched', () => {
  const src = [
    'Outside /ck:plan.',
    '````markdown',
    'docs example:',
    '```bash',
    '/ck:plan --tdd',
    '```',
    'still inside /ck:cook',
    '````',
    'Outside again /ck:ship.',
  ].join('\n');
  const out = rewriteCkReferences(src, new Set());
  assert.equal(out.split('\n')[0], 'Outside /cf:plan.');
  assert.equal(out.split('\n')[4], '/ck:plan --tdd');
  assert.equal(out.split('\n')[6], 'still inside /ck:cook');
  assert.equal(out.split('\n')[8], 'Outside again /cf:ship.');
});
