import {useEffect, useState} from 'react';
import {audioEnvelopeSchema, type AudioEnvelope} from '../../shared/audio-envelope';
import type {AudioEffects} from '../../shared/audio-effects';
import type {Clip} from '../../shared/project';
import {audioApi} from '../services/audio-api';
import {editorApi} from '../services/editor-api';
import {useAudioJobs} from '../stores/audio-store';
import {useEditor} from '../stores/editor-store';

export function useAudioEditing(clip: Clip, projectId: string) {
  const key = `${projectId}:${clip.id}`;
  const job = useAudioJobs(state => state.jobs[key]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = job?.status === 'queued' || job?.status === 'processing';
  useEffect(() => {
    if(!job || !running) return;
    let disposed = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const latest = await audioApi.effectJob(job.id);
        if(disposed) return;
        setError(null);
        if(latest.status === 'done') {
          const snapshot = await editorApi.snapshot();
          if(!disposed && snapshot.project.id === projectId && useEditor.getState().snapshot?.project.id === projectId) useEditor.getState().accept(snapshot);
        }
        if(disposed) return;
        useAudioJobs.getState().remember(key, latest);
        if(latest.status !== 'queued' && latest.status !== 'processing') return;
      } catch(failure) {if(!disposed) setError(`Could not refresh audio processing: ${(failure as Error).message}`);}
      if(!disposed) timer = setTimeout(poll, 750);
    };
    void poll();
    return () => {disposed = true; clearTimeout(timer);};
  }, [job?.id, running, key, projectId]);

  const current = () => {
    const state = useEditor.getState(); const project = state.snapshot?.project;
    if(!project || project.id !== projectId || !project.clips.some(candidate => candidate.id === clip.id)) throw new Error('This clip is no longer in the active project.');
    return project;
  };
  const perform = async (operation: () => Promise<void>) => {
    if(pending) return;
    setPending(true); setError(null);
    try {await operation();} catch(failure) {setError((failure as Error).message);} finally {setPending(false);}
  };
  const saveEnvelope = async (envelope: AudioEnvelope | null) => perform(async () => {
    current();
    const value = envelope ? audioEnvelopeSchema.parse(envelope) : null;
    await useEditor.getState().updateClip(clip.id, {audioEnvelope: value}, value ? 'Updated audio fades and automation' : 'Reset audio envelope');
  });
  const applyDucking = async (triggerTrackId: string, gain: number, attackFrames: number, releaseFrames: number) => perform(async () => {
    const project = current();
    const snapshot = await audioApi.duck({revision: project.revision, targetClipIds: [clip.id], triggerTrackIds: [triggerTrackId], gain, attackFrames, releaseFrames});
    if(useEditor.getState().snapshot?.project.id === projectId) useEditor.getState().accept(snapshot);
  });
  const applyEffects = async (effects: AudioEffects) => perform(async () => {
    const project = current();
    useAudioJobs.getState().remember(key, await audioApi.applyEffects(project.revision, [clip.id], effects));
  });
  const cancelEffects = async () => perform(async () => {if(job) useAudioJobs.getState().remember(key, await audioApi.cancelEffects(job.id));});
  return {job, pending, running, error, saveEnvelope, applyDucking, applyEffects, cancelEffects};
}
