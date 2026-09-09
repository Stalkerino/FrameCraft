import {describe, expect, it} from 'vitest';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PresetRepository} from '../server/repositories/preset-repository';
import {presetDefinitionSchema, resolvePresetValues, scalarAt, type SavedPreset} from '../shared/asset-presets';
import {legacyPresetStarters, presetStarters} from '../shared/preset-starters';
import {presetRevealStyle} from '../src/video/assets/preset-reveal';
import {presetCommands, presetPreviewProject} from '../shared/preset-project';
import {applyCommand, projectSchema, validateProject} from '../shared/project';
import {createDemo} from '../shared/demo';
import {reframeProject} from '../shared/project-settings';
import {removeTimelineRanges} from '../shared/assisted-editing';
const starter = (id: string): SavedPreset => ({...structuredClone(presetStarters.find(p => p.id === id)!), version: 1, createdAt: '', updatedAt: ''});

describe('portable asset recipes', () => {
  it('keeps comparison dividers aligned with their reveal, and progress fills anchored to the left', () => {
    for(const id of ['comparison-wipe-horizontal', 'comparison-wipe-vertical', 'accent-edge-wipe']) {
      const definition = starter(id).definition;
      const vertical = id === 'comparison-wipe-vertical';
      const values = resolvePresetValues(definition);
      for(const progress of [0, .13, .5, .89, 1]) {
        expect(scalarAt(definition.layers[0][vertical ? 'y' : 'x'], progress, values)).toBeCloseTo(progress * 100);
        if(progress < 1) expect(presetRevealStyle(definition.reveal, progress).clipPath).toBe(vertical
          ? `inset(0% 0% ${(1 - progress) * 100}% 0%)`
          : `inset(0% ${(1 - progress) * 100}% 0% 0%)`);
      }
    }
    const progressLine = starter('progress-line').definition.layers.find(layer => layer.id === 'fill')!;
    for(const progress of [0, .2, .75, 1]) {
      expect(scalarAt(progressLine.x, progress, {}) - scalarAt(progressLine.width, progress, {}) / 2).toBeCloseTo(6);
    }
  });

  it('validates parameter types/ranges, ordered keyframes and unsupported executable fields', () => {
    const title = starter('chapter-title').definition;
    expect(() => presetDefinitionSchema.parse({...title, layers: [{...title.layers[0], fill: {param: 'title'}}]})).toThrow('incompatible');
    expect(() => presetDefinitionSchema.parse({...title, layers: [{...title.layers[0], x: {keyframes: [{at: .5, value: 1}, {at: .2, value: 2}]}}]})).toThrow('increasing');
    expect(() => presetDefinitionSchema.parse({...title, script: 'arbitrary code'})).toThrow('Unrecognized');
    expect(() => resolvePresetValues(title, {unknown: 1})).toThrow('Unknown');
    expect(() => resolvePresetValues(title, {accent: 'url(https://example.com)'})).toThrow('Invalid');
    expect(() => resolvePresetValues(starter('purple-glitch').definition, {intensity: 25})).toThrow('between');
    expect(scalarAt({keyframes: [{at: 0, value: 10}, {at: 1, value: {param: 'end'}}], easing: 'linear'}, .5, {end: 30})).toBe(20);
    expect(scalarAt({keyframes: [{at: 0, value: 1}, {at: 1, value: 2}], easing: 'step'}, 1, {})).toBe(2);
  });

  it('embeds independent versions and preserves animation timing through split, fps changes and ripple cuts', () => {
    const preset = starter('chapter-title'); const original = {...createDemo(), clips: []};
    const command = presetCommands(original, preset, {id: preset.id, version: 1, revision: 0, frame: 30, values: {title: 'Reusable title'}, duration: 4}, 'graphic')[0];
    const project = applyCommand(original, command); preset.definition.name = 'Changed later';
    expect(project.clips[0].graphic?.definition.name).toBe('Chapter Title');
    const split = applyCommand(project, {type: 'clip.split', id: 'graphic', frame: 60, newId: 'second'});
    expect(split.clips[1].motionOffset).toBe(30); expect(split.clips[1].graphic?.duration).toBe(4);
    const faster = reframeProject(split, 60); expect(faster.clips[1].motionOffset).toBe(60); expect(faster.clips[1].graphic?.duration).toBe(4);
    expect(validateProject(projectSchema.parse(faster))).toEqual(faster);
    expect(() => presetCommands(project, preset, {id: preset.id, version: 2, revision: 1, frame: 0, values: {}}, 'other')).toThrow('changed');
  });

  it('creates isolated transition previews and clears preset entrances from split fragments', () => {
    const preset = starter('purple-glitch'); const preview = presetPreviewProject(preset, {accent: '#ff8800'}, .6);
    expect(preview.project.assets).toEqual([]); expect(preview.start).toBe(30); expect(preview.frames).toBe(18);
    const split = applyCommand(preview.project, {type: 'clip.split', id: 'incoming', frame: 40, newId: 'fragment'});
    expect(split.clips.find(c => c.id === 'fragment')?.presetTransition).toBeNull();
    const cut = removeTimelineRanges(preview.project, [{start: 35, end: 40}], () => 'cut-fragment');
    expect(cut.find(c => c.id === 'cut-fragment')?.presetTransition).toBeNull();
  });
});

it('upgrades legacy libraries once, preserves customizations, and never restores deleted starters', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'framecraft-preset-upgrade-'));
  try {
    const legacy = legacyPresetStarters.filter(preset => preset.id !== 'purple-glitch').map(preset => starter(preset.id));
    const customized = {...starter('chapter-title'), version: 3, definition: {...starter('chapter-title').definition, name: 'My chapter design'}};
    const collision = {...starter('comparison-wipe-horizontal'), version: 2, definition: {...starter('comparison-wipe-horizontal').definition, name: 'My comparison'}};
    const custom = {...starter('chapter-title'), id: 'my-custom-title'};
    await writeFile(path.join(directory, 'presets.json'), JSON.stringify({revision: 9, presets: [...legacy.filter(preset => preset.id !== customized.id), customized, custom, collision]}));
    const repository = new PresetRepository(directory); await repository.init();
    expect(repository.get(customized.id)).toEqual(customized);
    expect(repository.get(custom.id)).toEqual(custom);
    expect(repository.get(collision.id)).toEqual(collision);
    expect(repository.get('caption-strip').definition.name).toBe('Caption · Explanation strip');
    expect(() => repository.get('purple-glitch')).toThrow('not found');
    expect(new Set(repository.snapshot().installedStarterIds)).toEqual(new Set(presetStarters.map(preset => preset.id)));
    await repository.remove('caption-strip', 1);
    await repository.save({id: custom.id, expectedVersion: 1, definition: {...custom.definition, name: 'Edited after migration'}});
    const revision = repository.snapshot().revision;
    const restarted = new PresetRepository(directory); await restarted.init();
    expect(restarted.snapshot().revision).toBe(revision);
    expect(() => restarted.get('caption-strip')).toThrow('not found');
    expect(() => restarted.get('purple-glitch')).toThrow('not found');
    expect(restarted.get(custom.id).version).toBe(2);
  } finally {await rm(directory, {recursive: true, force: true});}
});

it('persists the shared library, serializes version checks, and keeps applied clips independent of deletion', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'framecraft-presets-'));
  try {
    const repository = new PresetRepository(directory); await repository.init();
    expect(new Set(repository.snapshot().presets.map(preset => preset.id))).toEqual(new Set(presetStarters.map(preset => preset.id)));
    const saved = await repository.save({expectedVersion: null, definition: {...starter('chapter-title').definition, name: 'My reusable title'}});
    const applied = presetPreviewProject(saved).project;
    const results = await Promise.allSettled([repository.save({id: saved.id, expectedVersion: 1, definition: {...saved.definition, name: 'Version two'}}), repository.save({id: saved.id, expectedVersion: 1, definition: {...saved.definition, name: 'Conflicting update'}})]);
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected']);
    const restarted = new PresetRepository(directory); await restarted.init(); expect(restarted.get(saved.id).version).toBe(2);
    await expect(restarted.remove(saved.id, 1)).rejects.toThrow('changed'); await restarted.remove(saved.id, 2);
    expect(() => restarted.get(saved.id)).toThrow('not found'); expect(validateProject(applied).clips[0].graphic?.definition.name).toBe('My reusable title');
    const reopened = new PresetRepository(directory); await reopened.init(); expect(() => reopened.get(saved.id)).toThrow('not found');
  } finally {await rm(directory, {recursive: true, force: true});}
});
