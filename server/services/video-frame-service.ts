import path from 'node:path';
import {access, mkdir} from 'node:fs/promises';
import type {Asset} from '../../shared/project';
import type {VisualMetric} from '../../shared/visual-rush';
import {ffmpegPath, runProcess} from './process-service';
import type {Progress} from './inference-service';
import {MediaFileRepository} from '../repositories/media-file-repository';

export class VideoFrameService {
  private files: MediaFileRepository;
  constructor(media: string) {this.files = new MediaFileRepository(media);}
  async metrics(asset: Asset, signal: AbortSignal, progress: Progress) {
    const interval = Math.max(.5, asset.duration / 7200); const size = 64 * 36; let pending = Buffer.alloc(0); let previous: Buffer | undefined; const samples: VisualMetric[] = [];
    await runProcess(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-i', await this.files.playableSource(asset), '-an', '-vf', `fps=1/${interval}:start_time=0,scale=64:36,format=gray`, '-f', 'rawvideo', '-'], 2 * 60 * 60_000, {signal, onOutput: chunk => {
      pending = Buffer.concat([pending, chunk]);
      while(pending.length >= size) {
        const frame = Buffer.from(pending.subarray(0, size)); pending = pending.subarray(size); let difference = 0; let sum = 0;
        for(let i = 0; i < size; i++) {sum += frame[i]; if(previous) difference += Math.abs(frame[i] - previous[i]);}
        const time = samples.length * interval;
        if(time < asset.duration) samples.push({time, motion: difference / (size * 255), brightness: sum / (size * 255)});
        previous = frame; progress(Math.min(.7, time / asset.duration * .7), `Scanning video · ${Math.min(100, Math.floor(time / asset.duration * 100))}%`);
      }
    }});
    return {samples, interval};
  }
  async frame(asset: Asset, time: number, file: string, signal?: AbortSignal, width = 320) {
    const height = width * 9 / 16;
    await runProcess(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(time), '-i', await this.files.playableSource(asset), '-frames:v', '1', '-an', '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`, '-q:v', '3', file], 60000, {signal});
    await access(file);
  }
  async sheet(asset: Asset, times: number[], directory: string, signal?: AbortSignal) {
    await mkdir(directory, {recursive: true});
    for(let i = 0; i < times.length; i++) await this.frame(asset, times[i], path.join(directory, `${String(i).padStart(2, '0')}.jpg`), signal);
    const file = path.join(directory, 'sheet.jpg');
    await runProcess(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '1', '-start_number', '0', '-i', path.join(directory, '%02d.jpg'), '-vf', `tile=4x${Math.ceil(times.length / 4)}:nb_frames=${times.length}:padding=3:margin=3:color=black`, '-frames:v', '1', '-q:v', '3', file], 60000, {signal});
    return file;
  }
}
