import {expect, it} from 'vitest';
import {prepareLocalToolArguments, localInspectionParameters, localInspectionToolParameters} from '../server/services/local-tool-arguments';
const reportId = '88926f48-23b5-4ae7-bffa-6f704751c09f';
it.each([0, 6])('treats an equal range at %s seconds as a single frame without mutating the call', time => {
  const args = {inspection: {reportId, start: time, end: time}};
  expect(prepareLocalToolArguments('inspect_video', args)).toMatchObject({arguments: {inspection: {reportId, time}}, note: expect.stringContaining('single-frame')});
  expect(args.inspection).toEqual({reportId, start: time, end: time});
});
it('translates flat calls and plain numeric strings from the logs to the existing MCP envelope', () => {
  for(const [start, end] of [['310', '357'], ['37', '81'], ['2116', '2568']]) {
    const input = {reportId, start, end};
    const prepared = prepareLocalToolArguments('inspect_video', input);
    expect(prepared.arguments).toEqual({inspection: {reportId, start: Number(start), end: Number(end)}});
    expect(prepared.note).toContain('Parsed start=');
    expect(input.start).toBe(start); // No guessed units or clamping to media duration.
  }
  expect(prepareLocalToolArguments('inspect_video', {reportId, page: '0'}).arguments).toEqual({inspection: {reportId, page: 0}});
  expect(localInspectionToolParameters.required).toEqual(['reportId']);
  expect(localInspectionToolParameters.properties).not.toHaveProperty('inspection');
});
it.each([{time: ''}, {time: '6s'}, {time: '01:30'}, {time: 'Infinity'}, {page: '1.5'}, {start: '81', end: '37'}, {page: '0', time: '6'}, {start: '37'}])('rejects malformed or ambiguous flat inspection %j', fields => {
  expect(() => prepareLocalToolArguments('inspect_video', {reportId, ...fields})).toThrow();
});
it('rejects mixed envelopes rather than guessing which values win', () => {
  expect(() => prepareLocalToolArguments('inspect_video', {inspection: {reportId, page: 0}, time: '6'})).toThrow('Unrecognized');
  const edit = {revision: '304', commands: '[]'};
  expect(prepareLocalToolArguments('edit_project', edit).arguments).toBe(edit);
});
it.each([{start: 6, end: 4}, {time: 6, start: 6, end: 6}, {page: 0, start: 6, end: 6}, {start: 6}, {start: -1, end: -1}])('rejects ambiguous or invalid inspection %j with examples', fields => {
  expect(() => prepareLocalToolArguments('inspect_video', {inspection: {reportId, ...fields}})).toThrow('Single frame at 6 seconds');
});
it('preserves valid inspection modes and does not repair editing calls', () => {
  for(const fields of [{time: 6}, {page: 0}, {start: 6, end: 8}]) expect(prepareLocalToolArguments('inspect_video', {inspection: {reportId, ...fields}})).toEqual({arguments: {inspection: {reportId, ...fields}}});
  const input = {shots: [{start: 6, end: 6}]}; expect(prepareLocalToolArguments('save_video_cut', input).arguments).toBe(input);
  expect(JSON.stringify(localInspectionParameters)).toContain('oneOf');
});
