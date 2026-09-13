import {sourceLayers} from '../../shared/native-sequence-plan';
import type {NativeVisualLayer} from '../../shared/native-scene-plan';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {z} from 'zod';
import {durationOf, type Project} from '../../shared/project';
import {exportSettingsSchema} from '../../shared/media-settings';
import {requireNativeScenePlan} from '../../shared/native-scene-plan';
import type {NativePreviewScene} from '../../shared/native-preview';
import {mediaDir} from '../config';
import {MediaFileRepository} from '../repositories/media-file-repository';
import {prepareGpuArtwork} from './rendering/gpu-artwork-service';
import {prepareNativeImage} from './rendering/native-image-service';
import {vulkanSceneGraph} from './rendering/vulkan-scene-commands';
import {vulkanBatches} from './rendering/vulkan-batch-service';
import {mediaPreviewKey, previewQualities} from '../../shared/media-import';
import type {MediaPreviewService} from './media-preview-service';

export const nativePreviewRequest = z.object({revision: z.number().int().nonnegative(), frame: z.number().int().nonnegative(),
  width: z.number().int().min(64).max(8192).multipleOf(2), height: z.number().int().min(64).max(8192).multipleOf(2), vendor: z.enum(['amd', 'nvidia']),
  quality: z.enum(previewQualities).default('high'), mediaKey: z.string().max(100000).default('')});

/** Reuses export planning/shaders. One retained workspace, serialized preparation,
 * and one cached image upload source per imported still; no GPU probing here. */
export class NativePreviewService {
  private workspace?: Promise<string>;
  private images = new Map<string, Promise<string>>();
  private projectId?: string;
  private closed = false;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private previews?: Pick<MediaPreviewService, 'snapshot'>) {}
  scene(project: Project, request: unknown): Promise<NativePreviewScene> {
    const input = nativePreviewRequest.parse(request);
    const work = this.chain.then(async () => {
      if(this.closed) throw new Error('Native preview closed.');
      if(input.revision !== project.revision) throw Object.assign(new Error('Timeline changed; refresh native preview.'), {status: 409});
      if(input.frame >= durationOf(project)) throw new Error('Preview frame is outside the timeline.');
      if(this.projectId !== project.id) {await this.clear(); this.projectId = project.id;}
      const settings = exportSettingsSchema.parse({width: input.width, height: input.height, fps: project.fps, renderer: 'native-vulkan', encoder: input.vendor, audio: false, startSeconds: input.frame / project.fps});
      const plan = requireNativeScenePlan(project, settings);
      const span = plan.spans[0];
      const [batch] = vulkanBatches([span], settings); // Same admission and queue limits as export.
      const artwork = await prepareGpuArtwork({...plan, spans: [span]}, settings.fps);
      const files = new MediaFileRepository(mediaDir);
      const previews = input.quality === 'high' ? {} : this.previews?.snapshot(project.assets) ?? {};
      const inputs: NativePreviewScene['inputs'] = []; const sourceInputs = new Map<NativeVisualLayer, string>();
      for(const layer of sourceLayers(span)) {
        sourceInputs.set(layer, `in${inputs.length}`);
        if(layer.artwork || layer.textClip) continue;
        let file = files.resolve(layer.asset.src);
        let width = layer.asset.width!; let height = layer.asset.height!;
        const image = layer.asset.kind === 'image';
        const proxy = previews[mediaPreviewKey(layer.asset.id, input.quality)];
        if(!image && proxy?.status === 'ready' && proxy.src && proxy.width && proxy.height) {
          file = files.resolve(proxy.src); width = proxy.width; height = proxy.height;
          // Static placement crops use source pixels; animated shaders use the
          // original geometry and normalized texture coordinates instead.
          if(!layer.animation) {
            const source = layer.placement.source;
            layer.placement = {...layer.placement, source: {x: source.x * width / layer.asset.width!, y: source.y * height / layer.asset.height!,
              width: source.width * width / layer.asset.width!, height: source.height * height / layer.asset.height!}};
          }
        }
        if(image) {
          const key = `${file}/${layer.asset.width}/${layer.asset.height}`;
          if(!this.images.has(key)) {
            this.workspace ??= mkdtemp(path.join(os.tmpdir(), 'framecraft-native-preview-'));
            const index = this.images.size;
            this.images.set(key, this.workspace.then(directory => prepareNativeImage(file, layer.asset, directory, index)));
          }
          file = await this.images.get(key)!;
        }
        inputs.push({file, image, sourceStart: layer.sourceStart / settings.fps, width, height});
      }
      return {projectId: project.id, revision: project.revision, quality: input.quality, mediaKey: input.mediaKey, start: span.start, duration: span.duration, fps: settings.fps, width: settings.width, height: settings.height, bufferedFrames: batch.bufferedFrames, inputs,
        graph: vulkanSceneGraph(span, settings, plan.background, {prefix: 'preview_', inputs: [], sourceInputs, preparedImages: false, output: 'video', outputFormat: 'rgba', artwork})};
    });
    this.chain = work.catch(() => undefined); return work;
  }
  private async clear() {if(this.workspace) await rm(await this.workspace, {recursive: true, force: true}); this.workspace = undefined; this.images.clear();}
  close() {this.closed = true; void this.chain.then(() => this.clear());}
}
