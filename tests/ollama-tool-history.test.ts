import {expect, it} from 'vitest';
import {ollamaToolHistory} from '../server/services/ollama-tool-history';
import {callEditorTool} from '../server/services/ollama-context-service';
import type {OllamaMessage, OllamaTool} from '../server/services/ollama-client';

it('keeps inactive historical calls and results valid without changing saved history or permissions', () => {
  const active: OllamaTool = {type: 'function', function: {name: 'get_project', description: '', parameters: {type: 'object'}}};
  const history: OllamaMessage[] = [
    {role: 'assistant', content: '', tool_calls: [
      {function: {name: 'get_video_analysis', arguments: {reportId: 'report-1'}}},
      {function: {name: 'get_project', arguments: {}}},
      {function: {name: 'call_editor_tool', arguments: {name: 'edit_project', arguments: {revision: 4}}}},
      {function: {name: 'run_workspace_command', arguments: {executable: 'node', args: ['generate.mjs']}}},
    ]},
    {role: 'tool', tool_name: 'get_video_analysis', content: 'Saved report'},
    {role: 'tool', tool_name: 'get_project', content: 'Current project'},
    {role: 'tool', tool_name: 'call_editor_tool', content: 'User declined'},
    {role: 'tool', tool_name: 'run_workspace_command', content: 'Completed once'},
    {role: 'user', tool_name: 'inspect_video', content: 'Source frames', images: ['image-bytes']},
  ];
  const original = structuredClone(history); const tools = [active, callEditorTool];
  const wire = ollamaToolHistory(history, tools);
  expect(wire[0].tool_calls?.map(c => c.function.name)).toEqual(['call_editor_tool', 'get_project', 'call_editor_tool', 'call_editor_tool']);
  expect(wire[0].tool_calls?.[0].function.arguments).toEqual({name: 'get_video_analysis', arguments: {reportId: 'report-1'}});
  expect(wire.slice(1, 5).map(m => m.tool_name)).toEqual(['call_editor_tool', 'get_project', 'call_editor_tool', 'call_editor_tool']);
  expect(wire.slice(1).map(m => m.content)).toEqual(history.slice(1).map(m => m.content));
  expect(wire[5]).toEqual(history[5]); expect(history).toEqual(original);
  expect(tools).toHaveLength(2);
  expect(ollamaToolHistory(wire, tools)).toEqual(wire); // Never nest the dispatcher on another serialization.
});
