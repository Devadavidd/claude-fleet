import { test, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import WorkflowsFleet from './WorkflowsFleet.svelte';
import { fleetStore } from '../fleet-store.svelte.js';
import { MockEventSource } from '../../../vitest.setup.js';
import type { WorkflowRun } from '../../../../shared/types/index.js';

function workflow(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    sessionId: 's1',
    projectSlug: '-Users-dev-proj',
    workflowId: 'w1',
    name: 'Ship feature X',
    description: null,
    phases: [],
    status: 'running',
    agentCount: 1,
    running: 1,
    done: 0,
    tokensTotal: 4800,
    toolsTotal: 12,
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    agents: [
      {
        agentId: 'a1',
        label: 'Worker A',
        phase: null,
        agentType: 'general-purpose',
        spawnDepth: 1,
        status: 'running',
        tokens: 4800,
        toolCount: 12,
        startedAt: Date.now(),
        durationMs: 65_000,
      },
    ],
    ...overrides,
  };
}

let es: MockEventSource;

beforeEach(() => {
  // fleetStore is a module singleton shared across this file's tests — reset
  // its connection + Map so each test starts from a clean, empty view.
  fleetStore.destroyFleet();
  MockEventSource.instances.length = 0;
  fleetStore.initFleet('/events');
  es = MockEventSource.instances.at(-1)!;
});

afterEach(() => {
  cleanup();
  fleetStore.destroyFleet();
  // destroyFleet() only tears down the SSE connection, not the Maps it fed —
  // reset workflows explicitly so the next test starts from an empty view
  // (there is no bulk "workflow-snapshot" event to clear it via SSE).
  fleetStore.workflows = new Map();
});

test('renders a workflow run row', async () => {
  render(WorkflowsFleet);
  es._emit('workflow', workflow());
  await tick();

  expect(screen.getByTestId('workflow-run-row')).toBeInTheDocument();
  expect(screen.getByText('Ship feature X')).toBeInTheDocument();
  expect(screen.getByText(/1 workflow — 1 running/)).toBeInTheDocument();
});

test('expands a run row to reveal its agents, grouped and formatted', async () => {
  render(WorkflowsFleet);
  es._emit('workflow', workflow());
  await tick();
  expect(screen.queryByTestId('workflow-agent-row')).not.toBeInTheDocument();

  await fireEvent.click(screen.getByText('Ship feature X'));
  await tick();

  const row = screen.getByTestId('workflow-agent-row');
  expect(within(row).getByText(/Worker A/)).toBeInTheDocument();
  expect(within(row).getByText('4.8k')).toBeInTheDocument(); // formatTokens
  expect(within(row).getByText('1:05')).toBeInTheDocument(); // formatDuration
});

test('renders an empty state with no workflows', () => {
  render(WorkflowsFleet);
  expect(screen.getByText(/No workflows running/)).toBeInTheDocument();
});
