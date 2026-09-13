import {expect, it} from 'vitest';
import {probeDuration} from '../server/services/probe-timing';

it('preserves exact video and audio endpoints without borrowing a longer container duration', () => {
  expect(probeDuration({duration: '41.033333', duration_ts: 2462, time_base: '1/60'}, '41.045000')).toBe(2462 / 60);
  expect(probeDuration({duration: '0.033333', duration_ts: 1600, time_base: '1/48000'})).toBe(1 / 30);
  expect(probeDuration({duration: '10', duration_ts: 'N/A', time_base: '0/0'}, '11')).toBe(10);
  expect(probeDuration({duration: 'N/A'}, '11')).toBe(11);
});
