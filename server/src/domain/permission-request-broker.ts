import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

// In-memory broker between the PreToolUse hook (running inside a blocked
// Claude Code session) and the dashboard UI. The hook POSTs a request and
// long-polls for the decision; the UI answers it. Holds no history — a request
// lives exactly as long as someone might still act on it.
//
// Zombie protection is two-layered:
//  - precise: the transcript shows the tool_use resolved (user answered in the
//    terminal after a fail-open, or the tool ran) → resolveByToolUse cancels.
//  - safety net: the hook process died (Ctrl+C, crash) so nobody polls anymore
//    → sweepOrphans cancels after `orphanMs` without an attached waiter.

export interface PermissionRequestInput {
  sessionId: string;
  toolName: string;
  toolInput: unknown;
  toolUseId: string;
  permissionMode: string;
  cwd: string;
}

export type PermissionDecision = 'allow' | 'deny';
export type PollResult = PermissionDecision | 'passthrough' | 'timeout' | null;

export interface PendingPermission extends PermissionRequestInput {
  requestId: string;
  askedAt: number;
}

interface InternalRequest extends PendingPermission {
  decision: PermissionDecision | 'passthrough' | null;
  lastSeenAt: number;
  waiters: Set<(result: PermissionDecision | 'passthrough' | 'timeout') => void>;
}

interface PermissionBrokerEventMap {
  'permission-pending': [request: PendingPermission];
  'permission-resolved': [payload: { requestId: string; sessionId: string; decision: PermissionDecision | 'passthrough' }];
}

export interface PermissionRequestBrokerOptions {
  now?: () => number;
  /** No waiter attached for this long → the hook is gone; cancel the request. */
  orphanMs?: number;
  /** Burst insurance: refuse new requests past this many live entries. */
  maxPending?: number;
}

export class PermissionRequestBroker extends EventEmitter<PermissionBrokerEventMap> {
  private readonly now: () => number;
  private readonly orphanMs: number;
  private readonly maxPending: number;
  private readonly byId = new Map<string, InternalRequest>();

  constructor({ now = Date.now, orphanMs = 90_000, maxPending = 200 }: PermissionRequestBrokerOptions = {}) {
    super();
    this.now = now;
    this.orphanMs = orphanMs;
    this.maxPending = maxPending;
  }

  /** Register (or idempotently re-register after a hook re-POST) a request.
   * Returns null at the pending cap — the caller refuses and the hook fails
   * open, so a burst (or a hostile spammer) can't grow memory unboundedly. */
  request(input: PermissionRequestInput): { requestId: string } | null {
    // A hook that saw its request vanish (server restart) re-POSTs the same
    // tool call — match on (sessionId, toolUseId) so the card doesn't double.
    if (input.toolUseId) {
      for (const existing of this.byId.values()) {
        if (existing.sessionId === input.sessionId && existing.toolUseId === input.toolUseId && !existing.decision) {
          existing.lastSeenAt = this.now();
          return { requestId: existing.requestId };
        }
      }
    }
    if (this.byId.size >= this.maxPending) return null;
    const requestId = randomUUID();
    const entry: InternalRequest = {
      ...input,
      requestId,
      askedAt: this.now(),
      decision: null,
      lastSeenAt: this.now(),
      waiters: new Set(),
    };
    this.byId.set(requestId, entry);
    this.emit('permission-pending', toPublic(entry));
    return { requestId };
  }

  /**
   * Hold until the request is decided or `timeoutMs` passes ('timeout' → the
   * hook re-polls, making the overall wait unbounded). null → unknown id.
   */
  waitDecision(requestId: string, timeoutMs: number): Promise<PollResult> {
    const entry = this.byId.get(requestId);
    if (!entry) return Promise.resolve(null);
    if (entry.decision) {
      this.byId.delete(requestId); // delivered — nothing left to act on
      return Promise.resolve(entry.decision);
    }
    entry.lastSeenAt = this.now();
    return new Promise((resolve) => {
      const waiter = (result: PermissionDecision | 'passthrough' | 'timeout'): void => {
        clearTimeout(timer);
        entry.waiters.delete(waiter);
        entry.lastSeenAt = this.now();
        if (result !== 'timeout') this.byId.delete(requestId); // delivered
        resolve(result);
      };
      // Deliberately NOT unref'd: this timer backs a held HTTP long-poll that
      // must always get a response — unref would let the loop drain past it.
      const timer = setTimeout(() => waiter('timeout'), timeoutMs);
      entry.waiters.add(waiter);
    });
  }

  /** UI decision. False when the request is unknown/already decided. */
  answer(requestId: string, decision: PermissionDecision): boolean {
    const entry = this.byId.get(requestId);
    if (!entry || entry.decision) return false;
    this.resolve(entry, decision);
    return true;
  }

  /** Transcript saw this tool_use resolve — the session moved on without us. */
  resolveByToolUse(sessionId: string, toolUseId: string): void {
    if (!toolUseId) return;
    for (const entry of this.byId.values()) {
      if (entry.sessionId === sessionId && entry.toolUseId === toolUseId && !entry.decision) {
        this.resolve(entry, 'passthrough');
      }
    }
  }

  /** Cancel requests whose hook stopped polling (process died), and drop
   * decided-but-never-delivered entries the dead hook will never collect. */
  sweepOrphans(): number {
    let swept = 0;
    for (const entry of [...this.byId.values()]) {
      if (entry.waiters.size > 0 || this.now() - entry.lastSeenAt <= this.orphanMs) continue;
      if (entry.decision) {
        this.byId.delete(entry.requestId);
      } else {
        this.resolve(entry, 'passthrough');
        this.byId.delete(entry.requestId);
        swept += 1;
      }
    }
    return swept;
  }

  listPending(sessionId?: string): PendingPermission[] {
    return [...this.byId.values()]
      .filter((e) => !e.decision && (!sessionId || e.sessionId === sessionId))
      .map(toPublic);
  }

  /** Sessions that currently have at least one undecided request. */
  pendingSessionIds(): Set<string> {
    return new Set(this.listPending().map((e) => e.sessionId));
  }

  /** Shutdown: flush every waiter with 'timeout' so held HTTP polls end. */
  close(): void {
    for (const entry of this.byId.values()) {
      for (const waiter of [...entry.waiters]) waiter('timeout');
    }
    this.byId.clear();
  }

  private resolve(entry: InternalRequest, decision: PermissionDecision | 'passthrough'): void {
    entry.decision = decision;
    for (const waiter of [...entry.waiters]) waiter(decision);
    // No waiter attached (answered between polls): keep the entry so the next
    // poll delivers it; the sweep or delivery will delete it.
    if (entry.waiters.size === 0) entry.lastSeenAt = this.now();
    this.emit('permission-resolved', { requestId: entry.requestId, sessionId: entry.sessionId, decision });
  }
}

function toPublic(entry: InternalRequest): PendingPermission {
  const { sessionId, toolName, toolInput, toolUseId, permissionMode, cwd, requestId, askedAt } = entry;
  return { sessionId, toolName, toolInput, toolUseId, permissionMode, cwd, requestId, askedAt };
}
