import {z} from 'zod';
import {soundDefinitionSchema, type SoundApplication, type SoundCatalog, type SoundDefinition, type SoundPreview, type SoundValues, type SavedSound} from '../../shared/sound-presets';
import type {Snapshot} from '../../shared/project';
import {request} from './editor-api';
import {subscribeWorkspace} from './workspace-events';
const base = '/api/sounds';
export const soundApi = {
  list: () => request<SoundCatalog>(base),
  save: (definition: SoundDefinition, existing?: Pick<SavedSound, 'id' | 'version'>) => request<SavedSound>(`${base}/save`, {definition, id: existing?.id, expectedVersion: existing?.version ?? null}),
  remove: (sound: SavedSound) => request(`${base}/${encodeURIComponent(sound.id)}/remove`, {version: sound.version}),
  preview: (sound: SavedSound, values: SoundValues) => request<SoundPreview>(`${base}/preview`, {id: sound.id, version: sound.version, values}),
  apply: (input: SoundApplication) => request<Snapshot>(`${base}/apply`, input),
  downloadUrl: (id: string) => `${base}/${encodeURIComponent(id)}/download`,
  async import(file: File) {
    if(file.size > 256 * 1024) throw new Error('Choose a sound recipe smaller than 256 KB');
    const recipe = z.object({format: z.literal('framecraft-sound'), version: z.literal(1), definition: soundDefinitionSchema}).strict().parse(JSON.parse(await file.text()));
    return soundApi.save(recipe.definition);
  },
  subscribe: (refresh: () => void, error: () => void) => subscribeWorkspace('sounds', refresh, error),
};
