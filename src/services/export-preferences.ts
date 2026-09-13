import type {ExportSettings} from '../../shared/media-settings';
type Pipeline = Pick<ExportSettings, 'renderer' | 'encoder'>;
const key = (projectId: string) => `framecraft.export-pipeline.${projectId}`;
export const exportPreferences = {
  read(projectId: string): Pipeline | undefined {
    try {
      const value = JSON.parse(localStorage.getItem(key(projectId)) || 'null');
      if(value && ['compatible', 'native-gpu', 'native-vulkan'].includes(value.renderer) && ['auto', 'cpu', 'amd', 'nvidia'].includes(value.encoder)) return value;
    } catch { /* Storage may be disabled. */ }
  },
  save(projectId: string, value: Pipeline) {try {localStorage.setItem(key(projectId), JSON.stringify({renderer: value.renderer, encoder: value.encoder}));} catch { /* Keep the current dialog usable. */ }},
};
