// The single SSE subscriber + reactive fleet state. Subsumes the legacy
// SseClient (one EventSource shared by all views). Server-authoritative
// collections are `$state.raw` Maps reassigned WHOLESALE on each delta so
// reassignment fires reactivity without deep proxying large payloads.
//
// Load-bearing invariants (do not weaken):
//  - snapshot is AUTHORITATIVE + ORDER-PRESERVING: survivors keep first-seen
//    insertion order, new sessions append, keys ABSENT from the snapshot are
//    pruned (a session that ends during a disconnect must not linger). The
//    server's lastActivityAt sort is NEVER adopted as insertion order — the
//    board applies it as a CSS `order` integer only.
//  - loop cycles are excluded server-side; the client does not (cannot) filter.

import type {
  SessionCard, LoopJob, WorkflowRun, SseEventName,
} from '../../../shared/types/index.js';

const EVENT_NAMES: SseEventName[] = [
  'snapshot', 'session', 'session-removed', 'loop-job',
  'wiki-updated', 'overview-updated', 'workflow', 'workflow-removed',
  'permission-mode',
];

const workflowKey = (sessionId: string, workflowId: string) => `${sessionId}:${workflowId}`;

export class FleetStore {
  sessions = $state.raw(new Map<string, SessionCard>());
  loopJobs = $state.raw(new Map<string, LoopJob>());
  workflows = $state.raw(new Map<string, WorkflowRun>());
  connectionUp = $state(false);
  /** Bumped on the matching SSE event so the Shipped / Overview views refetch. */
  wikiVersion = $state(0);
  overviewVersion = $state(0);

  /** Dashboard-vs-terminal approval toggle. true = opted-in terminal prompts
   * land on this dashboard; false = they stay in their own terminal window. */
  remoteApprovalEnabled = $state(true);

  #es: EventSource | null = null;

  initFleet(url = '/events'): void {
    if (this.#es) return;
    const es = new EventSource(url);
    es.onopen = () => { this.connectionUp = true; };
    es.onerror = () => { this.connectionUp = false; };
    for (const name of EVENT_NAMES) {
      es.addEventListener(name, (e) => {
        let data: unknown;
        try { data = JSON.parse((e as MessageEvent).data); } catch { return; }
        try { this.#dispatch(name, data); } catch (err) { console.error(`[sse:${name}]`, err); }
      });
    }
    this.#es = es;
    // Seed the approval toggle from the server; live flips arrive over SSE.
    void fetch('/api/permissions/mode')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && typeof d.enabled === 'boolean') this.remoteApprovalEnabled = d.enabled; })
      .catch(() => { /* keep default on */ });
  }

  destroyFleet(): void {
    this.#es?.close();
    this.#es = null;
    this.connectionUp = false;
  }

  // Mount-time hydration: loop jobs and workflows are NOT part of the SSE
  // `snapshot` (only session cards are), so a fresh load / reconnect would show
  // nothing until the next per-item delta — and settled/interrupted items would
  // never reappear. The Always-on and Workflows views GET their list on mount
  // and seed it here (upsert, so a racing SSE delta is never clobbered).
  hydrateLoopJobs(jobs: LoopJob[]): void {
    if (!Array.isArray(jobs) || !jobs.length) return;
    const next = new Map(this.loopJobs);
    for (const job of jobs) next.set(job.id, job);
    this.loopJobs = next;
  }

  hydrateWorkflows(runs: WorkflowRun[]): void {
    if (!Array.isArray(runs) || !runs.length) return;
    const next = new Map(this.workflows);
    for (const wf of runs) next.set(workflowKey(wf.sessionId, wf.workflowId), wf);
    this.workflows = next;
  }

  #dispatch(name: SseEventName, data: unknown): void {
    switch (name) {
      case 'snapshot': return this.#onSnapshot(data as SessionCard[]);
      case 'session': return this.#upsertSession(data as SessionCard);
      case 'session-removed': return this.#removeSession((data as { sessionId: string }).sessionId);
      case 'loop-job': return this.#upsertLoopJob(data as LoopJob);
      case 'workflow': return this.#upsertWorkflow(data as WorkflowRun);
      case 'workflow-removed': return this.#removeWorkflows((data as { sessionId: string }).sessionId);
      case 'wiki-updated': this.wikiVersion += 1; return;
      case 'overview-updated': this.overviewVersion += 1; return;
      case 'permission-mode': this.remoteApprovalEnabled = (data as { enabled: boolean }).enabled; return;
    }
  }

  // Authoritative + order-preserving merge (see header).
  #onSnapshot(cards: SessionCard[]): void {
    const incoming = new Map(cards.map((c) => [c.sessionId, c]));
    const next = new Map<string, SessionCard>();
    for (const id of this.sessions.keys()) {          // survivors keep insertion order
      const card = incoming.get(id);
      if (card) next.set(id, card);
    }
    for (const [id, card] of incoming) {              // genuinely new sessions append
      if (!next.has(id)) next.set(id, card);
    }
    this.sessions = next;                             // absent keys pruned; reassign fires reactivity
  }

  #upsertSession(card: SessionCard): void {
    const next = new Map(this.sessions);
    next.set(card.sessionId, card);                   // existing key keeps its slot; new key appends
    this.sessions = next;
  }

  #removeSession(sessionId: string): void {
    if (!this.sessions.has(sessionId)) return;
    const next = new Map(this.sessions);
    next.delete(sessionId);
    this.sessions = next;
  }

  #upsertLoopJob(job: LoopJob): void {
    const next = new Map(this.loopJobs);
    next.set(job.id, job);
    this.loopJobs = next;
  }

  #upsertWorkflow(wf: WorkflowRun): void {
    const next = new Map(this.workflows);
    next.set(workflowKey(wf.sessionId, wf.workflowId), wf);
    this.workflows = next;
  }

  #removeWorkflows(sessionId: string): void {
    const next = new Map(this.workflows);
    let changed = false;
    for (const [key, wf] of next) {
      if (wf.sessionId === sessionId) { next.delete(key); changed = true; }
    }
    if (changed) this.workflows = next;
  }
}

export const fleetStore = new FleetStore();
