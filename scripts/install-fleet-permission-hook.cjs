#!/usr/bin/env node
// Installs (or removes, with --uninstall) the fleet permission-approval
// PreToolUse hook in ~/.claude/settings.json.
//
// Safety posture: this edits the user's GLOBAL Claude Code settings, so it
// (a) refuses to touch a settings file it cannot parse, (b) writes a
// timestamped backup before the first mutation, (c) is idempotent — our entry
// is found by its command path marker and replaced, never duplicated, and
// (d) --uninstall removes ONLY our entry, leaving everything else untouched.

'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The marker that identifies OUR hook entry across installs/uninstalls.
const HOOK_FILENAME = 'fleet-permission-approval-hook.cjs';
const HOOK_MATCHER = 'Bash|Edit|Write|MultiEdit|NotebookEdit';
// Effectively-indefinite wait (24h), spike-verified: large timeouts are
// honored and the CLI holds the tool call while the hook blocks.
const HOOK_TIMEOUT_SECONDS = 86_400;

function fleetHookEntry(hookScriptPath) {
  return {
    matcher: HOOK_MATCHER,
    hooks: [{ type: 'command', command: `node ${JSON.stringify(hookScriptPath)}`, timeout: HOOK_TIMEOUT_SECONDS }],
  };
}

function isFleetEntry(entry) {
  return Array.isArray(entry?.hooks)
    && entry.hooks.some((h) => typeof h?.command === 'string' && h.command.includes(HOOK_FILENAME));
}

/** Pure merge: returns a NEW settings object with our hook installed (replacing
 * any previous fleet entry). Exported for unit tests. */
function mergeHookIntoSettings(settings, hookScriptPath) {
  const out = { ...(settings && typeof settings === 'object' ? settings : {}) };
  const hooks = { ...(out.hooks && typeof out.hooks === 'object' ? out.hooks : {}) };
  const pre = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse.filter((e) => !isFleetEntry(e)) : [];
  pre.push(fleetHookEntry(hookScriptPath));
  hooks.PreToolUse = pre;
  out.hooks = hooks;
  return out;
}

/** Pure removal: strips our entry; drops empty containers it emptied. */
function removeHookFromSettings(settings) {
  if (!settings || typeof settings !== 'object') return settings ?? {};
  const out = { ...settings };
  if (!out.hooks || typeof out.hooks !== 'object' || !Array.isArray(out.hooks.PreToolUse)) return out;
  const hooks = { ...out.hooks };
  const pre = hooks.PreToolUse.filter((e) => !isFleetEntry(e));
  if (pre.length > 0) hooks.PreToolUse = pre;
  else delete hooks.PreToolUse;
  if (Object.keys(hooks).length > 0) out.hooks = hooks;
  else delete out.hooks;
  return out;
}

function main() {
  const uninstall = process.argv.includes('--uninstall');
  const settingsPath = process.env.FLEET_CLAUDE_SETTINGS
    || path.join(os.homedir(), '.claude', 'settings.json');
  const hookScriptPath = path.resolve(__dirname, '..', 'hooks', HOOK_FILENAME);

  if (!uninstall && !fs.existsSync(hookScriptPath)) {
    console.error(`[fleet-hook] hook script not found: ${hookScriptPath}`);
    process.exit(1);
  }

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    try { settings = raw.trim() ? JSON.parse(raw) : {}; } catch {
      // Never clobber a file we can't parse — the user must fix it first.
      console.error(`[fleet-hook] cannot parse ${settingsPath} — fix its JSON and retry.`);
      process.exit(1);
    }
    const backupPath = `${settingsPath}.fleet-backup-${Date.now()}`;
    fs.copyFileSync(settingsPath, backupPath);
    console.log(`[fleet-hook] backup: ${backupPath}`);
  }

  const next = uninstall
    ? removeHookFromSettings(settings)
    : mergeHookIntoSettings(settings, hookScriptPath);

  // Atomic-ish write: temp file + rename, so a crash can't half-write settings.
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const tmpPath = `${settingsPath}.fleet-tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`);
  fs.renameSync(tmpPath, settingsPath);

  console.log(uninstall
    ? `[fleet-hook] removed from ${settingsPath}`
    : `[fleet-hook] installed into ${settingsPath}\n[fleet-hook] matcher: ${HOOK_MATCHER}\n[fleet-hook] OPT-IN per session: inert unless FLEET_REMOTE_APPROVE=on (supervised launches set it automatically)`);
}

if (require.main === module) main();

module.exports = { mergeHookIntoSettings, removeHookFromSettings, isFleetEntry, HOOK_FILENAME, HOOK_MATCHER };
