import type {MediaFolder} from '../../../shared/project-organization';
import {folderOptions} from '../../../shared/project-organization';
export function MediaFolderSelect({folders, value, onChange, label, all = false, disabled = false, rootLabel = 'Unfiled'}: {folders: MediaFolder[]; value: string; onChange: (value: string) => void; label: string; all?: boolean; disabled?: boolean; rootLabel?: string}) {
  return <select aria-label={label} title={value === '*' ? 'All folders' : folderOptions(folders).find(folder => folder.id === value)?.label || rootLabel} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
    {all && <option value="*">All folders</option>}<option value="">{rootLabel}</option>{folderOptions(folders).map(folder => <option key={folder.id} value={folder.id}>{folder.label}</option>)}
  </select>;
}
