import {createHash, randomUUID} from 'node:crypto';
import {mkdir, rename, stat, unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {z} from 'zod';
import {soundApplySchema, soundPreviewSchema, type SoundPreview} from '../../shared/sound-presets';
import {clipSchema, type Activity, type Command} from '../../shared/project';
import {projectTracks, trackSchema} from '../../shared/tracks';
import type {ProjectRepository} from '../repositories/project-repository';
import {SoundRepository} from '../repositories/sound-repository';
import type {MediaService} from './media-service';
import {soundSampleRate, synthesizeSound} from './sound-synthesis-service';

export class SoundLibraryService {
  readonly library: SoundRepository;
  private pending = new Map<string, Promise<void>>();
  constructor(libraryDir: string, private media: MediaService, private projects: ProjectRepository) {this.library = new SoundRepository(path.join(libraryDir, 'sounds'));}
  async init() {await this.library.init(); await mkdir(path.join(this.library.directory, 'audio'), {recursive: true});}
  audioPath(filename: string) {
    if(!/^[a-f0-9]{64}\.wav$/.test(filename)) throw Object.assign(new Error('Sound preview not found'), {status: 404});
    return path.join(this.library.directory, 'audio', filename);
  }
  async preview(input: z.infer<typeof soundPreviewSchema>): Promise<SoundPreview> {
    const body = soundPreviewSchema.parse(input); const sound = this.library.get(body.id);
    if(sound.version !== body.version) throw Object.assign(new Error('Sound changed. Refresh before previewing.'), {status: 409});
    const hash = createHash('sha256').update(JSON.stringify({synthesis: 1, definition: sound.definition, values: body.values})).digest('hex');
    const filename = `${hash}.wav`; const file = this.audioPath(filename);
    let work = this.pending.get(hash);
    if(!work) {
      work = (async () => {
        try {await stat(file); return;} catch(error) {if((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;}
        const temporary = `${file}.${randomUUID()}.tmp`;
        try {await writeFile(temporary, synthesizeSound(sound.definition, body.values)); await rename(temporary, file);}
        finally {await unlink(temporary).catch(() => undefined);}
      })().finally(() => this.pending.delete(hash));
      this.pending.set(hash, work);
    }
    await work;
    return {src: `/api/sounds/audio/${filename}`, duration: Math.round((body.values.duration ?? sound.definition.duration) * soundSampleRate) / soundSampleRate};
  }
  async apply(input: z.infer<typeof soundApplySchema>, source: Activity['source']) {
    const body = soundApplySchema.parse(input); const project = this.projects.snapshot().project;
    if(project.revision !== body.revision) throw Object.assign(new Error('Project changed. Refresh before placing the sound.'), {status: 409});
    const sound = this.library.get(body.id); const tracks = projectTracks(project);
    let track = body.trackId ? tracks.find(item => item.id === body.trackId) : tracks.find(item => item.type === 'audio');
    if(body.trackId && (!track || track.type !== 'audio')) throw new Error('Choose an audio track for the sound');
    const preview = await this.preview({id: body.id, version: body.version, values: body.values});
    const available = Math.floor(preview.duration * project.fps);
    if(available < 1) throw new Error('Increase the sound duration to at least one project frame');
    const duration = body.durationFrames ?? available;
    if(duration > available) throw new Error('Sound trim exceeds its generated duration');
    const asset = await this.media.import(this.audioPath(preview.src.split('/').at(-1)!), `${sound.definition.name}.wav`, project.id);
    const commands: Command[] = [{type: 'asset.add', asset}];
    if(!track) {track = trackSchema.parse({id: `audio-${randomUUID()}`, type: 'audio', name: 'Sound effects'}); commands.push({type: 'track.add', track});}
    commands.push({type: 'clip.add', clip: clipSchema.parse({id: randomUUID(), name: sound.definition.name, kind: 'audio', assetId: asset.id, track: 'audio', trackId: track.id, start: body.frame, duration, volume: 1})});
    try {
      const active = this.projects.snapshot().project;
      if(active.id !== project.id || active.revision !== body.revision) throw Object.assign(new Error('Project changed while preparing the sound. Its audio was retained in the requesting project; retry placement.'), {status: 409});
      return await this.projects.execute(commands, body.revision, source, `Added ${sound.definition.name}`);
    }
    catch(error) {
      // A concurrent switch/edit must never place this sound into another project.
      // Retain the completed import in its requesting project, as ordinary imports do.
      await this.projects.addImportedAsset(asset, project.id, source).catch(() => undefined);
      throw error;
    }
  }
  /** Prepare shared library audio for a larger atomic timeline edit. The
   * caller owns revision validation, placement and the single undo batch. */
  async prepareAsset(projectId:string,input:z.infer<typeof soundPreviewSchema>) {
    const preview=await this.preview(input);const sound=this.library.get(input.id);
    return this.media.import(this.audioPath(preview.src.split('/').at(-1)!),`${sound.definition.name}.wav`,projectId);
  }
}
