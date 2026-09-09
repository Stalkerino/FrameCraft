import {ArrowUpRight} from 'lucide-react';
import type {SavedPreset} from '../../../shared/asset-presets';
import {presetApi} from '../../services/preset-api';
export function PresetCard({preset, onOpen}: {preset: SavedPreset; onOpen: () => void}) {
  return <button className="preset-card" aria-label={`Open ${preset.definition.name} preset`} draggable onDragStart={event => {event.dataTransfer.setData('application/framecraft-preset', JSON.stringify({id: preset.id, version: preset.version})); event.dataTransfer.effectAllowed = 'copy';}} onClick={onOpen}><div className={`preset-card__art preset-card__art--${preset.definition.category}`}><img src={presetApi.thumbnailUrl(preset)} alt="" loading="lazy"/><span>{preset.definition.duration}s</span></div><div className="preset-card__caption"><strong>{preset.definition.name}</strong><ArrowUpRight size={14}/></div><small>{preset.definition.category.replace('-', ' ')} <span>v{preset.version}</span></small></button>;
}
