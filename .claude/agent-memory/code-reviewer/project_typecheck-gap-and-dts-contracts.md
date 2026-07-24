---
name: typecheck-gap-and-dts-contracts
description: No npm script runs client tsc; shared/types are declaration-only .d.ts that must stay value-free
metadata:
  type: project
---

Two review gotchas from the TS+Svelte rewrite (phase-00, 2026-07-22):

1. **No script typechecks the client project.** `build:client` = `vite build` (esbuild, transpile-only) and `test` = vitest — neither runs `tsc -p tsconfig.client.json`. Client type errors are latent and invisible to CI.
   **Why:** phase-00 shipped with a TS2339 in `client/vitest.config.ts` that all green pipelines missed.
   **How to apply:** in every review touching `client/` or `shared/types/`, manually run `npx tsc -p tsconfig.client.json` (and `tsc -p tsconfig.server.json --noEmit`) until a `typecheck` script exists.

2. **`shared/types/*` are declaration-only `.d.ts`** — chosen to dodge TS6059 (d.ts emits nothing, so `rootDir: server/src` + shared includes coexist and `dist/server/main.js` lands at the exact path).
   **How to apply:** reject any value-level code (enums, consts, classes) added to `shared/types/` — it would silently emit nothing at runtime. Contracts mirror live runtime shapes; verify against the emitting code (e.g. `toCard()`, `projectWorkflow()`, `createJob()`), not the plan text.
