import type {PresetApplication, PresetDefinition, PresetValues, SavedPreset} from '../../shared/asset-presets';
import {presetPackageSchema} from '../../shared/asset-presets';
import type {RenderJob, Snapshot} from '../../shared/project';
import {request} from './editor-api';
import {subscribeWorkspace} from './workspace-events';
const base = '/api/asset-presets';
export const presetApi = {
  list: () => request<{revision: number; presets: SavedPreset[]}>(base),
  get: (id: string) => request<SavedPreset>(`${base}/${encodeURIComponent(id)}`),
  save: (definition: PresetDefinition, existing?: Pick<SavedPreset, 'id' | 'version'>) => request<SavedPreset>(`${base}/save`, {definition, id: existing?.id, expectedVersion: existing?.version ?? null}),
  remove: (preset: SavedPreset) => request(`${base}/${encodeURIComponent(preset.id)}/remove`, {version: preset.version}),
  apply: (input: PresetApplication) => request<Snapshot>(`${base}/apply`, input),
  preview: (preset: SavedPreset, values: PresetValues, duration: number) => request<RenderJob>(`${base}/preview`, {id: preset.id, version: preset.version, values, duration, kind: 'video'}),
  async import(file: File) {if(file.size > 2 * 1024 * 1024) throw new Error('Choose a preset package smaller than 2 MB.'); const data = presetPackageSchema.parse(JSON.parse(await file.text())); return presetApi.save(data.definition);},
  downloadUrl: (id: string) => `${base}/${encodeURIComponent(id)}/download`,
  thumbnailUrl: (preset: SavedPreset) => `${base}/${encodeURIComponent(preset.id)}/thumbnail.svg?v=${preset.version}`,
  subscribe(onChange: () => void, onError: () => void) {return subscribeWorkspace('presets', onChange, onError);},
};
