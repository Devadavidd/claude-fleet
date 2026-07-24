import { test, expect, beforeEach } from 'vitest';
import { FleetStore } from './fleet-store.svelte.js';
import { MockEventSource } from '../../vitest.setup.js';
import type { SessionCard } from '../../../shared/types/index.js';

// Minimal card factory — only the fields the store keys/reads.
const card = (sessionId: string, extra: Partial<SessionCard> = {}): SessionCard =>
  ({ sessionId, status: 'working', title: sessionId, ...extra } as SessionCard);

let store: FleetStore;
let es: MockEventSource;

beforeEach(() => {
  MockEventSource.instances.length = 0;
  store = new FleetStore();
  store.initFleet('/events');
  es = MockEventSource.instances.at(-1)!;
});

test('handles all eight named events', () => {
  // Presence check: every event name has a registered listener.
  for (const name of ['snapshot', 'session', 'session-removed', 'loop-job', 'wiki-updated', 'overview-updated', 'workflow', 'workflow-removed']) {
    expect(es.listeners.has(name)).toBe(true);
  }
});

test('connectionUp toggles on open/error', () => {
  es.onopen?.();
  expect(store.connectionUp).toBe(true);
  es.onerror?.();
  expect(store.connectionUp).toBe(false);
});

test('snapshot is authoritative: absent keys are pruned', () => {
  es._emit('snapshot', [card('x'), card('y')]);
  expect([...store.sessions.keys()]).toEqual(['x', 'y']);
  es._emit('snapshot', [card('x')]); // y vanished during a disconnect
  expect([...store.sessions.keys()]).toEqual(['x']);
});

test('snapshot preserves first-seen insertion order; new sessions append', () => {
  es._emit('snapshot', [card('a'), card('b'), card('c')]);
  // Reordered by the server (sort) — insertion order must NOT change; d appends.
  es._emit('snapshot', [card('c'), card('b'), card('a'), card('d')]);
  expect([...store.sessions.keys()]).toEqual(['a', 'b', 'c', 'd']);
});

test('session upsert keeps an existing card in its slot, appends a new one', () => {
  es._emit('snapshot', [card('a'), card('b')]);
  es._emit('session', card('a', { status: 'idle' }));
  expect([...store.sessions.keys()]).toEqual(['a', 'b']);
  expect(store.sessions.get('a')!.status).toBe('idle');
  es._emit('session', card('z'));
  expect([...store.sessions.keys()]).toEqual(['a', 'b', 'z']);
});

test('session-removed deletes only that key', () => {
  es._emit('snapshot', [card('a'), card('b')]);
  es._emit('session-removed', { sessionId: 'a' });
  expect([...store.sessions.keys()]).toEqual(['b']);
});

test('loop-job upserts by id', () => {
  es._emit('loop-job', { id: 'j1', status: 'running' });
  es._emit('loop-job', { id: 'j1', status: 'stopped' });
  expect(store.loopJobs.size).toBe(1);
  expect(store.loopJobs.get('j1')!.status).toBe('stopped');
});

test('workflow upsert + workflow-removed clears a whole session', () => {
  es._emit('workflow', { sessionId: 's1', workflowId: 'wA' });
  es._emit('workflow', { sessionId: 's1', workflowId: 'wB' });
  es._emit('workflow', { sessionId: 's2', workflowId: 'wC' });
  expect(store.workflows.size).toBe(3);
  es._emit('workflow-removed', { sessionId: 's1' });
  expect([...store.workflows.values()].map((w) => w.sessionId)).toEqual(['s2']);
});

test('wiki/overview events bump their refetch versions', () => {
  es._emit('wiki-updated', { changed: true });
  es._emit('overview-updated', { changed: true });
  es._emit('overview-updated', { changed: true });
  expect(store.wikiVersion).toBe(1);
  expect(store.overviewVersion).toBe(2);
});

test('a malformed JSON frame is swallowed, not thrown', () => {
  const fn = es.listeners.get('snapshot')!.values().next().value!;
  expect(() => fn(new MessageEvent('snapshot', { data: '{ not json' }))).not.toThrow();
});

test('hydrateLoopJobs seeds jobs not carried by the snapshot (upsert, no clobber)', () => {
  es._emit('loop-job', { id: 'live', status: 'running' }); // an SSE delta arrives first
  store.hydrateLoopJobs([
    { id: 'interrupted-1', status: 'interrupted' },
    { id: 'live', status: 'paused' }, // hydrate overwrites by id
  ] as never);
  expect(store.loopJobs.get('interrupted-1')!.status).toBe('interrupted');
  expect(store.loopJobs.get('live')!.status).toBe('paused');
  expect(store.loopJobs.size).toBe(2);
});

test('hydrateWorkflows seeds settled runs not in the snapshot', () => {
  store.hydrateWorkflows([
    { sessionId: 's1', workflowId: 'wA', status: 'done' },
    { sessionId: 's1', workflowId: 'wB', status: 'running' },
  ] as never);
  expect(store.workflows.size).toBe(2);
  es._emit('workflow-removed', { sessionId: 's1' }); // later removal still works
  expect(store.workflows.size).toBe(0);
});

test('destroyFleet closes the EventSource', () => {
  store.destroyFleet();
  expect(es.closed).toBe(true);
});
