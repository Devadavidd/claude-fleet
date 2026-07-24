import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanSkillCatalog } from '../../dist/server/readers/skill-catalog-reader.js';

// Characterization of the read-only GET /api/skills scan: a temp fixture dir
// stands in for `~/.claude`. Defensive posture pinned here: a malformed/oversized
// skill is skipped (never thrown), a symlink/`..` escape out of the scanned root
// is never followed, and the scan never writes/renames/locks anything it reads.

function makeFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-skills-'));

  fs.mkdirSync(path.join(root, 'skills', 'demo-skill', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'skills', 'demo-skill', 'references'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'demo-skill', 'SKILL.md'), [
    '---',
    'name: ck:demo-skill',
    'description: Demonstrates the skill scan for tests.',
    'category: utilities',
    'keywords: [demo, test]',
    'argument-hint: "[thing]"',
    '---',
    '',
    '# Demo Skill',
  ].join('\n'));

  // No frontmatter — must fall back to the first non-empty line as its description.
  fs.mkdirSync(path.join(root, 'skills', 'bare-skill'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'skills', 'bare-skill', 'SKILL.md'),
    '# Bare Skill\nA skill with no frontmatter block.\n',
  );

  // Oversized — must be skipped, never thrown.
  fs.mkdirSync(path.join(root, 'skills', 'huge-skill'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'huge-skill', 'SKILL.md'), '#'.repeat(80 * 1024));

  // A support folder with no SKILL.md at any level — must be skipped silently.
  fs.mkdirSync(path.join(root, 'skills', '_shared'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', '_shared', 'notes.md'), 'not a skill');

  fs.mkdirSync(path.join(root, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(root, 'agents', 'demo-agent.md'), [
    '---',
    'name: demo-agent',
    'description: Runs the demo. Handles other things too, in detail, across many words that go on.',
    '---',
    '',
    'Agent body.',
  ].join('\n'));

  return root;
}

// A symlinked "skill" dir pointing at a directory outside `<root>/skills`.
function addEscapeAttempt(root) {
  const secretDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-secret-'));
  fs.writeFileSync(
    path.join(secretDir, 'SKILL.md'),
    '---\nname: escape\ndescription: should never appear\ncategory: evil\n---\nEscape\n',
  );
  fs.symlinkSync(secretDir, path.join(root, 'skills', 'escape-link'), 'dir');
  return secretDir;
}

test('scanSkillCatalog returns the SkillCatalog shape from a live scan', async () => {
  const root = makeFixtureRoot();
  const catalog = await scanSkillCatalog(root);

  assert.equal(typeof catalog.kit, 'object');
  assert.ok(Array.isArray(catalog.categories));
  assert.ok(Array.isArray(catalog.workflow));
  assert.ok(Array.isArray(catalog.agents));
  assert.ok(Array.isArray(catalog.skills));
  // None of the fixture's skills match the core workflow strip's backing names.
  assert.deepEqual(catalog.workflow, []);

  const demo = catalog.skills.find((s) => s.name === 'demo-skill');
  assert.ok(demo, 'demo-skill scanned');
  assert.equal(demo.desc, 'Demonstrates the skill scan for tests.');
  assert.equal(demo.cat, 'utilities');
  assert.equal(demo.hint, '[thing]');
  assert.deepEqual(demo.keywords, ['demo', 'test']);
  assert.equal(demo.scripts, true);
  assert.equal(demo.refs, true);
  assert.ok(catalog.categories.some((c) => c.key === 'utilities' && c.count >= 1));

  const bare = catalog.skills.find((s) => s.name === 'bare-skill');
  assert.ok(bare, 'bare-skill (no frontmatter) scanned via fallback');
  assert.equal(bare.desc, 'Bare Skill'); // falls back to the first non-empty (heading) line
  assert.equal(bare.cat, 'other');
  assert.equal(bare.scripts, false);
  assert.equal(bare.refs, false);

  const agent = catalog.agents.find((a) => a.name === 'demo-agent');
  assert.ok(agent, 'demo-agent scanned');
  assert.equal(agent.role, 'Runs the demo.');
});

test('a malformed/oversized skill file is skipped, never thrown', async () => {
  const root = makeFixtureRoot();
  const catalog = await scanSkillCatalog(root);
  assert.equal(catalog.skills.some((s) => s.name === 'huge-skill'), false);
  assert.equal(catalog.skills.some((s) => s.name === '_shared'), false); // no SKILL.md — silently skipped
});

test('a symlink escape out of the scanned root is never followed', async () => {
  const root = makeFixtureRoot();
  const secretDir = addEscapeAttempt(root);
  try {
    const catalog = await scanSkillCatalog(root);
    assert.equal(catalog.skills.some((s) => s.name === 'escape-link'), false);
    assert.equal(catalog.skills.some((s) => s.cat === 'evil'), false);
  } finally {
    fs.rmSync(secretDir, { recursive: true, force: true });
  }
});

test('never writes/renames/locks anything under the scanned root (mtimes unchanged)', async () => {
  const root = makeFixtureRoot();
  const targets = [
    path.join(root, 'skills', 'demo-skill', 'SKILL.md'),
    path.join(root, 'skills', 'bare-skill', 'SKILL.md'),
    path.join(root, 'agents', 'demo-agent.md'),
  ];
  const before = targets.map((p) => fs.statSync(p).mtimeMs);
  await scanSkillCatalog(root);
  await scanSkillCatalog(root); // scan twice — a lock/rename would surface on the second pass
  const after = targets.map((p) => fs.statSync(p).mtimeMs);
  assert.deepEqual(after, before);
});

test('a missing root degrades to an empty catalog instead of throwing', async () => {
  const missing = path.join(os.tmpdir(), 'fleet-skills-does-not-exist-xyz');
  const catalog = await scanSkillCatalog(missing);
  assert.deepEqual(catalog.skills, []);
  assert.deepEqual(catalog.agents, []);
  assert.deepEqual(catalog.categories, []);
});

// --- cf-mode: scanning the dashboard-owned cf-plugin bundle ---

function makeCfBundleRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-cf-bundle-'));
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({
    name: 'cf', version: '2.20.1-beta.10', description: 'bundle',
  }));
  fs.writeFileSync(path.join(root, 'cf-manifest.json'), JSON.stringify({
    upstream: { repo: 'x/y', tag: 'v2.20.1-beta.10', commit: 'abc1234', syncedAt: '2026-07-23T01:00:00Z' },
    entries: { skills: [
      { name: 'plan', origin: 'upstream', source: 'x/y/claude/skills/ck-plan', syncedAt: 't', files: 1, bytes: 1, filesHash: 'h' },
      { name: 'extra', origin: 'github', source: 'o/r', syncedAt: 't', files: 1, bytes: 1, filesHash: 'h' },
    ] },
  }));
  for (const name of ['plan', 'cook', 'test', 'code-review', 'ship', 'extra']) {
    fs.mkdirSync(path.join(root, 'skills', name), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', name, 'SKILL.md'),
      `---\ndescription: ${name} skill\ncategory: utilities\n---\nBody.`);
  }
  fs.mkdirSync(path.join(root, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(root, 'agents', 'planner.md'), '---\ndescription: Plans.\n---\nBody.');
  fs.mkdirSync(path.join(root, 'rules'), { recursive: true });
  fs.writeFileSync(path.join(root, 'rules', 'r1.md'), 'rule');
  return root;
}

test('cf-mode: kit brands from plugin.json + manifest, not .ck.json', async () => {
  const root = makeCfBundleRoot();
  const catalog = await scanSkillCatalog(root);
  assert.equal(catalog.kit.name, 'Claude Fleet /cf');
  assert.equal(catalog.kit.version, '2.20.1-beta.10');
  assert.equal(catalog.kit.installed, '2026-07-23');
  assert.equal(catalog.kit.counts.skills, 6);
  assert.equal(catalog.kit.counts.agents, 1);
  assert.equal(catalog.kit.counts.rules, 1);
});

test('cf-mode: workflow strip surfaces renamed skills (plan, code-review)', async () => {
  const catalog = await scanSkillCatalog(makeCfBundleRoot());
  assert.deepEqual(catalog.workflow.map((s) => s.skill), ['plan', 'cook', 'test', 'code-review', 'ship']);
});

test('cf-mode: manifest origins land as skill provenance', async () => {
  const catalog = await scanSkillCatalog(makeCfBundleRoot());
  const byName = new Map(catalog.skills.map((s) => [s.name, s]));
  assert.equal(byName.get('extra').provenance, 'github');
  assert.equal(byName.get('plan').provenance, 'upstream');
  assert.equal(byName.get('cook').provenance ?? '', '');
});
