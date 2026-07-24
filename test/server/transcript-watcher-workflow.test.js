import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TranscriptWatcher } from '../../dist/server/watchers/transcript-watcher.js';

// Integration over a real chokidar watch of a temp projects tree: workflow agent +
// journal files (path-depth 6) must fire 'workflow-event'/'workflow-journal' and
// NEVER 'session-event', and must cascade-drop with their parent session.
function makeTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-watch-'));
  const projectsRoot = path.join(root, 'projects');
  const slug = 'myslug';
  const sessionId = 'sess-1';
  const sessionFile = path.join(projectsRoot, slug, `${sessionId}.jsonl`);
  const wfDir = path.join(projectsRoot, slug, sessionId, 'subagents', 'workflows', 'wf_TEST');
  fs.mkdirSync(wfDir, { recursive: true });
  fs.writeFileSync(sessionFile, ''); // parent session (gating anchor)
  const journalPath = path.join(wfDir, 'journal.jsonl');
  const agentPath = path.join(wfDir, 'agent-aaa111.jsonl');
  fs.writeFileSync(path.join(wfDir, 'agent-aaa111.meta.json'), JSON.stringify({ agentType: 'researcher', spawnDepth: 1 }));
  fs.writeFileSync(journalPath, '');
  fs.writeFileSync(agentPath, '');
  return { projectsRoot, sessionId, sessionFile, journalPath, agentPath };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('emits workflow-event/workflow-journal (not session-event) for workflow files', async () => {
  const { projectsRoot, journalPath, agentPath } = makeTree();
  const watcher = new TranscriptWatcher({ projectsRoot, activeMinutes: 0 });
  const wfEvents = [], wfJournals = [], sessionEvents = [];
  watcher.on('workflow-event', (p) => wfEvents.push(p));
  watcher.on('workflow-journal', (p) => wfJournals.push(p));
  watcher.on('session-event', (p) => sessionEvents.push(p));
  watcher.start();
  await wait(300); // let chokidar become ready

  fs.appendFileSync(journalPath, `${JSON.stringify({ type: 'started', agentId: 'aaa111' })}\n`);
  fs.appendFileSync(agentPath, `${JSON.stringify({ type: 'assistant', message: { usage: { output_tokens: 5 } } })}\n`);
  await wait(600);
  await watcher.stop();

  const j = wfJournals.find((e) => e.workflowId === 'wf_TEST');
  assert.ok(j, 'workflow-journal emitted with workflowId');
  assert.equal(j.entry.kind, 'event');

  const ag = wfEvents.find((e) => e.agentId === 'aaa111');
  assert.ok(ag, 'workflow-event emitted for the workflow agent');
  assert.equal(ag.workflowId, 'wf_TEST');
  assert.equal(ag.agentMeta?.agentType, 'researcher');

  // Neither workflow file may leak into the session-event stream (board/#agents).
  const leaked = sessionEvents.filter((e) => e.filePath === journalPath || e.filePath === agentPath);
  assert.equal(leaked.length, 0, 'no session-event for workflow files');
});

test('workflow files cascade-drop when the parent session file is removed', async () => {
  const { projectsRoot, sessionId, sessionFile, agentPath } = makeTree();
  const watcher = new TranscriptWatcher({ projectsRoot, activeMinutes: 0 });
  watcher.start();
  await wait(300);
  fs.appendFileSync(agentPath, `${JSON.stringify({ type: 'assistant', message: {} })}\n`);
  await wait(400);
  assert.equal(watcher.filePathForWorkflowAgent(sessionId, 'wf_TEST', 'aaa111'), agentPath, 'agent registered');

  fs.unlinkSync(sessionFile);
  await wait(500);
  await watcher.stop();
  assert.equal(watcher.filePathForWorkflowAgent(sessionId, 'wf_TEST', 'aaa111'), null, 'agent registry cleared on cascade');
});
