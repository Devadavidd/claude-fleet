import { test, expect } from 'vitest';
import { extractBashPairs, resultText } from './extract-bash-pairs.js';
import type { TranscriptEntry } from '../../../shared/types/index.js';

function ev(type: string, content: unknown, ts = '2026-07-21T10:00:00Z'): TranscriptEntry {
  return { kind: 'event', event: { type, timestamp: ts, message: { content } } };
}

test('pairs a Bash tool_use with its tool_result by id', () => {
  const entries = [
    ev('assistant', [{ type: 'tool_use', id: 'x1', name: 'Bash', input: { command: 'ls', description: 'list' } }]),
    ev('user', [{ type: 'tool_result', tool_use_id: 'x1', content: 'a\nb' }]),
  ];
  const pairs = extractBashPairs(entries, { label: '', isWorker: false });
  expect(pairs.length).toBe(1);
  expect(pairs[0].command).toBe('ls');
  expect(pairs[0].detail).toBe('list');
  expect(pairs[0].output).toBe('a\nb');
  expect(pairs[0].running).toBe(false);
  expect(pairs[0].isError).toBe(false);
});

test('ignores non-Bash tool_use', () => {
  const entries = [
    ev('assistant', [{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: '/x' } }]),
    ev('user', [{ type: 'tool_result', tool_use_id: 'r1', content: 'file body' }]),
  ];
  expect(extractBashPairs(entries)).toEqual([]);
});

test('flags a command with no result yet as running', () => {
  const entries = [
    ev('assistant', [{ type: 'tool_use', id: 'x2', name: 'Bash', input: { command: 'sleep 9' } }]),
  ];
  const pairs = extractBashPairs(entries);
  expect(pairs.length).toBe(1);
  expect(pairs[0].running).toBe(true);
  expect(pairs[0].output).toBe('');
});

test('propagates is_error and worker label', () => {
  const entries = [
    ev('assistant', [{ type: 'tool_use', id: 'e1', name: 'Bash', input: { command: 'false' } }]),
    ev('user', [{ type: 'tool_result', tool_use_id: 'e1', content: 'boom', is_error: true }]),
  ];
  const pairs = extractBashPairs(entries, { label: 'code-reviewer', isWorker: true });
  expect(pairs[0].isError).toBe(true);
  expect(pairs[0].isWorker).toBe(true);
  expect(pairs[0].sourceLabel).toBe('code-reviewer');
});

test('resultText handles string and block-array content', () => {
  expect(resultText('plain')).toBe('plain');
  expect(resultText([{ type: 'text', text: 'x' }, { type: 'image' }])).toBe('x\n[image]');
  expect(resultText(null)).toBe('');
});
