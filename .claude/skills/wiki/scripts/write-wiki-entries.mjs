#!/usr/bin/env node
// Writer half of /ck:wiki: takes a collector work order + a prose map (authored by Claude)
// and writes each docs/wiki/<slug>.md with mechanically-correct frontmatter. Keeping the
// frontmatter (esp. source_hash) out of the model's hands guarantees idempotency — the model
// only supplies the human-readable prose.
//
// Usage:
//   node write-wiki-entries.mjs --work-order <wo.json> --prose <prose.json>
//
// prose.json shape: { "<slug>": { title, summary, highlights: [..], lessons: [..] }, ... }
//   title      plain-language headline (outcome, not slug)
//   summary    2-3 sentence what-shipped-and-why
//   highlights  bullet list of concrete wins (optional)
//   lessons     bullet list from the journal (optional; only rendered if the item has a journal)

import fs from 'node:fs';
import path from 'node:path';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

function frontmatter(item, project) {
  const tags = (item.tags || []).join(', ');
  return [
    '---',
    `plan_slug: ${item.slug}`,
    `source_hash: ${item.sourceHash}`,
    `status: ${item.status === 'complete' ? 'completed' : item.status}`,
    `completed: ${item.completed}`,
    `project: ${project}`,
    `branch: ${item.branch || ''}`,
    `tags: [${tags}]`,
    '---',
  ].join('\n');
}

function body(p, hasJournal, slug) {
  const title = (p.title || slug).trim();
  const out = [`# ${title}`, '', (p.summary || '').trim()];
  if (Array.isArray(p.highlights) && p.highlights.length) {
    out.push('', '## Highlights', ...p.highlights.map((h) => `- ${h}`));
  }
  if (hasJournal && Array.isArray(p.lessons) && p.lessons.length) {
    out.push('', '## Gotchas & lessons', ...p.lessons.map((l) => `- ${l}`));
  }
  return out.join('\n');
}

function main() {
  const wo = JSON.parse(fs.readFileSync(arg('--work-order'), 'utf8'));
  const prose = JSON.parse(fs.readFileSync(arg('--prose'), 'utf8'));
  const bySlug = new Map(wo.items.map((it) => [it.slug, it]));

  let written = 0;
  const missing = [];
  for (const [slug, p] of Object.entries(prose)) {
    const item = bySlug.get(slug);
    if (!item) { missing.push(slug); continue; }
    fs.mkdirSync(path.dirname(item.entryPath), { recursive: true });
    const content = `${frontmatter(item, wo.project)}\n\n${body(p, Boolean(item.journalText), slug)}\n`;
    fs.writeFileSync(item.entryPath, content);
    written += 1;
  }
  process.stdout.write(`wrote ${written} entries\n`);
  if (missing.length) process.stdout.write(`skipped (not in work order): ${missing.join(', ')}\n`);
}

main();
