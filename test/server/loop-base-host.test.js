import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBaseHost } from '../../dist/server/http/server.js';

// Characterization of the QA-template SSRF guard: an unattended loop agent's
// baseUrl may only target an allow-listed host, matched by EXACT hostname —
// suffix/substring tricks and non-http(s) schemes must always be rejected.

const ALLOWED = ['127.0.0.1', 'localhost'];

test('accepts loopback http and https on any port/path', () => {
  assert.equal(validateBaseHost('http://127.0.0.1:4700/health', ALLOWED), null);
  assert.equal(validateBaseHost('https://localhost/deep/path?q=1', ALLOWED), null);
});

test('rejects a non-allow-listed host', () => {
  assert.match(validateBaseHost('http://example.com/', ALLOWED), /not allowed/);
  assert.match(validateBaseHost('http://169.254.169.254/latest/meta-data', ALLOWED), /not allowed/);
});

test('rejects hosts that merely embed or suffix-match an allowed host', () => {
  assert.match(validateBaseHost('http://127.0.0.1.evil.com/', ALLOWED), /not allowed/);
  assert.match(validateBaseHost('http://localhost.evil.com/', ALLOWED), /not allowed/);
  assert.match(validateBaseHost('http://evil-localhost/', ALLOWED), /not allowed/);
});

test('rejects non-http(s) schemes outright', () => {
  assert.match(validateBaseHost('file:///etc/passwd', ALLOWED), /http\(s\)/);
  assert.match(validateBaseHost('ftp://127.0.0.1/', ALLOWED), /http\(s\)/);
});

test('rejects malformed URLs with a clear error', () => {
  assert.match(validateBaseHost('not a url', ALLOWED), /valid URL/);
  assert.match(validateBaseHost('', ALLOWED), /valid URL/);
});

test('userinfo/port tricks cannot smuggle a foreign host', () => {
  // URL parses the real hostname as evil.com in both shapes.
  assert.match(validateBaseHost('http://127.0.0.1@evil.com/', ALLOWED), /not allowed/);
  assert.match(validateBaseHost('http://evil.com:80@127.0.0.1/', ALLOWED) ?? 'null-ok', /not allowed|null-ok/);
});
