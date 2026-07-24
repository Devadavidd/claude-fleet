import { test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import SessionComposer from './SessionComposer.svelte';
import { fleetStore } from '../fleet-store.svelte.js';
import { resetSkillEntriesCache } from '../skill-catalog-cache.js';
import type { SessionCard } from '../../../../shared/types/index.js';

// Pins the in-session chat bar: hidden for observed/unknown sessions, steer
// input + Finish for steerable launches, Stop for every launch, question panel
// piped through when the session is blocked on an answer.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetSkillEntriesCache();
  fleetStore.sessions = new Map();
});

function seedCard(overrides: Partial<SessionCard> = {}): SessionCard {
  const card = {
    sessionId: 's1',
    projectSlug: 'proj',
    title: 't',
    status: 'working',
    currentAction: '',
    filesTouched: [],
    subagentCount: 0,
    agents: [],
    lastActivityAt: null,
    tokens: { output: 0, cacheRead: 0, cacheCreate: 0, perMin: [] },
    taskSummary: { total: 0, pending: 0, in_progress: 0, completed: 0 },
    workflowPhase: null,
    pendingQuestion: null,
    ...overrides,
  } as SessionCard;
  fleetStore.sessions = new Map([[card.sessionId, card]]);
  return card;
}

function stubFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    if (String(input) === '/api/spawn-options') {
      return { ok: true, status: 200, json: async () => ({ models: ['sonnet-4.5', 'opus-4.1'], defaultModel: 'sonnet-4.5' }) };
    }
    return { ok: true, status: 202, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

test('renders nothing only for an unknown session — observed cards get a resume composer', async () => {
  stubFetch();
  render(SessionComposer, { sessionId: 'missing' });
  expect(screen.queryByTestId('session-composer')).not.toBeInTheDocument();

  cleanup();
  seedCard(); // observed session — no `launched` ⇒ chat resumes it
  render(SessionComposer, { sessionId: 's1' });
  expect(screen.getByTestId('session-composer')).toBeInTheDocument();
  expect(screen.getByTestId('composer-input')).toBeInTheDocument();
  expect(screen.queryByTestId('composer-stop')).not.toBeInTheDocument(); // nothing to stop
});

test('sending on a non-launched session posts the message WITH the resume model', async () => {
  const fetchMock = stubFetch();
  seedCard(); // observed / finished session
  render(SessionComposer, { sessionId: 's1' });

  const input = screen.getByTestId('composer-input');
  await fireEvent.input(input, { target: { value: 'keep going' } });
  await fireEvent.keyDown(input, { key: 'Enter' });

  await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/steer'))).toBe(true));
  const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/steer'))!;
  expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ type: 'message', text: 'keep going', model: 'sonnet-4.5' });
});

test('steerable launch: Enter sends a steer message and clears the input', async () => {
  const fetchMock = stubFetch();
  seedCard({ launched: true, steerable: true });
  render(SessionComposer, { sessionId: 's1' });

  const input = screen.getByTestId('composer-input');
  await fireEvent.input(input, { target: { value: 'also add tests' } });
  await fireEvent.keyDown(input, { key: 'Enter' });

  await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/steer'))).toBe(true));
  const [url, init] = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/steer'))!;
  expect(String(url)).toBe('/api/sessions/s1/steer');
  expect(JSON.parse((init as RequestInit).body as string)).toEqual({ type: 'message', text: 'also add tests' });
  expect((input as HTMLInputElement).value).toBe('');
});

test('Finish and Stop hit their endpoints; non-steerable launch shows Stop only', async () => {
  const fetchMock = stubFetch();
  seedCard({ launched: true, steerable: true });
  render(SessionComposer, { sessionId: 's1' });
  await fireEvent.click(screen.getByTestId('composer-finish'));
  await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/steer'))).toBe(true));
  const finishCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/steer'))!;
  expect(JSON.parse((finishCall[1] as RequestInit).body as string)).toEqual({ type: 'finish' });

  cleanup();
  seedCard({ launched: true, steerable: false });
  render(SessionComposer, { sessionId: 's1' });
  expect(screen.queryByTestId('composer-input')).not.toBeInTheDocument();
  await fireEvent.click(screen.getByTestId('composer-stop'));
  await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)![0])).toBe('/api/sessions/s1/kill'));
});

test('composer attachments upload first, then the steer message carries their paths', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/spawn-options') {
      return { ok: true, status: 200, json: async () => ({ models: ['sonnet-4.5'], defaultModel: 'sonnet-4.5' }) };
    }
    if (url === '/api/uploads') {
      return { ok: true, status: 200, json: async () => ({ paths: ['/tmp/u/b1/notes.md'] }) };
    }
    return { ok: true, status: 202, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);
  seedCard(); // finished/observed session — send resumes it
  render(SessionComposer, { sessionId: 's1' });

  const file = new File([new Uint8Array([1, 2])], 'notes.md');
  await fireEvent.change(screen.getByTestId('composer-attach-input'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByTestId('composer-attachment-list')).toHaveTextContent('notes.md'));
  const input = screen.getByTestId('composer-input');
  await fireEvent.input(input, { target: { value: 'read this' } });
  await fireEvent.keyDown(input, { key: 'Enter' });

  await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/steer'))).toBe(true));
  const steer = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/steer'))!;
  const body = JSON.parse((steer[1] as RequestInit).body as string) as { text: string };
  expect(body.text).toContain('read this');
  expect(body.text).toContain('- /tmp/u/b1/notes.md');
  expect(screen.queryByTestId('composer-attachment-list')).not.toBeInTheDocument(); // cleared after send
});

test('a failed steer restores the typed message and shows the server error', async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
    { ok: false, status: 409, json: async () => ({ error: 'session no longer accepting input' }) }
  ));
  vi.stubGlobal('fetch', fetchMock);
  seedCard({ launched: true, steerable: true });
  render(SessionComposer, { sessionId: 's1' });

  const input = screen.getByTestId('composer-input');
  await fireEvent.input(input, { target: { value: 'important reply' } });
  await fireEvent.keyDown(input, { key: 'Enter' });

  await waitFor(() => expect(screen.getByTestId('composer-error')).toHaveTextContent('no longer accepting input'));
  await waitFor(() => expect((input as HTMLInputElement).value).toBe('important reply')); // not lost
});

test('a pending question renders the answerable chips inside the composer', () => {
  stubFetch();
  seedCard({
    launched: true,
    steerable: true,
    status: 'waiting-for-you',
    pendingQuestion: {
      toolUseId: 'tu-9',
      kind: 'question',
      askedAt: 0,
      questions: [{ header: 'Pick', question: 'Which?', multiSelect: false, options: ['A', 'B'] }],
    },
  });
  render(SessionComposer, { sessionId: 's1' });
  expect(screen.getByTestId('question-chips')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'A' })).toBeInTheDocument();
});
