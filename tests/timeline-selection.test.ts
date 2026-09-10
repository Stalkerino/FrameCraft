import {expect, it} from 'vitest';
import {clipSchema} from '../shared/project';
import {groupMoveDelta, intersects, timelineSelection} from '../src/services/timeline-selection';

it('uses the active group only while its primary selection is active', () => {
  expect(timelineSelection({selectedId: 'a', selectedIds: ['a', 'b']})).toEqual(['a', 'b']);
  expect(timelineSelection({selectedId: 'c', selectedIds: ['a', 'b']})).toEqual(['c']);
  expect(timelineSelection({selectedId: null, selectedIds: ['a', 'b']})).toEqual([]);
});
it('clamps group movement at zero without changing relative timing', () => {
  const clips = [10, 40].map((start, i) => clipSchema.parse({id: String(i), name: 'Clip', kind: 'text', track: 'text', start, duration: 20}));
  expect(groupMoveDelta(clips, -50)).toBe(-10);
  expect(groupMoveDelta(clips, 20.8)).toBe(21);
});
it('selects intersecting clips but not adjacent bounds', () => {
  const rect = {left: 10, top: 10, right: 100, bottom: 100};
  expect(intersects(rect, {left: 50, top: 50, right: 120, bottom: 120})).toBe(true);
  expect(intersects(rect, {left: 100, top: 10, right: 120, bottom: 40})).toBe(false);
});
