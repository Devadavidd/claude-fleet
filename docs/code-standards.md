# Code Standards

This document describes the codebase structure and conventions for claude-fleet-dashboard.

## Overview

Single-package structure: the project builds a Svelte 5 SPA served by a TypeScript Node backend, both compiled to `dist/` and run as a single origin from `npm start`.

```
.
├── client/              # Svelte 5 + Tailwind v4 SPA
│   └── src/
│       ├── App.svelte   # Root component + router
│       ├── main.ts      # SPA entry point (vite + hydration)
│       ├── style.css    # Design tokens + graphics CSS
│       └── lib/
│           ├── components/    # Reusable Svelte components
│           ├── stores/        # Fleet runes stores
│           └── utils/         # TS utilities (ANSI parsing, etc.)
├── server/src/          # TypeScript backend
│   ├── main.ts          # Boot entry point (watcher → reducer → server)
│   ├── config.ts        # Typed, frozen config (env-driven)
│   ├── http/            # HTTP + SSE server (single SseServer class)
│   ├── domain/          # Session state logic
│   ├── readers/         # Read-only file + transcript parsing
│   ├── watchers/        # chokidar file watchers (transcript, wiki, plans)
│   ├── workflows/       # Workflow run tracking
│   ├── launch/          # Claude Code spawn harness + registries
│   └── loop/            # Always-on job supervisor
├── shared/types/        # Declaration-only `.d.ts` files
│   ├── index.d.ts       # Unified export
│   ├── session-card.d.ts
│   ├── sse-events.d.ts
│   ├── timeline.d.ts
│   ├── overview.d.ts
│   ├── skill-catalog.d.ts
│   ├── plan.d.ts
│   ├── loop-job.d.ts
│   └── workflow-run.d.ts
├── test/server/         # Backend test suites (node:test)
├── public/              # Static SPA root (served from dist/client in prod)
└── dist/                # Build output
    ├── client/          # Vite bundle (SPA HTML + JS + CSS)
    └── server/          # tsc output (Node backend, SourceMaps)
```

## TypeScript Backend (`server/src/**`)

### Module Organization

**Module paths are explicit.** Relative imports must use `.js` extension (nodenext discipline); `import type` uses `verbatimModuleSyntax` to keep types out of the runtime bundle.

```typescript
// ✅ Correct
import { SseServer } from '../http/server.js';
import type { SessionCard } from '../../../shared/types/index.js';
import { randomBytes } from 'node:crypto';  // node:* builtins

// ❌ Incorrect
import { SseServer } from '../http/server';     // missing .js
import SseServer from '../http/server.js';      // use named export
import * as crypto from 'crypto';               // use node: prefix for builtins
```

### File Naming & Organization

- **Files:** kebab-case (e.g., `session-state-reducer.ts`, `transcript-watcher.ts`)
- **No `index.ts`:** except in `shared/types/index.d.ts` (unified export only)
- **100-line soft guideline:** most files stay under 100–150 LOC for clarity
- **Documented exceptions** (single-file ports at parity, deferred split):
  - `http/server.ts` — 561 LOC (monolithic SSE server, 7-way split deferred post-parity)
  - `domain/session-state-reducer.ts` — 493 LOC (state fold + SSE emission)
  - `domain/task-registry.ts` — 319 LOC (fleet task index from plan files)
  - `loop/loop-supervisor.ts` — 352 LOC (job loop + cycle management)

### Type Strictness

- **No `any`.** Everything is typed (nodenext, strict mode).
- **Import type only.** Cross-boundary types come from `shared/types/` as `import type`.
- **Structural interfaces** used in tests for doubles (e.g., `SseReducerLike`, `MutationRequestLike`).

## Svelte 5 Frontend (`client/src/**`)

### Component Structure

- **Components:** PascalCase files (e.g., `SessionCard.svelte`, `AppHeader.svelte`)
- **Props:** use `$props()` rune (no slot forwarding; callbacks via props)
- **State:** use `$state()` rune (mutable stores only as runes)
- **Derived:** use `$derived()` for computed properties (replaces `$:`）
- **Effects:** use `$effect()` for side effects (replaces `onMount`, `afterUpdate`)
- **Each with keys:** always use `{#each items as item (item.id)}` to prevent DOM reordering
- **Click handlers:** inline `onclick=` (standard event attributes, no event binding syntax from Svelte 4)

### Store Conventions

**Fleet store** (`client/src/lib/stores/fleet-store.ts`) uses runes for SSE state:

- `$state` for mutable collections (card snapshot, tasks, workflows)
- `$derived` for filtered / computed views
- **8 SSE events:** `session-updated`, `session-removed`, `overview`, `shipped`, `workflow-updated`, `workflow-removed`, `skills`, `heartbeat`
- **$state.raw Maps** reassigned wholesale on snapshot (never mutate entries after snapshot)

### Styling

**Two-tier split:**
- **Tailwind utilities:** layout, spacing, typography, colors (via `@theme` design tokens in `style.css`)
- **Plain CSS (graphics):** ANSI terminal rendering, SVG charts (velocity, heatmap), animations (`fleetPulse` keyframe)

**Design tokens:** defined in `client/src/style.css` `@theme` block (dark-only, self-hosted Geist/Geist Mono via `@fontsource-variable`).

```css
/* ✅ Use Tailwind utilities for layout */
<div class="flex gap-4 p-6 bg-fleet-panel text-fleet-text">

/* ✅ Use plain CSS for graphics */
<svg class="chart"> { /* CSS rules in style.css */ }
<div class="md"> { /* Markdown rendering, plain CSS in style.css */ }
```

**CSP:** no external CDN. `connect-src 'self'` (only fetch from same origin). Fonts self-hosted via `@fontsource-variable` npm packages, inlined by Vite.

### File Organization

```
client/src/
├── App.svelte                      # Root component + hash router
├── main.ts                          # Entry point (Vite module)
├── style.css                        # Design tokens + graphics CSS
├── lib/
│   ├── components/                  # Reusable components
│   │   ├── SessionCard.svelte       # Session card on board
│   │   ├── SessionTimeline.svelte   # Timeline view
│   │   ├── SessionKanban.svelte     # Board (3-column kanban)
│   │   └── ...                      # Others
│   ├── stores/
│   │   ├── fleet-store.ts           # Central SSE → runes store
│   │   └── ...                      # Other stores if needed
│   ├── styles/
│   │   ├── terminal.css             # ANSI rendering
│   │   ├── charts.css               # Velocity / heatmap SVG
│   │   └── ...                      # Other graphics
│   └── utils/
│       ├── ansi-to-html.ts          # Terminal color parsing
│       ├── markdown-renderer.ts     # Markdown → DOM
│       └── ...                      # Other utilities
└── smoke.test.ts                    # Build smoke test (Vitest)
```

## Shared Types (`shared/types/*.d.ts`)

**Declaration-only files.** No implementation; only TypeScript interfaces and type aliases. Used by both backend (Node) and frontend (browser).

- Authored from live runtime shapes during Phase 00 (before Phase 02 and 03 begin)
- One concept per file (e.g., `session-card.d.ts`, `sse-events.d.ts`)
- Unified export in `index.d.ts`

Example structure:

```typescript
// shared/types/session-card.d.ts
export interface SessionCard {
  sessionId: string;
  projectSlug: string;
  // ...
}

// shared/types/index.d.ts
export type { SessionCard } from './session-card.js';
export type { /* ... */ } from './sse-events.js';
// ...
```

## Testing

### Backend (`test/server/**`)

- **Framework:** node:test (built-in Node.js)
- **Suite per module:** each backend module has a `.test.ts` in `test/server/`
- **Test helpers:** assertions, fixtures, cleanup via `afterEach`
- **Characterization tests:** security-focused (Host guard, touched-file membership, CSRF token, launch hardening)

Example:

```typescript
// test/server/mutation-guard.test.ts
import test from 'node:test';
import assert from 'node:assert';
import { requireMutation } from '../../server/src/http/mutation-guard.js';

test('mutation guard rejects foreign origin', () => {
  const req = { method: 'POST', headers: { origin: 'https://evil.com' } };
  const result = requireMutation(req, 'token');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.status, 403);
});
```

### Frontend (`client/src/**/*.test.ts`)

- **Framework:** Vitest + @testing-library/svelte
- **Test alongside components:** e.g., `SessionCard.svelte` has `SessionCard.test.ts` in the same directory
- **JSDOM environment** for DOM APIs

Example:

```typescript
// client/src/lib/components/SessionCard.test.ts
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import SessionCard from './SessionCard.svelte';

describe('SessionCard', () => {
  it('renders session title', () => {
    const { getByText } = render(SessionCard, {
      props: { sessionId: 'abc', title: 'Test Session' },
    });
    expect(getByText('Test Session')).toBeDefined();
  });
});
```

## Import Order & Conventions

1. Node builtins (`node:*`)
2. Third-party packages
3. Internal modules (relative imports with `.js` extension)
4. Types last (after `import` from, as `import type`)

```typescript
import path from 'node:path';
import { readFileSync } from 'node:fs';
import chokidar from 'chokidar';
import type { ChokidarOptions } from 'chokidar';
import { config } from '../config.js';
import type { SessionCard } from '../../../shared/types/session-card.js';
```

## Build & Compilation

### TypeScript Configuration

**Three tsconfig files:**

| File | Purpose | Module | Emit |
|------|---------|--------|------|
| `tsconfig.base.json` | Shared strict options | — | — |
| `tsconfig.server.json` | Backend (Node) | `nodenext` | `dist/server` |
| `tsconfig.client.json` | Frontend (Vite) | `ESNext` | no-emit (Vite handles) |

**Key flags:**
- `nodenext` + `verbatimModuleSyntax` for backend (requires `.js` imports + `import type`)
- `ESNext` + `bundler` for frontend (Vite tree-shakes types)
- `strict: true` everywhere (no `any`, all types required)
- `skipLibCheck: true` (skip validation of `.d.ts` in node_modules)

### Build Pipeline

```bash
npm run build
# → Runs in sequence:
#   1. npm run build:client  (vite build → dist/client/)
#   2. npm run build:server  (tsc -p tsconfig.server.json → dist/server/)

npm start
# → node dist/server/main.js
#   Loads config, starts watchers, and serves the SPA from dist/client/

npm run dev
# → concurrently:
#   - vite --host 127.0.0.1 (dev server on 5173, HMR)
#   - tsc -w + node --watch dist/server/main.js (auto-restart on TS change)
```

**Dev proxy (Vite):** forwards `/api` and `/events` to Node backend with `changeOrigin:true` + Origin rewrite (required by security guard).

## Naming Conventions

| Category | Style | Example |
|----------|-------|---------|
| Files | kebab-case | `session-state-reducer.ts`, `transcript-watcher.ts` |
| Directories | kebab-case | `server/src/launch/`, `client/src/lib/components/` |
| Svelte components | PascalCase | `SessionCard.svelte`, `AppHeader.svelte` |
| CSS classes | lowercase + hyphen | `.fleet-panel`, `.md-code` |
| Exported functions | camelCase | `readTimeline()`, `aggregateFileTouches()` |
| Exported types | PascalCase | `SessionCard`, `FleetConfig`, `MutationResult` |
| Constants | UPPER_SNAKE_CASE | `SECURITY_HEADERS`, `DEFAULT_PORT` |

## Linting & Formatting

- **TypeScript:** strict mode (via `tsconfig*.json`)
- **No explicit formatter required** (developers use their IDE auto-format with TS plugin)
- **Pre-commit:** manual review of code quality (readability, no syntax errors)
- **Tests:** must pass before commit

## Error Handling

- **Backend:** try/catch for I/O, with console.error for watcher failures (defensive parse for untrusted JSONL)
- **Frontend:** unhandled errors log to console; no modal crash screen
- **Defensive parsing:** all data from disk or network is validated before use (no crashes on corrupt JSONL)

## Security Stance

Every response includes `SECURITY_HEADERS` (CSP + X-Frame-Options + X-Content-Type-Options).

**Mutation guard** applies to every write (POST `/api/spawn`, `/api/kill`, `/api/workflow-launch`):
1. Method must be POST
2. Content-Type must be application/json
3. Origin (if present) must match server origin
4. X-Fleet-Token must match per-run anti-CSRF secret (constant-time comparison)
5. Host header is validated before routing (DNS-rebinding guard)

See `server/src/http/mutation-guard.ts` for full guard logic.
