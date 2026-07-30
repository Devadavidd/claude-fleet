#!/usr/bin/env node
// Auto opt-in EVERY new terminal `claude` session into fleet remote approval,
// so its permission prompts can be answered from the dashboard without typing
// `FLEET_REMOTE_APPROVE=on` each time.
//
// How: writes a clearly-marked, idempotent block into the shell profile that
// exports FLEET_REMOTE_APPROVE=on for interactive shells. Only the fleet hook
// reads this var, so it is inert for every other program.
//
// Scope is deliberately TERMINAL-ONLY: GUI launches of the desktop app (Dock /
// Finder) do not source the shell profile, so they never inherit the marker and
// can never be frozen waiting on the dashboard — the incident that made remote
// approval opt-in in the first place. Activation stays an explicit marker; this
// just applies it automatically for shells, never a mode blocklist.
//
// Reversible: `--disable` removes ONLY our block, restoring the prior profile.

'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BEGIN = '# >>> fleet remote-approve (terminal auto opt-in) >>>';
const END = '# <<< fleet remote-approve (terminal auto opt-in) <<<';
const BLOCK = [
  BEGIN,
  '# Every terminal `claude` opts into fleet dashboard permission approval.',
  '# Remove this block (or run `npm run disable-terminal-approve`) to opt out.',
  'export FLEET_REMOTE_APPROVE=on',
  END,
].join('\n');

/** Default profile: zsh's interactive rc on macOS, else bash's. Overridable so
 * tests and other shells can target a specific file. */
function defaultProfilePath() {
  if (process.env.FLEET_SHELL_PROFILE) return process.env.FLEET_SHELL_PROFILE;
  const shell = process.env.SHELL || '';
  const home = os.homedir();
  if (shell.includes('zsh')) return path.join(home, '.zshrc');
  if (shell.includes('bash')) return path.join(home, '.bashrc');
  return path.join(home, '.profile');
}

/** Strip any existing fleet block (matched by markers) from profile text. */
function stripBlock(text) {
  const begin = text.indexOf(BEGIN);
  if (begin === -1) return text;
  const endMarker = text.indexOf(END, begin);
  if (endMarker === -1) return text; // malformed — leave as-is rather than eat the rest
  const after = endMarker + END.length;
  // Also swallow one trailing newline the block owned, and a leading blank line.
  let start = begin;
  if (start > 0 && text[start - 1] === '\n') start -= 1;
  let stop = after;
  if (text[stop] === '\n') stop += 1;
  return text.slice(0, start) + text.slice(stop);
}

/** Pure transform for unit tests: returns the profile text with our block
 * added (idempotent — replaces any prior copy) or removed. */
function applyBlock(text, enable) {
  const base = stripBlock(text || '');
  if (!enable) return base;
  const sep = base.length === 0 || base.endsWith('\n') ? '' : '\n';
  return `${base}${sep}${base.length ? '\n' : ''}${BLOCK}\n`;
}

function main() {
  const disable = process.argv.includes('--disable');
  const profilePath = defaultProfilePath();

  let text = '';
  if (fs.existsSync(profilePath)) {
    text = fs.readFileSync(profilePath, 'utf8');
    const backupPath = `${profilePath}.fleet-backup-${Date.now()}`;
    fs.copyFileSync(profilePath, backupPath);
    console.log(`[fleet-terminal] backup: ${backupPath}`);
  } else if (disable) {
    console.log('[fleet-terminal] nothing to disable — profile does not exist.');
    return;
  }

  const already = text.includes(BEGIN);
  if (!disable && already) {
    console.log(`[fleet-terminal] already enabled in ${profilePath} (no change).`);
    return;
  }

  const next = applyBlock(text, !disable);
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  const tmpPath = `${profilePath}.fleet-tmp`;
  fs.writeFileSync(tmpPath, next);
  fs.renameSync(tmpPath, profilePath);

  if (disable) {
    console.log(`[fleet-terminal] removed from ${profilePath}. New terminals opt out.`);
  } else {
    console.log(`[fleet-terminal] enabled in ${profilePath}.`);
    console.log('[fleet-terminal] Open a NEW terminal (or `source` the profile) so `claude` picks it up.');
    console.log('[fleet-terminal] Desktop app is untouched — GUI launches never read the shell profile.');
  }
}

if (require.main === module) main();

module.exports = { applyBlock, stripBlock, defaultProfilePath, BEGIN, END, BLOCK };
