import {randomUUID} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildPremiereXml, interchangeRate, timelineExportSchema, type InterchangeMedia, type TimelineExportRequest, type TimelineExportResult} from '../../shared/timeline-interchange';
import type {ProjectRepository} from '../repositories/project-repository';
import type {MediaFileRepository} from '../repositories/media-file-repository';
import {ffprobePath, runProcess} from './process-service';

export function interchangeFileUrl(source: string, filename: string, mediaRoot?: string) {
  if(!mediaRoot) return pathToFileURL(source).href;
  const windows = path.win32.isAbsolute(mediaRoot) && !mediaRoot.startsWith('/');
  if(!windows && !path.posix.isAbsolute(mediaRoot)) throw new Error('Media folder must be an absolute Windows or Linux path, such as D:\\Framecraft\\media or /home/me/media.');
  return pathToFileURL((windows ? path.win32 : path.posix).join(mediaRoot, filename), {windows}).href;
}

export class TimelineExportService {
  private metadata = new Map<string, Promise<{fps?: number; audioChannels: number; sampleRate: number; width?: number; height?: number; variableRate: boolean}>>();
  constructor(private projects: ProjectRepository, private files: MediaFileRepository, private exports: string) {}
  async create(input: TimelineExportRequest): Promise<TimelineExportResult> {
    const body = timelineExportSchema.parse(input); const project = this.projects.snapshot().project;
    if(body.revision !== project.revision) throw Object.assign(new Error('The timeline changed. Reopen Export timeline to export the current edit.'), {status: 409});
    interchangeRate(project.fps);
    const used = new Set(project.clips.map(clip => clip.assetId).filter(Boolean)); const media: InterchangeMedia[] = []; const variable: string[] = [];
    // Probe each unique source sequentially, with an immutable-media cache. No video decoding/encoding.
    for(const asset of project.assets.filter(asset => used.has(asset.id))) {
      if(asset.kind === 'image' && !/\.(png|jpe?g|webp)$/i.test(asset.src)) continue;
      const source = this.files.resolve(asset.src); const filename = path.basename(source);
      let details = {fps: asset.kind === 'video' ? asset.fps : project.fps, width: asset.width, height: asset.height, audioChannels: 0, sampleRate: 48000, variableRate: false};
      if(asset.kind !== 'image') {
        let cached = this.metadata.get(source);
        if(!cached) {
          cached = runProcess(ffprobePath(), ['-v', 'error', '-show_streams', '-of', 'json', source], 30000).then(output => {
            const streams = JSON.parse(output).streams as {codec_type: string; channels?: number; sample_rate?: string; width?: number; height?: number; r_frame_rate?: string; avg_frame_rate?: string}[];
            const video = streams.find(stream => stream.codec_type === 'video'); const audio = streams.find(stream => stream.codec_type === 'audio');
            const rate = (value?: string) => {const [n, d = 1] = (value ?? '').split('/').map(Number); return n / d;};
            const nominal = rate(video?.r_frame_rate); const average = rate(video?.avg_frame_rate);
            return {fps: Number.isFinite(nominal) && nominal > 0 ? nominal : Number.isFinite(average) && average > 0 ? average : undefined, width: video?.width, height: video?.height,
              audioChannels: audio?.channels ?? 0, sampleRate: Number(audio?.sample_rate) || 48000, variableRate: !!video && Number.isFinite(average) && Math.abs(nominal - average) > .01};
          });
          this.metadata.set(source, cached); void cached.catch(() => this.metadata.delete(source));
        }
        try {details = {...details, ...await cached};} catch(error) {throw new Error(`Cannot inspect ${asset.name} for timeline export: ${(error as Error).message}`);}
      }
      const fps = asset.kind === 'video' ? details.fps ?? project.fps : project.fps;
      try {interchangeRate(fps);} catch {throw new Error(`${asset.name} uses ${fps} fps, which this XML format cannot represent. Conform this source to a standard frame rate before timeline export.`);}
      if(details.variableRate) variable.push(asset.name);
      media.push({assetId: asset.id, name: asset.name, filename, src: asset.src, pathurl: interchangeFileUrl(source, filename, body.mediaRoot || undefined), fps, duration: asset.duration, width: details.width, height: details.height, audioChannels: details.audioChannels, sampleRate: details.sampleRate});
    }
    const {xml, report} = buildPremiereXml(project, media);
    for(const name of variable) report.warnings.push({name, message: 'Source reports varying/unequal average and nominal frame rates. Review source trim alignment after import; conform variable-rate footage if needed.'});
    const id = `timeline-${randomUUID()}`; const directory = path.join(this.exports, id); await mkdir(directory, {recursive: true});
    // These immutable artifacts describe the captured revision, even if editing continues during export.
    await Promise.all([writeFile(path.join(directory, 'timeline.xml'), xml), writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2)), writeFile(path.join(directory, 'framecraft-project.json'), JSON.stringify(project, null, 2))]);
    const name = project.name.normalize('NFKC').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'framecraft';
    return {report, filename: `${name}.xml`, xmlUrl: `/exports/${id}/timeline.xml`, reportUrl: `/exports/${id}/report.json`, projectUrl: `/exports/${id}/framecraft-project.json`};
  }
}
