import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createJobStore } from '../../dist/server/loop/loop-job-store.js';

const tmpFile = (name) => path.join(os.tmpdir(), `fleet-loop-test-${process.pid}-${name}`, 'loop-jobs.json');

test('upsert / get / remove round-trip', () => {
  const f = tmpFile('roundtrip');
  const store = createJobStore(f);
  assert.deepEqual(store.readJobs(), []);
  store.upsertJob({ id: 'a', task: 't', status: 'running' });
  assert.equal(store.getJob('a').status, 'running');
  store.upsertJob({ id: 'a', task: 't', status: 'stopped' }); // update in place
  assert.equal(store.getJob('a').status, 'stopped');
  assert.equal(store.readJobs().length, 1);
  assert.equal(store.removeJob('a'), true);
  assert.equal(store.getJob('a'), null);
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
});

test('missing or corrupt file reads as empty, never throws', () => {
  assert.deepEqual(createJobStore('/nonexistent/dir/loop-jobs.json').readJobs(), []);
  const f = tmpFile('corrupt');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, 'not json');
  assert.deepEqual(createJobStore(f).readJobs(), []);
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
});

test('persists the job file 0600 and its directory 0700 (owner-only)', () => {
  const f = tmpFile('perms');
  const store = createJobStore(f);
  store.upsertJob({ id: 'a', task: 't', status: 'running' });
  // Low 9 permission bits: file rw for owner only, dir rwx for owner only.
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(f)).mode & 0o777, 0o700);
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
});
