import {randomUUID} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {PresetArtwork} from '../../src/video/assets/PresetArtwork';
import type {z} from 'zod';
import type {presetPreviewSchema, PresetApplication} from '../../shared/asset-presets';
import {presetCommands, presetPreviewProject} from '../../shared/preset-project';
import type {Activity} from '../../shared/project';
import type {PresetRepository} from '../repositories/preset-repository';
import type {ProjectRepository} from '../repositories/project-repository';
import type {RenderService} from './render-service';
export class PresetService {
  constructor(readonly library: PresetRepository, private projects: ProjectRepository, private renders: RenderService) {}
  thumbnail(id: string) {const preset = this.library.get(id); return renderToStaticMarkup(createElement(PresetArtwork, {definition: preset.definition, values: {}, progress: .45, width: 640, height: 360}));}
  apply(input: PresetApplication, source: Activity['source']) {
    const preset = this.library.get(input.id);
    const commands = presetCommands(this.projects.snapshot().project, preset, input, randomUUID());
    return this.projects.execute(commands, input.revision, source, `Applied ${preset.definition.name}`);
  }
  preview(input: z.infer<typeof presetPreviewSchema>) {
    const preset = this.library.get(input.id);
    if(preset.version !== input.version) throw Object.assign(new Error('Preset changed. Refresh before previewing.'), {status: 409});
    const preview = presetPreviewProject(preset, input.values, input.duration);
    return this.renders.create(preview.project, input.kind, preview.start + Math.round(input.progress * (preview.frames - 1)));
  }
}
