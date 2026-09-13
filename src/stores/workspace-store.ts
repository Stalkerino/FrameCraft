import {create} from 'zustand';

interface LayoutPreferences {
  preset: 'edit' | 'custom';
  libraryWidth: number; inspectorWidth: number; timelineHeight: number;
  showLibrary: boolean; showInspector: boolean; snapping: boolean; followPlayhead: boolean;
}
const storageKey = 'framecraft.workspace.v1';
const defaults: LayoutPreferences = {preset: 'edit', libraryWidth: 320, inspectorWidth: 320, timelineHeight: 270, showLibrary: true, showInspector: true, snapping: true, followPlayhead: true};
function savedLayout(): LayoutPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || '{}');
    // Retired layouts must not reopen the editor with its panels hidden.
    if(value.preset === 'review' || value.preset === 'ai') return {...defaults,
      snapping: typeof value.snapping === 'boolean' ? value.snapping : defaults.snapping,
      followPlayhead: typeof value.followPlayhead === 'boolean' ? value.followPlayhead : defaults.followPlayhead};
    return {...defaults,
      libraryWidth: Number.isFinite(value.libraryWidth) ? Math.max(250, Math.min(520, value.libraryWidth)) : defaults.libraryWidth,
      inspectorWidth: Number.isFinite(value.inspectorWidth) ? Math.max(280, Math.min(620, value.inspectorWidth)) : defaults.inspectorWidth,
      timelineHeight: Number.isFinite(value.timelineHeight) ? Math.max(180, Math.min(650, value.timelineHeight)) : defaults.timelineHeight,
      ...Object.fromEntries(['showLibrary', 'showInspector', 'snapping', 'followPlayhead'].filter(key => typeof value[key] === 'boolean').map(key => [key, value[key]])),
      preset: value.preset === 'custom' ? 'custom' : 'edit'};
  } catch {return defaults;}
}
interface WorkspaceState extends LayoutPreferences {
  configure: (patch: Partial<LayoutPreferences>, persist?: boolean) => void;
  resetLayout: () => void;
  save: () => void;
}
export const useWorkspace = create<WorkspaceState>((set, get) => ({
  ...savedLayout(),
  configure: (patch, persist = true) => {
    const changesLayout = ['libraryWidth', 'inspectorWidth', 'timelineHeight', 'showLibrary', 'showInspector'].some(key => key in patch);
    set({...changesLayout ? {preset: 'custom' as const} : {}, ...patch});
    if(persist) get().save();
  },
  resetLayout: () => {
    set({...defaults, snapping: get().snapping, followPlayhead: get().followPlayhead});
    get().save();
  },
  save: () => {
    const {configure, resetLayout, save, ...preferences} = get();
    try {localStorage.setItem(storageKey, JSON.stringify(preferences));} catch { /* Layout still works in private/restricted storage. */ }
  },
}));
