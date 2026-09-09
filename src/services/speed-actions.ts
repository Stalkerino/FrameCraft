import type {z} from 'zod';
import type {applySpeedSchema} from '../../shared/speed-ramping';
import {useEditor} from '../stores/editor-store';
import {useSpeedJobs} from '../stores/speed-store';
import {speedApi} from './speed-api';
import {editorApi} from './editor-api';
import type {SpeedJob} from '../../shared/speed-ramping';

const watched = new Set<string>();
function watchJob(projectId: string, clipId: string, job: SpeedJob) {
  const key = `${projectId}:${clipId}`; useSpeedJobs.getState().remember(key, job);
  if(watched.has(job.id) || (job.status !== 'queued' && job.status !== 'processing')) return;
  watched.add(job.id);
  const poll = async () => {
    try {
      const latest = await speedApi.job(job.id);
      if(useSpeedJobs.getState().jobs[key]?.id !== job.id) {watched.delete(job.id); return;}
      useSpeedJobs.getState().remember(key, latest);
      if(latest.status === 'done') {
        watched.delete(job.id);
        const snapshot = await editorApi.snapshot();
        if(snapshot.project.id === projectId && useEditor.getState().snapshot?.project.id === projectId) useEditor.getState().accept(snapshot);
        return;
      }
      if(latest.status !== 'queued' && latest.status !== 'processing') {watched.delete(job.id); return;}
    } catch(reason) {
      if((reason as {status?: number}).status === 404) {useSpeedJobs.getState().remember(key, {...job, status: 'error', error: 'Speed job is no longer available. The service may have restarted.'}); watched.delete(job.id); return;}
    }
    setTimeout(() => void poll(), 750);
  };
  setTimeout(() => void poll(), 150);
}

function activeClip(projectId: string, revision: number, clipId: string) {
  const project = useEditor.getState().snapshot?.project;
  if(!project || project.id !== projectId || project.revision !== revision || !project.clips.some(clip => clip.id === clipId)) throw new Error('Project changed. Retry the speed edit on the current clip.');
  const job = useSpeedJobs.getState().jobs[`${projectId}:${clipId}`];
  if(job?.status === 'queued' || job?.status === 'processing') throw new Error('A speed change is already running for this clip.');
}
export async function beginSpeedEdit(projectId: string, input: z.input<typeof applySpeedSchema>) {
  activeClip(projectId, input.revision, input.clipId);
  const job = await speedApi.apply(input); watchJob(projectId, input.clipId, job); return job;
}
export async function resetSpeedEdit(projectId: string, revision: number, clipId: string) {
  activeClip(projectId, revision, clipId);
  const job = await speedApi.reset({revision, clipId}); watchJob(projectId, clipId, job); return job;
}
