import {access} from 'node:fs/promises';
import path from 'node:path';
import {projectStorageKey} from './project-storage';

/** Stable, confined URLs for project files and legacy workspace media. */
export class MediaFileRepository {
  constructor(private legacyMedia: string, private projects = path.join(path.dirname(legacyMedia), 'projects')) {}
  url(projectId: string, folder: 'media' | 'thumbnails', filename: string) {return `/project-media/${projectStorageKey(projectId)}/${folder}/${filename}`;}
  resolve(url: string): string {
    const legacy = /^\/media\/([a-zA-Z0-9][a-zA-Z0-9._-]*)$/.exec(url);
    if(legacy) return path.join(this.legacyMedia, legacy[1]);
    const project = /^\/project-media\/([a-f0-9]{64})\/(media|thumbnails)\/([a-zA-Z0-9][a-zA-Z0-9._-]*)$/.exec(url);
    if(project) return path.join(this.projects, project[1], project[2], project[3]);
    throw new Error('Choose a locally imported media file');
  }
  async playableSource(asset: {src: string; previewSrc?: string}) {
    if(asset.previewSrc) {
      const preview = this.resolve(asset.previewSrc);
      try {await access(preview); return preview;} catch { /* Analysis can use the original while a proxy is pending. */ }
    }
    return this.resolve(asset.src);
  }
}
