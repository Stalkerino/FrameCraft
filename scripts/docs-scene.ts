import {clipSchema, type Asset, type Command} from '../shared/project';
import type {SavedPreset} from '../shared/asset-presets';

/** Documentation scene: two locally generated video sources, real tracks and a saved transition. */
export function comparisonCommands(before: Asset, after: Asset, wipe: SavedPreset): Command[] {
  const duration = 96;
  return [
    {type: 'track.update', id: 'visual', patch: {name: 'Before · Original lighting'}},
    {type: 'track.add', track: {id: 'comparison-after', name: 'After · Atmosphere pass', type: 'visual', hidden: false, muted: false}},
    {type: 'track.move', id: 'comparison-after', direction: 'down'},
    {type: 'track.remove', id: 'audio'},
    {type: 'clips.replace', clips: [
      clipSchema.parse({id: 'comparison-before', name: 'Before · Original lighting', kind: 'video', assetId: before.id, track: 'visual', trackId: 'visual', start: 0, duration}),
      clipSchema.parse({id: 'comparison-after-clip', name: 'After · Atmosphere pass', kind: 'video', assetId: after.id, track: 'visual', trackId: 'comparison-after', start: 0, duration, transitionFrames: duration,
        presetTransition: {presetId: wipe.id, version: wipe.version, definition: wipe.definition, values: {divider: '#f1f5f6', thickness: .25}, duration: 4}}),
      clipSchema.parse({id: 'comparison-after-label', name: 'After label', kind: 'text', track: 'text', start: 0, duration, text: 'AFTER / ATMOSPHERE', x: 7, y: 9, align: 'left', fontSize: 26, color: '#64dcc5', animation: 'none'}),
      clipSchema.parse({id: 'comparison-before-label', name: 'Before label', kind: 'text', track: 'text', start: 0, duration, text: 'BEFORE / LIGHTING', x: 93, y: 9, align: 'right', fontSize: 26, animation: 'none'}),
    ]},
  ];
}
