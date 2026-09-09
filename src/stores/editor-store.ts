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
  snapshot: Snapshot | null; connected: boolean; selectedId: string | null; selectedTrackId: string | null; dragTargetTrackId: string | null; frame: number; playing: boolean;
  seekRequest: {frame: number; id: number}; seekTo: (frame: number) => void;
  timelineTool: 'select' | 'razor'; splitClip: (id?: string, frame?: number) => Promise<boolean>;
  clipboard: TimelineClipboard | null; copyClip: () => void; pasteClip: () => Promise<boolean>; duplicateClip: () => Promise<boolean>; clearTrack: (id: string) => Promise<boolean>;
  libraryTab: LibraryTab; inspectorTab: 'properties' | 'codex'; zoom: number; busy: boolean; importing: string | null;
  error: string | null; notice: string | null; renderJob: RenderJob | null;
  accept: (snapshot: Snapshot) => void; execute: (commands: Command[], label: string, revision?: number) => Promise<boolean>;
  updateClip: (id: string, patch: Partial<Clip>, label?: string) => Promise<boolean>;
  addAsset: (asset: Asset, frame?: number, trackId?: string) => void; addText: (preset?: 'title' | 'subtitle' | 'label') => void;
  addTrack: (type: Track['type']) => Promise<void>;
  manageProject: (action: ProjectActionDraft, revision: number) => Promise<boolean>;
  importFiles: (files: File[]) => Promise<void>; history: (direction: 'undo' | 'redo') => Promise<void>;
  render: (kind: 'video' | 'frame', settings?: ExportSettings) => Promise<void>;
  applyPreset: (preset: SavedPreset, values?: PresetValues, duration?: number, frame?: number, clipId?: string, trackId?: string) => Promise<boolean>;
}
export const useEditor = create<EditorState>((set, get) => ({
  snapshot: null, connected: false, selectedId: 'title-1', selectedTrackId: null, dragTargetTrackId: null, frame: 60, playing: false,
  timelineTool: 'select',
  clipboard: null,
  seekRequest: {frame: 60, id: 0},
  seekTo: frame => set(state => {
    const target = Math.max(0, Math.min(state.snapshot ? durationOf(state.snapshot.project) - 1 : 0, frame));
    return {frame: target, playing: false, seekRequest: {frame: target, id: state.seekRequest.id + 1}};
  }),
  libraryTab: 'media', inspectorTab: 'properties', zoom: 1, busy: false, importing: null, error: null, notice: null, renderJob: null,
  accept: snapshot => set(state => {
    if(state.snapshot && snapshot.project.revision < state.snapshot.project.revision) return {};
    if(state.snapshot && state.snapshot.project.id !== snapshot.project.id) return {snapshot, connected: true, libraryTab: 'media', timelineTool: 'select', clipboard: null, selectedId: null, selectedTrackId: null, dragTargetTrackId: null, frame: 0, playing: false, renderJob: null, notice: null, seekRequest: {frame: 0, id: state.seekRequest.id + 1}};
    const frame = Math.min(Math.round(state.frame * snapshot.project.fps / (state.snapshot?.project.fps ?? snapshot.project.fps)), durationOf(snapshot.project) - 1);
    return {snapshot: state.snapshot?.project.revision === snapshot.project.revision ? state.snapshot : snapshot, connected: true, selectedId: snapshot.project.clips.some(c => c.id === state.selectedId) ? state.selectedId : null, selectedTrackId: snapshot.project.clips.some(c => c.id === state.selectedId) ? clipTrackId(snapshot.project, snapshot.project.clips.find(c => c.id === state.selectedId)!) : projectTracks(snapshot.project).some(t => t.id === state.selectedTrackId) ? state.selectedTrackId : null, frame, ...(frame !== state.frame ? {seekRequest: {frame, id: state.seekRequest.id + 1}} : {})};
  }),
  execute: (commands, label, revision) => {const projectId = get().snapshot?.project.id; return enqueueMutation(async () => {
    const state = get(); if(!state.snapshot || state.snapshot.project.id !== projectId) return false;
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
    set({clipboard: {projectId: project.id, fps: project.fps, clip: structuredClone(clip)}, notice: `Copied ${clip.name}. Paste at the playhead with Ctrl+V.`});
  },
  pasteClip: async () => {
    const state = get(); const clipboard = state.clipboard;
    if(!clipboard || clipboard.projectId !== state.snapshot?.project.id) return false;
    return insertTimelineCopy(clipboard.clip, clipboard.fps, state.frame, state.selectedTrackId, 'Pasted');
  },
  duplicateClip: async () => {
    const state = get(); const project = state.snapshot?.project; const clip = project?.clips.find(c => c.id === state.selectedId);
    if(!project || !clip) return false;
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
    if(ok && get().snapshot?.project.id === project.id && get().selectedId === state.selectedId) set({selectedId: rightId, selectedTrackId: clipTrackId(project, clip!), notice: null});
    return ok;
  },
  addTrack: async type => {
    const project = get().snapshot?.project; if(!project) return; const tracks = projectTracks(project); let number = 1;
    while(tracks.some(t => t.name === `${trackTypeName(type)} ${number}`)) number++;
    const track = trackSchema.parse({id: createId(), type, name: `${trackTypeName(type)} ${number}`});
    if(await get().execute([{type: 'track.add', track}], `Added ${track.name}`)) set({selectedId: null, selectedTrackId: track.id});
  },
  applyPreset: (preset, values = {}, duration, frame, clipId, trackId) => {const projectId = get().snapshot?.project.id; return enqueueMutation(async () => {
    const state = get(); if(!state.snapshot || state.snapshot.project.id !== projectId) return false; const previousIds = new Set(state.snapshot.project.clips.map(c => c.id));
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
    const clip = clipSchema.parse({id: createId(), name: asset.name.replace(/\.[^.]+$/, ''), kind: asset.kind, assetId: asset.id, track, trackId: destination, start, transitionFrames: Math.max(1, Math.round(.6 * project.fps)), duration: Math.max(1, Math.floor(asset.duration * project.fps))});
    void get().execute([{type: 'clip.add', clip}], `Added ${clip.name}`).then(ok => {if(ok) {set({selectedId: clip.id}); get().seekTo(start);}});
  },
  addText: (preset = 'title') => {
    const fps = get().snapshot?.project.fps ?? 30;
    const project = get().snapshot?.project; const target = project && projectTracks(project).find(t => t.id === get().selectedTrackId && t.type === 'text');
    const clip = clipSchema.parse({id: createId(), name: preset === 'title' ? 'New title' : preset === 'subtitle' ? 'Subtitle' : 'Chapter label', kind: 'text', track: 'text', trackId: target?.id, start: get().frame, duration: Math.round(fps * 4), text: preset === 'title' ? 'Your next chapter.' : preset === 'subtitle' ? 'Every detail tells a story.' : 'DEVLOG 002 / WORK IN PROGRESS', fontSize: preset === 'title' ? 96 : preset === 'subtitle' ? 48 : 24, y: preset === 'subtitle' ? 82 : 50, color: preset === 'label' ? '#c5f277' : '#ffffff'});
    void get().execute([{type: 'clip.add', clip}], `Added ${clip.name}`).then(ok => {if(ok) set({selectedId: clip.id, inspectorTab: 'properties'});});
  },
  importFiles: async files => {
    const projectId = get().snapshot?.project.id;
    for(const file of files) {
      set({importing: file.name, error: null});
      try {get().accept(await editorApi.import(file, projectId));}
      catch(error) {set({error: (error as Error).message});}
    }
    set({importing: null});
  },
  history: direction => {const projectId = get().snapshot?.project.id; return enqueueMutation(async () => {
    const state = get(); if(!state.snapshot || state.snapshot.project.id !== projectId || !(direction === 'undo' ? state.snapshot.canUndo : state.snapshot.canRedo)) return;
    set({busy: true, playing: false});
    try {get().accept(await editorApi.history(direction, state.snapshot.project.revision));}
    catch(error) {set({error: (error as Error).message}); try {get().accept(await editorApi.snapshot());} catch {}}
    finally {set({busy: false});}
  });},
  render: async (kind, settings) => {
    if(['queued', 'rendering'].includes(get().renderJob?.status || '')) return;
    const projectId = get().snapshot?.project.id;
    try {set({error: null}); const job = await editorApi.render(kind, get().frame, settings, get().snapshot?.project.revision); if(get().snapshot?.project.id === projectId) set({renderJob: job});}
    catch(error) {set({error: (error as Error).message});}
  },
}));

async function insertTimelineCopy(source: Clip, fps: number, start: number, trackId: string | null, action: string): Promise<boolean> {
  const state = useEditor.getState(); const project = state.snapshot?.project;
  if(!project || state.busy) return false;
  try {
    const clip = copyTimelineClip(project, source, createId(), start, trackId, fps);
    useEditor.setState({playing: false});
    const ok = await state.execute([{type: 'clip.add', clip}], `${action} ${source.name}`.slice(0, 180), project.revision);
    if(ok && useEditor.getState().snapshot?.project.id === project.id) {
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
    const switched = state.snapshot?.project.id !== previous.snapshot?.project.id;
    if(switched) useAnalysis.setState({assetId: '', searchId: null, roughcutId: null});
    if(state.selectedId !== previous.selectedId && state.snapshot) {const clip = state.snapshot.project.clips.find(c => c.id === state.selectedId); if(clip) useEditor.setState({selectedTrackId: clipTrackId(state.snapshot.project, clip)});}
    if(switched || state.frame !== previous.frame || state.selectedId !== previous.selectedId || state.selectedTrackId !== previous.selectedTrackId) {
      clearTimeout(contextTimer); contextTimer = setTimeout(() => {void editorApi.context(state.frame, state.selectedId, state.selectedTrackId, state.snapshot?.project.id).catch(() => undefined);}, 200);
    }
  });
  return () => {disconnect(); clearInterval(poll); clearTimeout(contextTimer); unsubscribe();};
}
