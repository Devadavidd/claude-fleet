// Hash router — reuses the EXACT regex patterns from the legacy public/index.html
// so every existing `#/…` URL resolves identically. Session sub-routes
// (/terminal, /tasks, /agent/:id) collapse into one `session` view carrying a
// tab + agent selector; the hashes themselves are unchanged. `#/skills` is new.
//
// parseHash() is pure (no DOM, no runes) → unit-testable; the Router class wraps
// it with a `$state` route updated on `hashchange`.

export type ViewType =
  | 'overview' | 'board' | 'agents' | 'workflows' | 'always-on'
  | 'files' | 'shipped' | 'skills' | 'session' | 'file';

export type SessionTab = 'timeline' | 'terminal' | 'tasks';

export interface Route {
  view: ViewType;
  sessionId: string | null;
  agentId: string | null;
  sessionTab: SessionTab;
  filePath: string | null;
  /** True for every route except the landing — drives the header Back button. */
  showBack: boolean;
}

const STATIC: Record<string, ViewType> = {
  '#/board': 'board',
  '#/agents': 'agents',
  '#/workflows': 'workflows',
  '#/always-on': 'always-on',
  '#/files': 'files',
  '#/shipped': 'shipped',
  '#/skills': 'skills',
};

function safeDecode(raw: string): string | null {
  try { return decodeURIComponent(raw); } catch { return null; }
}

function base(view: ViewType, showBack: boolean): Route {
  return { view, sessionId: null, agentId: null, sessionTab: 'timeline', filePath: null, showBack };
}

export function parseHash(hash: string): Route {
  const term = hash.match(/^#\/session\/([^/]+)\/terminal$/);
  if (term) {
    const id = safeDecode(term[1]);
    return id ? { ...base('session', true), sessionId: id, sessionTab: 'terminal' } : base('overview', false);
  }
  const tasks = hash.match(/^#\/session\/([^/]+)\/tasks$/);
  if (tasks) {
    const id = safeDecode(tasks[1]);
    return id ? { ...base('session', true), sessionId: id, sessionTab: 'tasks' } : base('overview', false);
  }
  const session = hash.match(/^#\/session\/([^/]+)(?:\/agent\/([^/]+))?$/);
  if (session) {
    const id = safeDecode(session[1]);
    const agentId = session[2] ? safeDecode(session[2]) : null;
    return id ? { ...base('session', true), sessionId: id, agentId, sessionTab: 'timeline' } : base('overview', false);
  }
  const file = hash.match(/^#\/file\/(.+)$/);
  if (file) {
    const p = safeDecode(file[1]);
    return p ? { ...base('file', true), filePath: p } : base('overview', false);
  }
  const staticView = STATIC[hash];
  if (staticView) return base(staticView, false);
  return base('overview', false); // '#/' and any unknown hash fall back to the landing
}

export function navigate(hash: string): void {
  location.hash = hash;
}

export class Router {
  route = $state<Route>(parseHash(typeof location !== 'undefined' ? location.hash : '#/'));

  #onHash = () => { this.route = parseHash(location.hash); };

  start(): void { window.addEventListener('hashchange', this.#onHash); }
  stop(): void { window.removeEventListener('hashchange', this.#onHash); }
}

export const router = new Router();
