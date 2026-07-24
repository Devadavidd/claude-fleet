import { test, expect } from 'vitest';
import {
  formatDuration, formatTokens, workflowStatusLabel, sortWorkflows, displayLabel,
} from './workflow-view-format.js';

test('formatDuration renders m:ss and h:mm:ss', () => {
  expect(formatDuration(0)).toBe('0:00');
  expect(formatDuration(65_000)).toBe('1:05');
  expect(formatDuration(3_661_000)).toBe('1:01:01');
  expect(formatDuration(null)).toBe('0:00');
});

test('formatTokens abbreviates thousands', () => {
  expect(formatTokens(0)).toBe('0');
  expect(formatTokens(950)).toBe('950');
  expect(formatTokens(48_800)).toBe('48.8k');
});

test('workflowStatusLabel maps status to text', () => {
  expect(workflowStatusLabel({ status: 'running' })).toBe('running');
  expect(workflowStatusLabel({ status: 'done' })).toBe('done');
  expect(workflowStatusLabel({ status: 'idle' })).toBe('idle');
  expect(workflowStatusLabel({})).toBe('idle');
});

test('sortWorkflows orders by lastActivityAt desc, stable for ties', () => {
  const a = { workflowId: 'a', lastActivityAt: 100 };
  const b = { workflowId: 'b', lastActivityAt: 300 };
  const c = { workflowId: 'c', lastActivityAt: 100 }; // tie with a — a must stay before c
  expect(sortWorkflows([a, b, c]).map((w) => w.workflowId)).toEqual(['b', 'a', 'c']);
  expect(sortWorkflows([])).toEqual([]);
});

test('displayLabel falls back for null and unresolved template labels', () => {
  expect(displayLabel({ label: 'inventory+parity', agentType: 'researcher' })).toBe('inventory+parity');
  expect(displayLabel({ label: null, agentType: 'general-purpose' })).toBe('general-purpose');
  expect(displayLabel({ label: 'write:${p.filename}', agentType: 'general-purpose' })).toBe('general-purpose');
  expect(displayLabel({ label: null, agentType: null })).toBe('agent');
});
