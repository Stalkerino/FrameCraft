import {expect, it} from 'vitest';
import {validateVideoCutRanges} from '../shared/video-cut-validation';
import {OllamaWorkState} from '../server/services/ollama-work-state';
import type {VideoCut} from '../shared/visual-rush';

const shot = (patch: Partial<VideoCut['shots'][number]> = {}): VideoCut['shots'][number] => ({id: 'menu', start: 0, end: 28, evidence: [0.5, 12, 20], confidence: 'high', reason: 'Visible menu', ...patch});

it('reports both faults from the actual Ollama proposal in one response without changing the proposal', () => {
  const shots = [shot({evidence: [0.5, 12, 20, 28]}), shot({id: 'outro', start: 287.5, end: 360, evidence: [322, 326.5]})];
  const before = structuredClone(shots);
  let failure: Record<string, unknown> | undefined;
  try {validateVideoCutRanges(shots, 357.7, [0.5, 12, 20, 28, 322, 326.5]);} catch(error) {failure = JSON.parse((error as Error).message);}
  expect(failure).toMatchObject({sourceDuration: 357.7, units: 'source seconds', issues: [
    {shotId: 'menu', invalidEvidence: [{path: 'shots[0].evidence[3]', value: 28}], existingEvidenceInsideShot: [0.5, 12, 20]},
    {shotId: 'outro', path: 'shots[1].end', value: 360, maximum: 357.7},
  ]});
  expect(shots).toEqual(before);
  expect(() => validateVideoCutRanges([shot(), {...shots[1], end: 357.7}], 357.7, [0.5, 12, 20, 28, 322, 326.5])).not.toThrow();
});

it('keeps the exclusive endpoint and source-frame inspection requirements', () => {
  expect(() => validateVideoCutRanges([shot({start: 12, evidence: [12, 27.999]})], 357.7, [12, 27.999])).not.toThrow();
  expect(() => validateVideoCutRanges([shot({evidence: [28]})], 357.7, [28])).toThrow('EXCLUDED');
  expect(() => validateVideoCutRanges([shot({start: 12, evidence: [0.5]})], 357.7, [0.5])).toThrow('shots[0].evidence[0]');
  expect(() => validateVideoCutRanges([shot({evidence: [5.123]})], 357.7, [0.5])).toThrow('uninspectedEvidence');
});

it('preflights Ollama against the matching report duration, leaving cached inspection validation to MCP', () => {
  const work = new OllamaWorkState(); const reportId = '88926f48-23b5-4ae7-bffa-6f704751c09f';
  work.observe('get_video_analysis', {}, {id: reportId, duration: 357.7, moments: [], cues: []});
  const input = {reportId, revision: 305, title: 'Devlog', shots: [shot({end: 360})]};
  expect(() => work.validateCut(input)).toThrow('357.7');
  // Older cached inspections need not appear in this conversation's work state.
  expect(() => work.validateCut({...input, shots: [shot()]})).not.toThrow();
  expect(() => work.validateCut({...input, shots: [{...shot(), start: undefined}]})).toThrow('start');
});

it('diagnoses the reversed range from the logs before Zod refinement hides its values', () => {
  const work = new OllamaWorkState(); const reportId = '88926f48-23b5-4ae7-bffa-6f704751c09f';
  work.observe('get_video_analysis', {}, {id: reportId, duration: 357.7, moments: [], cues: []});
  const input = {reportId, revision: 305, title: 'Devlog', shots: [shot(), shot({id: 'loadout', start: 36, end: 28, evidence: [12, 20]})]};
  let issues: unknown;
  try {work.validateCut(input);} catch(error) {issues = JSON.parse((error as Error).message).issues;}
  expect(issues).toEqual(expect.arrayContaining([
    expect.objectContaining({shotId: 'loadout', path: 'shots[1].end', start: 36, end: 28, evidence: [12, 20]}),
    expect.objectContaining({shotId: 'loadout', invalidEvidence: [{path: 'shots[1].evidence[0]', value: 12}, {path: 'shots[1].evidence[1]', value: 20}]}),
  ]));
  expect(() => work.validateCut({...input, shots: [shot({start: 28, end: 28, evidence: [28]})]})).toThrow('strictly greater');
});
