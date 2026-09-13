import {activeSequenceId} from '../../shared/project-sequences';
import {timelineSelection} from '../services/timeline-selection';
import {createId} from '../services/id-service';
import {create} from 'zustand';
import {clipSchema, durationOf, type Asset, type Clip, type Command, type RenderJob, type Snapshot} from '../../shared/project';
import type {ExportSettings} from '../../shared/media-settings';
import {editorApi} from '../services/editor-api';
import type {PresetValues, SavedPreset} from '../../shared/asset-presets';
import {presetApi} from '../services/preset-api';
import {clipTrackId, projectTracks, trackSchema, trackTypeName, type Track} from '../../shared/tracks';
import {presetTrack} from '../../shared/preset-project';
import {projectApi} from '../services/project-api';
import type {ProjectActionDraft} from '../../shared/project-library';
import {useAnalysis} from './analysis-store';
import {subscribeWorkspace} from '../services/workspace-events';
import {canSplitAt, copyTimelineClip, splitTarget, type TimelineClipboard} from '../../shared/timeline-editing';

type LibraryTab = 'media' | 'text' | 'effects' | 'audio' | 'assist' | 'assets';
let mutationQueue: Promise<unknown> = Promise.resolve();
function enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
  const next = mutationQueue.then(operation); mutationQueue = next.catch(() => undefined); return next;
}
interface EditorState {
  snapshot: Snapshot | null; connected: boolean; selectedId: string | null; selectedIds: string[]; groupDrag: {ids: string[]; delta: number} | null; removeSelected: () => Promise<boolean>; selectedTrackId: string | null; dragTargetTrackId: string | null; frame: number; playing: boolean;
  seekRequest: {frame: number; id: number}; seekTo: (frame: number) => void;
  timelineTool: 'select' | 'razor'; trimMode: 'trim' | 'ripple' | 'roll' | 'slip'; splitClip: (id?: string, frame?: number) => Promise<boolean>;
  clipboard: TimelineClipboard | null; copyClip: () => void; pasteClip: () => Promise<boolean>; duplicateClip: () => Promise<boolean>; clearTrack: (id: string) => Promise<boolean>;
  libraryTab: LibraryTab; inspectorTab: 'properties' | 'codex'; zoom: number; busy: boolean; importing: string | null;
  error: string | null; notice: string | null; renderJob: RenderJob | null;
  accept: (snapshot: Snapshot) => void; execute: (commands: Command[], label: string, revision?: number) => Promise<boolean>;
  updateClip: (id: string, patch: Partial<Clip>, label?: string) => Promise<boolean>;
  addAsset: (asset: Asset, frame?: number, trackId?: string) => void; addText: (preset?: 'title' | 'subtitle' | 'label') => void;
  addTrack: (type: Track['type']) => Promise<void>;
  manageProject: (action: ProjectActionDraft, revision: number) => Promise<boolean>;
  importFiles: (files: File[], folderId?: string) => Promise<void>; history: (direction: 'undo' | 'redo') => Promise<void>;
  render: (kind: 'video' | 'frame', settings?: ExportSettings, outputPath?: string) => Promise<void>;
  applyPreset: (preset: SavedPreset, values?: PresetValues, duration?: number, frame?: number, clipId?: string, trackId?: string) => Promise<boolean>;
}
export const useEditor = create<EditorState>((set, get) => ({
  selectedIds: [], groupDrag: null,
  removeSelected: () => {const state = get(); if(state.busy) return Promise.resolve(false); const ids = timelineSelection(state); return ids.length ? state.execute(ids.map(id => ({type: 'clip.remove' as const, id})), `Removed ${ids.length} selected clips`) : Promise.resolve(false);},
  snapshot: null, connected: false, selectedId: 'title-1', selectedTrackId: null, dragTargetTrackId: null, frame: 60, playing: false,
  timelineTool: 'select',
  trimMode: 'trim',
  clipboard: null,
  seekRequest: {frame: 60, id: 0},
  seekTo: frame => set(state => {
    const target = Math.max(0, Math.min(state.snapshot ? durationOf(state.snapshot.project) - 1 : 0, frame));
    return {frame: target, playing: false, seekRequest: {frame: target, id: state.seekRequest.id + 1}};
  }),
  libraryTab: 'media', inspectorTab: 'properties', zoom: 1, busy: false, importing: null, error: null, notice: null, renderJob: null,
  accept: snapshot => set(state => {
    if(state.snapshot && snapshot.project.revision < state.snapshot.project.revision) return {};
    if(state.snapshot && state.snapshot.project.id !== snapshot.project.id) return {snapshot, connected: true, libraryTab: 'media', timelineTool: 'select', trimMode: 'trim', clipboard: null, selectedIds: [], groupDrag: null, selectedId: null, selectedTrackId: null, dragTargetTrackId: null, frame: 0, playing: false, renderJob: null, notice: null, seekRequest: {frame: 0, id: state.seekRequest.id + 1}};
    if(state.snapshot && activeSequenceId(state.snapshot.project) !== activeSequenceId(snapshot.project)) return {snapshot, connected: true, selectedIds: [], groupDrag: null, selectedId: null, selectedTrackId: null, dragTargetTrackId: null, frame: 0, playing: false, notice: null, seekRequest: {frame: 0, id: state.seekRequest.id + 1}};
    const frame = Math.min(Math.round(state.frame * snapshot.project.fps / (state.snapshot?.project.fps ?? snapshot.project.fps)), durationOf(snapshot.project) - 1);
    return {selectedIds: state.selectedIds.filter(id => snapshot.project.clips.some(c => c.id === id)), snapshot: state.snapshot?.project.revision === snapshot.project.revision ? state.snapshot : snapshot, connected: true, selectedId: snapshot.project.clips.some(c => c.id === state.selectedId) ? state.selectedId : null, selectedTrackId: snapshot.project.clips.some(c => c.id === state.selectedId) ? clipTrackId(snapshot.project, snapshot.project.clips.find(c => c.id === state.selectedId)!) : projectTracks(snapshot.project).some(t => t.id === state.selectedTrackId) ? state.selectedTrackId : null, frame, ...(frame !== state.frame ? {seekRequest: {frame, id: state.seekRequest.id + 1}} : {})};
  }),
  execute: (commands, label, revision) => {const projectId = get().snapshot?.project.id; const sequenceId = get().snapshot?.project.sequenceId; return enqueueMutation(async () => {
    const state = get(); if(!state.snapshot || state.snapshot.project.id !== projectId || state.snapshot.project.sequenceId !== sequenceId) return false;
    set({busy: true, error: null});
    try {get().accept(await editorApi.execute(commands, revision ?? state.snapshot.project.revision, label)); return true;}
    catch(error) {set({error: (error as Error).message}); try {get().accept(await editorApi.snapshot());} catch {} return false;}
    finally {set({busy: false});}
  });},
  manageProject: (action, revision) => enqueueMutation(async () => {
    set({busy: true, error: null, playing: false});
    try {get().accept(await projectApi.manage({...action, revision})); return true;}
    catch(error) {set({error: (error as Error).message}); try {get().accept(await editorApi.snapshot());} catch {} return false;}
    finally {set({busy: false});}
  }),
  updateClip: (id, patch, label = 'Updated clip properties') => get().execute([{type: 'clip.update', id, patch}], label),
  copyClip: () => {
    const state = get(); const project = state.snapshot?.project;
    const clip = project?.clips.find(c => c.id === state.selectedId); if(!project || !clip) return;
    set({clipboard: {projectId: project.id, fps: project.fps, clip: structuredClone(clip), clips: structuredClone(project.clips.filter(c => timelineSelection(state).includes(c.id)))}, notice: `Copied ${clip.name}. Paste at the playhead with Ctrl+V.`});
  },
  pasteClip: async () => {
    const state = get(); const clipboard = state.clipboard;
    if(!clipboard || clipboard.projectId !== state.snapshot?.project.id) return false;
    if(clipboard.clips && clipboard.clips.length > 1) return insertTimelineGroup(clipboard.clips, clipboard.fps, state.frame, 'Pasted');
    return insertTimelineCopy(clipboard.clip, clipboard.fps, state.frame, state.selectedTrackId, 'Pasted');
  },
  duplicateClip: async () => {
    const state = get(); const project = state.snapshot?.project; const clip = project?.clips.find(c => c.id === state.selectedId);
    if(!project || !clip) return false;
    const clips = project.clips.filter(c => timelineSelection(state).includes(c.id));
    if(clips.length > 1) return insertTimelineGroup(clips, project.fps, Math.max(...clips.map(c => c.start + c.duration)), 'Duplicated');
    return insertTimelineCopy(clip, project.fps, clip.start + clip.duration, clipTrackId(project, clip), 'Duplicated');
  },
  clearTrack: async id => {
    const state = get(); const project = state.snapshot?.project; const track = project && projectTracks(project).find(t => t.id === id);
    if(!project || !track || state.busy || !project.clips.some(c => clipTrackId(project, c) === id)) return false;
    set({playing: false});
    return state.execute([{type: 'track.clear', id}], `Cleared ${track.name}`, project.revision);
  },
  splitClip: async (id, at) => {
    const state = get(); const project = state.snapshot?.project; if(!project || state.busy) return false;
    const frame = at ?? state.frame;
    const clip = id ? project.clips.find(c => c.id === id) : splitTarget(project, state.selectedId, state.selectedTrackId, frame);
    if(!canSplitAt(clip, frame)) {set({notice: 'Place the playhead inside a clip, or use Cut (C) and click where you want to split.'}); return false;}
    const rightId = createId(); set({playing: false});
    if(at !== undefined) state.seekTo(frame);
    const ok = await state.execute([{type: 'clip.split', id: clip!.id, frame, newId: rightId}], `Split ${clip!.name}`, project.revision);
    if(ok && get().snapshot?.project.id === project.id && get().snapshot?.project.sequenceId === project.sequenceId && get().selectedId === state.selectedId) set({selectedId: rightId, selectedTrackId: clipTrackId(project, clip!), notice: null});
    return ok;
  },
  addTrack: async type => {
    const project = get().snapshot?.project; if(!project) return; const tracks = projectTracks(project); let number = 1;
    while(tracks.some(t => t.name === `${trackTypeName(type)} ${number}`)) number++;
    const track = trackSchema.parse({id: createId(), type, name: `${trackTypeName(type)} ${number}`});
    if(await get().execute([{type: 'track.add', track}], `Added ${track.name}`)) set({selectedId: null, selectedTrackId: track.id});
  },
  applyPreset: (preset, values = {}, duration, frame, clipId, trackId) => {const projectId = get().snapshot?.project.id; const sequenceId = get().snapshot?.project.sequenceId; return enqueueMutation(async () => {
    const state = get(); if(!state.snapshot || state.snapshot.project.id !== projectId || state.snapshot.project.sequenceId !== sequenceId) return false; const previousIds = new Set(state.snapshot.project.clips.map(c => c.id));
    set({busy: true, error: null});
    try {
      const selectedTrack = projectTracks(state.snapshot.project).find(t => t.id === state.selectedTrackId && t.type === presetTrack(preset.definition.category));
      const snapshot = await presetApi.apply({id: preset.id, version: preset.version, revision: state.snapshot.project.revision, frame: frame ?? state.frame, clipId: clipId ?? state.selectedId ?? undefined, trackId: trackId ?? selectedTrack?.id, values, duration});
      get().accept(snapshot); const added = snapshot.project.clips.find(c => !previousIds.has(c.id));
      if(added) {set({selectedId: added.id, inspectorTab: 'properties'}); get().seekTo(added.start + Math.min(added.duration - 1, Math.round(snapshot.project.fps * .5)));}
      return true;
    } catch(error) {set({error: (error as Error).message}); try {get().accept(await editorApi.snapshot());} catch {} return false;}
    finally {set({busy: false});}
  });},
  addAsset: (asset, frame, trackId) => {
    const project = get().snapshot?.project; if(!project) return;
    const track = asset.kind === 'audio' ? 'audio' : 'visual';
    const destination = trackId ?? projectTracks(project).find(t => t.id === get().selectedTrackId && t.type === track)?.id ?? projectTracks(project).find(t => t.type === track)?.id;
    const start = frame ?? Math.max(0, ...project.clips.filter(c => clipTrackId(project, c) === destination).map(c => c.start + c.duration));
    const clip = clipSchema.parse({id: createId(), name: asset.name.replace(/\.[^.]+$/, ''), kind: asset.kind, assetId: asset.id, track, trackId: destination, start, transitionFrames: Math.max(1, Math.round(.6 * project.fps)), duration: Math.max(1, Math.floor(asset.duration * project.fps + 1e-7))});
    void get().execute([{type: 'clip.add', clip}], `Added ${clip.name}`).then(ok => {if(ok) {set({selectedId: clip.id}); get().seekTo(start);}});
  },
  addText: (preset = 'title') => {
    const fps = get().snapshot?.project.fps ?? 30;
    const project = get().snapshot?.project; const target = project && projectTracks(project).find(t => t.id === get().selectedTrackId && t.type === 'text');
    const clip = clipSchema.parse({id: createId(), name: preset === 'title' ? 'New title' : preset === 'subtitle' ? 'Subtitle' : 'Chapter label', kind: 'text', track: 'text', trackId: target?.id, start: get().frame, duration: Math.round(fps * 4), text: preset === 'title' ? 'Your next chapter.' : preset === 'subtitle' ? 'Every detail tells a story.' : 'DEVLOG 002 / WORK IN PROGRESS', fontSize: preset === 'title' ? 96 : preset === 'subtitle' ? 48 : 24, y: preset === 'subtitle' ? 82 : 50, color: preset === 'label' ? '#c5f277' : '#ffffff'});
    void get().execute([{type: 'clip.add', clip}], `Added ${clip.name}`).then(ok => {if(ok) set({selectedId: clip.id, inspectorTab: 'properties'});});
  },
  importFiles: async (files, folderId) => {
    const projectId = get().snapshot?.project.id;
    for(const file of files) {
      set({importing: file.name, error: null});
      try {get().accept(await editorApi.import(file, projectId, folderId));}
      catch(error) {set({error: (error as Error).message});}
    }
    set({importing: null});
  },
  history: direction => {const projectId = get().snapshot?.project.id; const sequenceId = get().snapshot?.project.sequenceId; return enqueueMutation(async () => {
    const state = get(); if(!state.snapshot || state.snapshot.project.id !== projectId || state.snapshot.project.sequenceId !== sequenceId || !(direction === 'undo' ? state.snapshot.canUndo : state.snapshot.canRedo)) return;
    set({busy: true, playing: false});
    try {get().accept(await editorApi.history(direction, state.snapshot.project.revision));}
    catch(error) {set({error: (error as Error).message}); try {get().accept(await editorApi.snapshot());} catch {}}
    finally {set({busy: false});}
  });},
  render: async (kind, settings, outputPath) => {
    if(['queued', 'rendering'].includes(get().renderJob?.status || '')) return;
    const projectId = get().snapshot?.project.id;
    try {set({error: null}); const job = await editorApi.render(kind, get().frame, settings, get().snapshot?.project.revision, outputPath); if(get().snapshot?.project.id === projectId) set({renderJob: job});}
    catch(error) {set({error: (error as Error).message});}
  },
}));

// Existing canvas/inspector single-selection actions must not revive an older group.
useEditor.subscribe((state, previous) => {
  if(state.selectedId !== previous.selectedId && state.selectedIds === previous.selectedIds && state.selectedIds.length) useEditor.setState({selectedIds: []});
});

async function insertTimelineGroup(sources: Clip[], fps: number, start: number, action: string): Promise<boolean> {
  const state = useEditor.getState(); const project = state.snapshot?.project;
  if(!project || state.busy) return false;
  try {
    const first = Math.min(...sources.map(c => c.start));
    const ids = new Map(sources.map(c => [c.id, createId()]));
    const groups = new Map(sources.flatMap(c => c.groupId ? [[c.groupId, createId()] as const] : []));
    const links = new Map(sources.flatMap(c => c.linkId ? [[c.linkId, createId()] as const] : []));
    const clips = sources.map(source => {
      const clip = copyTimelineClip(project, source, ids.get(source.id)!, start + Math.round((source.start - first) * project.fps / fps), clipTrackId(project, source), fps);
      clip.groupId = source.groupId ? groups.get(source.groupId) : null;
      clip.linkId = source.linkId ? links.get(source.linkId) : null;
      if(clip.caption && ids.has(clip.caption.parentClipId)) clip.caption = {...clip.caption, parentClipId: ids.get(clip.caption.parentClipId)!};
      return clip;
    });
    const ok = await state.execute(clips.map(clip => ({type: 'clip.add', clip})), `${action} ${clips.length} clips`, project.revision);
    if(ok && useEditor.getState().snapshot?.project.id === project.id && useEditor.getState().snapshot?.project.sequenceId === project.sequenceId) useEditor.setState({selectedId: clips[0].id, selectedIds: clips.map(c => c.id), playing: false});
    return ok;
  } catch(error) {useEditor.setState({error: (error as Error).message}); return false;}
}

async function insertTimelineCopy(source: Clip, fps: number, start: number, trackId: string | null, action: string): Promise<boolean> {
  const state = useEditor.getState(); const project = state.snapshot?.project;
  if(!project || state.busy) return false;
  try {
    const clip = copyTimelineClip(project, source, createId(), start, trackId, fps);
    useEditor.setState({playing: false});
    const ok = await state.execute([{type: 'clip.add', clip}], `${action} ${source.name}`.slice(0, 180), project.revision);
    if(ok && useEditor.getState().snapshot?.project.id === project.id && useEditor.getState().snapshot?.project.sequenceId === project.sequenceId) {
      useEditor.setState({selectedId: clip.id, selectedTrackId: clip.trackId, inspectorTab: 'properties', notice: null});
      useEditor.getState().seekTo(clip.start);
    }
    return ok;
  } catch(error) {useEditor.setState({error: (error as Error).message}); return false;}
}

export function connectEditor() {
  const disconnect = subscribeWorkspace('project', snapshot => useEditor.getState().accept(snapshot), () => useEditor.setState({connected: false}));
  const poll = setInterval(async () => {
    const job = useEditor.getState().renderJob;
    if(job && (job.status === 'queued' || job.status === 'rendering')) {
      try {
        const updated = await editorApi.job(job.id);
        if(useEditor.getState().renderJob?.id === job.id) useEditor.setState({renderJob: updated});
      } catch(error) {
        if(useEditor.getState().renderJob?.id !== job.id) return;
        const failure = error as Error & {status?: number};
        if(failure.status === 404) useEditor.setState({renderJob: {...job, status: 'error', error: 'This render was interrupted when the editor restarted. Start a new export.'}});
        else useEditor.setState({error: failure.message});
      }
    }
  }, 1000);
  let contextTimer: ReturnType<typeof setTimeout>;
  const unsubscribe = useEditor.subscribe((state, previous) => {
    const switched = state.snapshot?.project.id !== previous.snapshot?.project.id || state.snapshot?.project.sequenceId !== previous.snapshot?.project.sequenceId;
    if(switched) useAnalysis.setState({assetId: '', searchId: null, roughcutId: null});
    if(state.selectedId !== previous.selectedId && state.snapshot) {const clip = state.snapshot.project.clips.find(c => c.id === state.selectedId); if(clip) useEditor.setState({selectedTrackId: clipTrackId(state.snapshot.project, clip)});}
    if(switched || state.frame !== previous.frame || state.selectedId !== previous.selectedId || state.selectedTrackId !== previous.selectedTrackId) {
      clearTimeout(contextTimer); contextTimer = setTimeout(() => {void editorApi.context(state.frame, state.selectedId, state.selectedTrackId, state.snapshot?.project.id, state.snapshot?.project.sequenceId ?? 'main').catch(() => undefined);}, 200);
    }
  });
  return () => {disconnect(); clearInterval(poll); clearTimeout(contextTimer); unsubscribe();};
}
