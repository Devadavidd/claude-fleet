import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phaseFromSkill, WORKFLOW_PHASES } from '../../dist/server/domain/workflow-phase.js';

const skill = (name) => ({ type: 'tool_use', name: 'Skill', input: { skill: name } });

test('recognizes CK workflow skills across ck:/ck-/bare spellings', () => {
  assert.equal(phaseFromSkill(skill('ck:plan')), 'plan');
  assert.equal(phaseFromSkill(skill('ck-plan')), 'plan');
  assert.equal(phaseFromSkill(skill('plan')), 'plan');
  assert.equal(phaseFromSkill(skill('cook')), 'cook');
  assert.equal(phaseFromSkill(skill('ck:code-review')), 'review');
  assert.equal(phaseFromSkill(skill('web-testing')), 'test');
  assert.equal(phaseFromSkill(skill('ck:ship')), 'ship');
});

test('returns null for non-Skill blocks and unrecognized skills', () => {
  assert.equal(phaseFromSkill(skill('brainstorm')), null);
  assert.equal(phaseFromSkill(skill('journal')), null);
  assert.equal(phaseFromSkill({ type: 'tool_use', name: 'Bash', input: { command: 'plan' } }), null);
  assert.equal(phaseFromSkill({ name: 'Skill', input: {} }), null);
  assert.equal(phaseFromSkill(null), null);
  assert.equal(phaseFromSkill({ name: 'Skill', input: { skill: 123 } }), null);
});

test('WORKFLOW_PHASES is the ordered pipeline', () => {
  assert.deepEqual(WORKFLOW_PHASES, ['plan', 'cook', 'test', 'review', 'ship']);
});
