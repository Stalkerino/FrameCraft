import {z} from 'zod';

const key = z.string().regex(/^[a-z][a-z0-9_-]{0,59}$/).refine(value => !['constructor', 'prototype', '__proto__'].includes(value), 'Reserved identifier');
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const finite = z.number().finite().min(-10000).max(10000);
const reference = z.object({param: key}).strict();
const numericValue = z.union([finite, reference]);
export const scalarSchema = z.union([numericValue, z.object({
  keyframes: z.array(z.object({at: z.number().min(0).max(1), value: numericValue}).strict()).min(2).max(24),
  easing: z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out', 'step']).default('ease-in-out'),
}).strict()]);
const parameterSchema = z.discriminatedUnion('type', [
  z.object({key, label: z.string().min(1).max(60), type: z.literal('number'), default: finite, min: finite, max: finite, step: z.number().positive().max(1000).default(.1)}).strict(),
  z.object({key, label: z.string().min(1).max(60), type: z.literal('color'), default: color}).strict(),
  z.object({key, label: z.string().min(1).max(60), type: z.literal('text'), default: z.string().max(1000)}).strict(),
]);
export const presetValuesSchema = z.record(key, z.union([finite, z.string().max(1000)]));
export const presetLayerSchema = z.object({
  id: key, type: z.enum(['rect', 'ellipse', 'text']),
  x: scalarSchema.default(50), y: scalarSchema.default(50), width: scalarSchema.default(80), height: scalarSchema.default(20),
  opacity: scalarSchema.default(1), rotation: scalarSchema.default(0), scale: scalarSchema.default(1),
  fill: z.union([color, reference]).default('#ffffff'), stroke: z.union([color, reference]).optional(), strokeWidth: scalarSchema.default(0), radius: scalarSchema.default(0),
  text: z.union([z.string().max(1000), reference]).default(''), fontSize: scalarSchema.default(6),
  weight: z.enum(['400', '600', '800']).default('800'), align: z.enum(['left', 'center', 'right']).default('center'),
}).strict();
export const presetDefinitionSchema = z.object({
  schemaVersion: z.literal(1), name: z.string().trim().min(1).max(100), description: z.string().max(500).default(''),
  category: z.enum(['transition', 'title', 'lower-third', 'background', 'overlay', 'intro', 'outro']),
  tags: z.array(z.string().min(1).max(30)).max(12).default([]), duration: z.number().min(.1).max(120).default(3),
  parameters: z.array(parameterSchema).max(20).default([]), layers: z.array(presetLayerSchema).max(40).default([]),
  reveal: z.object({type: z.enum(['fade', 'wipe', 'iris', 'blocks']), direction: z.enum(['left', 'right', 'up', 'down']).default('right'), steps: z.number().int().min(2).max(30).default(12)}).strict().optional(),
}).strict().superRefine((preset, ctx) => {
  const fail = (message: string) => ctx.addIssue({code: z.ZodIssueCode.custom, message});
  if(preset.category === 'transition' ? !preset.reveal : !!preset.reveal) fail('Only transitions require a reveal definition');
  if(preset.category !== 'transition' && !preset.layers.length) fail('Add at least one graphic layer');
  const parameters = new Map(preset.parameters.map(p => [p.key, p]));
  if(parameters.size !== preset.parameters.length || new Set(preset.layers.map(l => l.id)).size !== preset.layers.length) fail('Parameter and layer identifiers must be unique');
  for(const p of preset.parameters) if(p.type === 'number' && (p.min >= p.max || p.default < p.min || p.default > p.max)) fail(`Invalid range/default for ${p.key}`);
  const checkReference = (value: unknown, type: 'number' | 'color' | 'text') => {
    if(value && typeof value === 'object' && 'param' in value && parameters.get(String(value.param))?.type !== type) fail(`Unknown or incompatible ${type} parameter: ${String(value.param)}`);
  };
  for(const layer of preset.layers) {
    for(const field of ['x', 'y', 'width', 'height', 'opacity', 'rotation', 'scale', 'strokeWidth', 'radius', 'fontSize'] as const) {
      const value = layer[field]; checkReference(value, 'number');
      if(typeof value === 'object' && 'keyframes' in value) {
        value.keyframes.forEach((frame, index) => {checkReference(frame.value, 'number'); if(index && frame.at <= value.keyframes[index - 1].at) fail('Keyframes must have strictly increasing times');});
      }
    }
    checkReference(layer.fill, 'color'); checkReference(layer.stroke, 'color'); checkReference(layer.text, 'text');
  }
});
export type PresetDefinition = z.infer<typeof presetDefinitionSchema>;
export type PresetValues = z.infer<typeof presetValuesSchema>;
export type PresetLayer = z.infer<typeof presetLayerSchema>;
export type Scalar = z.infer<typeof scalarSchema>;
export const savedPresetSchema = z.object({id: key, version: z.number().int().positive(), definition: presetDefinitionSchema, createdAt: z.string(), updatedAt: z.string()}).strict();
export type SavedPreset = z.infer<typeof savedPresetSchema>;
export function resolvePresetValues(definition: PresetDefinition, input: PresetValues = {}): PresetValues {
  const values: PresetValues = {};
  for(const name of Object.keys(input)) if(!definition.parameters.some(p => p.key === name)) throw new Error(`Unknown preset parameter: ${name}`);
  for(const parameter of definition.parameters) {
    const value = input[parameter.key] ?? parameter.default;
    if(parameter.type === 'number') {if(typeof value !== 'number' || !Number.isFinite(value) || value < parameter.min || value > parameter.max) throw new Error(`${parameter.label} must be between ${parameter.min} and ${parameter.max}`);}
    else if(typeof value !== 'string' || value.length > 1000 || (parameter.type === 'color' && !color.safeParse(value).success)) throw new Error(`Invalid ${parameter.label}`);
    values[parameter.key] = value;
  }
  return values;
}
export const presetInstanceSchema = z.object({presetId: key, version: z.number().int().positive(), definition: presetDefinitionSchema, values: presetValuesSchema, duration: z.number().min(.1).max(120)}).strict().superRefine((instance, ctx) => {
  try {resolvePresetValues(instance.definition, instance.values);} catch(error) {ctx.addIssue({code: z.ZodIssueCode.custom, message: (error as Error).message});}
});
export type PresetInstance = z.infer<typeof presetInstanceSchema>;
export const presetSaveSchema = z.object({id: key.optional(), expectedVersion: z.number().int().positive().nullable().default(null), definition: presetDefinitionSchema}).strict();
export const presetApplySchema = z.object({id: key, version: z.number().int().positive(), revision: z.number().int().nonnegative(), frame: z.number().int().nonnegative(), clipId: z.string().optional(), trackId: z.string().optional(), values: presetValuesSchema.default({}), duration: z.number().min(.1).max(120).optional()}).strict();
export type PresetApplication = z.infer<typeof presetApplySchema>;
export const presetPreviewSchema = z.object({id: key, version: z.number().int().positive(), values: presetValuesSchema.default({}), duration: z.number().min(.1).max(120).optional(), progress: z.number().min(0).max(1).default(.5), kind: z.enum(['frame', 'video']).default('frame')}).strict();
export const presetPackageSchema = z.object({format: z.literal('framecraft-asset-preset'), version: z.literal(1), definition: presetDefinitionSchema}).strict();

export function scalarAt(value: Scalar, progress: number, values: PresetValues): number {
  const number = (v: z.infer<typeof numericValue>) => typeof v === 'number' ? v : Number(values[v.param]);
  if(typeof value === 'number' || 'param' in value) return number(value);
  const frames = value.keyframes; const p = Math.min(1, Math.max(0, progress));
  if(p <= frames[0].at) return number(frames[0].value);
  const right = frames.findIndex(f => f.at >= p); if(right < 0) return number(frames.at(-1)!.value);
  const a = frames[right - 1]; const b = frames[right]; let t = (p - a.at) / (b.at - a.at);
  if(value.easing === 'ease-in') t *= t;
  else if(value.easing === 'ease-out') t = 1 - (1 - t) ** 2;
  else if(value.easing === 'ease-in-out') t = t * t * (3 - 2 * t);
  else if(value.easing === 'step') t = t >= 1 ? 1 : 0;
  return number(a.value) + (number(b.value) - number(a.value)) * t;
}
export const presetString = (value: string | {param: string}, values: PresetValues) => typeof value === 'string' ? value : String(values[value.param] ?? '');
