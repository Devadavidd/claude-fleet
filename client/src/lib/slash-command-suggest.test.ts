import { test, expect } from 'vitest';
import { activeSlashToken, suggestSlashCommands } from './slash-command-suggest.js';
import type { SkillEntry } from '../../../shared/types/index.js';

const SKILLS = [
  { name: 'brainstorm', desc: 'Debate solutions', cat: 'core' },
  { name: 'plan', desc: 'Plan implementations', cat: 'core' },
  { name: 'deploy', desc: 'Ship to a platform', cat: 'infra' },
] as SkillEntry[];

test('activeSlashToken: only the first word, only when it starts with /', () => {
  expect(activeSlashToken('/bra')).toBe('/bra');
  expect(activeSlashToken('/')).toBe('/');
  expect(activeSlashToken('fix /this')).toBeNull();
  expect(activeSlashToken('/cf:plan rest')).toBeNull(); // word finished (space typed)
  expect(activeSlashToken('')).toBeNull();
});

test('bare "/" lists the catalog; typed prefix ranks name matches first', () => {
  expect(suggestSlashCommands(SKILLS, '/').map((s) => s.command)).toEqual([
    '/cf:brainstorm', '/cf:deploy', '/cf:plan',
  ]);
  const bra = suggestSlashCommands(SKILLS, '/bra');
  expect(bra[0]).toMatchObject({ command: '/cf:brainstorm', desc: 'Debate solutions' });
  expect(bra).toHaveLength(1);
});

test('cf: prefix and desc matches are honored; no match → empty', () => {
  expect(suggestSlashCommands(SKILLS, '/cf:pl')[0].command).toBe('/cf:plan');
  expect(suggestSlashCommands(SKILLS, '/ship')[0].command).toBe('/cf:deploy'); // via desc
  expect(suggestSlashCommands(SKILLS, '/zzz')).toEqual([]);
});
