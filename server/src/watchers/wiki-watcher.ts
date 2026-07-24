import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import chokidar from 'chokidar';
import type { FSWatcher } from 'chokidar';

// Watches the two on-disk sources the "Shipped" tab reads, per fleet project, and emits a
// debounced 'wiki-changed' whenever either changes so the tab updates live without a refresh:
//   - docs/wiki/*.md      the plain-language entries the /ck:wiki skill generates (depth 0)
//   - plans/<slug>/plan.md the plan status/meta that decides which cards show + the shipped
//                          badge (depth 1, filtered to plan.md so phase/report churn is ignored)
// Read-only: it only watches. The set of roots grows as sessions are discovered, so it
// reconciles its watchers against the reducer on an interval.

export interface WikiWatcherOptions {
  reducer: { listProjectRoots(): string[] };
  syncMs?: number;
  debounceMs?: number;
}

// Each fleet root contributes two watch targets, keyed by absolute dir. `onlyPlanMd` limits
// the plans/ watcher to status-bearing plan.md files so it ignores phase/report writes.
interface WatchTarget {
  depth: number;
  onlyPlanMd: boolean;
}

interface WikiWatcherEventMap {
  'wiki-changed': [];
}

export class WikiWatcher extends EventEmitter<WikiWatcherEventMap> {
  private readonly reducer: { listProjectRoots(): string[] };
  private readonly syncMs: number;
  private readonly debounceMs: number;
  private readonly watched: Map<string, FSWatcher>; // watchDir -> chokidar watcher
  private debounce: NodeJS.Timeout | null;
  private timer: NodeJS.Timeout | null;

  constructor({ reducer, syncMs = 30_000, debounceMs = 300 }: WikiWatcherOptions) {
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

  private desiredTargets(): Map<string, WatchTarget> {
    const targets = new Map<string, WatchTarget>(); // dir -> { depth, onlyPlanMd }
    for (const root of this.reducer.listProjectRoots()) {
      const wikiDir = path.join(root, 'docs', 'wiki');
      if (isDirectory(wikiDir)) targets.set(wikiDir, { depth: 0, onlyPlanMd: false });
      const plansDir = path.join(root, 'plans');
      if (isDirectory(plansDir)) targets.set(plansDir, { depth: 1, onlyPlanMd: true });
    }
    return targets;
  }

  private sync(): void {
    const desired = this.desiredTargets();
    // Add watchers for newly-appeared target dirs.
    for (const [dir, opts] of desired) {
      if (this.watched.has(dir)) continue;
      const w = chokidar.watch(dir, { ignoreInitial: true, depth: opts.depth });
      w.on('all', (_event: string, changedPath: string) => {
        if (opts.onlyPlanMd && path.basename(changedPath) !== 'plan.md') return;
        this.emitChange();
      });
      this.watched.set(dir, w);
    }
    // Drop watchers for roots that vanished.
    for (const [dir, w] of this.watched) {
      if (!desired.has(dir)) { w.close().catch(() => {}); this.watched.delete(dir); }
    }
  }

  private emitChange(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.emit('wiki-changed'), this.debounceMs);
    this.debounce.unref?.();
  }
}

function isDirectory(dir: string): boolean {
  try { return fs.statSync(dir).isDirectory(); } catch { return false; }
}
