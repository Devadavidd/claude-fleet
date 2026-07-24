---
name: wiki
description: Generate a plain-language "shipped work" wiki entry for each completed plan. Rewrites plans + journals into human-readable summaries the fleet-dashboard displays. Use when the user says "/ck:wiki", "update the wiki", "backfill shipped work", or after a plan is marked completed.
---

# /ck:wiki — Shipped Work Wiki generator

Turn completed plans into plain-language entries a non-engineer can skim. Companion to the
fleet-dashboard "Shipped" tab, which renders these entries. **You (the running Claude session)
are the rewrite engine** — this uses the subscription, never an API key.

## What it produces

One file per completed plan at `{project}/docs/wiki/<slug>.md`, following
`references/entry-template.md` exactly.

## Invocation

- `/ck:wiki` — backfill/refresh every completed plan in the current project.
- `/ck:wiki --for <slug>` — a single plan.
- `/ck:wiki --root <dir>` — target another project root (default: cwd).

## Procedure

1. **Collect the work order (deterministic, no LLM):**
   ```bash
   node "$(dirname "$0")/scripts/collect-wiki-sources.mjs" [--root <dir>] [--for <slug>]
   ```
   Run the script at `.claude/skills/wiki/scripts/collect-wiki-sources.mjs` in the target
   project. It prints JSON: `{ root, project, items: [...] }`. Each item has `slug`, `action`
   (`create` | `update` | `skip`), `title`, `branch`, `tags`, `completed`, `sourceHash`,
   `entryPath`, `planBody`, `journalText`, `gitLog`.

2. **Skip the skips.** Items with `action: "skip"` are already up to date (source hash
   unchanged) — do NOT rewrite them. This is the idempotency guarantee: an unchanged fleet
   ⇒ zero writes, zero generation.

3. **Author prose for each `create` / `update` item** (skip `skip` items). Read `planBody`,
   `journalText` (may be null), and `gitLog`, and build a prose map keyed by slug:
   ```json
   { "<slug>": { "title": "...", "summary": "...", "highlights": ["..."], "lessons": ["..."] } }
   ```
   - `title` = the outcome in plain language (**not** the slug).
   - `summary` = 2–3 sentences of *what shipped & why it matters*.
   - `highlights` = concrete wins (prefer measured numbers / fixed bugs from the journal).
   - `lessons` = journal traps — **only rendered when the item has a journal**; omit otherwise.
   - **Mirror the source language** (Vietnamese plan ⇒ Vietnamese prose).
   Save the map as JSON (a temp file is fine).

4. **Stamp the entries deterministically:**
   ```bash
   node "$(dirname "$0")/scripts/write-wiki-entries.mjs" --work-order <work-order.json> --prose <prose.json>
   ```
   The writer assembles each `docs/wiki/<slug>.md` with the correct frontmatter and the **exact
   `source_hash` from the work order** — you never transcribe the hash yourself, so idempotency
   cannot break. It creates `docs/wiki/` if missing. (You supply prose only; frontmatter is
   mechanical.)

5. **Report:** list created / updated / skipped counts. Keep it terse.

## Hard rules

- **You author prose only; the writer stamps frontmatter.** Never hand-edit `source_hash` — it
  comes from the collector via the writer, so the idempotency guarantee holds.
- **No plan-artifact references** in prose (no phase numbers, finding codes, file paths).
- **Completed-only.** The collector already filters to completed plans; don't summarize
  pending/in-progress work.
- **This skill writes only under `{project}/docs/wiki/`.** Never touch `~/.claude`, plan
  files, or journals.
- When run head­less by the auto-hook, behave identically — collect, author prose, run the writer.

## Notes

- Journal matching is heuristic: a journal binds to the plan with the most shared slug words
  (≥3 required; the date is only a tiebreak), and to at most one plan. If an item has
  `journalText: null`, its entry is plan-only and the lessons section is omitted.
- `completed` is the plan file's last-modified date (a proxy for when it was marked done).
