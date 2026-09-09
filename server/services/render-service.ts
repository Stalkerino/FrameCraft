import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {durationOf, type Project, type RenderJob} from '../../shared/project';
import {defaultExportSettings, exportSettingsSchema, extensionFor, type ExportSettings} from '../../shared/media-settings';
import {baseUrl, dataDir, exportDir, rootDir} from '../config';
import type {RenderMessage, RenderProgress, RenderTask} from './render-engine';
import {createRenderWorkspace} from './render-workspace-service';

export class RenderService {
  jobs = new Map<string, RenderJob>();
  private queue = Promise.resolve();
  create(project: Project, kind: RenderJob['kind'], frame?: number, input?: ExportSettings) {
    if([...this.jobs.values()].filter(j => j.status === 'queued' || j.status === 'rendering').length >= 4) throw new Error('Render queue is full. Wait for an export to finish.');
    if(kind === 'frame' && (!Number.isInteger(frame) || frame! < 0 || frame! >= durationOf(project))) throw new Error('Frame is outside the project');
    const settings = kind === 'video' ? exportSettingsSchema.parse(input ?? defaultExportSettings(project)) : undefined;
    if(settings && (settings.startSeconds >= durationOf(project) / project.fps || (settings.endSeconds ?? 0) > durationOf(project) / project.fps + .000001)) throw new Error('Export range must be inside the timeline.');
    const job: RenderJob = {id: randomUUID(), kind, status: 'queued', progress: 0, frame, revision: project.revision, settings, filename: `framecraft-${kind === 'video' ? 'devlog.' + extensionFor(settings!.codec) : 'frame.png'}`};
    this.jobs.set(job.id, job);
    const snapshot = structuredClone(project);
    this.queue = this.queue.then(() => this.render(snapshot, job));
    return job;
  }
  private async render(project: Project, job: RenderJob) {
    let workspace: Awaited<ReturnType<typeof createRenderWorkspace>> | undefined;
    try {
      job.status = 'rendering'; job.phase = 'Starting renderer'; await mkdir(exportDir, {recursive: true});
      const scratch = path.resolve(process.env.FRAMECRAFT_RENDER_CACHE || path.join(dataDir, 'render-cache'));
      workspace = await createRenderWorkspace(scratch);
      const file = await this.runWorker({project, job, workspace: workspace.directory, root: rootDir, exports: exportDir, mediaBase: baseUrl}, workspace.temporary, update => {
        job.progress = Math.max(job.progress, Math.min(.99, update.progress)); job.phase = update.phase; job.detail = update.detail;
        if(update.encoder) job.encoder = update.encoder;
        if(update.warning) job.warning = update.warning;
      });
      job.status = 'done'; job.progress = 1; job.url = `/exports/${file}`;
    } catch(error) {job.status = 'error'; job.error = error instanceof Error ? error.message : String(error);}
    finally {
      // Delete only this worker's scratch files, never source media or exports.
      if(workspace) await workspace.dispose().catch(error => console.error('Could not remove render scratch files:', error.message));
    }
  }
  private runWorker(task: RenderTask, temporary: string, progress: (value: RenderProgress) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      // Set all OS variants in the child only; browser profiles, downloads and frames
      // must not exhaust a small Linux /tmp or change the editor's process environment.
      const child = spawn(process.execPath, ['--import', 'tsx', path.join(rootDir, 'server/render-worker.ts')], {cwd: rootDir, windowsHide: true,
        env: {...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary}, stdio: ['ignore', 'pipe', 'pipe', 'ipc']});
      let file: string | undefined; let failure: string | undefined; let log = '';
      let lastUpdate = ''; let phase = 'starting the render worker'; let detail = '';
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const stopWorker = (reason: string) => {
        if(child.connected) child.send({type: 'cancel', reason}, error => {if(error) child.kill();});
        else child.kill();
        killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
        killTimer.unref();
      };
      const stalled = () => {failure = `Render stopped while ${phase}: no progress for two minutes. ${detail}\n${log.trim()}`.trim(); stopWorker(failure);};
      let timer = setTimeout(stalled, 120000);
      const active = () => {clearTimeout(timer); timer = setTimeout(stalled, 120000);};
      const record = (chunk: Buffer) => {log = (log + chunk.toString()).slice(-6000);};
      child.stdout?.on('data', record); child.stderr?.on('data', record);
      child.on('message', (message: RenderMessage) => {
        if(message.type === 'ready') {active(); child.send!(task, error => {if(error) {failure = error.message; stopWorker(failure);}});}
        else if(message.type === 'progress') {
          const update = JSON.stringify(message);
          if(update !== lastUpdate) {lastUpdate = update; phase = message.phase; detail = message.detail ?? ''; active();}
          progress(message);
        }
        else if(message.type === 'done') {file = message.file; clearTimeout(timer);}
        else if(message.type === 'error') {failure = message.error; clearTimeout(timer);}
      });
      child.on('error', error => {clearTimeout(timer); clearTimeout(killTimer); reject(error);});
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        clearTimeout(killTimer);
        if(code === 0 && file && !failure) resolve(file);
        else reject(new Error(failure || `Render worker stopped (${signal || code}). ${log}`));
      });
    });
  }
}
