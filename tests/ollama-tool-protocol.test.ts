import {expect, it} from 'vitest';
import {decodeToolArguments, ollamaToolSchema, isLeakedToolCall} from '../server/services/ollama-tool-protocol';
import {localInspectionParameters, prepareLocalToolArguments} from '../server/services/local-tool-arguments';

const reportId = '88926f48-23b5-4ae7-bffa-6f704751c09f';
it('replays the serialized inspection objects found in the user logs', () => {
  for(const fields of [{page: 0}, {time: 5}, {start: 0, end: 2}]) {
    const raw = {inspection: JSON.stringify({reportId, ...fields})};
    const result = decodeToolArguments(raw, localInspectionParameters);
    expect(result.note).toContain('arguments.inspection');
    expect(prepareLocalToolArguments('inspect_video', result.arguments).arguments).toEqual({inspection: {reportId, ...fields}});
    expect(typeof raw.inspection).toBe('string');
  }
});
it('exposes actual union properties to model templates which only read type/properties', () => {
  const model = ollamaToolSchema(localInspectionParameters) as {properties: {inspection: {type: string; properties: Record<string, unknown>; required: string[]}}};
  expect(model.properties.inspection.type).toBe('object');
  expect(Object.keys(model.properties.inspection.properties)).toEqual(['reportId', 'page', 'time', 'start', 'end']);
  expect(model.properties.inspection.required).toEqual(['reportId']);
  expect(JSON.stringify(model)).not.toContain('oneOf');
  expect(() => prepareLocalToolArguments('inspect_video', {inspection: {reportId, page: 0, time: 5}})).toThrow();
});
it('decodes nested arrays and references without changing JSON-looking text or guessing values', () => {
  const schema = {type: 'object', properties: {commands: {type: 'array', items: {$ref: '#/$defs/command'}}, text: {type: 'string'}}, $defs: {command: {type: 'object', properties: {clip: {type: 'object', properties: {text: {type: 'string'}, start: {type: 'integer'}}}}}}};
  const raw = {commands: JSON.stringify([{clip: JSON.stringify({text: '{"keep":"literal"}', start: '6'})}]), text: '[1,2]'};
  const result = decodeToolArguments(JSON.stringify(raw), schema);
  expect(result.arguments).toEqual({commands: [{clip: {text: '{"keep":"literal"}', start: '6'}}], text: '[1,2]'});
  expect(() => decodeToolArguments({commands: '[broken'}, schema)).toThrow('invalid JSON');
  expect(() => decodeToolArguments({commands: '6'}, schema)).toThrow('not a JSON scalar');
});
it('flags the raw tool protocol found in logs without mistaking normal prose for a call', () => {
  expect(isLeakedToolCall('get_project[ARGS]{}')).toBe(true);
  expect(isLeakedToolCall('<tool_call>{"name":"get_project"}</tool_call>')).toBe(true);
  expect(isLeakedToolCall('Example: get_project[ARGS]{}')).toBe(false);
  expect(isLeakedToolCall('Read the report successfully.')).toBe(false);
});
