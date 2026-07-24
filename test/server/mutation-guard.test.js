import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { requireMutation, resolveAllowedCwd, isAllowedModel } from '../../dist/server/http/mutation-guard.js';

const TOKEN = 'secret-token-abc';
const opts = { host: '127.0.0.1', port: 4600 };
const goodReq = (over = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-fleet-token': TOKEN, origin: 'http://127.0.0.1:4600', ...over },
});

test('requireMutation accepts a well-formed same-origin POST with the token', () => {
  assert.deepEqual(requireMutation(goodReq(), TOKEN, opts), { ok: true });
  // Absent Origin is allowed — the header token is the real gate.
  const noOrigin = goodReq(); delete noOrigin.headers.origin;
  assert.equal(requireMutation(noOrigin, TOKEN, opts).ok, true);
  // localhost alias is same-origin.
  assert.equal(requireMutation(goodReq({ origin: 'http://localhost:4600' }), TOKEN, opts).ok, true);
});

test('requireMutation rejects the CSRF vectors', () => {
  assert.equal(requireMutation({ method: 'GET', headers: {} }, TOKEN, opts).status, 405); // method
  assert.equal(requireMutation(goodReq({ 'content-type': 'text/plain' }), TOKEN, opts).status, 415); // sendBeacon/form
  assert.equal(requireMutation(goodReq({ origin: 'http://evil.example' }), TOKEN, opts).status, 403); // cross-origin
  assert.equal(requireMutation(goodReq({ origin: 'null' }), TOKEN, opts).status, 403); // sandboxed iframe
  const noToken = goodReq(); delete noToken.headers['x-fleet-token'];
  assert.equal(requireMutation(noToken, TOKEN, opts).status, 403); // missing token
  assert.equal(requireMutation(goodReq({ 'x-fleet-token': 'wrong' }), TOKEN, opts).status, 403); // wrong token
  assert.equal(requireMutation(goodReq(), '', opts).status, 403); // server has no token
});

// identity realpath so we test prefix logic without touching the fs
const idRealpath = (p) => p;

test('resolveAllowedCwd enforces the allow-list with canonicalized prefix', () => {
  const roots = ['/home/u/proj'];
  assert.deepEqual(resolveAllowedCwd('/home/u/proj', roots, idRealpath), { ok: true, path: '/home/u/proj' });
  assert.equal(resolveAllowedCwd('/home/u/proj/sub/dir', roots, idRealpath).ok, true);
  // sibling-dir bug: /proj must NOT match /proj-evil
  assert.equal(resolveAllowedCwd('/home/u/proj-evil', roots, idRealpath).ok, false);
  // traversal escapes after resolve
  assert.equal(resolveAllowedCwd('/home/u/proj/../etc', roots, idRealpath).ok, false);
  assert.equal(resolveAllowedCwd(path.join('/home/u/proj', '..', '..', 'etc'), roots, idRealpath).ok, false);
});

test('resolveAllowedCwd is deny-by-default and fails safe', () => {
  assert.equal(resolveAllowedCwd('/anything', [], idRealpath).ok, false); // empty allow-list = disabled
  assert.equal(resolveAllowedCwd('', ['/home/u'], idRealpath).ok, false); // no cwd
  assert.equal(resolveAllowedCwd(null, ['/home/u'], idRealpath).ok, false);
  // realpath throwing (cwd/symlink missing) → rejected, never throws
  const throwing = () => { throw new Error('ENOENT'); };
  assert.doesNotThrow(() => resolveAllowedCwd('/home/u/x', ['/home/u'], throwing));
  assert.equal(resolveAllowedCwd('/home/u/x', ['/home/u'], throwing).ok, false);
});

test('isAllowedModel is a strict whitelist', () => {
  const models = ['claude-haiku-4-5-20251001', 'claude-sonnet-5'];
  assert.equal(isAllowedModel('claude-haiku-4-5-20251001', models), true);
  assert.equal(isAllowedModel('claude-opus-4-8', models), false);
  assert.equal(isAllowedModel('claude-haiku-4-5-20251001', []), false);
  assert.equal(isAllowedModel(undefined, models), false);
});
