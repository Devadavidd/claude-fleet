# docs/wiki/&lt;slug&gt;.md — entry contract

Every generated wiki entry is a single markdown file at `{project}/docs/wiki/<slug>.md`.
The dashboard reads its frontmatter for metadata and renders the body as the card.

## Frontmatter (all fields required except tags)

```yaml
---
plan_slug: <plan directory slug, verbatim>
source_hash: <the sourceHash from the collector work order — copy exactly>
status: completed
completed: <YYYY-MM-DD from the work order>
project: <project name from the work order>
branch: <branch from the work order, or "" if none>
tags: [tag1, tag2]        # from the work order; [] if none
---
```

`source_hash` MUST be the exact value the collector emitted for this item — it is the
idempotency key. If you invent or alter it, the next run will needlessly regenerate.

## Body

```markdown
# <Plain-language title>

<2–3 sentences: what shipped and why it matters. Plain language a non-engineer skims in
under 20 seconds. No jargon, no phase/finding codes, no file paths.>

## Highlights
- <concrete win, e.g. "Ingestion is ~5× faster on graphics PDFs">
- <concrete win>

## Gotchas & lessons        <!-- OMIT this whole section if there is no journal -->
- <lesson or trap, drawn from the journal>
```

## Rules
- **Mirror the source language.** If the plan/journal is Vietnamese, write the entry in
  Vietnamese; if English, English. Do not translate.
- **Title = outcome, not slug.** "Google login + per-user knowledge bases", not
  "google-oauth-login-and-user-kb-isolation".
- **Highlights are concrete.** Prefer measured wins from the journal (numbers, fixed bugs)
  over vague claims. 2–5 bullets.
- **Omit "Gotchas & lessons" entirely** when the item has no matched journal.
- **No plan-artifact references** in prose — no phase numbers, finding codes, or paths.
- Keep the whole entry tight: a reader should "get what shipped" at a glance.
