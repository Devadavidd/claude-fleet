import { test, expect } from 'vitest';
import { workflowLaunchPrompt } from './workflow-launch-template.js';

test('wraps the goal with an explicit "use a workflow" instruction', () => {
  const out = workflowLaunchPrompt('add dark mode');
  expect(out).toMatch(/workflow/i);
  expect(out).toMatch(/GOAL: add dark mode/);
  expect(typeof out).toBe('string');
});

test('empty or whitespace goal returns empty (caller keeps the "task required" guard)', () => {
  expect(workflowLaunchPrompt('')).toBe('');
  expect(workflowLaunchPrompt('   ')).toBe('');
  expect(workflowLaunchPrompt(null)).toBe('');
  expect(workflowLaunchPrompt(undefined)).toBe('');
});

test('goal is embedded verbatim (no mangling of a multi-line goal)', () => {
  const out = workflowLaunchPrompt('line one\nline two');
  expect(out).toContain('line one\nline two');
});
