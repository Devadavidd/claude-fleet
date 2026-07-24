import { test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import QuestionChips from './QuestionChips.svelte';
import type { SessionCard } from '../../../../shared/types/index.js';

// Pins the answer surface: read-only for observed sessions, click-to-send for
// single-select, toggle-then-Answer (selections array) for multiSelect.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function makeCard(overrides: Partial<SessionCard> = {}): SessionCard {
  return {
    sessionId: 's1',
    projectSlug: 'proj',
    title: 't',
    status: 'waiting-for-you',
    currentAction: '',
    filesTouched: [],
    subagentCount: 0,
    agents: [],
    lastActivityAt: null,
    tokens: { output: 0, cacheRead: 0, cacheCreate: 0, perMin: [] },
    taskSummary: { total: 0, pending: 0, in_progress: 0, completed: 0 },
    workflowPhase: null,
    pendingQuestion: {
      toolUseId: 'tu-1',
      kind: 'question',
      askedAt: 0,
      questions: [{ header: 'Approach', question: 'Which one?', multiSelect: false, options: ['A', 'B'] }],
    },
    ...overrides,
  } as SessionCard;
}

function stubSteer() {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
    { ok: true, status: 202, json: async () => ({}) }
  ));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function steerBody(fetchMock: ReturnType<typeof stubSteer>): unknown {
  const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/steer'));
  expect(call).toBeTruthy();
  return JSON.parse((call![1] as RequestInit).body as string);
}

test('only a launched-but-unsteerable child is read-only; observed cards are answerable (resume)', () => {
  stubSteer();
  render(QuestionChips, { card: makeCard({ launched: true, steerable: false }) });
  expect(screen.getByTestId('question-chips')).toHaveTextContent('Lead is waiting');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();

  cleanup();
  render(QuestionChips, { card: makeCard() }); // observed → clickable, answer resumes
  expect(screen.getByRole('button', { name: 'A' })).toBeInTheDocument();
});

test('single-select chip click POSTs the answer immediately', async () => {
  const fetchMock = stubSteer();
  render(QuestionChips, { card: makeCard({ launched: true, steerable: true }) });
  await fireEvent.click(screen.getByRole('button', { name: 'B' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(String(fetchMock.mock.calls[0][0])).toBe('/api/sessions/s1/steer');
  expect(steerBody(fetchMock)).toEqual({ type: 'answer', selections: ['B'] });
});

test('multiSelect toggles chips and sends the whole selection on Answer', async () => {
  const fetchMock = stubSteer();
  const card = makeCard({ launched: true, steerable: true });
  card.pendingQuestion!.questions[0] = {
    header: 'Scope', question: 'Pick all', multiSelect: true, options: ['X', 'Y', 'Z'],
  };
  render(QuestionChips, { card });

  const sendBtn = screen.getByTestId('question-multi-send-0');
  expect(sendBtn).toBeDisabled(); // nothing picked yet
  await fireEvent.click(screen.getByRole('button', { name: 'X' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Z' }));
  await fireEvent.click(screen.getByRole('button', { name: 'X' })); // toggle X back off
  await fireEvent.click(screen.getByRole('button', { name: 'X' })); // and on again
  await fireEvent.click(sendBtn);

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(steerBody(fetchMock)).toEqual({ type: 'answer', selections: ['Z', 'X'] });
});
