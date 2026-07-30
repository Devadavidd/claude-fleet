import { test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import SessionTimeline from './SessionTimeline.svelte';
import { fleetStore } from '../fleet-store.svelte.js';
import type { SessionCard } from '../../../../shared/types/index.js';

// The opt-in hint: an external (non-dashboard-launched) session can't be
// approved from here unless it opted in, and shows no answer buttons — the hint
// explains why, but only when it can help (hook installed, external session, no
// permission pending) and stays dismissed once closed.

function stubFetch(hookInstalled: boolean) {
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes('/api/permissions/hook-status')) {
      return { ok: true, json: async () => ({ installed: hookInstalled }) };
    }
    return { ok: true, json: async () => ({ events: [], total: 0, offset: 0 }) }; // timeline
  }));
}

function setCard(overrides: Partial<SessionCard> = {}): void {
  fleetStore.sessions = new Map([['s1', {
    sessionId: 's1', projectSlug: 'proj', title: 't', status: 'working',
    currentAction: '', filesTouched: [], subagentCount: 0, agents: [],
    lastActivityAt: Date.now(), tokens: { output: 0, cacheRead: 0, cacheCreate: 0, perMin: [] },
    taskSummary: { total: 0, pending: 0, in_progress: 0, completed: 0 },
    workflowPhase: null, pendingQuestion: null, ...overrides,
  } as SessionCard]]);
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); fleetStore.sessions = new Map(); });

test('external session with hook installed shows the opt-in hint, dismissible', async () => {
  stubFetch(true);
  setCard({ launched: undefined });
  render(SessionTimeline, { sessionId: 's1', agentId: null });

  const hint = await screen.findByTestId('timeline-optin-hint');
  expect(hint).toHaveTextContent('FLEET_REMOTE_APPROVE=on');
  await fireEvent.click(screen.getByLabelText('Dismiss hint'));
  expect(screen.queryByTestId('timeline-optin-hint')).not.toBeInTheDocument();
  expect(localStorage.getItem('fleet-hide-optin-hint')).toBe('1');
});

test('hint stays hidden for a dashboard-launched session', async () => {
  stubFetch(true);
  setCard({ launched: true });
  render(SessionTimeline, { sessionId: 's1', agentId: null });
  // Give the hook-status fetch a tick to resolve, then assert absence.
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(screen.queryByTestId('timeline-optin-hint')).not.toBeInTheDocument();
});

test('hint stays hidden when the hook is not installed', async () => {
  stubFetch(false);
  setCard({ launched: undefined });
  render(SessionTimeline, { sessionId: 's1', agentId: null });
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(screen.queryByTestId('timeline-optin-hint')).not.toBeInTheDocument();
});

test('hint stays hidden while a permission request is pending (already opted in)', async () => {
  stubFetch(true);
  setCard({
    launched: undefined,
    status: 'waiting-for-you',
    pendingQuestion: {
      toolUseId: 'tu', kind: 'permission', requestId: 'r1', askedAt: 0,
      questions: [{ header: 'Permission: Bash', question: '$ ls', multiSelect: false, options: ['Allow', 'Deny'] }],
    },
  });
  render(SessionTimeline, { sessionId: 's1', agentId: null });
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(screen.queryByTestId('timeline-optin-hint')).not.toBeInTheDocument();
  expect(screen.getByTestId('timeline-permission-banner')).toBeInTheDocument();
});

test('hint suppressed on a worker sub-timeline (agentId set)', async () => {
  stubFetch(true);
  setCard({ launched: undefined });
  render(SessionTimeline, { sessionId: 's1', agentId: 'agent-1' });
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(screen.queryByTestId('timeline-optin-hint')).not.toBeInTheDocument();
});
