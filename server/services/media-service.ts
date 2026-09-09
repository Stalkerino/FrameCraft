import {copyFile, mkdir, rename, stat, unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import type {Asset} from '../../shared/project';
import {MediaFileRepository} from '../repositories/media-file-repository';
import {ffmpegPath, ffprobePath, runProcess} from './process-service';

const images = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const audio = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac']);
const video = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v']);
// Conservative common-browser support; HEVC and unusual pixel formats/containers need a proxy.
function directVideo(ext: string, visual: {codec_name?: string; pix_fmt?: string}, sound?: {codec_name?: string}) {
  if(['.mp4', '.m4v'].includes(ext)) return visual.codec_name === 'h264' && ['yuv420p', 'yuvj420p'].includes(visual.pix_fmt ?? '') && (!sound || ['aac', 'mp3'].includes(sound.codec_name ?? ''));
  return ext === '.webm' && ['vp8', 'vp9'].includes(visual.codec_name ?? '') && visual.pix_fmt === 'yuv420p' && (!sound || ['opus', 'vorbis'].includes(sound.codec_name ?? ''));
}
export class MediaService {
  constructor(private files: MediaFileRepository) {}
  async import(source: string, originalName: string, projectId: string, uploaded = false): Promise<Asset> {
    const ext = path.extname(originalName).toLowerCase();
    if(!images.has(ext) && !audio.has(ext) && !video.has(ext)) throw new Error('Supported: MP4, MOV, MKV, WebM, AVI, PNG, JPG, WebP, MP3, WAV, M4A, OGG, FLAC, AAC');
    const info = await stat(source); if(!info.isFile()) throw new Error('Choose a media file');
    const id = randomUUID(); const url = this.files.url(projectId, 'media', `${id}${ext}`); const target = this.files.resolve(url);
    const thumbnailUrl = this.files.url(projectId, 'thumbnails', `${id}.jpg`); const thumbnail = this.files.resolve(thumbnailUrl);
    await Promise.all([mkdir(path.dirname(target), {recursive: true}), mkdir(path.dirname(thumbnail), {recursive: true})]);
    try {
      const probe = JSON.parse(await runProcess(ffprobePath(), ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', source], 30_000));
      const visual = probe.streams?.find((stream: {codec_type: string}) => stream.codec_type === 'video');
      const sound = probe.streams?.find((stream: {codec_type: string}) => stream.codec_type === 'audio');
      const kind = images.has(ext) ? 'image' : audio.has(ext) ? 'audio' : 'video';
      if(kind === 'audio' ? !sound : !visual) throw new Error('File does not contain the expected media');
      const duration = kind === 'image' ? 6 : Number(probe.format.duration || visual?.duration || sound?.duration);
      if(!Number.isFinite(duration) || duration < 1 / 30) throw new Error('Could not determine media duration');
      const asset: Asset = {id, name: path.basename(originalName), kind, src: url, duration, width: visual?.width, height: visual?.height, videoCodec: kind === 'video' ? visual.codec_name : undefined};
      if(kind === 'video') {
        for(const rate of [visual?.avg_frame_rate, visual?.r_frame_rate]) {
          const [numerator, denominator = 1] = String(rate || '').split('/').map(Number);
          const fps = numerator / denominator;
          if(Number.isFinite(fps) && fps > 0) {asset.fps = fps; break;}
        }
      }
      if(kind !== 'audio') {
        // Decode just one frame. A thumbnail failure must not discard usable footage.
        try {
          await runProcess(ffmpegPath(), ['-y', '-threads', '2', '-i', source, '-frames:v', '1', '-an', '-vf', 'scale=480:-2', '-filter_threads', '1', '-threads', '1', thumbnail], 30_000);
          asset.thumbnail = thumbnailUrl;
        } catch {await unlink(thumbnail).catch(() => undefined);}
      }
      if(uploaded) await rename(source, target); // Uploads already live on the workspace filesystem.
      else await copyFile(source, target);
      if(kind === 'video' && !directVideo(ext, visual, sound)) asset.previewSrc = this.files.url(projectId, 'media', `${id}-preview.mp4`);
      return asset;
    } catch(error) {await Promise.all([unlink(target).catch(() => undefined), unlink(thumbnail).catch(() => undefined)]); throw error;}
  }
}
