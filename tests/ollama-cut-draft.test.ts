import {expect, it} from 'vitest';
import {OllamaCutDraft} from '../server/services/ollama-cut-draft';
import {validateVideoCutRanges} from '../shared/video-cut-validation';

const input = {revision: 305, reportId: '88926f48-23b5-4ae7-bffa-6f704751c09f', title: 'Devlog', goal: 'Keep existing choices', shots: [
  {id: 'menu', start: 0, end: 10, evidence: [0.5], reason: 'Visible menu', confidence: 'high'},
  {id: 'loadout', start: 36, end: 28, evidence: [12, 20], reason: 'Loadout choices', confidence: 'medium'},
]};
it('repairs one invalid interval while retaining good shots and metadata across restart', () => {
  const drafts = new OllamaCutDraft(); const draftId = drafts.remember(input, 'project-1')!;
  const restored = new OllamaCutDraft(); restored.restore(drafts.serialize());
  const call = restored.prepare({draftId, changes: [{id: 'loadout', start: 12}]}, 'project-1');
  expect(call.name).toBe('save_video_cut');
  expect(call.arguments).toEqual({...input, expectedVersion: null, shots: [input.shots[0], {...input.shots[1], start: 12}]});
  expect(() => validateVideoCutRanges(call.arguments.shots, 357.7, [0.5, 12, 20])).not.toThrow();
  expect(restored.serialize()?.input.shots[1].start).toBe(36); // approval hasn't occurred
});
it('rejects unknown shots, unrelated field rewrites, empty changes and another project', () => {
  const drafts = new OllamaCutDraft(); const draftId = drafts.remember(input, 'project-1')!;
  expect(() => drafts.prepare({draftId, changes: [{id: 'missing', start: 12}]}, 'project-1')).toThrow('matched 0');
  expect(() => drafts.prepare({draftId, changes: [{id: 'loadout', reason: 'New story'}]}, 'project-1')).toThrow('reason');
  expect(() => drafts.prepare({draftId, changes: [{id: 'loadout'}]}, 'project-1')).toThrow('Provide start');
  expect(() => drafts.prepare({draftId, changes: [{id: 'loadout', start: 12}]}, 'project-2')).toThrow('another project');
  drafts.reset(); expect(() => drafts.prepare({draftId, changes: [{id: 'loadout', start: 12}]}, 'project-1')).toThrow('Unknown');
});
