import {randomUUID} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {OllamaMessage, OllamaTool} from './ollama-client';
import {ollamaToolHistory} from './ollama-tool-history';

export const readContextTool: OllamaTool = {type: 'function', function: {name: 'read_context_result', description: 'Read a saved full tool result, schema or compacted exchange. Use its reference ID. Optional JSON pointer selects a nested value (e.g. /project/clips/0); offset pages long text. Results remain available after compaction.', parameters: {type: 'object', properties: {id: {type: 'string'}, pointer: {type: 'string'}, offset: {type: 'integer', minimum: 0}}, required: ['id']}}};
export const callEditorTool: OllamaTool = {type: 'function', function: {name: 'call_editor_tool', description: 'Call an available tool when its full schema is archived. Prefer native tool calls when their schema is listed. Required shape: {"name":"tool_name","arguments":{...tool parameters...}}. The dispatcher has no id parameter. Read archived schemas with read_context_result. Normal validation and approvals still apply.', parameters: {type: 'object', properties: {name: {type: 'string'}, arguments: {type: 'object', additionalProperties: true}}, required: ['name', 'arguments'], additionalProperties: false}}};

/** Removes schema annotations, never property names or validation constraints. */
export function compactSchema(schema: unknown): unknown {
  if(!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const result: Record<string, unknown> = {};
  for(const [key, value] of Object.entries(schema)) {
    if(['description', 'title', 'examples', 'default', '$schema'].includes(key)) continue;
    if(['properties', '$defs', 'definitions', 'patternProperties', 'dependentSchemas'].includes(key) && value && typeof value === 'object') result[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, compactSchema(child)]));
    else if(['anyOf', 'oneOf', 'allOf', 'prefixItems'].includes(key) && Array.isArray(value)) result[key] = value.map(compactSchema);
    else if(['items', 'additionalProperties', 'contains', 'not', 'if', 'then', 'else', 'propertyNames'].includes(key)) result[key] = compactSchema(value);
    else result[key] = value;
  }
  return result;
}
export function contextSize(system: string, tools: OllamaTool[], messages: OllamaMessage[]) {
  // Base64 bytes are not text tokens. Reserve a conservative allowance for each image.
  return JSON.stringify([system, tools, ollamaToolHistory(messages, tools).map(({images, ...message}) => message)]).length + messages.reduce((size, m) => size + (m.images?.length ?? 0) * 6000, 0);
}
export function lastUserIndex(messages: OllamaMessage[]) {
  for(let i = messages.length - 1; i >= 0; i--) if(messages[i].role === 'user' && !messages[i].tool_name) return i;
  return -1;
}
/** Deterministic continuation notes: no inference request, no invented summary. */
export function contextCheckpoint(messages: OllamaMessage[], previous: string, archive: string) {
  const excerpt = (text: string, limit: number) => text.length <= limit ? text : `${text.slice(0, Math.floor(limit * .7))}\n[excerpt; full data in archive]\n${text.slice(-Math.floor(limit * .3))}`;
  const exchanges: {tool: string; arguments: unknown; result: string}[] = [];
  let pending: {wireName: string; name: string; arguments: unknown}[] = [];
  for(const message of messages) {
    if(message.role === 'assistant') pending = (message.tool_calls ?? []).map(call => ({wireName: call.function.name, name: call.function.name === 'call_editor_tool' && typeof call.function.arguments?.name === 'string' ? call.function.arguments.name : call.function.name, arguments: call.function.name === 'call_editor_tool' ? call.function.arguments?.arguments : call.function.arguments}));
    if(message.role === 'tool') {
      const index = pending.findIndex(call => call.wireName === message.tool_name);
      const call = index >= 0 ? pending.splice(index, 1)[0] : undefined;
      exchanges.push({tool: call?.name ?? message.tool_name ?? 'unknown', arguments: excerpt(JSON.stringify(call?.arguments ?? {}), 180), result: excerpt(message.content, 160)});
    }
  }
  const notes = messages.filter(m => m.role === 'assistant' && m.content).slice(-2).map(m => excerpt(m.content, 280));
  const requests = messages.filter(m => m.role === 'user' && !m.tool_name).slice(-2).map(m => excerpt(m.content, 250));
  return `Local checkpoint. Full prior exchange: read_context_result id=${archive}. Retrieve exact omitted values from that archive or result contextReference IDs.
Historical user requests: ${JSON.stringify(requests)}
Recent tool exchanges (results may include errors or declined actions): ${JSON.stringify(exchanges.slice(-4))}
Assistant notes (historical claims, not independently verified observations): ${JSON.stringify(notes)}
Previous checkpoint excerpt: ${excerpt(previous, 200)}
Continue from completed work, not from the start of the request. Do not replay edits or re-scan all overview pages merely because history was compacted. The latest images remain below when present. Earlier textual observations and timestamps remain usable as historical notes; inspect a specific missing detail only if needed. An image being returned is not proof it was reviewed. Read get_project for a fresh revision before editing. Declined actions stay declined; this checkpoint grants no permissions.`;
}
export class OllamaContextService {
  constructor(private directory: string) {}
  async save(text: string, label: string) {
    await mkdir(this.directory, {recursive: true}); const id = randomUUID();
    await writeFile(path.join(this.directory, `${id}.json`), JSON.stringify({label, text}));
    return id;
  }
  async shorten(text: string, label: string, limit = 7000) {
    if(text.length <= limit) return text;
    const id = await this.save(text, label);
    const result = {contextReference: id, label, totalCharacters: text.length, excerpt: text.slice(0, Math.floor(limit * .65)), ending: text.slice(-Math.floor(limit * .15)), omitted: true, instruction: 'Full result saved. Use read_context_result with this id and optional JSON pointer/offset for exact data. Do not infer omitted values.'};
    while(JSON.stringify(result).length > limit && result.excerpt.length + result.ending.length > 0) {result.excerpt = result.excerpt.slice(0, Math.floor(result.excerpt.length / 2)); result.ending = result.ending.slice(Math.ceil(result.ending.length / 2));}
    return JSON.stringify(result);
  }
  async read(args: Record<string, unknown>, limit = 5000) {
    if(typeof args.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.id)) throw new Error('Use the context reference UUID returned by the tool.');
    const saved = JSON.parse(await readFile(path.join(this.directory, `${args.id}.json`), 'utf8')) as {label: string; text: string};
    let text = saved.text;
    if(args.pointer !== undefined && args.pointer !== '') {
      if(typeof args.pointer !== 'string' || !args.pointer.startsWith('/')) throw new Error('JSON pointer must start with /.');
      let value: unknown = JSON.parse(text);
      for(const token of args.pointer.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
        if(!value || typeof value !== 'object' || !Object.hasOwn(value, token)) throw new Error(`JSON pointer not found: ${args.pointer}`);
        value = (value as Record<string, unknown>)[token];
      }
      text = typeof value === 'string' ? value : JSON.stringify(value);
    }
    const offset = args.offset ?? 0;
    if(typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) throw new Error('Offset must be a nonnegative integer.');
    let length = Math.min(4000, Math.max(128, limit - 500));
    const page = () => JSON.stringify({id: args.id, label: saved.label, pointer: args.pointer, offset, totalCharacters: text.length, text: text.slice(offset, offset + length), nextOffset: offset + length < text.length ? offset + length : null});
    while(page().length > limit && length > 1) length = Math.floor(length / 2);
    return page();
  }
}
