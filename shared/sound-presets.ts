import {z} from 'zod';

const soundId = z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/);
export const soundValuesSchema = z.object({
  duration: z.number().min(.08).max(4).optional(),
  pitch: z.number().min(.25).max(4).optional(),
  volume: z.number().min(0).max(1).optional(),
}).strict();
export const soundLayerSchema = z.object({
  wave: z.enum(['sine', 'triangle', 'noise']),
  frequency: z.number().min(20).max(16000), endFrequency: z.number().min(20).max(16000),
  gain: z.number().min(0).max(1).default(.5),
  start: z.number().min(0).max(1).default(0), end: z.number().min(0).max(1).default(1),
  attack: z.number().min(.001).max(1).default(.03), release: z.number().min(.001).max(1).default(.6),
}).strict().refine(layer => layer.end > layer.start, 'Sound layer end must follow its start');
export const soundDefinitionSchema = z.object({
  schemaVersion: z.literal(1), name: z.string().trim().min(1).max(100), description: z.string().max(500).default(''),
  category: z.enum(['transition', 'impact', 'interface', 'atmosphere']),
  duration: z.number().min(.08).max(4), pitch: z.number().min(.25).max(4).default(1), volume: z.number().min(0).max(1).default(.65),
  seed: z.number().int().min(1).max(4294967295).default(13579),
  layers: z.array(soundLayerSchema).min(1).max(6),
}).strict();
export const savedSoundSchema = z.object({id: soundId, version: z.number().int().positive(), definition: soundDefinitionSchema, createdAt: z.string(), updatedAt: z.string()}).strict();
export const soundSaveSchema = z.object({id: soundId.optional(), expectedVersion: z.number().int().positive().nullable(), definition: soundDefinitionSchema}).strict();
export const soundPreviewSchema = z.object({id: soundId, version: z.number().int().positive(), values: soundValuesSchema.default({})}).strict();
export const soundApplySchema = soundPreviewSchema.extend({revision: z.number().int().nonnegative(), frame: z.number().int().nonnegative(), trackId: z.string().min(1).max(100).optional(), durationFrames: z.number().int().positive().optional()});
export type SoundDefinition = z.infer<typeof soundDefinitionSchema>;
export type SoundValues = z.infer<typeof soundValuesSchema>;
export type SavedSound = z.infer<typeof savedSoundSchema>;
export type SoundApplication = z.infer<typeof soundApplySchema>;
export interface SoundCatalog {revision: number; sounds: SavedSound[]}
export interface SoundPreview {src: string; duration: number}

const layer = (wave: 'sine' | 'triangle' | 'noise', frequency: number, endFrequency: number, gain: number, attack = .02, release = .8, start = 0, end = 1) => ({wave, frequency, endFrequency, gain, attack, release, start, end});
const sound = (id: string, name: string, category: SoundDefinition['category'], duration: number, description: string, layers: z.input<typeof soundLayerSchema>[]) => ({id, definition: soundDefinitionSchema.parse({schemaVersion: 1, name, category, duration, description, layers})});
export const soundStarters = [
  sound('whoosh-soft', 'Soft whoosh', 'transition', .65, 'A gentle filtered sweep for labels and small reveals.', [layer('noise', 600, 3800, .6, .48, .52)]),
  sound('whoosh-heavy', 'Heavy whoosh', 'transition', .95, 'A broad sweep with a low tonal body.', [layer('noise', 180, 2200, .7, .35, .65), layer('sine', 150, 45, .4, .1, .9)]),
  sound('impact-soft', 'Soft impact', 'impact', .45, 'A restrained transient for a result or cut.', [layer('sine', 220, 65, .8), layer('noise', 1800, 450, .2, .01, .95, 0, .3)]),
  sound('impact-deep', 'Deep impact', 'impact', 1.2, 'A low descending hit for major reveals.', [layer('sine', 100, 30, .9, .01, .95), layer('noise', 2400, 100, .3, .01, .9, 0, .25)]),
  sound('riser-clean', 'Clean riser', 'atmosphere', 2.4, 'A tonal build into a transition or milestone.', [layer('sine', 180, 1500, .45, .85, .12), layer('noise', 250, 4500, .35, .8, .15)]),
  sound('riser-air', 'Air riser', 'atmosphere', 2, 'A soft noise swell before the next section.', [layer('noise', 100, 5000, .7, .9, .1)]),
  sound('ui-click', 'UI click', 'interface', .09, 'A short rounded click for a keypress or interface action.', [layer('sine', 1600, 450, .6, .03, .95)]),
  sound('ui-toggle', 'UI toggle', 'interface', .16, 'A two-note tick for before/after switches.', [layer('sine', 550, 550, .6, .08, .9, 0, .45), layer('sine', 850, 850, .5, .08, .9, .5, 1)]),
  sound('notification', 'Notification', 'interface', .65, 'A clear ascending two-note confirmation.', [layer('sine', 660, 660, .6, .03, .8, 0, .55), layer('sine', 990, 990, .5, .03, .85, .25, 1)]),
  sound('glitch-tick', 'Glitch tick', 'interface', .28, 'Three controlled digital pulses for an abrupt reveal.', [layer('triangle', 310, 800, .45, .02, .8, 0, .25), layer('noise', 3000, 800, .4, .02, .8, .35, .55), layer('triangle', 900, 180, .5, .02, .95, .65, 1)]),
  sound('transition-hit', 'Transition hit', 'transition', 1, 'A brief sweep followed by a soft landing.', [layer('noise', 300, 3400, .5, .75, .2, 0, .55), layer('sine', 170, 40, .8, .01, .95, .45, 1)]),
  sound('success-chime', 'Success chime', 'interface', 1.1, 'A three-note cue for a completed feature or benchmark.', [layer('sine', 523, 523, .45, .02, .85, 0, .7), layer('sine', 659, 659, .4, .02, .85, .17, .85), layer('sine', 784, 784, .4, .02, .9, .34, 1)]),
];
