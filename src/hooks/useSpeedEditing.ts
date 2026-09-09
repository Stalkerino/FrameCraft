import {useState} from 'react';
import {speedRecipeSchema, type SpeedRecipe} from '../../shared/speed-ramping';
import {speedApi} from '../services/speed-api';
import {beginSpeedEdit, resetSpeedEdit} from '../services/speed-actions';
import {useEditor} from '../stores/editor-store';
import {useSpeedJobs} from '../stores/speed-store';

export function useSpeedEditing(clipId: string, projectId: string) {
  const key = `${projectId}:${clipId}`; const job = useSpeedJobs(state => state.jobs[key]);
  const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null);
  const running = job?.status === 'queued' || job?.status === 'processing';
  const perform = async (action: () => Promise<void>) => {if(pending) return; setPending(true); setError(null); try {await action();} catch(reason) {setError((reason as Error).message);} finally {setPending(false);}};
  const revision = () => {const project = useEditor.getState().snapshot?.project; if(!project || project.id !== projectId) throw new Error('Open the requesting project before changing its clip speed.'); return project.revision;};
  return {job, pending, running, error,
    apply: (recipe: SpeedRecipe) => perform(async () => {await beginSpeedEdit(projectId, {revision: revision(), clipId, recipe: speedRecipeSchema.parse(recipe)});}),
    reset: () => perform(async () => {await resetSpeedEdit(projectId, revision(), clipId);}),
    cancel: () => perform(async () => {if(job) useSpeedJobs.getState().remember(key, await speedApi.cancel(job.id));}),
  };
}
