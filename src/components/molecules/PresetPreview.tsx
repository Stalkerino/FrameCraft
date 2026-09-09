import {useMemo} from 'react';
import {Player} from '@remotion/player';
import type {PresetValues, SavedPreset} from '../../../shared/asset-presets';
import {presetPreviewProject} from '../../../shared/preset-project';
import {durationOf} from '../../../shared/project';
import {ProjectComposition} from '../../video/ProjectComposition';
export function PresetPreview({preset, values, duration}: {preset: SavedPreset; values: PresetValues; duration: number}) {
  const {project} = useMemo(() => presetPreviewProject({...preset, definition: {...preset.definition, name: preset.definition.name.trim() || 'Untitled asset'}}, values, duration), [preset, values, duration]);
  return <div className="preset-preview"><Player key={`${preset.id}-${preset.version}-${duration}`} component={ProjectComposition} inputProps={{project}} durationInFrames={durationOf(project)} compositionWidth={project.width} compositionHeight={project.height} fps={project.fps} controls loop autoPlay initiallyMuted acknowledgeRemotionLicense style={{width: '100%'}}/></div>;
}
