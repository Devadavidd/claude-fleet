import { test, expect } from 'vitest';
import { parseHash } from './router.svelte.js';

test('static routes resolve to their views (no back button)', () => {
  expect(parseHash('#/').view).toBe('overview');
  expect(parseHash('#/board').view).toBe('board');
  expect(parseHash('#/agents').view).toBe('agents');
  expect(parseHash('#/workflows').view).toBe('workflows');
  expect(parseHash('#/always-on').view).toBe('always-on');
  expect(parseHash('#/files').view).toBe('files');
  expect(parseHash('#/shipped').view).toBe('shipped');
  expect(parseHash('#/skills').view).toBe('skills'); // new route
  expect(parseHash('#/board').showBack).toBe(false);
});

test('an unknown hash falls back to the overview landing', () => {
  expect(parseHash('#/bogus').view).toBe('overview');
  expect(parseHash('').view).toBe('overview');
});

test('session sub-routes select the right tab, same session id', () => {
  expect(parseHash('#/session/abc')).toMatchObject({ view: 'session', sessionId: 'abc', sessionTab: 'timeline', showBack: true });
  expect(parseHash('#/session/abc/terminal')).toMatchObject({ view: 'session', sessionId: 'abc', sessionTab: 'terminal' });
  expect(parseHash('#/session/abc/tasks')).toMatchObject({ view: 'session', sessionId: 'abc', sessionTab: 'tasks' });
});

test('subagent timeline carries the agent id', () => {
  const r = parseHash('#/session/abc/agent/wrk-1');
  expect(r).toMatchObject({ view: 'session', sessionId: 'abc', agentId: 'wrk-1', sessionTab: 'timeline' });
});

test('file route decodes the (possibly slashed) path', () => {
  const r = parseHash('#/file/' + encodeURIComponent('/proj/plans/x.md'));
  expect(r.view).toBe('file');
  expect(r.filePath).toBe('/proj/plans/x.md');
});

test('a malformed percent-encoding never throws — falls back to overview', () => {
  expect(parseHash('#/session/%E0%A4%A').view).toBe('overview');
  expect(parseHash('#/file/%').view).toBe('overview');
});
