import {expect, it} from 'vitest';
import {mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {compactSchema, contextCheckpoint, OllamaContextService} from '../server/services/ollama-context-service';

it('compacts schema annotations while preserving named fields and validation', () => {
  expect(compactSchema({type: 'object', description: 'Long documentation', properties: {description: {type: 'string', description: 'Help', maxLength: 100}, default: {type: 'number', default: 2}, clip: {oneOf: [{type: 'string', enum: ['a']}, {type: 'null'}]}}, required: ['description']})).toEqual({type: 'object', properties: {description: {type: 'string', maxLength: 100}, default: {type: 'number'}, clip: {oneOf: [{type: 'string', enum: ['a']}, {type: 'null'}]}}, required: ['description']});
});
it('checkpoints exact call arguments, outcomes and user constraints without inventing completion', () => {
  const notes = contextCheckpoint([
    {role: 'user', content: 'Keep the original audio.'},
    {role: 'assistant', content: '', tool_calls: [{function: {name: 'call_editor_tool', arguments: {name: 'inspect_video', arguments: {reportId: 'report-1', page: 3}}}}]},
    {role: 'tool', tool_name: 'call_editor_tool', content: '{"frames":[{"time":287.5}]}'},
    {role: 'assistant', content: 'Need to inspect the ending.'},
    {role: 'tool', tool_name: 'edit_project', content: 'User declined this action.'},
  ], 'Earlier request: preserve the ending.', 'archive-id');
  for(const value of ['Keep the original audio', 'inspect_video', 'report-1', '287.5', 'User declined', 'preserve the ending', 'read_context_result id=archive-id']) expect(notes).toContain(value);
  expect(notes).toContain('not proof it was reviewed');
});
it('archives full results and retrieves exact nested values and successive pages', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fc-context-'));
  try {
    const store = new OllamaContextService(directory);
    const value = {project: {revision: 42, clips: Array.from({length: 1000}, (_, i) => ({id: `clip-${i}`, start: i * 30}))}};
    const ref = JSON.parse(await store.shorten(JSON.stringify(value), 'project', 1000));
    expect(ref.omitted).toBe(true);
    expect(JSON.parse(await store.read({id: ref.contextReference, pointer: '/project/clips/999'})).text).toBe(JSON.stringify(value.project.clips[999]));
    const smallPage = await store.read({id: ref.contextReference}, 900); expect(smallPage.length).toBeLessThanOrEqual(900);
    const escaped = JSON.parse(await store.shorten('\u0001'.repeat(5000), 'escaped', 900)); expect(JSON.stringify(escaped).length).toBeLessThanOrEqual(900);
    let full = ''; let offset: number | null = 0;
    while(offset !== null) {const page = JSON.parse(await store.read({id: ref.contextReference, offset})); full += page.text; offset = page.nextOffset;}
    expect(JSON.parse(full)).toEqual(value);
    await expect(store.read({id: '../project'})).rejects.toThrow('UUID');
    await expect(store.read({id: ref.contextReference, pointer: '/__proto__'})).rejects.toThrow('not found');
  } finally {await rm(directory, {recursive: true, force: true});}
});
