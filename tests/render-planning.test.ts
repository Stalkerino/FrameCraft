import {expect, it} from 'vitest';
import {createDemo} from '../shared/demo';
import {clipSchema} from '../shared/project';
import {exportSettingsSchema} from '../shared/media-settings';
import {describeRenderPlan} from '../shared/render-plan';
import {layeredRenderPlan} from '../shared/layered-render-plan';
import {planProjectRender} from '../server/services/render-plan-service';
import {renderResources} from '../server/services/render-resources-service';

function fixture() {
  const project = {...createDemo(), width: 640, height: 360, fps: 30, assets: [{id: 'rush', kind: 'video' as const, name: 'Rush', src: '/media/rush.mp4', width: 640, height: 360, duration: 10, fps: 30}],
    clips: [clipSchema.parse({id: 'cut', name: 'First cut', kind: 'video', track: 'visual', assetId: 'rush', start: 0, duration: 60})]};
  return {project, settings: exportSettingsSchema.parse({width: 640, height: 360, fps: 30})};
}

it('plans plain cuts without claiming a verified GPU and agrees with actual native eligibility', () => {
  const {project, settings} = fixture();
  const plan = describeRenderPlan(project, {settings});
  expect(plan).toMatchObject({route: 'native-video', verification: 'not-run', blockers: []});
  expect(layeredRenderPlan(project, settings)).not.toBeNull();
  expect(plan.stages.find(stage => stage.id === 'transfer')?.execution).toBe('conditional');
  expect(describeRenderPlan(project, {settings: {...settings, encoder: 'cpu'}}).stages.find(stage => stage.id === 'encode')?.execution).toBe('cpu');
});

it('names the exact effect and additional track requiring Remotion, respecting the export range', () => {
  const {project, settings} = fixture();
  project.clips.push(clipSchema.parse({id: 'later', name: 'Masked detail', kind: 'video', track: 'visual', assetId: 'rush', start: 60, duration: 30,
    mask: {shape: 'ellipse'}}));
  const full = describeRenderPlan(project, {settings});
  expect(full.route).toBe('browser-composition');
  expect(full.blockers).toContainEqual(expect.objectContaining({code: 'mask', clipId: 'later', clipName: 'Masked detail'}));
  expect(layeredRenderPlan(project, settings)).toBeNull();
  const range = {...settings, endSeconds: 1};
  expect(describeRenderPlan(project, {settings: range}).blockers).toEqual([]);
  expect(layeredRenderPlan(project, range)).not.toBeNull();
  project.clips.push(clipSchema.parse({id: 'music', name: 'Music', kind: 'audio', track: 'audio', assetId: 'rush', start: 0, duration: 30}));
  expect(describeRenderPlan(project, {settings: range}).blockers).toContainEqual(expect.objectContaining({code: 'additional-audio', clipId: 'music'}));
});

it('preserves frame-rate semantics and reports CPU artwork and grading work', () => {
  const {project, settings} = fixture();
  project.clips.push(clipSchema.parse({id: 'title', name: 'Title', kind: 'text', track: 'text', start: 30, duration: 30, text: 'Hello'}));
  const plan = describeRenderPlan(project, {settings: {...settings, fps: 60, startSeconds: 1, endSeconds: 2}});
  expect(plan.route).toBe('native-video-with-artwork');
  expect(plan.stages.find(stage => stage.id === 'transfer')?.execution).toBe('cpu');
  expect(plan.stages.find(stage => stage.id === 'artwork')?.execution).toBe('browser');
  project.clips[0] = {...project.clips[0], opacity: .5};
  expect(describeRenderPlan(project, {settings}).stages.find(stage => stage.id === 'processing')?.execution).toBe('cpu');
});

it('rejects a stale project revision or invalid range without changing the project', () => {
  const {project, settings} = fixture(); const before = structuredClone(project);
  expect(() => planProjectRender(project, {revision: project.revision + 1, settings})).toThrow('Project changed');
  expect(() => planProjectRender(project, {settings: {...settings, endSeconds: 100}})).toThrow('Export range');
  expect(project).toEqual(before);
});

it('keeps decode concurrency aligned with GPU pages and shrinks resources under memory pressure', () => {
  const gpu = renderResources(1920, 1080, {hardware: true, memory: 32 * 1024 ** 3, parallelism: 32, maxWorkers: 8});
  const lowMemory = renderResources(3840, 2160, {memory: 1024 ** 3, parallelism: 32});
  expect(gpu.concurrency).toBeLessThanOrEqual(2);
  expect(gpu.offthreadVideoThreads).toBe(gpu.concurrency);
  expect(gpu.offthreadVideoCacheSizeInBytes).toBeLessThanOrEqual(256 * 1024 ** 2);
  expect(lowMemory.concurrency).toBe(1);
  expect(lowMemory.offthreadVideoCacheSizeInBytes).toBeLessThan(gpu.offthreadVideoCacheSizeInBytes);
  expect(renderResources(640, 360, {memory: 32 * 1024 ** 3, parallelism: 32, maxWorkers: 1}).concurrency).toBe(1);
});
