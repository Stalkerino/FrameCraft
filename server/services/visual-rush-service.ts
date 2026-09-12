import {randomUUID} from 'node:crypto';
import {access, mkdir, rm} from 'node:fs/promises';
import path from 'node:path';
import type {z} from 'zod';
import type {Project} from '../../shared/project';
import {validateVideoCutRanges} from '../../shared/video-cut-validation';
import {cachedInspection, inspectionCacheKey, inspectionTimes, sourceTimecode, summarizeVisuals, type saveVideoCutSchema, type VideoCut, type VideoInspection, type VideoSheet, type VisualReport} from '../../shared/visual-rush';
import {VisualRushRepository} from '../repositories/visual-rush-repository';
import {VideoFrameService} from './video-frame-service';
import type {Progress} from './inference-service';

export class VisualRushService {
  readonly repository: VisualRushRepository;
  private frames: VideoFrameService;
  private queue: Promise<unknown> = Promise.resolve();
  private inspected = new Map<string, Set<number>>();
  constructor(options: {data: string; media: string}) {this.repository = new VisualRushRepository(path.join(options.data, 'visual-rush')); this.frames = new VideoFrameService(options.media);}
  private source(project: Project, assetId: string) {const asset = project.assets.find(a => a.id === assetId && a.kind === 'video'); if(!asset) throw new Error('Choose an imported video'); return asset;}
  private async viewed(report: VisualReport) {
    let viewed = this.inspected.get(report.id); if(viewed) return viewed;
    viewed = new Set<number>();
    for(const key of await this.repository.completedInspections(report.id)) {
      const input = cachedInspection(report.id, key); if(!input) continue;
      try {for(const time of inspectionTimes(report, input)) viewed.add(time);} catch { /* Ignore obsolete/out-of-range cache entries. */ }
    }
    this.inspected.set(report.id, viewed); return viewed;
  }
  async scan(project: Project, assetId: string, refresh: boolean, signal: AbortSignal, progress: Progress) {
    const asset = this.source(project, assetId);
    if(!refresh) {const cached = (await this.repository.reports([assetId]))[0]; if(cached) return cached;}
    const {samples, interval} = await this.frames.metrics(asset, signal, progress); signal.throwIfAborted();
    const report: VisualReport = {version: 1, id: randomUUID(), assetId, assetName: asset.name, duration: asset.duration, sampleInterval: interval, createdAt: new Date().toISOString(), ...summarizeVisuals(samples, asset.duration)};
    progress(.9, 'Saving the visual map'); await this.repository.saveReport(report); return report;
  }
  inspect(project: Project, input: VideoInspection) {
    const task = this.queue.then(async (): Promise<VideoSheet> => {
      const report = await this.repository.report(input.reportId); const asset = this.source(project, report.assetId);
      const times = inspectionTimes(report, input); const key = inspectionCacheKey(input);
      const directory = path.join(this.repository.directory, 'images', report.id, key); const file = path.join(directory, 'sheet.jpg');
      try {await access(file);} catch {
        await mkdir(directory, {recursive: true});
        try {if(input.time !== undefined) await this.frames.frame(asset, input.time, file, undefined, 1280); else await this.frames.sheet(asset, times, directory);} catch(error) {await rm(directory, {recursive: true, force: true}); throw error;}
      }
      const viewed = await this.viewed(report); for(const time of times) viewed.add(time);
      return {url: `/visual-rush/images/${report.id}/${key}/sheet.jpg`, reportId: report.id, columns: input.time === undefined ? 4 : 1, frames: times.map((time, index) => ({index: index + 1, time, timecode: sourceTimecode(time)}))};
    }); this.queue = task.catch(() => undefined); return task;
  }
  save(project: Project, input: z.infer<typeof saveVideoCutSchema>) {
    const task = this.queue.then(async () => {
      if(project.revision !== input.revision) throw Object.assign(new Error('Project changed. Reread it before saving the cut.'), {status: 409});
      const report = await this.repository.report(input.reportId); const asset = this.source(project, report.assetId);
      const existing = input.id ? await this.repository.cut(input.id) : null;
      if(existing && (existing.projectId !== project.id || existing.assetId !== asset.id)) throw new Error('This proposal belongs to another project or source');
      if((existing?.version ?? null) !== input.expectedVersion) throw Object.assign(new Error('The proposal changed. Refresh it before saving.'), {status: 409});
      if(new Set(input.shots.map(shot => shot.id)).size !== input.shots.length) throw new Error('Each proposed shot needs a unique ID');
      validateVideoCutRanges(input.shots, asset.duration, [...await this.viewed(report)]);
      const proposal: VideoCut = {id: input.id ?? randomUUID(), version: (existing?.version ?? 0) + 1, projectId: project.id, assetId: asset.id, reportId: report.id, title: input.title, goal: input.goal, shots: input.shots, createdAt: new Date().toISOString()};
      await this.repository.saveCut(proposal); return proposal;
    }); this.queue = task.catch(() => undefined); return task;
  }
}
