import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkUpstream, syncUpstream } from '../../dist/server/skills/upstream-sync.js';

// Sync orchestration with every network/exec seam injected — no gh, no
// GitHub. A fake "extract" fabricates the upstream payload tree; the tests
// pin: ck-* renames + md rewrites land in the bundle, plugin.json + manifest
// are written, the staging swap is atomic, and a failed extract leaves an
// existing bundle untouched.

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-sync-'));
}

function fakePayload(root) {
  const payload = path.join(root, 'claudekit-claudekit-engineer-abc1234', 'claude');
  fs.mkdirSync(path.join(payload, 'skills', 'ck-plan'), { recursive: true });
  fs.writeFileSync(path.join(payload, 'skills', 'ck-plan', 'SKILL.md'), '---\ndescription: Plan things\ncategory: utilities\n---\nRun /ck:cook after ck-plan.\n');
  fs.mkdirSync(path.join(payload, 'skills', 'cook'), { recursive: true });
  fs.writeFileSync(path.join(payload, 'skills', 'cook', 'SKILL.md'), '---\ndescription: Cook things\ncategory: utilities\n---\nSee ck:scout.\n');
  fs.mkdirSync(path.join(payload, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(payload, 'agents', 'planner.md'), '---\ndescription: Plans. Uses /ck:plan.\n---\nBody.\n');
  fs.mkdirSync(path.join(payload, 'rules'), { recursive: true });
  fs.writeFileSync(path.join(payload, 'rules', 'workflow.md'), 'Prefer /ck:plan → /ck:cook.\n');
  fs.mkdirSync(path.join(payload, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(payload, 'hooks', 'hook.cjs'), '// mentions /ck:plan verbatim\n');
  fs.mkdirSync(path.join(payload, 'output-styles'), { recursive: true });
  fs.writeFileSync(path.join(payload, 'output-styles', 'style.md'), 'Style /ck:ship.\n');
}

const fakeDeps = {
  ghExec: async () => JSON.stringify([{ tag_name: 'v9.9.9', prerelease: true, published_at: '2026-07-01T00:00:00Z' }]),
  download: async () => {},
  extract: async (_tarFile, destDir) => {
    fakePayload(destDir);
    return { root: path.join(destDir, 'claudekit-claudekit-engineer-abc1234'), commit: 'abc1234' };
  },
};

test('syncUpstream builds a renamed, rewritten bundle with plugin.json + manifest', async () => {
  const bundleDir = path.join(makeTmp(), 'cf-plugin');
  const summary = await syncUpstream({ repo: 'x/y', bundleDir, tmpRoot: makeTmp() }, fakeDeps);

  assert.equal(summary.tag, 'v9.9.9');
  assert.equal(summary.commit, 'abc1234');
  assert.equal(summary.skills, 2);

  // ck-plan → plan, body rewritten (ck-plan ref collapses, /ck: → /cf:).
  const planMd = fs.readFileSync(path.join(bundleDir, 'skills', 'plan', 'SKILL.md'), 'utf8');
  assert.match(planMd, /Run \/cf:cook after plan\./);
  // hooks verbatim; rules rewritten.
  assert.match(fs.readFileSync(path.join(bundleDir, 'hooks', 'hook.cjs'), 'utf8'), /\/ck:plan/);
  assert.match(fs.readFileSync(path.join(bundleDir, 'rules', 'workflow.md'), 'utf8'), /\/cf:plan → \/cf:cook/);

  const plugin = JSON.parse(fs.readFileSync(path.join(bundleDir, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(plugin.name, 'cf');
  assert.equal(plugin.version, '9.9.9');

  const manifest = JSON.parse(fs.readFileSync(path.join(bundleDir, 'cf-manifest.json'), 'utf8'));
  assert.equal(manifest.upstream.tag, 'v9.9.9');
  assert.equal(manifest.upstream.commit, 'abc1234');
  assert.ok(manifest.entries.skills.some((e) => e.name === 'plan' && e.origin === 'upstream'));
  // staging dir cleaned up after the swap
  assert.ok(!fs.existsSync(`${bundleDir}.staging`));
});

test('a failed sync leaves the existing bundle untouched', async () => {
  const bundleDir = path.join(makeTmp(), 'cf-plugin');
  await syncUpstream({ repo: 'x/y', bundleDir, tmpRoot: makeTmp() }, fakeDeps);
  const before = fs.readFileSync(path.join(bundleDir, 'cf-manifest.json'), 'utf8');

  await assert.rejects(
    () => syncUpstream({ repo: 'x/y', bundleDir, tmpRoot: makeTmp() }, {
      ...fakeDeps,
      extract: async () => { throw new Error('boom'); },
    }),
    /boom/,
  );
  assert.equal(fs.readFileSync(path.join(bundleDir, 'cf-manifest.json'), 'utf8'), before);
  assert.ok(!fs.existsSync(`${bundleDir}.staging`));
});

test('checkUpstream compares manifest tag with the latest release', async () => {
  const bundleDir = path.join(makeTmp(), 'cf-plugin');
  const fresh = await checkUpstream({ repo: 'x/y', bundleDir }, fakeDeps);
  assert.deepEqual(
    { current: fresh.current, latest: fresh.latest, upToDate: fresh.upToDate, prerelease: fresh.prerelease },
    { current: '', latest: 'v9.9.9', upToDate: false, prerelease: true },
  );

  await syncUpstream({ repo: 'x/y', bundleDir, tmpRoot: makeTmp() }, fakeDeps);
  const synced = await checkUpstream({ repo: 'x/y', bundleDir }, fakeDeps);
  assert.equal(synced.upToDate, true);
  assert.equal(synced.current, 'v9.9.9');
});

test('explicit tag is validated', async () => {
  await assert.rejects(
    () => syncUpstream({ repo: 'x/y', tag: 'v1;rm -rf', bundleDir: path.join(makeTmp(), 'b'), tmpRoot: makeTmp() }, fakeDeps),
    /invalid release tag/,
  );
});

test('operator-installed skills survive an upstream re-sync', async () => {
  const bundleDir = path.join(makeTmp(), 'cf-plugin');
  await syncUpstream({ repo: 'x/y', bundleDir, tmpRoot: makeTmp() }, fakeDeps);

  // Simulate an operator install: dir + manifest entry with origin 'github'.
  fs.mkdirSync(path.join(bundleDir, 'skills', 'my-tool'), { recursive: true });
  fs.writeFileSync(path.join(bundleDir, 'skills', 'my-tool', 'SKILL.md'), 'mine');
  const manifest = JSON.parse(fs.readFileSync(path.join(bundleDir, 'cf-manifest.json'), 'utf8'));
  manifest.entries.skills.push({ name: 'my-tool', origin: 'github', source: 'o/r', syncedAt: 't', files: 1, bytes: 4, filesHash: 'h' });
  fs.writeFileSync(path.join(bundleDir, 'cf-manifest.json'), JSON.stringify(manifest));

  const summary = await syncUpstream({ repo: 'x/y', bundleDir, tmpRoot: makeTmp() }, fakeDeps);
  assert.deepEqual(summary.preserved, ['my-tool']);
  assert.equal(fs.readFileSync(path.join(bundleDir, 'skills', 'my-tool', 'SKILL.md'), 'utf8'), 'mine');
  const after = JSON.parse(fs.readFileSync(path.join(bundleDir, 'cf-manifest.json'), 'utf8'));
  assert.ok(after.entries.skills.some((e) => e.name === 'my-tool' && e.origin === 'github'));
});
