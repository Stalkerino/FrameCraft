import {expect, it} from 'vitest';
import {applyCommand, clipSchema, type Project} from '../shared/project';
import {isOllamaEditorTool, ollamaEditorTools, prepareOllamaEditorTool} from '../server/services/ollama-editor-tools';

const project: Project = {version: 1, id: 'test', name: 'Test', revision: 4, width: 1920, height: 1080, fps: 60, assets: [
  {id: 'source', kind: 'video', name: 'Rush', src: '/media/video.mp4', duration: 20},
  {id: 'picture', kind: 'image', name: 'Logo', src: '/media/logo.png', duration: 1},
  {id: 'music', kind: 'audio', name: 'Music', src: '/media/music.wav', duration: 20},
], clips: [clipSchema.parse({id: 'existing', kind: 'video', name: 'Rush', assetId: 'source', track: 'visual', start: 120, sourceStart: 60, duration: 300})]};
const prepare = (name: string, args: Record<string, unknown>) => prepareOllamaEditorTool(name, {revision: 4, ...args})!;

it('keeps common editing schemas small and directly typed, leaving advanced MCP calls untouched', () => {
  const serialized = JSON.stringify(ollamaEditorTools);
  expect(serialized.length).toBeLessThan(8000);
  expect(serialized).not.toMatch(/"(?:oneOf|anyOf|\$ref)"/);
  for(const tool of ollamaEditorTools) expect(tool.inputSchema.required).toContain('revision');
  expect(isOllamaEditorTool('add_text_clip')).toBe(true);
  expect(prepareOllamaEditorTool('edit_project', {revision: 1, commands: []})).toBeUndefined();
  expect(prepareOllamaEditorTool('apply_speed_ramp', {})).toBeUndefined();
});

it('adds actual text with explicit frame timing, stable IDs and shared defaults', () => {
  const input = {trackId: 'text', text: 'Local title', start: 120, duration: 180, x: 30};
  const call = prepare('add_text_clip', input);
  expect(call).toMatchObject({name: 'edit_project', arguments: {revision: 4, commands: [{type: 'clip.add', clip: {kind: 'text', text: 'Local title', start: 120, duration: 180, x: 30, y: 50, opacity: 1, animation: 'none'}}]}});
  expect(call).toEqual(prepare('add_text_clip', {x: 30, duration: 180, start: 120, text: 'Local title', trackId: 'text'}));
  const next = applyCommand(project, call.arguments.commands[0]);
  expect(next.clips).toHaveLength(2);
  expect(next.clips[1].text).toBe('Local title');
  expect(input).not.toHaveProperty('clipId');
  expect(prepare('add_text_clip', {...input, clipId: 'chosen'}).arguments.commands[0]).toMatchObject({clip: {id: 'chosen'}});
});

it.each([['video', 'source', 'visual'], ['image', 'picture', 'visual'], ['audio', 'music', 'audio']] as const)('adds %s media through the validated editor reducer', (kind, assetId, trackId) => {
  const call = prepare('add_media_clip', {kind, assetId, trackId, start: 10, duration: 120, sourceStart: 60});
  const next = applyCommand(project, call.arguments.commands[0]);
  expect(next.clips[1]).toMatchObject({kind, assetId, trackId, start: 10, duration: 120, sourceStart: 60});
});

it('split uses absolute timeline frames and preserves source offsets in the real reducer', () => {
  const call = prepare('split_clip', {clipId: 'existing', frame: 240});
  const next = applyCommand(project, call.arguments.commands[0]);
  expect(next.clips[0].duration).toBe(120);
  expect(next.clips[1]).toMatchObject({start: 240, sourceStart: 180, duration: 180});
  expect(next.clips[1].id).not.toBe('existing');
  expect(call).toEqual(prepare('split_clip', {clipId: 'existing', frame: 240}));
  expect(() => applyCommand(project, prepare('split_clip', {clipId: 'existing', frame: 120}).arguments.commands[0])).toThrow('inside');
});

it('updates only requested fields and lets the shared reducer enforce position locks', () => {
  const call = prepare('update_clip', {clipId: 'existing', opacity: 0.5, start: 180});
  expect(call.arguments.commands).toEqual([{type: 'clip.update', id: 'existing', patch: {opacity: 0.5, start: 180}}]);
  expect(applyCommand(project, call.arguments.commands[0]).clips[0]).toMatchObject({opacity: 0.5, start: 180, duration: 300, sourceStart: 60});
  const locked = {...project, clips: [{...project.clips[0], positionLocked: true}]};
  expect(() => applyCommand(locked, prepare('update_clip', {clipId: 'existing', x: 20}).arguments.commands[0])).toThrow('locked');
});

it('adds and moves tracks, moves clips, clears only the selected track and renames the project', () => {
  let next = applyCommand(project, prepare('add_track', {name: 'Video 2', type: 'visual', trackId: 'v2'}).arguments.commands[0]);
  next = applyCommand(next, prepare('move_clip_to_track', {clipId: 'existing', trackId: 'v2'}).arguments.commands[0]);
  expect(next.clips[0]).toMatchObject({trackId: 'v2', start: 120});
  next = applyCommand(next, prepare('move_track', {trackId: 'v2', direction: 'down'}).arguments.commands[0]);
  expect(next.tracks?.[1].id).toBe('v2');
  next = applyCommand(next, prepare('clear_track', {trackId: 'v2'}).arguments.commands[0]);
  expect(next.clips).toHaveLength(0);
  expect(next.assets).toEqual(project.assets);
  expect(next.tracks?.some(track => track.id === 'v2')).toBe(true);
  expect(applyCommand(next, prepare('rename_project', {name: 'New name'}).arguments.commands[0]).name).toBe('New name');
  expect(applyCommand(project, prepare('remove_clip', {clipId: 'existing'}).arguments.commands[0]).clips).toHaveLength(0);
});

it('rejects missing or coerced revisions, invalid units, unknown fields and no-op updates', () => {
  const input = {clipId: 'existing', opacity: 0.5};
  for(const revision of [undefined, '4', -1, 1.5]) expect(() => prepareOllamaEditorTool('update_clip', {...input, revision})).toThrow();
  for(const patch of [{start: 1.5}, {duration: 0}, {opacity: 2}, {sourceStart: '2s'}, {surprise: true}, {}]) expect(() => prepare('update_clip', {clipId: 'existing', ...patch})).toThrow();
  expect(() => prepare('add_media_clip', {kind: 'video', assetId: 'source', start: 0, duration: 30})).toThrow();
});
