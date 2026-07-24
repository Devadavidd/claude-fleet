#!/usr/bin/env node
// Stop-hook: after a session ends, auto-generate wiki entries for any plan that newly
// reached "completed" without a fresh entry — so the Shipped tab stays current without
// anyone running /ck:wiki by hand.
//
// Cheap by design: it first runs the deterministic collector (no LLM). Only if that finds
// a create/update item does it spawn ONE detached, subscription-billed `claude -p` to author
// the prose and run the writer. An unchanged fleet spawns nothing.
//
// Registered as a Stop hook (see .claude/skills/wiki/hooks/README for the settings snippet).
// Hook input (JSON on stdin) carries { cwd, session_id, stop_hook_active, ... }.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COLLECTOR = path.join(HERE, '..', 'scripts', 'collect-wiki-sources.mjs');
const WRITER = path.join(HERE, '..', 'scripts', 'write-wiki-entries.mjs');
const TEMPLATE = path.join(HERE, '..', 'references', 'entry-template.md');

function readStdin() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}

function log(msg) { process.stderr.write(`[wiki-hook] ${msg}\n`); }

function main() {
  // Loop guard: the generation session we spawn also ends → fires this hook again. Skip it.
  if (process.env.CK_WIKI_HOOK) return;

  const input = readStdin();
  if (input.stop_hook_active) return; // already inside a stop-hook continuation
  const cwd = input.cwd || process.cwd();

  // Deterministic pre-check — no LLM. Bail unless something actually needs an entry.
  let wo;
  try {
    wo = JSON.parse(execFileSync('node', [COLLECTOR, '--root', cwd], { encoding: 'utf8' }));
  } catch {
    return; // not a ClaudeKit project / collector failed → do nothing (fail-open)
  }
  const stale = wo.items.filter((i) => i.action !== 'skip');
  if (!stale.length) return;

  if (process.env.WIKI_HOOK_DRY_RUN) {
    log(`would generate ${stale.length} entr${stale.length === 1 ? 'y' : 'ies'} in ${cwd}: ${stale.map((i) => i.slug).join(', ')}`);
    return;
  }

  // Stage the work order + prompt in a temp dir the spawned session is granted via --add-dir.
  // The model only AUTHORS prose (Read+Write, no Bash); the detached shell runs the writer
  // afterward. Headless claude sandboxes file access to cwd, so the temp dir must be added
  // explicitly and cwd stays the project (so the writer's entries land under project/docs/wiki).
  const stamp = String(input.session_id || wo.items.length).replace(/[^a-z0-9]/gi, '').slice(0, 12);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-hook-'));
  const woPath = path.join(dir, 'wo.json');
  const prosePath = path.join(dir, 'prose.json');
  const promptPath = path.join(dir, 'prompt.txt');
  const scriptPath = path.join(dir, 'run.sh');
  fs.writeFileSync(woPath, JSON.stringify(wo));

  const prompt = [
    'Author Shipped Work Wiki prose. Do ONLY this, then stop:',
    `Read the work order JSON at ${woPath}. For every item whose action is "create" or "update"`,
    '(ignore "skip"), produce a plain-language entry. Build a JSON object keyed by slug:',
    '{ "<slug>": { "title": "...", "summary": "...", "highlights": ["..."], "lessons": ["..."] } }.',
    'title = the outcome in plain language (NOT the slug). summary = 2-3 sentences of what shipped',
    '& why it matters. highlights = concrete wins. lessons = journal traps, ONLY when the item has',
    'journalText (else omit that key). Mirror the source language (Vietnamese plan => Vietnamese',
    `prose). No phase numbers, finding codes, or file paths in the prose. See ${TEMPLATE} for the`,
    `contract. Write ONLY that JSON object to ${prosePath}. Do not run any other tools or commit.`,
  ].join('\n');
  fs.writeFileSync(promptPath, prompt);

  // Quoted heredoc passes the prompt literally (no shell interpolation of $, quotes, braces).
  const script = `#!/bin/sh
claude -p "$(cat "${promptPath}")" --add-dir "${dir}" --permission-mode acceptEdits && node "${WRITER}" --work-order "${woPath}" --prose "${prosePath}"
`;
  fs.writeFileSync(scriptPath, script);

  const child = spawn('sh', [scriptPath], {
    cwd,
    env: { ...process.env, CK_WIKI_HOOK: '1' },
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', () => {}); // sh/claude missing → silently skip; manual /ck:wiki still works
  child.unref();
  log(`spawned generation for ${stale.length} plan(s) in ${cwd}`);
}

main();
