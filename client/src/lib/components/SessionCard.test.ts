import { test, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import SessionCard from './SessionCard.svelte';
import type { SessionCard as SessionCardType } from '../../../../shared/types/index.js';

// @testing-library/svelte does not auto-register teardown in this project's
// vitest setup — without this, each render() below would stack onto the
// previous test's still-mounted DOM tree and queries would match stale nodes.
afterEach(() => cleanup());

// Minimal card factory — fills every required SessionCard field so overrides
// stay focused on what each test actually exercises.
function makeCard(overrides: Partial<SessionCardType> = {}): SessionCardType {
  return {
    sessionId: 's1',
    projectSlug: '-Users-dev-my-project',
    title: 'Fix auth bug',
    status: 'working',
    currentAction: 'Editing auth.ts',
    filesTouched: ['a.ts', 'b.ts'],
    subagentCount: 0,
    pendingQuestion: null,
    agents: [],
    lastActivityAt: Date.now(),
    tokens: { output: 0, cacheRead: 0, cacheCreate: 0, perMin: [] },
    taskSummary: { total: 0, pending: 0, in_progress: 0, completed: 0 },
    workflowPhase: null,
    ...overrides,
  };
}

test('renders title, project slug, and current action', () => {
  render(SessionCard, { card: makeCard() });
  expect(screen.getByText('Fix auth bug')).toBeInTheDocument();
  expect(screen.getByText('my-project')).toBeInTheDocument();
  expect(screen.getByText('Editing auth.ts')).toBeInTheDocument();
});

test('renders a SubagentRow per live agent', () => {
  render(SessionCard, {
    card: makeCard({
      agents: [
        {
          agentId: 'a1',
          label: 'Worker A',
          agentType: 'general',
          toolUseId: null,
          status: 'running',
          currentAction: 'writing tests',
          lastActivityAt: Date.now(),
        },
        {
          agentId: 'a2',
          label: 'Worker B',
          agentType: 'general',
          toolUseId: null,
          status: 'idle',
          currentAction: 'waiting on lock',
          lastActivityAt: Date.now(),
        },
      ],
    }),
  });
  expect(screen.getAllByTestId('subagent-row')).toHaveLength(2);
  expect(screen.getByText(/Worker A/)).toBeInTheDocument();
  expect(screen.getByText(/writing tests/)).toBeInTheDocument();
  // agent.status 'idle' reads as "stalled" per the legacy AGENT_STATUS_LABELS.
  expect(screen.getByText(/stalled/)).toBeInTheDocument();
});

test('a waiting card with a pending question renders QuestionChips', () => {
  render(SessionCard, {
    card: makeCard({
      status: 'waiting-for-you',
      pendingQuestion: {
        toolUseId: 't1',
        kind: 'question',
        askedAt: Date.now(),
        questions: [{ header: 'Pick a path', question: 'Which approach?', multiSelect: false, options: ['A', 'B'] }],
      },
    }),
  });
  expect(screen.getByTestId('question-chips')).toBeInTheDocument();
  expect(screen.getByText('Which approach?')).toBeInTheDocument();
  expect(screen.getByText('A')).toBeInTheDocument();
  expect(screen.getByText('B')).toBeInTheDocument();
});

test('a waiting card with no pending question renders as done, not QuestionChips', () => {
  render(SessionCard, { card: makeCard({ status: 'waiting-for-you', pendingQuestion: null }) });
  expect(screen.queryByTestId('question-chips')).not.toBeInTheDocument();
  expect(screen.getByText('done')).toBeInTheDocument();
});

test('a launched session always exposes a Stop control', () => {
  render(SessionCard, { card: makeCard({ launched: true, steerable: false }) });
  expect(screen.getByTestId('launched-controls')).toBeInTheDocument();
  expect(screen.getByTestId('launched-stop')).toBeInTheDocument();
  // non-steerable: no Finish / follow-up
  expect(screen.queryByTestId('launched-finish')).not.toBeInTheDocument();
  expect(screen.queryByTestId('launched-followup-input')).not.toBeInTheDocument();
});

test('a steerable launched session also exposes Finish + a follow-up input', () => {
  render(SessionCard, { card: makeCard({ launched: true, steerable: true }) });
  expect(screen.getByTestId('launched-stop')).toBeInTheDocument();
  expect(screen.getByTestId('launched-finish')).toBeInTheDocument();
  expect(screen.getByTestId('launched-followup-input')).toBeInTheDocument();
});

test('a non-launched session shows no launched controls', () => {
  render(SessionCard, { card: makeCard({ launched: false }) });
  expect(screen.queryByTestId('launched-controls')).not.toBeInTheDocument();
});
