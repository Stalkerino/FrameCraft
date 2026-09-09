import {describe, expect, it} from 'vitest';
import {createDemo} from '../shared/demo';
import {applyCommand, clipSchema, validateProject} from '../shared/project';
import {captionOptionsSchema, captionsToSubtitles, createCaptions, proposeRoughCut, removeTimelineRanges, transcriptRanges} from '../shared/assisted-editing';
import {normalizeWords, type Transcript} from '../shared/transcript';
import {zoomAtFrame} from '../shared/clip-animation';
const id = (() => {let n = 0; return () => `new-${n++}`;})();
function fixture() {
  const project = createDemo();
  project.assets = [{id: 'source', name: 'Combat.mp4', kind: 'video', src: '/media/combat.mp4', duration: 20}, {id: 'music', name: 'Music', kind: 'audio', src: '/media/music.wav', duration: 20}];
  project.clips = [clipSchema.parse({id: 'video', name: 'Combat', kind: 'video', track: 'visual', assetId: 'source', start: 30, sourceStart: 60, duration: 240}), clipSchema.parse({id: 'music', name: 'Music', kind: 'audio', track: 'audio', assetId: 'music', start: 0, duration: 450}), clipSchema.parse({id: 'title', name: 'Title', kind: 'text', track: 'text', start: 120, duration: 180, text: 'Chapter'})];
  const doc: Transcript = {assetId: 'source', revision: 0, language: 'english', model: 'fixture', updatedAt: '', words: [{id: 'a', text: 'Combat', start: 2, end: 3}, {id: 'b', text: 'feels', start: 3, end: 4}, {id: 'c', text: 'better.', start: 4, end: 5}, {id: 'd', text: 'New', start: 7, end: 8}, {id: 'e', text: 'lighting.', start: 8, end: 10}]};
  return {project, doc};
}
describe('assisted timeline editing', () => {
  it('maps words through source trims, merges adjacent selections and ripples every track', () => {
    const {project, doc} = fixture();
    const ranges = transcriptRanges(project, 'video', doc, ['b', 'c']); expect(ranges).toEqual([{start: 60, end: 120}]);
    const clips = removeTimelineRanges(project, ranges, id); validateProject({...project, clips});
    expect(clips.filter(c => c.kind === 'video').map(c => [c.start, c.duration, c.sourceStart])).toEqual([[30, 30, 60], [60, 150, 150]]);
    expect(clips.filter(c => c.kind === 'audio').map(c => [c.start, c.duration, c.sourceStart])).toEqual([[0, 60, 0], [60, 330, 120]]);
    expect(clips.find(c => c.id === 'title')?.start).toBe(60); expect(project.clips[0].duration).toBe(240);
    expect(() => transcriptRanges(project, 'video', doc, ['missing'])).toThrow('valid');
  });
  it('retains caption timing and text after cutting through a caption, with valid SRT and VTT', () => {
    const {project, doc} = fixture(); const captions = createCaptions(project, 'video', doc, captionOptionsSchema.parse({}), id);
    expect(captions[0].start).toBe(30); expect(captions[0].caption?.words.map(w => w.start)).toEqual([0, 30, 60]);
    const original = {...project, clips: [...project.clips, ...captions]};
    const cut = {...original, clips: removeTimelineRanges(original, [{start: 60, end: 90}], id)};
    const srt = captionsToSubtitles(cut, 'srt'); expect(srt).toContain('00:00:01,000 --> 00:00:02,000\nCombat'); expect(srt).toContain('00:00:02,000 --> 00:00:03,000\nbetter.'); expect(srt).not.toContain('feels');
    expect(captionsToSubtitles(cut, 'vtt')).toMatch(/^WEBVTT\n\n/); validateProject(cut);
  });
  it('keeps frame-based zoom continuous when a clip is split or ripple-cut', () => {
    const {project} = fixture(); project.clips[0].zoom = {from: 1, to: 2, x: 60, y: 40, start: 0, end: 120};
    const split = applyCommand(project, {type: 'clip.split', id: 'video', frame: 90, newId: 'split'});
    expect(zoomAtFrame(split.clips.find(c => c.id === 'split')!, 10)).toBe(zoomAtFrame(project.clips[0], 70));
    const cut = removeTimelineRanges(project, [{start: 60, end: 90}], id); const right = cut.filter(c => c.kind === 'video')[1];
    expect(zoomAtFrame(right, 10)).toBe(zoomAtFrame(project.clips[0], 70));
  });
  it('proposes bounded whole passages by relevance, then restores source order', () => {
    const {project, doc} = fixture(); const proposal = proposeRoughCut(project, [doc], ['source'], 6, 'lighting', ['source:d', 'source:a']);
    expect(proposal.shots.map(s => s.text)).toEqual(['Combat feels better.', 'New lighting.']); expect(proposal.totalFrames).toBe(180);
    const short = proposeRoughCut(project, [doc], ['source'], 3, 'lighting', ['source:d', 'source:a']); expect(short.shots.map(s => s.text)).toEqual(['New lighting.']);
    const fallback = proposeRoughCut(project, [], ['source'], 5, ''); expect(fallback.totalFrames).toBe(150); expect(fallback.warnings.length).toBeGreaterThan(0);
  });
  it('normalizes missing and overlapping model timestamps without inventing negative word ranges', () => {
    const words = normalizeWords([{text: ' hi', timestamp: [0, 1]}, {text: ' there', timestamp: [.8, null]}, {text: ' friend', timestamp: [2, 8]}], 3, id);
    expect(words.map(w => [w.start, w.end])).toEqual([[0, 1], [1, 2], [2, 3]]);
  });
  it('rejects malformed overlays and invalid replacement transactions', () => {
    const {project} = fixture();
    expect(() => applyCommand(project, {type: 'clip.add', clip: clipSchema.parse({id: id(), name: 'Arrow', kind: 'annotation', track: 'text', start: 0, duration: 30})})).toThrow('shape');
    expect(() => applyCommand(project, {type: 'clips.replace', clips: [...project.clips, project.clips[0]]})).toThrow('Duplicate');
  });
});
