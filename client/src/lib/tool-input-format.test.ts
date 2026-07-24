import { test, expect } from 'vitest';
import { toolBody } from './tool-input-format.js';

test('Bash renders the command as a shell line, not JSON', () => {
  const body = toolBody('Bash', { command: 'git status', description: 'check tree' });
  expect(body.kind).toBe('command');
  expect(body.text).toBe('git status');
});

test('Task/Agent renders the delegation prompt as text', () => {
  for (const name of ['Task', 'Agent']) {
    const body = toolBody(name, { prompt: 'Fix the parser bug', description: 'delegate' });
    expect(body.kind).toBe('text');
    expect(body.text).toBe('Fix the parser bug');
  }
});

test('generic tool shows key/value params, minus keys already in the header', () => {
  const body = toolBody('Grep', { pattern: 'TODO', path: 'src', description: 'search' });
  expect(body.kind).toBe('params');
  const keys = (body.params ?? []).map(([k]) => k);
  expect(keys).toContain('pattern');
  expect(keys).toContain('path');
  expect(keys).not.toContain('description'); // already shown in the row header
});

test('non-string values are stringified for the params view', () => {
  const body = toolBody('Read', { offset: 10, limit: 50, all: true });
  expect(body.kind).toBe('params');
  expect(body.params).toContainEqual(['offset', '10']);
  expect(body.params).toContainEqual(['limit', '50']);
  expect(body.params).toContainEqual(['all', 'true']);
});

test('empty (or header-only) input collapses to an empty body', () => {
  // A Read whose only key is the file_path — already shown in the header.
  expect(toolBody('Read', { file_path: '/a/b.ts' }).kind).toBe('empty');
  expect(toolBody('Whatever', {}).kind).toBe('empty');
});
