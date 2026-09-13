import {RenderMediaAccess} from './render-media-access';
import {activeSequenceId, activeSequenceName, projectForSequence} from '../../shared/project-sequences';
import {spawn} from 'node:child_process';
import {mkdir, unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {durationOf, type Project, type RenderJob} from '../../shared/project';
import {defaultExportSettings, exportSettingsSchema, extensionFor, type ExportSettings} from '../../shared/media-settings';
import {baseUrl, dataDir, exportDir, rootDir} from '../config';
import type {RenderMessage, RenderProgress, RenderTask} from './render-engine';
import {createRenderWorkspace} from './render-workspace-service';
import {requireNativeGpuPlan} from '../../shared/native-gpu-plan';
import {gpuDisabled} from './rendering/gpu-policy';
import {requireNativeScenePlan} from '../../shared/native-scene-plan';
import {resolveRenderOutput} from './render-output-service';
import {defaultExportPath, publishExport, requireUnusedExport, validateExportPath} from './export-destination-service';

export class RenderService {
  readonly mediaAccess = new RenderMediaAccess();
  jobs = new Map<string, RenderJob>();
  output(id: string) {return resolveRenderOutput(this.jobs.get(id), exportDir);}
  private queue = Promise.resolve();
  private closed = false;
  private workers = new Set<() => void>();
  close() {this.closed = true; for(const stop of this.workers) stop();}
  create(project: Project, kind: RenderJob['kind'], frame?: number, input?: ExportSettings, outputPath?: string) {
    if(this.closed) throw new Error('The renderer is shutting down.');
    if([...this.jobs.values()].filter(j => j.status === 'queued' || j.status === 'rendering').length >= 4) throw new Error('Render queue is full. Wait for an export to finish.');
    if(kind === 'frame' && (!Number.isInteger(frame) || frame! < 0 || frame! >= durationOf(project))) throw new Error('Frame is outside the project');
    const settings = kind === 'video' ? exportSettingsSchema.parse(input ?? defaultExportSettings(project)) : undefined;
    if(settings && (settings.startSeconds >= durationOf(project) / project.fps || (settings.endSeconds ?? 0) > durationOf(project) / project.fps + .000001)) throw new Error('Export range must be inside the timeline.');
    if(settings && settings.renderer !== 'compatible') {
      if(settings.renderer === 'native-vulkan') requireNativeScenePlan(project, settings);
      else requireNativeGpuPlan(project, settings);
      if(gpuDisabled()) throw new Error('GPU use is disabled in this process (FRAMECRAFT_DISABLE_GPU=1).');
    }
    const job: RenderJob = {id: randomUUID(), sequenceId: activeSequenceId(project), sequenceName: activeSequenceName(project), kind, status: 'queued', progress: 0, frame, revision: project.revision, settings, filename: `framecraft-${kind === 'video' ? 'devlog.' + extensionFor(settings!.codec) : 'frame.png'}`};
    if(kind === 'video') {
      job.outputPath = validateExportPath(outputPath || defaultExportPath(dataDir, project, extensionFor(settings!.codec)), extensionFor(settings!.codec));
      job.filename = path.basename(job.outputPath);
    }
    this.jobs.set(job.id, job);
    const snapshot = projectForSequence(project);
    const access = !settings || settings.renderer === 'compatible' ? this.mediaAccess.prepare(snapshot) : undefined;
    this.queue = this.queue.then(() => this.render(access?.project ?? snapshot, job)).finally(() => access?.release());
    return job;
  }
  private async render(project: Project, job: RenderJob) {
    let workspace: Awaited<ReturnType<typeof createRenderWorkspace>> | undefined;
    const destination = job.outputPath ? path.dirname(job.outputPath) : exportDir;
    const staged = path.join(destination, `${job.id}.${job.settings ? extensionFor(job.settings.codec) : 'png'}`);
    try {
      if(this.closed) throw new Error('The renderer is shutting down.');
      job.status = 'rendering'; job.phase = 'Starting renderer';
      if(job.outputPath) await requireUnusedExport(job.outputPath);
      await mkdir(destination, {recursive: true});
      const scratch = path.resolve(process.env.FRAMECRAFT_RENDER_CACHE || path.join(dataDir, 'render-cache'));
      workspace = await createRenderWorkspace(scratch);
      const file = await this.runWorker({project, job, workspace: workspace.directory, root: rootDir, exports: destination, mediaBase: baseUrl}, workspace.temporary, update => {
        job.progress = Math.max(job.progress, Math.min(.99, update.progress)); job.phase = update.phase; job.detail = update.detail;
        if(update.encoder) job.encoder = update.encoder;
        if(update.warning) job.warning = update.warning;
      });
      if(job.outputPath) await publishExport(staged, job.outputPath);
      job.status = 'done'; job.progress = 1; job.url = job.outputPath ? `/api/render/${job.id}/file` : `/exports/${file}`;
    } catch(error) {job.status = 'error'; job.error = error instanceof Error ? error.message : String(error);}
    finally {
      // Delete only this worker's scratch files, never source media or exports.
      if(workspace) await workspace.dispose().catch(error => console.error('Could not remove render scratch files:', error.message));
      if(workspace && job.outputPath) await unlink(staged).catch(() => undefined);
    }
  }
  private runWorker(task: RenderTask, temporary: string, progress: (value: RenderProgress) => void): Promise<string> {
    if(this.closed) return Promise.reject(new Error('The renderer is shutting down.'));
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
      const shutdown = () => {failure = 'The editor is closing.'; stopWorker(failure);};
      this.workers.add(shutdown);
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
      child.on('error', error => {this.workers.delete(shutdown); clearTimeout(timer); clearTimeout(killTimer); reject(error);});
      child.on('close', (code, signal) => {
        this.workers.delete(shutdown);
        clearTimeout(timer);
        clearTimeout(killTimer);
        if(code === 0 && file && !failure) resolve(file);
        else reject(new Error(failure || `Render worker stopped (${signal || code}). ${log}`));
      });
    });
  }
}
