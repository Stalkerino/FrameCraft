import {create} from 'zustand';
import type {SavedPreset} from '../../shared/asset-presets';
import {presetApi} from '../services/preset-api';
interface PresetState {presets: SavedPreset[]; revision: number; loaded: boolean; error: string | null; refresh: () => Promise<void>}
export const usePresets = create<PresetState>((set) => ({
  presets: [], revision: -1, loaded: false, error: null,
  refresh: async () => {try {const catalog = await presetApi.list(); set(state => catalog.revision >= state.revision ? {...catalog, loaded: true, error: null} : state);} catch(error) {set({error: (error as Error).message});}},
}));
export function connectPresets() {return presetApi.subscribe(() => {void usePresets.getState().refresh();}, () => usePresets.setState({error: 'Asset library unavailable. Reconnecting…'}));}
