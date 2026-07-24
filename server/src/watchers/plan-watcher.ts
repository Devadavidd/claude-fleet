import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import chokidar from 'chokidar';
import type { FSWatcher } from 'chokidar';

// Watches every fleet project's plans/ directory and emits a debounced 'plans-changed' whenever a
// plan.md or phase-*.md is added/changed/removed, so the Overview dashboard's durable progress
// (checkbox %, plan status) refreshes live without a reload. Read-only: it only watches. Depth 1
// covers plans/<slug>/*.md. The set of roots grows as sessions are discovered, so it reconciles
// its watchers against the reducer on an interval — mirrors WikiWatcher.

export interface PlanWatcherOptions {
  reducer: { listProjectRoots(): string[] };
  syncMs?: number;
  debounceMs?: number;
}

interface PlanWatcherEventMap {
  'plans-changed': [];
}

export class PlanWatcher extends EventEmitter<PlanWatcherEventMap> {
  private readonly reducer: { listProjectRoots(): string[] };
  private readonly syncMs: number;
  private readonly debounceMs: number;
  private readonly watched: Map<string, FSWatcher>; // plansDir -> chokidar watcher
  private debounce: NodeJS.Timeout | null;
  private timer: NodeJS.Timeout | null;

  constructor({ reducer, syncMs = 30_000, debounceMs = 400 }: PlanWatcherOptions) {
    super();
    this.reducer = reducer;
    this.syncMs = syncMs;
    this.debounceMs = debounceMs;
    this.watched = new Map();
    this.debounce = null;
    this.timer = null;
  }

  start(): void {
    this.sync();
    this.timer = setInterval(() => this.sync(), this.syncMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
    await Promise.all([...this.watched.values()].map((w) => w.close()));
    this.watched.clear();
  }

  private sync(): void {
    const desired = new Set(
      this.reducer.listProjectRoots()
        .map((root) => path.join(root, 'plans'))
        .filter((dir) => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } }),
    );
    for (const dir of desired) {
      if (this.watched.has(dir)) continue;
      // depth 1 = plans/<slug>/*.md (plan.md + phase-*.md), not deeper research/ trees.
      const w = chokidar.watch(dir, { ignoreInitial: true, depth: 1 });
      w.on('all', () => this.emitChange());
      this.watched.set(dir, w);
    }
    for (const [dir, w] of this.watched) {
      if (!desired.has(dir)) { w.close().catch(() => {}); this.watched.delete(dir); }
    }
  }

  private emitChange(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.emit('plans-changed'), this.debounceMs);
    this.debounce.unref?.();
  }
}
