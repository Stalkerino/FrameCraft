import type {RenderMessage, RenderTask} from './services/render-engine';
import {stopRunningProcesses} from './services/process-service';

let stopping = false;
let started = false;
const send = (message: RenderMessage) => {
  if(!stopping && process.connected) process.send?.(message, () => {});
};
const finish = async (message: RenderMessage | undefined, code: number, reason?: string) => {
  if(stopping) return;
  stopping = true;
  // The child processes get SIGTERM, then SIGKILL after one second. Bound the
  // worker too, in case Chromium/webpack or a broken IPC channel holds it open.
  const deadline = setTimeout(() => process.exit(code), 4000);
  deadline.unref();
  await stopRunningProcesses(new Error(reason ?? 'Render worker finished'));
  if(!message || !process.connected || !process.send) {process.exit(code); return;}
  process.send(message, () => process.exit(code));
};
process.on('SIGTERM', () => {void finish(undefined, 1, 'Render worker was stopped');});
process.on('disconnect', () => {void finish(undefined, 1, 'Editor disconnected');});
process.on('message', async (task: RenderTask | {type: 'cancel'; reason?: string}) => {
  // IPC cancellation also works on Windows, where child.kill() cannot deliver
  // a catchable SIGTERM to a Node process.
  if('type' in task && task.type === 'cancel') {
    await finish(undefined, 1, task.reason ?? 'Render was cancelled');
    return;
  }
  if(stopping || started || !('project' in task)) return;
  started = true;
  try {
    const {renderProject} = await import('./services/render-engine');
    if(stopping) return;
    const file = await renderProject(task, progress => send({type: 'progress', ...progress}));
    await finish({type: 'done', file}, 0);
  } catch(error) {
    await finish({type: 'error', error: error instanceof Error ? error.message : String(error)}, 1);
  }
});
send({type: 'ready'});
