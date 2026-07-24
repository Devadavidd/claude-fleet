import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkflowScript } from '../../dist/server/workflows/workflow-script-parser.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = fs.readFileSync(path.join(here, 'fixtures', 'workflow', 'workflow-script-sample.txt'), 'utf8');

test('parses meta name/description, phases, and ordered agent specs', () => {
  const parsed = parseWorkflowScript(fixture);
  assert.equal(parsed.name, 'author-test-plan');
  assert.equal(parsed.description, 'Test workflow: research then author');
  assert.deepEqual(parsed.phases.map((p) => p.title), ['Research', 'Author']);
  assert.equal(parsed.phases[0].detail, '2 parallel researchers');
  assert.deepEqual(parsed.agentSpecs, [
    { agentType: 'researcher', label: 'topic-a', phase: 'Research' },
    { agentType: 'researcher', label: 'topic-b', phase: 'Research' },
    { agentType: 'general-purpose', label: 'write-doc.md', phase: 'Author' },
  ]);
});

test('malformed script fails open to empty fields (no throw)', () => {
  const parsed = parseWorkflowScript('this is not }{ a workflow script at all');
  assert.equal(parsed.name, null);
  assert.deepEqual(parsed.phases, []);
  assert.deepEqual(parsed.agentSpecs, []);
});

test('non-string input is tolerated', () => {
  const parsed = parseWorkflowScript(null);
  assert.deepEqual(parsed, { name: null, description: null, phases: [], agentSpecs: [] });
});
