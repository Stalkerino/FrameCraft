import {clipSchema, validateProject, type Command, type Project} from './project';
import {presetDefinitionSchema, resolvePresetValues, type PresetApplication, type PresetInstance, type PresetValues, type SavedPreset} from './asset-presets';
import {projectTracks} from './tracks';

export const presetTrack = (category: string) => ['background', 'intro', 'outro', 'transition'].includes(category) ? 'visual' : 'text';
export function instantiatePreset(preset: SavedPreset, values: PresetValues = {}, duration = preset.definition.duration): PresetInstance {
  return {presetId: preset.id, version: preset.version, definition: structuredClone(preset.definition), values: resolvePresetValues(preset.definition, values), duration};
}
export function presetCommands(project: Project, preset: SavedPreset, input: PresetApplication, newId: string): Command[] {
  if(preset.version !== input.version) throw Object.assign(new Error('Preset changed. Refresh the library before applying it.'), {status: 409});
  const instance = instantiatePreset(preset, input.values, input.duration);
  const duration = Math.max(1, Math.round(instance.duration * project.fps));
  if(preset.definition.category === 'transition') {
    const clip = project.clips.find(c => c.id === input.clipId); if(!clip || clip.track !== 'visual') throw new Error('Select the incoming visual clip for this transition.');
    return [{type: 'clip.update', id: clip.id, patch: {presetTransition: instance, transition: 'none', transitionFrames: duration}}];
  }
  const track = input.trackId ? projectTracks(project).find(t => t.id === input.trackId) : undefined;
  if(input.trackId && (!track || track.type === 'audio')) throw new Error('Choose a video or text track for this graphic.');
  return [{type: 'clip.add', clip: clipSchema.parse({id: newId, name: preset.definition.name, kind: 'graphic', track: track?.type ?? presetTrack(preset.definition.category), trackId: track?.id, start: input.frame, duration, graphic: instance})}];
}
/** Isolated preview project: never enters the running editor's repository or undo history. */
export function presetPreviewProject(preset: SavedPreset, values: PresetValues = {}, duration = preset.definition.duration) {
  const project: Project = {version: 1, id: 'preset-preview', name: preset.definition.name, revision: 0, width: 960, height: 540, fps: 30, assets: [], clips: []};
  const instance = instantiatePreset(preset, values, duration); const frames = Math.max(1, Math.round(duration * project.fps));
  if(preset.definition.category !== 'transition') {
    project.clips = [clipSchema.parse({id: 'preview', name: preset.definition.name, kind: 'graphic', track: presetTrack(preset.definition.category), start: 0, duration: frames, graphic: instance})];
    return {project: validateProject(project), start: 0, frames};
  }
  const scene = (id: string, fill: string, text: string, start: number, duration: number) => {
    const definition = presetDefinitionSchema.parse({schemaVersion: 1, name: text, category: 'background', layers: [{id: 'base', type: 'rect', width: 100, height: 100, fill}, {id: 'title', type: 'text', text, fontSize: 9}]});
    return clipSchema.parse({id, name: text, kind: 'graphic', track: 'visual', start, duration, graphic: {presetId: id, version: 1, definition, values: {}, duration: duration / 30}});
  };
  project.clips = [scene('outgoing', '#1d293b', 'SCENE A', 0, 30), {...scene('incoming', '#383051', 'SCENE B', 30, frames + 30), presetTransition: instance, transitionFrames: frames}];
  return {project: validateProject(project), start: 30, frames};
}
