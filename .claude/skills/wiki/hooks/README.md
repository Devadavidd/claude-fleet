# Auto-generate wiki entries on session end

`wiki-on-complete.mjs` is a Claude Code **Stop hook**. When a session ends, it runs the
deterministic collector (no LLM); if a plan has newly reached `completed` without a fresh
`docs/wiki/<slug>.md`, it spawns **one** detached, subscription-billed `claude -p` that authors
the prose and runs the writer. An unchanged fleet spawns nothing.

## Cost & safety model

- **Cheap:** the collector pre-check gates the spawn. Most session-ends do zero LLM work.
- **Subscription, not API:** the spawned `claude -p` uses your logged-in Claude subscription
  (verified: no `ANTHROPIC_API_KEY` needed). If you set `ANTHROPIC_API_KEY`, it would bill the API.
- **Loop-safe:** the spawned session sets `CK_WIKI_HOOK=1`; the hook no-ops when it sees that,
  and also when `stop_hook_active` is set — so it never recurses.
- **Fail-open:** missing `claude` CLI, a non-ClaudeKit project, or a collector error → the hook
  silently does nothing. Manual `/ck:wiki` always works regardless.
- **Detached:** the spawn is `unref`'d, so it never delays session shutdown.

## Register it

### Option A — global (fires for every project; true fleet-wide auto)

Append to the `Stop` array in `~/.claude/settings.json` (keep any existing entries):

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [ { "type": "command", "command": "node \"$HOME/.claude/hooks/session-state.cjs\"" } ] },
      { "hooks": [ { "type": "command", "command": "node \"/Users/nguyentuongkhang/claude-fleet-dashboard/.claude/skills/wiki/hooks/wiki-on-complete.mjs\"" } ] }
    ]
  }
}
```

### Option B — one project only

Add the same second entry to that project's `.claude/settings.json` `Stop` array instead of the
global file. The hook then only runs for sessions in that project.

## Test it

```bash
echo '{"cwd":"/path/to/project"}' | WIKI_HOOK_DRY_RUN=1 node wiki-on-complete.mjs
# prints what it *would* generate, without spawning claude
```

## Disable

Remove the entry from the `Stop` array. (Or unset — there is no state to clean up.)
