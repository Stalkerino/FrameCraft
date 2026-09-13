import {access, stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import type {z} from 'zod';
import type {MediaHealth, relinkMediaSchema} from '../../shared/project-care';
import {validateProject, type Activity} from '../../shared/project';
import type {ProjectRepository} from '../repositories/project-repository';
import type {MediaFileRepository} from '../repositories/media-file-repository';
import type {MediaService} from './media-service';

export class ProjectMediaService {
  constructor(private projects: ProjectRepository, private files: MediaFileRepository, private media: MediaService) {}
  async health(): Promise<MediaHealth> {
    const project = this.projects.snapshot().project;
    const media: MediaHealth['media'] = [];
    for(const asset of project.assets) {
      const entry: MediaHealth['media'][number] = {assetId: asset.id, name: asset.name, kind: asset.kind, src: asset.src, status: 'available'};
      try {entry.filePath = this.files.resolve(asset.src);} catch {entry.status = 'unsupported';}
      if(entry.filePath) try {const info = await stat(entry.filePath); await access(entry.filePath, constants.R_OK); entry.status = info.isFile() ? 'available' : 'unreadable'; entry.bytes = info.size;}
      catch(error) {entry.status = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable';}
      media.push(entry);
    }
    return {projectId: project.id, revision: project.revision, media};
  }
  async relink(input: z.infer<typeof relinkMediaSchema>, source: Activity['source']) {
    if(!path.isAbsolute(input.filePath)) throw new Error('Use an absolute replacement file path');
    const project = this.projects.snapshot().project;
    if(input.revision !== project.revision) throw Object.assign(new Error('Project changed. Refresh the media list.'), {status: 409});
    const asset = project.assets.find(a => a.id === input.assetId); if(!asset) throw new Error('Media no longer belongs to this project');
    const imported = await this.media.import(input.filePath, path.basename(input.filePath), project.id);
    const aliases = project.assets.filter(a => a.src === asset.src);
    const replacements = aliases.map(original => {
      if(original.kind !== imported.kind && !(original.kind === 'audio' && imported.kind === 'video' && imported.hasAudio)) throw new Error('Replacement must contain the same kind of media, including linked audio');
      return {...original, ...imported, id: original.id, name: original.name, kind: original.kind, previewSrc: imported.previewSrc, thumbnail: imported.thumbnail, demo: false,
        ...(original.kind === 'audio' ? {previewSrc: undefined, thumbnail: undefined, width: undefined, height: undefined, fps: undefined, videoCodec: undefined} : {})};
    });
    // Validate every existing cut against the replacement before publishing.
    validateProject({...project, assets: project.assets.map(a => replacements.find(r => r.id === a.id) ?? a)});
    return this.projects.replaceAssets(replacements, input.revision, project.id, source);
  }
}
