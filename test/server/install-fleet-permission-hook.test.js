import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { mergeHookIntoSettings, removeHookFromSettings, isFleetEntry, HOOK_MATCHER } =
  require('../../scripts/install-fleet-permission-hook.cjs');

const HOOK_PATH = '/repo/hooks/fleet-permission-approval-hook.cjs';

// Installer edits the user's GLOBAL settings.json — these tests pin the three
// safety properties: preserve unrelated content, idempotence, clean round-trip.

test('merge into empty settings creates exactly our PreToolUse entry', () => {
  const next = mergeHookIntoSettings({}, HOOK_PATH);
  assert.equal(next.hooks.PreToolUse.length, 1);
  const entry = next.hooks.PreToolUse[0];
  assert.equal(entry.matcher, HOOK_MATCHER);
  assert.equal(entry.hooks[0].timeout, 86_400);
  assert.ok(isFleetEntry(entry));
});

test('merge preserves unrelated settings and foreign hooks', () => {
  const settings = {
    model: 'opus',
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'other-tool' }] }], Stop: [{ hooks: [] }] },
  };
  const next = mergeHookIntoSettings(settings, HOOK_PATH);
  assert.equal(next.model, 'opus');
  assert.equal(next.hooks.PreToolUse.length, 2);
  assert.equal(next.hooks.PreToolUse[0].hooks[0].command, 'other-tool');
  assert.deepEqual(next.hooks.Stop, [{ hooks: [] }]);
  // Input object untouched (pure function).
  assert.equal(settings.hooks.PreToolUse.length, 1);
});

test('double install replaces, never duplicates', () => {
  const once = mergeHookIntoSettings({}, HOOK_PATH);
  const twice = mergeHookIntoSettings(once, '/elsewhere/hooks/fleet-permission-approval-hook.cjs');
  assert.equal(twice.hooks.PreToolUse.length, 1);
  assert.match(twice.hooks.PreToolUse[0].hooks[0].command, /elsewhere/);
});

test('install → uninstall round-trip restores original shape', () => {
  const original = { hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'lint' }] }] }, other: 1 };
  const restored = removeHookFromSettings(mergeHookIntoSettings(original, HOOK_PATH));
  assert.deepEqual(restored, original);
  // From-empty round-trip drops the containers we created.
  assert.deepEqual(removeHookFromSettings(mergeHookIntoSettings({}, HOOK_PATH)), {});
});

// End-to-end through the real CLI against a temp settings path (never the
// user's real ~/.claude). Also proves backup + refusal-to-clobber behavior.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const installerPath = path.join(repoRoot, 'scripts', 'install-fleet-permission-hook.cjs');

function runInstaller(settingsPath, args = []) {
  return execFileSync('node', [installerPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, FLEET_CLAUDE_SETTINGS: settingsPath },
  });
}

test('CLI install writes settings, backs up, uninstall restores content', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-hook-test-'));
  const settingsPath = path.join(dir, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify({ model: 'haiku' }));

  runInstaller(settingsPath);
  const installed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.equal(installed.model, 'haiku');
  assert.equal(installed.hooks.PreToolUse.length, 1);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('settings.json.fleet-backup-')));

  runInstaller(settingsPath, ['--uninstall']);
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')), { model: 'haiku' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI refuses to clobber unparseable settings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-hook-test-'));
  const settingsPath = path.join(dir, 'settings.json');
  fs.writeFileSync(settingsPath, '{ definitely not json');
  assert.throws(() => runInstaller(settingsPath));
  assert.equal(fs.readFileSync(settingsPath, 'utf8'), '{ definitely not json');
  fs.rmSync(dir, { recursive: true, force: true });
});
