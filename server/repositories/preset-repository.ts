import {mkdir, readFile, rename, writeFile, unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {z} from 'zod';
import {presetSaveSchema, savedPresetSchema, type SavedPreset} from '../../shared/asset-presets';
import {legacyPresetStarters, presetStarters} from '../../shared/preset-starters';
const catalogSchema = z.object({
  revision: z.number().int().nonnegative(), presets: z.array(savedPresetSchema).max(500),
  // Legacy libraries already received the first seven recipes. Missing legacy IDs
  // represent a user's deletion, rather than an invitation to restore them.
  installedStarterIds: z.array(z.string()).default(() => legacyPresetStarters.map(preset => preset.id)),
});
export class PresetRepository extends EventEmitter {
  private catalog: z.infer<typeof catalogSchema> = {revision: 0, presets: [], installedStarterIds: []};
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private directory: string) {super();}
  async init() {
    await mkdir(this.directory, {recursive: true});
    try {this.catalog = catalogSchema.parse(JSON.parse(await readFile(path.join(this.directory, 'presets.json'), 'utf8')));}
    catch(error) {
      if((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Cannot read the asset library; preserved the original file. ${String(error)}`);
      const now = new Date().toISOString();
      await this.commit({revision: 0, presets: presetStarters.map(preset => ({...preset, version: 1, createdAt: now, updatedAt: now})), installedStarterIds: presetStarters.map(preset => preset.id)});
      return;
    }
    await this.installNewStarters();
  }
  private async installNewStarters() {
    const installed = new Set(this.catalog.installedStarterIds);
    const existing = new Set(this.catalog.presets.map(preset => preset.id));
    const now = new Date().toISOString();
    const additions: SavedPreset[] = [];
    for(const preset of presetStarters) {
      if(installed.has(preset.id)) continue;
      if(existing.has(preset.id)) installed.add(preset.id);
      else if(this.catalog.presets.length + additions.length < 500) {
        additions.push({...preset, version: 1, createdAt: now, updatedAt: now});
        installed.add(preset.id);
      }
    }
    if(installed.size === this.catalog.installedStarterIds.length && !additions.length) return;
    await this.commit({...this.catalog, revision: this.catalog.revision + 1, presets: [...this.catalog.presets, ...additions], installedStarterIds: [...installed]});
  }
  snapshot() {return structuredClone(this.catalog);}
  get(id: string): SavedPreset {const preset = this.catalog.presets.find(p => p.id === id); if(!preset) throw Object.assign(new Error('Preset not found'), {status: 404}); return structuredClone(preset);}
  private serial<T>(operation: () => Promise<T>): Promise<T> {const next = this.queue.then(operation); this.queue = next.catch(() => undefined); return next;}
  save(input: z.infer<typeof presetSaveSchema>) {
    return this.serial(async () => {
      const body = presetSaveSchema.parse(input); const id = body.id ?? `preset-${randomUUID()}`;
      const existing = this.catalog.presets.find(p => p.id === id);
      if((existing?.version ?? null) !== body.expectedVersion) throw Object.assign(new Error('Preset changed. Refresh before saving.'), {status: 409});
      const now = new Date().toISOString();
      const preset = savedPresetSchema.parse({id, version: (existing?.version ?? 0) + 1, definition: body.definition, createdAt: existing?.createdAt ?? now, updatedAt: now});
      await this.commit({...this.catalog, revision: this.catalog.revision + 1, presets: [...this.catalog.presets.filter(p => p.id !== id), preset]}); return structuredClone(preset);
    });
  }
  remove(id: string, version: number) {
    return this.serial(async () => {
      const preset = this.get(id); if(preset.version !== version) throw Object.assign(new Error('Preset changed. Refresh before deleting.'), {status: 409});
      await this.commit({...this.catalog, revision: this.catalog.revision + 1, presets: this.catalog.presets.filter(p => p.id !== id)});
      return {ok: true};
    });
  }
  private async commit(catalog: z.infer<typeof catalogSchema>) {
    const parsed = catalogSchema.parse(catalog); const temporary = path.join(this.directory, `presets-${randomUUID()}.tmp`);
    try {await writeFile(temporary, JSON.stringify(parsed)); await rename(temporary, path.join(this.directory, 'presets.json'));}
    finally {await unlink(temporary).catch(() => undefined);}
    this.catalog = parsed; this.emit('change', {revision: parsed.revision});
  }
}
