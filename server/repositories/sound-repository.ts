import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {savedSoundSchema, soundSaveSchema, soundStarters, type SavedSound} from '../../shared/sound-presets';

const catalogSchema = z.object({revision: z.number().int().nonnegative(), sounds: z.array(savedSoundSchema), installedStarterIds: z.array(z.string())});
export class SoundRepository extends EventEmitter {
  private catalog: z.infer<typeof catalogSchema> = {revision: 0, sounds: [], installedStarterIds: []};
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string) {super();}
  async init() {
    await mkdir(this.directory, {recursive: true});
    try {this.catalog = catalogSchema.parse(JSON.parse(await readFile(path.join(this.directory, 'catalog.json'), 'utf8')));}
    catch(error) {if((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Cannot read sound library; preserved original file. ${String(error)}`);}
    const installed = new Set(this.catalog.installedStarterIds); const existing = new Set(this.catalog.sounds.map(sound => sound.id));
    const now = new Date().toISOString(); const additions: SavedSound[] = [];
    for(const starter of soundStarters) if(!installed.has(starter.id)) {installed.add(starter.id); if(!existing.has(starter.id)) additions.push({...starter, version: 1, createdAt: now, updatedAt: now});}
    if(installed.size !== this.catalog.installedStarterIds.length) await this.commit({...this.catalog, revision: this.catalog.revision + 1, sounds: [...this.catalog.sounds, ...additions], installedStarterIds: [...installed]});
  }
  snapshot() {return structuredClone({revision: this.catalog.revision, sounds: this.catalog.sounds});}
  get(id: string) {const sound = this.catalog.sounds.find(item => item.id === id); if(!sound) throw Object.assign(new Error('Sound not found'), {status: 404}); return structuredClone(sound);}
  private serial<T>(operation: () => Promise<T>) {const next = this.queue.then(operation); this.queue = next.catch(() => undefined); return next;}
  save(input: z.infer<typeof soundSaveSchema>) {
    return this.serial(async () => {
      const body = soundSaveSchema.parse(input); const id = body.id ?? `sound-${randomUUID()}`; const existing = this.catalog.sounds.find(item => item.id === id);
      if((existing?.version ?? null) !== body.expectedVersion) throw Object.assign(new Error('Sound changed. Refresh before saving.'), {status: 409});
      const now = new Date().toISOString(); const sound = savedSoundSchema.parse({id, version: (existing?.version ?? 0) + 1, definition: body.definition, createdAt: existing?.createdAt ?? now, updatedAt: now});
      await this.commit({...this.catalog, revision: this.catalog.revision + 1, sounds: [...this.catalog.sounds.filter(item => item.id !== id), sound]}); return sound;
    });
  }
  remove(id: string, version: number) {
    return this.serial(async () => {const sound = this.get(id); if(sound.version !== version) throw Object.assign(new Error('Sound changed. Refresh before deleting.'), {status: 409}); await this.commit({...this.catalog, revision: this.catalog.revision + 1, sounds: this.catalog.sounds.filter(item => item.id !== id)}); return {ok: true};});
  }
  private async commit(input: z.infer<typeof catalogSchema>) {
    const catalog = catalogSchema.parse(input); const temporary = path.join(this.directory, `catalog-${randomUUID()}.tmp`);
    try {await writeFile(temporary, JSON.stringify(catalog)); await rename(temporary, path.join(this.directory, 'catalog.json'));}
    finally {await unlink(temporary).catch(() => undefined);}
    this.catalog = catalog; this.emit('change', {revision: catalog.revision});
  }
}
