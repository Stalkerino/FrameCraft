import {Field} from '../atoms/Field';
import {Button} from '../atoms/Button';
import {SettingsSection} from './SettingsSection';
import type {useExportDestination} from '../../hooks/useExportDestination';

export function ExportDestination({destination}: {destination: ReturnType<typeof useExportDestination>}) {
  return <SettingsSection title="Save video" description="Defaults to the project's exported folder. Existing files are never overwritten.">
    <Field label="Export file path"><input aria-label="Export file path" value={destination.outputPath} placeholder="Loading project export folder…" onChange={event => destination.change(event.target.value)}/></Field>
    <Button type="button" onClick={destination.reset}>Use project folder</Button>
    {destination.error && <p role="alert" className="agent-inline-error">{destination.error}</p>}
  </SettingsSection>;
}
