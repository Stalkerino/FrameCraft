import {expect, it} from 'vitest';
import {clipSchema} from '../shared/project';
import {moveOnCanvas, resizeOnCanvas} from '../src/services/preview-geometry-service';
const canvas = {left: 0, top: 0, width: 1000, height: 500};
it('maps displayed pixels to percentages, clamps positions and keeps proportions on resize', () => {
  const clip = clipSchema.parse({id: 'text', name: 'Text', kind: 'text', track: 'text', start: 0, duration: 60, x: 50, y: 50});
  expect(moveOnCanvas(clip, 100, -50, canvas)).toEqual({x: 60, y: 40, scale: 1});
  expect(moveOnCanvas(clip, 2000, -2000, canvas)).toEqual({x: 100, y: 0, scale: 1});
  const rect = {left: 400, top: 250, width: 200, height: 60};
  const resized = resizeOnCanvas(clip, rect, canvas, 'se', 100, 30);
  expect(resized).toEqual({x: 55, y: 50, scale: 1.5});
  // Left/top corner remains fixed while width grows by 50%.
  expect(resized.x / 100 * canvas.width - rect.width * resized.scale / 2).toBe(rect.left);
});
it('resizes video around its focus point and enforces supported scale bounds', () => {
  const clip = clipSchema.parse({id: 'v', name: 'Video', kind: 'video', track: 'visual', assetId: 'asset', start: 0, duration: 60, zoom: {from: 1, to: 2, x: 70, y: 20, start: 0, end: 30}});
  expect(resizeOnCanvas(clip, canvas, canvas, 'se', 500, 250)).toEqual({x: 85, y: 60, scale: 1.5});
  expect(resizeOnCanvas(clip, canvas, canvas, 'se', 999999, 999999).scale).toBe(4);
});
