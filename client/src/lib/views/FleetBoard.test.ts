import { test, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import FleetBoard from './FleetBoard.svelte';
import { fleetStore } from '../fleet-store.svelte.js';
import { MockEventSource } from '../../../vitest.setup.js';
import type { SessionCard } from '../../../../shared/types/index.js';

// Minimal card factory — only the fields the board reads/keys.
function card(sessionId: string, overrides: Partial<SessionCard> = {}): SessionCard {
  return {
    sessionId,
    projectSlug: '-Users-dev-proj',
    title: sessionId,
    status: 'working',
    currentAction: 'doing work',
    filesTouched: [],
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

function slotFor(sessionId: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-session-id="${sessionId}"]`);
  if (!el) throw new Error(`no board slot for ${sessionId}`);
  return el;
}

// The sort-order effect runs on a real ~50ms debounce (see FleetBoard.svelte);
// waiting it out plus a tick is simplest given jsdom + Svelte 5 effect timing.
async function flushSortDebounce(): Promise<void> {
  await new Promise((r) => setTimeout(r, 60));
  await tick();
}

let es: MockEventSource;

beforeEach(async () => {
  // fleetStore is a module singleton shared across this file's tests — reset
  // its connection + Map so each test starts from a clean, empty board.
  fleetStore.destroyFleet();
  MockEventSource.instances.length = 0;
  fleetStore.initFleet('/events');
  es = MockEventSource.instances.at(-1)!;
  es._emit('snapshot', []);
  await tick();
});

afterEach(() => {
  // @testing-library/svelte does not auto-register teardown in this project's
  // vitest setup — without this, each render() below would stack onto the
  // previous test's still-mounted DOM tree and querySelector would match a
  // stale node instead of the current test's board.
  cleanup();
  fleetStore.destroyFleet();
});

test('renders three columns', () => {
  render(FleetBoard);
  expect(screen.getByTestId('board-column-waiting')).toBeInTheDocument();
  expect(screen.getByTestId('board-column-working')).toBeInTheDocument();
  expect(screen.getByTestId('board-column-idle')).toBeInTheDocument();
});

test('board grid uses dense packing so every column stacks from row 1', () => {
  // Without dense, the forward-only grid placement cursor pushes a column's
  // first card below globally-earlier-ranked cards of OTHER columns (idle
  // column starting under two working cards; waiting card shoved offscreen).
  render(FleetBoard);
  expect(screen.getByTestId('fleet-board-grid').classList.contains('grid-flow-row-dense')).toBe(true);
});

test('each card slot gets a masonry grid-row span so columns pack independently', async () => {
  // Columns share one grid: without per-card spans over the fine 8px implicit
  // rows, a tall card in one column stretches the whole row and leaves vertical
  // holes next to the shorter cards of the other columns.
  render(FleetBoard);
  es._emit('snapshot', [card('s1', { status: 'working' })]);
  await tick();
  expect(slotFor('s1').style.gridRowEnd).toMatch(/^span \d+$/);
});

test('a waiting-with-question card lands in the waiting column and shows QuestionChips', async () => {
  render(FleetBoard);
  es._emit('snapshot', [
    card('s1', {
      status: 'waiting-for-you',
      pendingQuestion: {
        toolUseId: 't1',
        kind: 'question',
        askedAt: Date.now(),
        questions: [{ header: 'h', question: 'q?', multiSelect: false, options: ['Yes'] }],
      },
    }),
  ]);
  await tick();

  const slot = slotFor('s1');
  expect(slot.dataset.column).toBe('waiting');
  expect(within(slot).getByTestId('question-chips')).toBeInTheDocument();
});

test('a same-column recency update keeps the same DOM node — only its order style changes', async () => {
  render(FleetBoard);
  es._emit('snapshot', [card('a', { lastActivityAt: 1000 }), card('b', { lastActivityAt: 2000 })]);
  await tick();
  await flushSortDebounce();

  const before = slotFor('a');
  // Raw attribute string, not the parsed `.style.order` getter — more robust
  // against jsdom's CSSOM handling of shorthand/grid-adjacent properties.
  const styleBefore = before.getAttribute('style');
  expect(before.dataset.column).toBe('working');

  // 'a' becomes the most recent card, but its status (and thus column) is
  // unchanged — only its rank should move.
  es._emit('session', card('a', { lastActivityAt: 9999 }));
  await tick();
  await flushSortDebounce();

  const after = slotFor('a');
  expect(after).toBe(before); // same DOM node — never destroyed/recreated
  expect(after.dataset.column).toBe('working'); // column unchanged
  expect(after.getAttribute('style')).not.toBe(styleBefore); // only the rank moved
});

test('a status change (crossing columns) keeps the same DOM node — column + order styles change', async () => {
  render(FleetBoard);
  es._emit('snapshot', [card('a', { status: 'working' })]);
  await tick();
  await flushSortDebounce();

  const before = slotFor('a');
  expect(before.dataset.column).toBe('working');
  // Raw attribute string (not the parsed `.style.gridColumn` getter, which
  // jsdom's CSSOM does not reliably round-trip for the grid-column shorthand)
  // captured BEFORE the mutation — `before`/`after` end up being the same
  // live node, so its style must be read now, not after the emit.
  const styleBefore = before.getAttribute('style');

  es._emit('session', card('a', {
    status: 'waiting-for-you',
    pendingQuestion: {
      toolUseId: 't2', kind: 'question', askedAt: Date.now(),
      questions: [{ header: 'h', question: 'q?', multiSelect: false, options: ['Yes'] }],
    },
  }));
  await tick();

  const after = slotFor('a');
  expect(after).toBe(before); // same element — the {#each} key never changed
  expect(after.dataset.column).toBe('waiting');
  expect(after.getAttribute('style')).not.toBe(styleBefore); // column moved via style only
});

test('a 30-card resorted snapshot keeps every node identity stable', async () => {
  render(FleetBoard);
  const ids = Array.from({ length: 30 }, (_, i) => `c${i}`);
  const initial = ids.map((id, i) => card(id, { lastActivityAt: i }));
  es._emit('snapshot', initial);
  await tick();
  await flushSortDebounce();

  const before = new Map(ids.map((id) => [id, slotFor(id)]));

  // Re-sorted snapshot (server's lastActivityAt-desc order) — the store's
  // Map merge must NOT adopt this as insertion order, and the board must
  // NOT move any DOM node in response.
  const reordered = [...initial].sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
  es._emit('snapshot', reordered);
  await tick();
  await flushSortDebounce();

  for (const id of ids) {
    expect(slotFor(id)).toBe(before.get(id));
  }
});
