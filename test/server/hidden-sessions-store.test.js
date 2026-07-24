import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadHiddenSessions,
  persistHiddenSessions,
  resolveTranscriptDeleteTargets,
  deleteTranscriptTargets,
} from '../../dist/server/http/hidden-sessions-store.js';

// Pins the hide persistence round-trip and — critically — the delete
// confinement contract: only registry-derived paths under projectsRoot, with
// the expected <slug>/<id>.jsonl layout, are ever deletable.

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-hidden-'));
}

test('hidden set round-trips through the file; corrupt/missing file is empty', () => {
  const file = path.join(makeTmp(), 'hidden.json');
  assert.deepEqual([...loadHiddenSessions(file)], []);
  persistHiddenSessions(file, new Set(['a', 'b']));
  assert.deepEqual([...loadHiddenSessions(file)].sort(), ['a', 'b']);
  fs.writeFileSync(file, '{not json');
  assert.deepEqual([...loadHiddenSessions(file)], []);
});

test('delete targets: happy path resolves the file + sibling session dir', () => {
  const root = makeTmp();
  const file = path.join(root, '-proj', 'sess-1.jsonl');
  const targets = resolveTranscriptDeleteTargets(file, 'sess-1', root);
  assert.equal(targets.transcriptFile, file);
  assert.equal(targets.sessionDir, path.join(root, '-proj', 'sess-1'));
});

test('delete targets: refuses paths outside projectsRoot or with a foreign basename', () => {
  const root = makeTmp();
  assert.equal(resolveTranscriptDeleteTargets('/etc/passwd', 'passwd', root), null);
  assert.equal(resolveTranscriptDeleteTargets(path.join(root, '..', 'x', 'sess-1.jsonl'), 'sess-1', root), null);
  // basename must be exactly <sessionId>.jsonl — a mismatched id never deletes
  assert.equal(resolveTranscriptDeleteTargets(path.join(root, '-p', 'other.jsonl'), 'sess-1', root), null);
});

test('deleteTranscriptTargets removes the file and the subagents dir, tolerates absences', () => {
  const root = makeTmp();
  const slug = path.join(root, '-proj');
  fs.mkdirSync(path.join(slug, 'sess-1', 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(slug, 'sess-1.jsonl'), 'x');
  fs.writeFileSync(path.join(slug, 'sess-1', 'subagents', 'agent-a.jsonl'), 'y');
  const targets = resolveTranscriptDeleteTargets(path.join(slug, 'sess-1.jsonl'), 'sess-1', root);
  deleteTranscriptTargets(targets);
  assert.ok(!fs.existsSync(path.join(slug, 'sess-1.jsonl')));
  assert.ok(!fs.existsSync(path.join(slug, 'sess-1')));
  // second delete is a clean no-op (force: true)
  deleteTranscriptTargets(targets);
});
