import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  copyDirIntoBundle,
  readManifest,
  writeManifest,
  upsertManifestEntry,
  removeSkillFromBundle,
} from '../../dist/server/skills/skill-bundle-writer.js';

// Pins the bundle writer contract: excluded dirs filtered, .md transformed,
// non-md verbatim, deterministic filesHash, and confined removal.

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-bundle-'));
}

test('copies with filters and transforms md only', async () => {
  const src = makeTmp();
  const dest = path.join(makeTmp(), 'out');
  fs.writeFileSync(path.join(src, 'SKILL.md'), 'Use /ck:plan here.\n');
  fs.writeFileSync(path.join(src, 'run.sh'), 'echo /ck:plan stays\n');
  fs.mkdirSync(path.join(src, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(src, 'node_modules', 'x', 'index.js'), 'junk');
  fs.mkdirSync(path.join(src, 'scripts'));
  fs.writeFileSync(path.join(src, 'scripts', 'helper.py'), 'print(1)\n');

  const result = await copyDirIntoBundle({ srcDir: src, destDir: dest, renamed: new Set(), transformMd: true });

  assert.equal(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8'), 'Use /cf:plan here.\n');
  assert.equal(fs.readFileSync(path.join(dest, 'run.sh'), 'utf8'), 'echo /ck:plan stays\n');
  assert.ok(!fs.existsSync(path.join(dest, 'node_modules')));
  assert.ok(fs.existsSync(path.join(dest, 'scripts', 'helper.py')));
  assert.equal(result.files, 3);
  assert.equal(result.truncated, false);
  assert.match(result.filesHash, /^[0-9a-f]{64}$/);
});

test('filesHash is deterministic across identical copies', async () => {
  const src = makeTmp();
  fs.writeFileSync(path.join(src, 'a.md'), 'alpha\n');
  fs.writeFileSync(path.join(src, 'b.txt'), 'beta\n');
  const r1 = await copyDirIntoBundle({ srcDir: src, destDir: path.join(makeTmp(), 'o1'), renamed: new Set(), transformMd: true });
  const r2 = await copyDirIntoBundle({ srcDir: src, destDir: path.join(makeTmp(), 'o2'), renamed: new Set(), transformMd: true });
  assert.equal(r1.filesHash, r2.filesHash);
});

test('oversized single files are skipped; entry budget flags truncated', async () => {
  const src = makeTmp();
  fs.writeFileSync(path.join(src, 'big.bin'), Buffer.alloc(600 * 1024)); // > per-file cap
  fs.writeFileSync(path.join(src, 'ok.md'), 'fine\n');
  const dest = path.join(makeTmp(), 'out');
  const result = await copyDirIntoBundle({ srcDir: src, destDir: dest, renamed: new Set(), transformMd: true });
  assert.ok(!fs.existsSync(path.join(dest, 'big.bin')));
  assert.equal(result.files, 1);
  assert.equal(result.truncated, false); // skipped-by-size ≠ budget truncation
});

test('manifest round-trip and upsert', async () => {
  const bundle = makeTmp();
  const manifest = await readManifest(bundle); // missing file → empty
  assert.deepEqual(manifest, { entries: {} });
  upsertManifestEntry(manifest, 'skills', { name: 'plan', origin: 'upstream', source: 'x', syncedAt: 't', files: 1, bytes: 2, filesHash: 'h' });
  upsertManifestEntry(manifest, 'skills', { name: 'plan', origin: 'local', source: 'y', syncedAt: 't2', files: 3, bytes: 4, filesHash: 'h2' });
  await writeManifest(bundle, manifest);
  const back = await readManifest(bundle);
  assert.equal(back.entries.skills.length, 1);
  assert.equal(back.entries.skills[0].origin, 'local');
});

test('removeSkillFromBundle removes dir + entry, rejects traversal names', async () => {
  const bundle = makeTmp();
  fs.mkdirSync(path.join(bundle, 'skills', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(bundle, 'skills', 'demo', 'SKILL.md'), 'x');
  await writeManifest(bundle, { entries: { skills: [{ name: 'demo', origin: 'local', source: 's', syncedAt: 't', files: 1, bytes: 1, filesHash: 'h' }] } });

  assert.equal(await removeSkillFromBundle(bundle, '../evil'), false);
  assert.equal(await removeSkillFromBundle(bundle, 'not-there'), false);
  assert.equal(await removeSkillFromBundle(bundle, 'demo'), true);
  assert.ok(!fs.existsSync(path.join(bundle, 'skills', 'demo')));
  assert.deepEqual((await readManifest(bundle)).entries.skills, []);
});
