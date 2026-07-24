import { test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import AlwaysOn from './AlwaysOn.svelte';
import { fleetStore } from '../fleet-store.svelte.js';
import { MockEventSource } from '../../../vitest.setup.js';
import type { LoopJob } from '../../../../shared/types/index.js';

function job(overrides: Partial<LoopJob> = {}): LoopJob {
  return {
    id: 'j1',
    task: 'watch site',
    cwd: '/tmp/proj',
    model: 'claude-x',
    mode: 'job',
    intervalSec: 300,
    status: 'running',
    cyclesDone: 3,
    consecutiveFailures: 0,
    lastResult: null,
    lastRunAt: Date.now(),
    createdAt: Date.now(),
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
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 202, json: async () => ({}) })));
});

afterEach(() => {
  cleanup();
  fleetStore.destroyFleet();
  fleetStore.loopJobs = new Map(); // destroyFleet() only tears down the SSE, not the Map
  vi.unstubAllGlobals();
});

test('renders a loop job card with status + cumulative cycle count', async () => {
  render(AlwaysOn);
  es._emit('loop-job', job());
  await tick();

  expect(screen.getByTestId('loop-job-card')).toBeInTheDocument();
  expect(screen.getByText('watch site')).toBeInTheDocument();
  expect(screen.getByTestId('loop-job-status')).toHaveTextContent('live');
  expect(screen.getByTestId('loop-job-cycles')).toHaveTextContent('3 cycles');
});

test('Stop posts to /api/loop-jobs/:id/stop with fleet headers', async () => {
  const fetchMock = vi.fn(async () => ({ ok: true, status: 202, json: async () => ({}) }));
  vi.stubGlobal('fetch', fetchMock);
  render(AlwaysOn);
  es._emit('loop-job', job());
  await tick();

  await fireEvent.click(screen.getByTestId('loop-job-stop'));

  expect(fetchMock).toHaveBeenCalledWith(
    '/api/loop-jobs/j1/stop',
    expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'x-fleet-token': expect.any(String) }) }),
  );
});

test('Resume is offered for a paused job, not Stop', async () => {
  render(AlwaysOn);
  es._emit('loop-job', job({ status: 'paused' }));
  await tick();

  expect(screen.getByTestId('loop-job-resume')).toBeInTheDocument();
  expect(screen.queryByTestId('loop-job-stop')).not.toBeInTheDocument();
});

test('shows an empty state with no loop jobs', () => {
  render(AlwaysOn);
  expect(screen.getByText(/No always-on agents yet/)).toBeInTheDocument();
});
