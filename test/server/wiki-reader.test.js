import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readProjectWiki, readFleetWiki } from '../../dist/server/readers/wiki-reader.js';

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-reader-'));
}

function writePlan(root, slug, fm) {
  const dir = path.join(root, 'plans', slug);
  fs.mkdirSync(dir, { recursive: true });
  const lines = ['---', ...Object.entries(fm).map(([k, v]) => `${k}: ${v}`), '---', '', `# ${fm.title ?? slug}`, '', 'body'];
  fs.writeFileSync(path.join(dir, 'plan.md'), lines.join('\n'));
}

function writeEntry(root, slug, frontmatterText, body) {
  const dir = path.join(root, 'docs', 'wiki');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${slug}.md`), `${frontmatterText}\n\n${body}`);
}

test('reads completed + pending plans and flags shipped/summarized', async () => {
  const root = tmpRoot();
  writePlan(root, '260101-1200-alpha-feature', { title: 'Alpha Feature', status: 'completed', branch: 'feat/alpha', tags: '[a, b]' });
  writeEntry(root, '260101-1200-alpha-feature',
    '---\nplan_slug: 260101-1200-alpha-feature\nsource_hash: sha256:abc\nstatus: completed\ncompleted: 2026-01-01\nproject: proj\nbranch: feat/alpha\ntags: [a, b]\n---',
    '# Alpha, in plain words\n\nWhat shipped and why.\n\n## Highlights\n- did a thing');
  writePlan(root, '260102-1200-beta-wip', { title: 'Beta WIP', status: 'pending' });

  const { cards } = await readProjectWiki(root);
  assert.equal(cards.length, 2);
  const alpha = cards.find((c) => c.slug === '260101-1200-alpha-feature');
  const beta = cards.find((c) => c.slug === '260102-1200-beta-wip');

  assert.equal(alpha.shipped, true);
  assert.equal(alpha.summarized, true);
  assert.equal(alpha.plainTitle, 'Alpha, in plain words'); // from entry H1, not the raw plan title
  assert.match(alpha.body, /What shipped and why/);
  assert.deepEqual(alpha.tags, ['a', 'b']);

  assert.equal(beta.shipped, false);
  assert.equal(beta.summarized, false);
  assert.equal(beta.plainTitle, 'Beta WIP'); // falls back to the plan title
  assert.equal(beta.body, '');
});

test('graceful-empty when the project has no plans/ directory', async () => {
  const root = tmpRoot();
  const { cards } = await readProjectWiki(root);
  assert.deepEqual(cards, []);
});

test('a malformed entry (no frontmatter) degrades instead of throwing', async () => {
  const root = tmpRoot();
  writePlan(root, '260103-1200-gamma', { title: 'Gamma', status: 'completed' });
  writeEntry(root, '260103-1200-gamma', '(not valid frontmatter', '# Gamma plain\n\ntext');
  const { cards } = await readProjectWiki(root);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].summarized, true);
  assert.equal(cards[0].plainTitle, 'Gamma plain'); // H1 still extracted from the body
});

test('a plan with a missing plan.md is skipped, not fatal', async () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'plans', '260104-1200-empty'), { recursive: true }); // dir, no plan.md
  writePlan(root, '260104-1300-real', { title: 'Real', status: 'completed' });
  const { cards } = await readProjectWiki(root);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].slug, '260104-1300-real');
});

test('readFleetWiki sorts shipped-first then newest-completed', async () => {
  const root = tmpRoot();
  writePlan(root, '260201-1200-old-shipped', { title: 'Old', status: 'completed' });
  writeEntry(root, '260201-1200-old-shipped', '---\nsource_hash: sha256:1\nstatus: completed\ncompleted: 2026-02-01\n---', '# Old\n\nx');
  writePlan(root, '260601-1200-new-shipped', { title: 'New', status: 'completed' });
  writeEntry(root, '260601-1200-new-shipped', '---\nsource_hash: sha256:2\nstatus: completed\ncompleted: 2026-06-01\n---', '# New\n\nx');
  writePlan(root, '260701-1200-pending', { title: 'Pending', status: 'pending' });

  const { cards, projects } = await readFleetWiki([root]);
  assert.equal(cards[0].slug, '260601-1200-new-shipped'); // newest shipped first
  assert.equal(cards[1].slug, '260201-1200-old-shipped'); // older shipped next
  assert.equal(cards[2].shipped, false);                  // pending sinks below shipped
  assert.ok(projects.length >= 1);
});

test('shipped cards order by recency (mtime) even when completed dates tie on the same day', async () => {
  const root = tmpRoot();
  writePlan(root, '260722-0900-morning', { title: 'Morning', status: 'completed' });
  writeEntry(root, '260722-0900-morning', '---\nsource_hash: sha256:1\nstatus: completed\ncompleted: 2026-07-22\n---', '# Morning\n\nx');
  await new Promise((r) => setTimeout(r, 20)); // guarantee a later mtime for the evening work
  writePlan(root, '260722-1800-evening', { title: 'Evening', status: 'completed' });
  writeEntry(root, '260722-1800-evening', '---\nsource_hash: sha256:2\nstatus: completed\ncompleted: 2026-07-22\n---', '# Evening\n\nx');

  const { cards } = await readFleetWiki([root]);
  assert.equal(cards[0].slug, '260722-1800-evening'); // just-finished work leads despite equal completed date
  assert.equal(cards[1].slug, '260722-0900-morning');
});

test('unsummarized shipped card dates from plan.md mtime, not the stale created field', async () => {
  const root = tmpRoot();
  writePlan(root, '260101-1200-done-no-summary', { title: 'Done', status: 'completed', created: '2026-01-01' });
  const { cards } = await readProjectWiki(root);
  assert.equal(cards[0].summarized, false);
  assert.notEqual(cards[0].completed, '2026-01-01');        // not the created date
  assert.match(cards[0].completed, /^\d{4}-\d{2}-\d{2}$/);  // a real completion day from mtime
});
