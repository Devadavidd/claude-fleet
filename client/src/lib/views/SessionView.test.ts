import { test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import SessionView from './SessionView.svelte';
import { router } from '../router.svelte.js';
import { fleetStore } from '../fleet-store.svelte.js';
import type { Route } from '../router.svelte.js';
import type { SessionCard } from '../../../../shared/types/index.js';

function setRoute(overrides: Partial<Route> = {}): void {
  router.route = {
    view: 'session',
    sessionId: 's1',
    agentId: null,
    sessionTab: 'timeline',
    filePath: null,
    showBack: true,
    ...overrides,
  };
}

beforeEach(() => {
  setRoute();
  // Every tab component fetches on mount (timeline/terminal via the timeline
  // API, tasks via /api/sessions/:id/tasks) — a single fail-soft stub covers
  // all three shapes without any test needing to care which tab is active.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ events: [], total: 0, offset: 0 }) })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fleetStore.sessions = new Map();
});

test('defaults to the Timeline tab and marks it current', () => {
  render(SessionView);

  expect(screen.getByTestId('session-timeline')).toBeInTheDocument();
  expect(screen.getByTestId('session-tab-timeline')).toHaveAttribute('aria-current', 'page');
});

test('a terminal sessionTab route renders the Terminal tab component', async () => {
  setRoute({ sessionTab: 'terminal' });
  render(SessionView);
  await tick();

  expect(screen.getByTestId('session-terminal')).toBeInTheDocument();
  expect(screen.queryByTestId('session-timeline')).not.toBeInTheDocument();
});

test('a tasks sessionTab route renders the Tasks tab component', async () => {
  setRoute({ sessionTab: 'tasks' });
  render(SessionView);
  await tick();

  expect(screen.getByTestId('session-kanban')).toBeInTheDocument();
  expect(screen.queryByTestId('session-timeline')).not.toBeInTheDocument();
});

test('switching router.route.sessionTab after mount swaps the rendered tab', async () => {
  render(SessionView);
  expect(screen.getByTestId('session-timeline')).toBeInTheDocument();

  setRoute({ sessionTab: 'terminal' });
  await tick();

  expect(screen.getByTestId('session-terminal')).toBeInTheDocument();
});

test('shows a placeholder when no session is selected', () => {
  setRoute({ sessionId: null });
  render(SessionView);

  expect(screen.getByText(/No session selected/)).toBeInTheDocument();
});

test('mounts the chat composer for a dashboard-launched session, not for observed ones', async () => {
  render(SessionView);
  expect(screen.queryByTestId('session-composer')).not.toBeInTheDocument(); // observed / unknown

  fleetStore.sessions = new Map([['s1', {
    sessionId: 's1', projectSlug: 'p', title: 't', status: 'working', currentAction: '',
    filesTouched: [], subagentCount: 0, agents: [], lastActivityAt: null,
    tokens: { output: 0, cacheRead: 0, cacheCreate: 0, perMin: [] },
    taskSummary: { total: 0, pending: 0, in_progress: 0, completed: 0 },
    workflowPhase: null, pendingQuestion: null, launched: true, steerable: true,
  } as SessionCard]]);
  await tick();

  expect(screen.getByTestId('session-composer')).toBeInTheDocument();
  expect(screen.getByTestId('composer-input')).toBeInTheDocument();
});
