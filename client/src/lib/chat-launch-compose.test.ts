import { test, expect } from 'vitest';
import { composeLaunchTask, skillToolId } from './chat-launch-compose.js';

// Pins the launch-task composition contract: plain prompt passthrough, skill
// directive placement, attachment block, and workflow wrapping order.

test('plain prompt passes through trimmed, no scaffolding', () => {
  expect(composeLaunchTask({ prompt: '  fix the bug  ' })).toBe('fix the bug');
});

test('empty prompt composes to empty string regardless of extras', () => {
  expect(composeLaunchTask({ prompt: '   ', skillName: 'brainstorm', attachmentPaths: ['/a'] })).toBe('');
});

test('skillToolId normalizes catalog names to cf:<name>', () => {
  expect(skillToolId('brainstorm')).toBe('cf:brainstorm');
  expect(skillToolId('cf:plan')).toBe('cf:plan');
  expect(skillToolId('/cook')).toBe('cf:cook');
  expect(skillToolId('  ')).toBe('');
});

test('skill directive precedes the prompt and names both ids', () => {
  const task = composeLaunchTask({ prompt: 'design the API', skillName: 'brainstorm' });
  const [directive, goal] = task.split('\n\n');
  expect(directive).toContain('"cf:brainstorm"');
  expect(directive).toContain('"brainstorm"');
  expect(directive).toContain('Skill tool');
  expect(goal).toBe('design the API');
});

test('a prompt typed as a slash command passes through verbatim, ignoring skillName', () => {
  expect(composeLaunchTask({ prompt: '/cf:plan build auth', skillName: 'brainstorm' }))
    .toBe('/cf:plan build auth');
  // attachments still append after a raw command
  expect(composeLaunchTask({ prompt: '/cf:plan x', attachmentPaths: ['/tmp/a'] }))
    .toBe('/cf:plan x\n\nAttached files (read them from disk):\n- /tmp/a');
});

test('attachments append as an absolute-path list after the prompt', () => {
  const task = composeLaunchTask({ prompt: 'review these', attachmentPaths: ['/tmp/u/a.png', '/tmp/u/b.md', ' '] });
  expect(task).toBe('review these\n\nAttached files (read them from disk):\n- /tmp/u/a.png\n- /tmp/u/b.md');
});

test('asWorkflow wraps the FULLY composed text (skill + attachments inside the GOAL)', () => {
  const task = composeLaunchTask({
    prompt: 'ship it', skillName: 'cook', attachmentPaths: ['/tmp/x'], asWorkflow: true,
  });
  expect(task).toContain('Workflow tool');
  expect(task).toContain('GOAL: First activate the skill "cf:cook"');
  expect(task).toContain('- /tmp/x');
});
