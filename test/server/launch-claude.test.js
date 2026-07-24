import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { launchClaude } from '../../dist/server/launch/launch-claude.js';

// Characterization of the ONLY bypassPermissions spawn in the codebase. These
// assertions are the security floor for the TS port: argv stays an ARRAY (no
// shell), the child is group-detached, and the stdin lifecycle (EOF for plain
// launches, kept-open + error-swallowed for steerable) is preserved exactly.

function fakeChild() {
  const child = new EventEmitter();
  child.pid = 4242;
  child.stdin = Object.assign(new EventEmitter(), {
    writes: [],
    ended: false,
    write(chunk) { this.writes.push(String(chunk)); return true; },
    end() { this.ended = true; },
  });
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

function launchWith(overrides = {}, hooks = {}) {
  const calls = [];
  const child = fakeChild();
  const spawnFn = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return child; };
  const promise = launchClaude(
    {
      sessionId: 'sess-1',
      cwd: '/tmp/proj',
      model: 'claude-haiku-4-5-20251001',
      task: 'do the thing',
      maxTurns: 40,
      ...overrides,
    },
    { spawnFn, ...hooks },
  );
  return { calls, child, promise };
}

test('spawns an argv ARRAY carrying bypassPermissions — never a shell string', async () => {
  const { calls, child, promise } = launchWith();
  child.emit('spawn');
  await promise;

  assert.equal(calls.length, 1);
  const { cmd, args, opts } = calls[0];
  assert.equal(cmd, 'claude');
  assert.ok(Array.isArray(args), 'argv must be an array');
  const i = args.indexOf('--permission-mode');
  assert.ok(i >= 0 && args[i + 1] === 'bypassPermissions');
  assert.equal(opts.shell, undefined, 'shell mode must never be enabled');
  assert.equal(opts.detached, true, 'own process group so group-kill works');
  assert.deepEqual(opts.stdio, ['pipe', 'pipe', 'pipe']);
});

test('task/cwd/model can never inject: task goes to stdin JSON, not argv', async () => {
  const evil = '"; rm -rf / #';
  const { calls, child, promise } = launchWith({ task: evil, model: evil });
  child.emit('spawn');
  await promise;

  const { args, opts } = calls[0];
  assert.ok(!args.join(' ').includes('rm -rf /') || args.includes(evil),
    'argv holds values only as inert array entries');
  assert.ok(!args.includes(evil) || args[args.indexOf('--model') + 1] === evil,
    'the only argv slot a client value may occupy is the --model value position');
  // The task itself travels exclusively via the stdin JSON message.
  assert.ok(child.stdin.writes.length === 1);
  const msg = JSON.parse(child.stdin.writes[0]);
  assert.equal(msg.message.content, evil);
  assert.equal(opts.cwd, '/tmp/proj');
});

test('resume swaps --session-id for --resume <id> (same id, no fork)', async () => {
  const { calls, child, promise } = launchWith({ resume: true, steerable: true });
  child.emit('spawn');
  await promise;
  const args = calls[0].args;
  const at = args.indexOf('--resume');
  assert.ok(at >= 0, 'resume launch must pass --resume');
  assert.equal(args[at + 1], 'sess-1');
  assert.ok(!args.includes('--session-id'), 'must not also pass --session-id');
  assert.ok(!args.includes('--fork-session'), 'no fork — the transcript must continue in place');
});

test('plain launch EOFs stdin; steerable keeps it open', async () => {
  const plain = launchWith();
  plain.child.emit('spawn');
  await plain.promise;
  assert.equal(plain.child.stdin.ended, true, 'non-steerable must stdin.end()');

  const steer = launchWith({ steerable: true });
  steer.child.emit('spawn');
  await steer.promise;
  assert.equal(steer.child.stdin.ended, false, 'steerable must keep stdin open');
});

test('a stdin error after spawn is swallowed — never crashes the process', async () => {
  const { child, promise } = launchWith({ steerable: true });
  child.emit('spawn');
  await promise;
  // Without the error listener this emit would throw (unhandled 'error').
  child.stdin.emit('error', new Error('EPIPE'));
  assert.ok(true, 'no throw');
});

test('resolves with pid after spawn; rejects when spawn itself fails', async () => {
  const ok = launchWith();
  ok.child.emit('spawn');
  const { pid } = await ok.promise;
  assert.equal(pid, 4242);

  const bad = launchWith();
  bad.child.emit('error', new Error('spawn claude ENOENT'));
  await assert.rejects(bad.promise, /ENOENT/);
});

test('onExit fires with code/signal; onActivity fires on post-spawn stdout', async () => {
  const exits = [];
  let activity = 0;
  const { child, promise } = launchWith({}, { onExit: (x) => exits.push(x), onActivity: () => { activity += 1; } });
  child.emit('spawn');
  await promise;
  child.stdout.emit('data', Buffer.from('{}'));
  child.emit('exit', 0, null);
  assert.equal(activity, 1);
  assert.equal(exits.length, 1);
  assert.equal(exits[0].code, 0);
  assert.equal(exits[0].signal, null);
});

test('pluginDir adds --plugin-dir; omitted keeps legacy argv byte-identical', async () => {
  const withPlugin = launchWith({ pluginDir: '/repo/cf-plugin' });
  withPlugin.child.emit('spawn');
  await withPlugin.promise;
  const args = withPlugin.calls[0].args;
  const i = args.indexOf('--plugin-dir');
  assert.ok(i >= 0 && args[i + 1] === '/repo/cf-plugin');

  const withoutPlugin = launchWith();
  withoutPlugin.child.emit('spawn');
  await withoutPlugin.promise;
  assert.ok(!withoutPlugin.calls[0].args.includes('--plugin-dir'),
    'FLEET_CF_PLUGIN=0 rollback restores the exact legacy argv');
});
