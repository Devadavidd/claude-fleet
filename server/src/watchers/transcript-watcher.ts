import { EventEmitter } from 'node:events';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import chokidar from 'chokidar';
import type { FSWatcher } from 'chokidar';
import type { TranscriptEntry } from '../../../shared/types/index.js';
import { parseLine } from '../readers/jsonl-defensive-parser.js';
import { identifyPath } from './transcript-path.js';
import type { TranscriptPathInfo } from './transcript-path.js';

// Watches session transcripts, subagent transcripts, and workflow runs (path
// shapes classified in transcript-path.ts). Strictly read-only — files are only
// ever opened with read streams. Emits:
//   'session-event'   { projectSlug, sessionId, agentId|null, agentMeta, filePath, entry }
//   'workflow-event'  { projectSlug, sessionId, workflowId, agentId, agentMeta, filePath, entry }
//   'workflow-journal'{ projectSlug, sessionId, workflowId, filePath, entry }
//   'session-stale' { sessionId } / 'agent-stale' { sessionId, agentId }

export interface TranscriptWatcherOptions {
  projectsRoot: string;
  activeMinutes: number;
}

// Per-file read state; queue serializes reads per file because chokidar can
// fire bursts of change events for one write. agentMeta is parsed from an
// untrusted sibling *.meta.json — kept as `unknown` until a consumer narrows it.
interface FileState {
  offset: number;
  carry: string;
  queue: Promise<void>;
  agentMeta: unknown;
}

export interface SessionEventPayload {
  projectSlug: string;
  sessionId: string;
  agentId: string | null;
  agentMeta: unknown;
  filePath: string;
  entry: TranscriptEntry;
}

export interface WorkflowEventPayload {
  projectSlug: string;
  sessionId: string;
  workflowId: string;
  agentId: string;
  agentMeta: unknown;
  filePath: string;
  entry: TranscriptEntry;
}

export interface WorkflowJournalPayload {
  projectSlug: string;
  sessionId: string;
  workflowId: string;
  filePath: string;
  entry: TranscriptEntry;
}

interface TranscriptWatcherEventMap {
  'session-event': [payload: SessionEventPayload];
  'workflow-event': [payload: WorkflowEventPayload];
  'workflow-journal': [payload: WorkflowJournalPayload];
  'session-stale': [payload: { sessionId: string }];
  'agent-stale': [payload: { sessionId: string; agentId: string }];
  'watch-error': [err: unknown];
}

export class TranscriptWatcher extends EventEmitter<TranscriptWatcherEventMap> {
  private readonly projectsRoot: string;
  private readonly activeMs: number; // <= 0 → unlimited: sessions are never aged out of the board.
  private readonly files: Map<string, FileState>;
  // Resolver maps for the timeline API — ids → filePath, never built from client input.
  private readonly sessionFiles: Map<string, string>; // sessionId -> filePath
  private readonly agentFiles: Map<string, string>; // `${sessionId}:${agentId}` -> filePath
  private readonly workflowAgentFiles: Map<string, string>; // `${sessionId}:${workflowId}:${agentId}` -> filePath
  private readonly workflowJournalFiles: Map<string, string>; // `${sessionId}:${workflowId}` -> filePath
  private watcher: FSWatcher | null;
  private sweepTimer: NodeJS.Timeout | null;

  constructor({ projectsRoot, activeMinutes }: TranscriptWatcherOptions) {
    super();
    this.projectsRoot = projectsRoot;
    this.activeMs = activeMinutes > 0 ? activeMinutes * 60_000 : Infinity;
    this.files = new Map();
    this.sessionFiles = new Map();
    this.agentFiles = new Map();
    this.workflowAgentFiles = new Map();
    this.workflowJournalFiles = new Map();
    this.watcher = null;
    this.sweepTimer = null;
  }

  start(): void {
    this.watcher = chokidar.watch(this.projectsRoot, {
      // Workflow agent/journal files sit at path-depth 6 (see transcript-path.ts).
      depth: 6,
      ignoreInitial: false,
      awaitWriteFinish: false,
    });
    this.watcher.on('add', (p: string) => this.onFileTouched(p));
    this.watcher.on('change', (p: string) => this.onFileTouched(p));
    this.watcher.on('unlink', (p: string) => this.dropFile(p));
    this.watcher.on('error', (err: unknown) => this.emit('watch-error', err));
    this.sweepTimer = setInterval(() => { this.sweepStale().catch((err: unknown) => this.emit('watch-error', err)); }, 60_000); // retire idle sessions
    this.sweepTimer.unref();
  }

  async stop(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    await this.watcher?.close();
  }

  filePathForSession(sessionId: string): string | null {
    return this.sessionFiles.get(sessionId) ?? null;
  }

  filePathForAgent(sessionId: string, agentId: string): string | null {
    return this.agentFiles.get(`${sessionId}:${agentId}`) ?? null;
  }

  filePathForWorkflowAgent(sessionId: string, workflowId: string, agentId: string): string | null {
    return this.workflowAgentFiles.get(`${sessionId}:${workflowId}:${agentId}`) ?? null;
  }

  private onFileTouched(filePath: string): void {
    if (!filePath.endsWith('.jsonl')) return;
    let state = this.files.get(filePath);
    if (!state) {
      state = { offset: 0, carry: '', queue: Promise.resolve(), agentMeta: null };
      this.files.set(filePath, state);
      this.register(filePath);
    }
    const activeState = state;
    activeState.queue = activeState.queue
      .then(() => this.readNewBytes(filePath, activeState))
      .catch((err: unknown) => { this.emit('watch-error', err); });
  }

  private register(filePath: string): void {
    const info = identifyPath(this.projectsRoot, filePath);
    if (info.kind === 'agent') this.agentFiles.set(`${info.sessionId}:${info.agentId}`, filePath);
    else if (info.kind === 'workflow-agent') this.workflowAgentFiles.set(`${info.sessionId}:${info.workflowId}:${info.agentId}`, filePath);
    else if (info.kind === 'workflow-journal') this.workflowJournalFiles.set(`${info.sessionId}:${info.workflowId}`, filePath);
    else this.sessionFiles.set(info.sessionId, filePath);
  }

  private async readNewBytes(filePath: string, state: FileState): Promise<void> {
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      this.dropFile(filePath);
      return;
    }
    const info = identifyPath(this.projectsRoot, filePath);
    // Active-window gate. A session gates on its own mtime; every child kind
    // (subagent, workflow agent/journal) gates on its PARENT session's mtime so a
    // long-finished worker/workflow stays ingested while its session is live. The
    // session path comes from identifyPath, never client input (no traversal).
    let gateMtimeMs = stat.mtimeMs;
    if (info.kind !== 'session') {
      try {
        const sessStat = await fs.stat(path.join(this.projectsRoot, info.projectSlug, `${info.sessionId}.jsonl`));
        gateMtimeMs = sessStat.mtimeMs;
      } catch { /* no session file — fall back to the file's own mtime */ }
    }
    if (Date.now() - gateMtimeMs > this.activeMs) return; // stale — skip history
    if (stat.size < state.offset) {
      // File truncated/rewritten — start over.
      state.offset = 0;
      state.carry = '';
    }
    if (stat.size === state.offset) return;

    if ((info.kind === 'agent' || info.kind === 'workflow-agent') && !state.agentMeta) {
      // Sibling agent-<id>.meta.json carries {agentType, spawnDepth} — the
      // human-readable label for the worker row. Best-effort, read once.
      state.agentMeta = await fs.readFile(filePath.replace(/\.jsonl$/, '.meta.json'), 'utf8')
        .then((raw): unknown => JSON.parse(raw))
        .catch(() => ({}));
    }
    const stream = createReadStream(filePath, { start: state.offset, end: stat.size - 1, encoding: 'utf8' });
    for await (const chunk of stream as AsyncIterable<string>) {
      const lines = (state.carry + chunk).split('\n');
      state.carry = lines.pop() ?? ''; // last piece may be a partial line
      for (const line of lines) this.emitLine(info, state.agentMeta, filePath, line);
    }
    state.offset = stat.size;
    // A lingering carry is a partial write the next change event completes.
  }

  private emitLine(info: TranscriptPathInfo, agentMeta: unknown, filePath: string, line: string): void {
    const entry = parseLine(line);
    if (!entry) return;
    if (info.kind === 'workflow-agent') {
      this.emit('workflow-event', {
        projectSlug: info.projectSlug, sessionId: info.sessionId, workflowId: info.workflowId,
        agentId: info.agentId, agentMeta, filePath, entry,
      });
    } else if (info.kind === 'workflow-journal') {
      this.emit('workflow-journal', {
        projectSlug: info.projectSlug, sessionId: info.sessionId, workflowId: info.workflowId, filePath, entry,
      });
    } else {
      // session (agentId undefined → null) or subagent — payload unchanged.
      const agentId = info.kind === 'agent' ? info.agentId : null;
      this.emit('session-event', {
        projectSlug: info.projectSlug, sessionId: info.sessionId, agentId, agentMeta, filePath, entry,
      });
    }
  }

  private async sweepStale(): Promise<void> {
    if (this.activeMs === Infinity) return; // unlimited retention — nothing ages out
    for (const [filePath] of this.files) {
      // Workers and workflows are retired together with their parent session
      // (cascade in dropFile), never independently — a finished worker/workflow
      // stays polled and viewable for as long as its session is active.
      if (identifyPath(this.projectsRoot, filePath).kind !== 'session') continue;
      try {
        const stat = await fs.stat(filePath);
        if (Date.now() - stat.mtimeMs > this.activeMs) this.dropFile(filePath);
      } catch {
        this.dropFile(filePath);
      }
    }
  }

  private dropFile(filePath: string): void {
    if (!this.files.delete(filePath)) return;
    const info = identifyPath(this.projectsRoot, filePath);
    if (info.kind === 'agent') {
      const key = `${info.sessionId}:${info.agentId}`;
      if (this.agentFiles.get(key) === filePath) this.agentFiles.delete(key);
      this.emit('agent-stale', { sessionId: info.sessionId, agentId: info.agentId });
      return;
    }
    if (info.kind === 'workflow-agent') {
      const key = `${info.sessionId}:${info.workflowId}:${info.agentId}`;
      if (this.workflowAgentFiles.get(key) === filePath) this.workflowAgentFiles.delete(key);
      return; // the workflow registry drops the whole run on 'session-stale'
    }
    if (info.kind === 'workflow-journal') {
      const key = `${info.sessionId}:${info.workflowId}`;
      if (this.workflowJournalFiles.get(key) === filePath) this.workflowJournalFiles.delete(key);
      return;
    }
    if (this.sessionFiles.get(info.sessionId) === filePath) this.sessionFiles.delete(info.sessionId);
    // Cascade: a session's workers AND workflows die with it — stop polling their
    // files and release their registry entries. The reducer/registry drop the
    // whole session (subagents + workflows) on 'session-stale'.
    const prefix = `${info.sessionId}:`;
    this.dropByPrefix(this.agentFiles, prefix);
    this.dropByPrefix(this.workflowAgentFiles, prefix);
    this.dropByPrefix(this.workflowJournalFiles, prefix);
    this.emit('session-stale', { sessionId: info.sessionId });
  }

  // Release every `${sessionId}:`-prefixed entry of a child-file map on cascade.
  private dropByPrefix(map: Map<string, string>, prefix: string): void {
    for (const [key, filePath] of map) {
      if (key.startsWith(prefix)) { this.files.delete(filePath); map.delete(key); }
    }
  }
}
