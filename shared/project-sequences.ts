import {z} from 'zod';
import type {Asset, Clip, Project, Sequence} from './project';
import {defaultTracks, projectTracks} from './tracks';
import {canvasSettingsSchema} from './media-settings';
import {updateCanvasSettings} from './project-settings';

const id = z.string().min(1).max(100);
const name = z.string().trim().min(1).max(120);
export const sequenceCommands = [
  z.object({type: z.literal('sequence.create'), id, name, sourceId: id.optional(), settings: canvasSettingsSchema.optional()}),
  z.object({type: z.literal('sequence.open'), id}),
  z.object({type: z.literal('sequence.rename'), id, name}),
  z.object({type: z.literal('sequence.remove'), id}),
  z.object({type: z.literal('sequence.insert'), id, sequenceId: id, start: z.number().int().nonnegative(), trackId: id.optional(), sourceStart: z.number().int().nonnegative().default(0), duration: z.number().int().positive().optional()}),
] as const;
export const sequenceCommandSchema = z.discriminatedUnion('type', sequenceCommands);
export type SequenceCommand = z.infer<typeof sequenceCommandSchema>;

export const activeSequenceId = (project: Pick<Project, 'sequenceId'>) => project.sequenceId ?? 'main';
export const activeSequenceName = (project: Pick<Project, 'sequenceName'>) => project.sequenceName ?? 'Main';
export const timelineIdentity = (project: Pick<Project, 'id' | 'sequenceId'>) => JSON.stringify([project.id, activeSequenceId(project)]);

/** Explicitly include absent optional settings so switching cannot leak a previous grade or export range. */
function timeline(project: Project | Sequence) {
  return {width: project.width, height: project.height, fps: project.fps, clips: project.clips, tracks: project.tracks,
    markers: project.markers, backgroundColor: project.backgroundColor, masterVolume: project.masterVolume,
    audioMix: project.audioMix, colorGrade: project.colorGrade, exportSettings: project.exportSettings};
}
export function activeSequence(project: Project): Sequence {
  return {id: activeSequenceId(project), name: activeSequenceName(project), ...timeline(project)};
}
export function projectSequences(project: Project): Sequence[] {
  return [activeSequence(project), ...(project.sequences ?? [])];
}
export function sequenceSummaries(project: Project) {
  return projectSequences(project).map(sequence => ({id: sequence.id, name: sequence.name, active: sequence.id === activeSequenceId(project),
    width: sequence.width, height: sequence.height, fps: sequence.fps, clipCount: sequence.clips.length,
    durationSeconds: sequence.clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), Math.max(1, Math.round(sequence.fps))) / sequence.fps}));
}

export const sequenceDuration = (sequence: Pick<Sequence, 'clips' | 'fps'>) => sequence.clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), Math.max(1, Math.round(sequence.fps)));
export function findSequence(project: Project, id: string): Sequence {
  const sequence = projectSequences(project).find(sequence => sequence.id === id);
  if(!sequence) throw new Error('Sequence no longer exists.');
  return sequence;
}
export function sequenceSource(project: Project, clip: Clip): Asset | undefined {
  if(clip.kind !== 'sequence') return project.assets.find(asset => asset.id === clip.assetId);
  const sequence = findSequence(project, clip.sequenceId!);
  return {id: `sequence:${sequence.id}`, name: sequence.name, kind: 'image', src: '', width: sequence.width, height: sequence.height, duration: sequenceDuration(sequence) / sequence.fps};
}
export function sequenceDependents(project: Project, id: string) {
  return projectSequences(project).filter(sequence => sequence.clips.some(clip => clip.kind === 'sequence' && clip.sequenceId === id));
}
export function canNestSequence(project: Project, sourceId: string, targetId = activeSequenceId(project)): boolean {
  const sequences = new Map(projectSequences(project).map(sequence => [sequence.id, sequence]));
  const seen = new Set<string>();
  const reaches = (id: string): boolean => {
    if(id === targetId) return true;
    if(seen.has(id)) return false;
    seen.add(id);
    return sequences.get(id)?.clips.some(clip => clip.kind === 'sequence' && reaches(clip.sequenceId!)) ?? false;
  };
  return sequences.has(sourceId) && !reaches(sourceId);
}
/** Frozen renderer input, retaining only the transitive child dependencies. */
export function projectForSequence(project: Project, sequenceId = activeSequenceId(project)): Project {
  const sequence = findSequence(project, sequenceId);
  const seen = new Set([sequenceId]); const dependencies: Sequence[] = [];
  const visit = (sequence: Sequence) => {
    for(const clip of sequence.clips) if(clip.kind === 'sequence' && !seen.has(clip.sequenceId!)) {
      seen.add(clip.sequenceId!); const child = findSequence(project, clip.sequenceId!); dependencies.push(child); visit(child);
    }
  };
  visit(sequence);
  const {sequences: _sequences, ...shared} = project;
  return structuredClone({...shared, ...timeline(sequence), sequenceId: sequence.id, sequenceName: sequence.name, ...(dependencies.length ? {sequences: dependencies} : {})});
}
/** Agent responses describe one timeline; dependencies are inspected explicitly. */
export function sequenceContext(project: Project) {
  const {sequences: _sequences, ...shared} = project;
  return {...shared, sequenceId: activeSequenceId(project), sequenceName: activeSequenceName(project)};
}
export function validateSequences(project: Project, validate: (project: Project) => Project) {
  const sequences = projectSequences(project); const ids = new Set<string>();
  for(const sequence of sequences) {
    if(ids.has(sequence.id)) throw new Error('Duplicate sequence ID.');
    ids.add(sequence.id);
    if(sequence.id !== activeSequenceId(project)) validate({...project, ...timeline(sequence), sequenceId: sequence.id, sequenceName: sequence.name});
  }
  const map = new Map(sequences.map(sequence => [sequence.id, sequence]));
  const visited = new Set<string>(); const visiting = new Set<string>();
  const visit = (id: string) => {
    if(visiting.has(id)) throw new Error('A sequence cannot contain itself, directly or through another sequence.');
    if(visited.has(id)) return;
    const sequence = map.get(id); if(!sequence) throw new Error('Nested sequence reference does not exist.');
    visiting.add(id);
    for(const clip of sequence.clips) if(clip.kind === 'sequence') visit(clip.sequenceId!);
    visiting.delete(id); visited.add(id);
  };
  for(const sequence of sequences) visit(sequence.id);
}

export function applySequenceCommand(project: Project, command: SequenceCommand, makeClip: (input: unknown) => Clip) {
  const current = activeSequence(project);
  const sequences = project.sequences ?? [];
  const find = (sequenceId: string) => {
    const sequence = sequenceId === current.id ? current : sequences.find(item => item.id === sequenceId);
    if(!sequence) throw new Error('Sequence no longer exists.');
    return sequence;
  };
  const activate = (sequence: Sequence) => {
    Object.assign(project, structuredClone(timeline(sequence)), {sequenceId: sequence.id, sequenceName: sequence.name});
  };
  switch(command.type) {
    case 'sequence.create': {
      if(projectSequences(project).some(item => item.id === command.id)) throw new Error('Duplicate sequence ID.');
      let created: Sequence = command.sourceId ? structuredClone(find(command.sourceId)) : {
        id: command.id, name: command.name, width: current.width, height: current.height, fps: current.fps,
        backgroundColor: current.backgroundColor, masterVolume: 1, tracks: structuredClone(defaultTracks), clips: [], markers: [],
      };
      if(command.settings) created = {...created, ...timeline(updateCanvasSettings({...project, ...timeline(created)}, command.settings))};
      created.id = command.id; created.name = command.name;
      project.sequences = [...sequences, current]; activate(created); break;
    }
    case 'sequence.open': {
      const target = find(command.id);
      if(target.id !== current.id) {project.sequences = [...sequences.filter(item => item.id !== target.id), current]; activate(target);}
      break;
    }
    case 'sequence.rename': {
      const target = find(command.id);
      if(target.id === current.id) project.sequenceName = command.name;
      else target.name = command.name;
      break;
    }
    case 'sequence.insert': {
      const child = find(command.sequenceId);
      if(!canNestSequence(project, child.id)) throw new Error('This nesting would create a sequence cycle.');
      const track = command.trackId ? projectTracks(project).find(track => track.id === command.trackId) : projectTracks(project).find(track => track.type === 'visual');
      if(!track || track.type !== 'visual') throw new Error('Select a video track for the nested sequence.');
      project.clips.push(makeClip({id: command.id, kind: 'sequence', sequenceId: child.id, name: child.name, track: 'visual', trackId: track.id,
        start: command.start, sourceStart: command.sourceStart, duration: command.duration ?? Math.max(1, Math.round(sequenceDuration(child) / child.fps * project.fps) - command.sourceStart), animation: 'none'}));
      break;
    }
    case 'sequence.remove': {
      find(command.id);
      const parents = sequenceDependents(project, command.id);
      if(parents.length) throw new Error(`This sequence is used by ${parents.map(item => item.name).join(', ')}. Remove those instances first.`);
      if(!sequences.length) throw new Error('Keep at least one sequence in the project.');
      if(command.id === current.id) {activate(sequences[0]); project.sequences = sequences.slice(1);}
      else project.sequences = sequences.filter(item => item.id !== command.id);
      break;
    }
  }
}

export function sequenceAssets(project: Project) {
  const ids = new Set<string>(); const seen = new Set<string>();
  const visit = (sequence: Sequence) => {
    if(seen.has(sequence.id)) return; seen.add(sequence.id);
    for(const clip of sequence.clips) {
      if(clip.assetId) ids.add(clip.assetId);
      if(clip.kind === 'sequence') visit(findSequence(project, clip.sequenceId!));
    }
  };
  visit(activeSequence(project)); return project.assets.filter(asset => ids.has(asset.id));
}
