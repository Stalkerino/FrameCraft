import {afterEach, expect, it, vi} from 'vitest';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {OllamaSessionService} from '../server/services/ollama-session-service';

const mcpState = vi.hoisted(() => ({failAnalysis: false, calls: [] as string[], structuredImage: false, savedCuts: [] as Record<string, unknown>[]}));
vi.mock('../server/services/agent-mcp-client', () => ({AgentMcpClient: class {
  tools = ['get_project', 'inspect_video', 'get_video_analysis', 'save_video_cut'].map(name => ({name, description: name, inputSchema: {type: 'object', properties: {}}}));
  async connect() {}
  async close() {}
  async call(name: string, args: Record<string, unknown>) {
    mcpState.calls.push(name);
    if(name === 'save_video_cut') mcpState.savedCuts.push(structuredClone(args));
    if(mcpState.failAnalysis && name === 'get_video_analysis') return {isError: true, content: [{type: 'text', text: 'Invalid reportId'}]};
    if(name === 'inspect_video') expect([{inspection: {reportId: '88926f48-23b5-4ae7-bffa-6f704751c09f', time: 6}}, {inspection: {reportId: '88926f48-23b5-4ae7-bffa-6f704751c09f', start: 310, end: 357}}]).toContainEqual(args);
    return name === 'inspect_video' ? {content: [{type: 'text', text: mcpState.structuredImage ? JSON.stringify({reportId: '88926f48-23b5-4ae7-bffa-6f704751c09f', frames: [{index: 0, time: 6, timecode: '00:00:06.000'}]}) : 'Frame at 1 second'}, {type: 'image', mimeType: 'image/png', data: 'dGVzdA=='}]} : {content: [{type: 'text', text: '{"project":{"revision":1}}'}]};
  }
}}));
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {for(const clean of cleanups.splice(0)) await clean(); vi.unstubAllGlobals(); mcpState.failAnalysis = false; mcpState.structuredImage = false; mcpState.calls = []; mcpState.savedCuts = [];});
async function session() {
  const directory = await mkdtemp(path.join(tmpdir(), 'fc-ollama-test-'));
  const service = new OllamaSessionService({root: process.cwd(), data: directory, url: 'http://localhost:4319'}, () => ({provider: 'ollama', ollamaUrl: 'http://ollama.test:11434', contextLength: 32768, workspaceAccess: 'disabled', workspacePath: ''}));
  cleanups.push(async () => {await service.interrupt(); service.close(); await rm(directory, {recursive: true, force: true});});
  return {directory, service};
}
function metadata(url: string) {
  if(url.endsWith('/ps')) return Response.json({models: []});
  if(url.endsWith('/tags')) return Response.json({models: [{name: 'test:vision'}]});
  if(url.endsWith('/show')) return Response.json({capabilities: ['tools', 'vision']});
}
it.each([false, true])('executes the flat numeric-string inspection from logs (dispatcher: %s)', async wrapped => {
  let round = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const meta = metadata(url); if(meta) return meta;
    const body = JSON.parse(init.body as string); round++;
    const definition = body.tools.find((t: {function: {name: string}}) => t.function.name === 'inspect_video');
    expect(definition.function.parameters.required).toEqual(['reportId']);
    expect(definition.function.parameters.properties).not.toHaveProperty('inspection');
    if(round === 2) {
      const previous = body.messages.find((m: {tool_calls?: unknown[]}) => m.tool_calls?.length).tool_calls[0].function.arguments;
      expect(wrapped ? previous.arguments : previous).toEqual({reportId: '88926f48-23b5-4ae7-bffa-6f704751c09f', start: 310, end: 357});
    }
    const args = {reportId: '88926f48-23b5-4ae7-bffa-6f704751c09f', start: '310', end: '357'};
    const message = round === 1 ? {role: 'assistant', content: '', tool_calls: [{function: {name: wrapped ? 'call_editor_tool' : 'inspect_video', arguments: wrapped ? {name: 'inspect_video', arguments: args} : args}}]} : {role: 'assistant', content: 'Inspection returned.'};
    return Response.json({message, done: true});
  }));
  const {service} = await session(); await service.start(); await service.send('Use inspect_video on the ending');
  await vi.waitFor(() => expect(service.snapshot().status).toBe('ready'));
  expect(service.snapshot().error).toBeNull(); expect(round).toBe(2);
  expect(service.snapshot().activity.some(a => a.label === 'inspect_video' && a.status === 'completed')).toBe(true);
});
it('keeps historical tools valid after discovery changes and resuming saved conversation', async () => {
  let round = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const meta = metadata(url); if(meta) return meta;
    const body = JSON.parse(init.body as string); round++;
    const declared = body.tools.map((tool: {function: {name: string}}) => tool.function.name);
    for(const message of body.messages) {
      for(const call of message.tool_calls ?? []) expect(declared).toContain(call.function.name);
      if(message.role === 'tool') expect(declared).toContain(message.tool_name);
    }
    if(round === 4) expect(declared).toContain('get_video_analysis');
    if(round >= 5) {
      expect(declared).not.toContain('get_video_analysis');
      expect(JSON.stringify(body.messages)).toContain('get_video_analysis');
      expect(body.messages.some((m: {tool_calls?: {function: {name: string; arguments: {name?: string}}}[]}) => m.tool_calls?.some(c => c.function.name === 'call_editor_tool' && c.function.arguments.name === 'get_video_analysis'))).toBe(true);
    }
    const call = (name: string, args: unknown) => ({role: 'assistant', content: '', tool_calls: [{function: {name, arguments: args}}]});
    const message = round === 1 ? call('discover_tools', {names: ['get_video_analysis']})
      : round === 2 ? call('get_video_analysis', {})
      : round === 3 ? call('discover_tools', {names: ['inspect_video']})
      : {role: 'assistant', content: 'Ready.'};
    return Response.json({message, done: true});
  }));
  const {directory, service} = await session(); await service.start(); await service.send('Find a video report');
  await vi.waitFor(() => expect(service.snapshot().status).toBe('ready'));
  expect(service.snapshot().error).toBeNull(); expect(round).toBe(4);
  await service.init(); await service.send('Continue with that report');
  await vi.waitFor(() => expect(service.snapshot().status).toBe('ready'));
  expect(service.snapshot().error).toBeNull(); expect(round).toBe(5);
  expect(service.snapshot().activity.filter(a => a.label === 'get_video_analysis')).toHaveLength(1);
  const saved = JSON.parse(await readFile(path.join(directory, 'ollama-session.json'), 'utf8'));
  expect(saved.history.some((m: {tool_name?: string}) => m.tool_name === 'get_video_analysis')).toBe(true);
});
it('accepts known calls without discovery and recovers the malformed dispatcher from the logs', async () => {
  let round = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const meta = metadata(url); if(meta) return meta;
    const body = JSON.parse(init.body as string); round++;
    if(round === 3) {
      expect(body.messages.at(-1).content).toContain('Malformed call_editor_tool');
      expect(body.messages.at(-1).content).not.toContain('not enabled');
      expect(body.tools.some((t: {function: {name: string}}) => t.function.name === 'inspect_video')).toBe(true);
    }
    if(round === 5) expect(body.tools.some((t: {function: {name: string}}) => t.function.name === 'inspect_video')).toBe(true);
    const call = (name: string, args: unknown) => ({role: 'assistant', content: '', tool_calls: [{function: {name, arguments: args}}]});
    const message = round === 1 ? call('get_video_analysis', {})
      : round === 2 ? call('call_editor_tool', {name: 'inspect_video', id: '{"reportId":"88926f48-23b5-4ae7-bffa-6f704751c09f","page":1}'})
      : round === 3 || round === 5 ? call('inspect_video', {inspection: {reportId: '88926f48-23b5-4ae7-bffa-6f704751c09f', time: 6}})
      : round === 4 ? call('discover_tools', {names: ['get_video_analysis']})
      : {role: 'assistant', content: 'Inspections completed.'};
    return Response.json({message, done: true});
  }));
  const {service} = await session(); await service.start(); await service.send('Inspect my video');
  await vi.waitFor(() => expect(service.snapshot().status).toBe('ready'));
  expect(service.snapshot().error).toBeNull(); expect(round).toBe(6);
  expect(service.snapshot().activity.filter(a => a.label === 'inspect_video' && a.status === 'completed')).toHaveLength(2);
  expect(service.snapshot().activity.some(a => a.label === 'get_video_analysis' && a.status === 'completed')).toBe(true);
});
it('stops repeated malformed dispatcher calls instead of looping or silently succeeding', async () => {
  let round = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const meta = metadata(url); if(meta) return meta;
    round++;
    return Response.json({message: {role: 'assistant', content: '', tool_calls: [{function: {name: 'call_editor_tool', arguments: {name: 'inspect_video', id: '{"page":1}'}}}]}, done: true});
  }));
  const {service} = await session(); await service.start(); await service.send('Inspect');
  await vi.waitFor(() => expect(service.snapshot().status).toBe('ready'));
  expect(round).toBe(3); expect(service.snapshot().error).toContain('Stopped the error loop');
  expect(service.snapshot().activity.filter(a => a.label === 'inspect_video' && a.status === 'completed')).toHaveLength(0);
});
it.each(['http', 'stream'])('recovers an Ollama XML parser failure (%s) without executing partial tool calls', async failure => {
  let round = 0;
  const call = {function: {name: 'get_project', arguments: {}}};
  const parserError = 'XML syntax error on line 32: unexpected EOF';
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const meta = metadata(url); if(meta) return meta;
    const body = JSON.parse(init.body as string); round++;
    if(round === 1) {
      expect(body.stream).toBe(true);
      if(failure === 'http') return Response.json({error: parserError}, {status: 500});
      return new Response(JSON.stringify({message: {content: 'Incomplete attempt', thinking: 'Partial thought', tool_calls: [call]}}) + '\n' + JSON.stringify({error: parserError}) + '\n');
    }
    expect(body.stream).toBe(false);
    expect(JSON.stringify(body.messages)).not.toContain('Incomplete attempt');
    if(round === 2) return Response.json({message: {role: 'assistant', content: '', tool_calls: [call]}, done: true});
    expect(body.messages.filter((m: {role: string}) => m.role === 'tool')).toHaveLength(1);
    return Response.json({message: {role: 'assistant', content: 'Recovered.'}, done: true});
  }));
  const {directory, service} = await session(); await service.start(); await service.send('Read the timeline');
  await vi.waitFor(() => expect(service.snapshot().status).toBe('ready'));
  const state = service.snapshot();
  expect(round).toBe(3); expect(state.error).toBeNull();
  expect(state.activity.filter(a => a.label === 'get_project')).toHaveLength(1);
  expect(state.activity.some(a => a.label === 'Recovering Ollama response' && a.status === 'completed')).toBe(true);
  expect(state.activity.some(a => a.status === 'inProgress')).toBe(false);
  expect(state.messages.map(m => m.text)).toEqual(['Read the timeline', 'Recovered.']);
  const saved = JSON.parse(await readFile(path.join(directory, 'ollama-session.json'), 'utf8'));
  expect(JSON.stringify(saved.history)).not.toContain('Incomplete attempt');
});
it.each([
  ['XML syntax error on line 32: unexpected EOF', 2],
  ['model needs more memory', 1],
] as const)('bounds retries for %s', async (error, expectedRequests) => {
  let requests = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const meta = metadata(url); if(meta) return meta;
    requests++; return Response.json({error}, {status: 500});
  }));
  const {service} = await session(); await service.start(); await service.send('Read the timeline');
  await vi.waitFor(() => expect(service.snapshot().status).toBe('ready'));
  expect(requests).toBe(expectedRequests); expect(service.snapshot().error).toContain(error);
  expect(service.snapshot().activity.some(a => a.label === 'get_project')).toBe(false);
});
it.each([false, true])('forwards MCP images after inspection normalization (serialized JSON: %s)', async serialized => {
  let round = 0; let sawImage = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const meta = metadata(url); if(meta) return meta;
    const inspection = {reportId: '88926f48-23b5-4ae7-bffa-6f704751c09f', start: 6, end: 6};
    const body = JSON.parse(init.body as string); const message = round++ === 0 ? {role: 'assistant', content: '', tool_calls: [{function: {name: 'discover_tools', arguments: {names: ['inspect_video']}}}]} : round === 2 ? {role: 'assistant', content: '', tool_calls: [{function: {name: 'inspect_video', arguments: {inspection: serialized ? JSON.stringify(inspection) : inspection}}}]} : {role: 'assistant', content: 'Inspected the frame.'};
    if(round === 3) {sawImage = body.messages.some((m: {images?: string[]}) => m.images?.[0] === 'dGVzdA==');}
    return new Response(JSON.stringify({message, done: true}) + '\n');
  }));
  const {directory, service} = await session(); await service.start(); await service.send('Inspect a frame');
  await vi.waitFor(() => expect(service.snapshot().status).toBe('ready'));
  expect(service.snapshot().error).toBeNull(); expect(sawImage).toBe(true);
  expect(service.snapshot().activity.some(a => a.label === 'inspect_video' && a.detail.includes('Interpreted start=end=6'))).toBe(true);
  const saved = await readFile(path.join(directory, 'ollama-session.json'), 'utf8'); expect(saved).not.toContain('dGVzdA=='); expect(saved).toContain('Images omitted');
});
it.each([false, true])('requests native calls after leaked tool syntax without executing text (persistent: %s)', async persistent => {
  let rounds = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const meta = metadata(url); if(meta) return meta;
    rounds++;
    const message = rounds === 1 || persistent ? {role: 'assistant', content: 'get_project[ARGS]{}'}
      : rounds === 2 ? {role: 'assistant', content: '', tool_calls: [{function: {name: 'get_project', arguments: {}}}]}
      : {role: 'assistant', content: 'Read project.'};
    return Response.json({message, done: true});
  }));
  const {service} = await session(); await service.start(); await service.send('Read project');
  await vi.waitFor(() => expect(service.snapshot().status).toBe('ready'));
  expect(rounds).toBe(persistent ? 2 : 3);
  expect(service.snapshot().activity.filter(a => a.label === 'get_project')).toHaveLength(persistent ? 0 : 1);
  if(persistent) expect(service.snapshot().error).toContain('plain text');
  else expect(service.snapshot().error).toBeNull();
});
it('stops an in-flight model request and returns the session to ready', async () => {
  let generating = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const meta = metadata(url); if(meta) return meta;
    generating = true;
    return await new Promise<Response>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('Aborted')), {once: true}));
  }));
  const {service} = await session(); await service.start(); await service.send('Wait');
  await vi.waitFor(() => expect(generating).toBe(true)); await service.interrupt();
  expect(service.snapshot().status).toBe('ready'); expect(service.snapshot().turnId).toBeNull(); expect(service.snapshot().error).toBeNull();
});
it('retains the latest image batch across local compaction instead of restarting inspection', async () => {
  let rounds = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const meta = metadata(url); if(meta) return meta;
    const body = JSON.parse(init.body as string); rounds++;
    expect(body.tools).toBeDefined();
    if(rounds === 2) {
      expect(body.messages.filter((m: {images?: string[]}) => m.images?.length)).toHaveLength(4);
      expect(body.messages[0].content).toContain('Local checkpoint');
      expect(body.messages.filter((m: {role: string}) => m.role === 'tool')).toHaveLength(4);
    }
    const message = rounds === 1 ? {role: 'assistant', content: 'Inspection plan. '.repeat(4000), tool_calls: Array.from({length: 4}, () => ({function: {name: 'inspect_video', arguments: {reportId: '88926f48-23b5-4ae7-bffa-6f704751c09f', time: 6}}}))} : {role: 'assistant', content: 'Batch reviewed.'};
    return Response.json({message, done: true});
  }));
  const {service} = await session(); await service.start(); await service.send('Use inspect_video to review the frames');
  await vi.waitFor(() => expect(service.snapshot().status).toBe('ready'));
  expect(service.snapshot().error).toBeNull(); expect(rounds).toBe(2);
  expect(service.snapshot().activity.filter(a => a.label === 'inspect_video' && a.status === 'completed')).toHaveLength(4);
  expect(service.snapshot().activity.some(a => a.label === 'Compacting conversation' && a.status === 'completed')).toBe(true);
});
it('compacts locally inside one long task without model summarization or replaying tools', async () => {
  let rounds = 0; let summaries = 0; const goal = 'Review the complete source; keep its ending and do not delete audio.';
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const meta = metadata(url); if(meta) return meta;
    const body = JSON.parse(init.body as string);
    if(!body.tools) {summaries++; throw new Error('Compaction must not call the model');}
    expect(body.messages.some((m: {role: string; content: string}) => m.role === 'user' && m.content === goal)).toBe(true);
    // Compaction must never leave a dangling tool result or replay an old call.
    let pending = 0;
    for(const m of body.messages) {if(m.role === 'assistant') pending += m.tool_calls?.length ?? 0; if(m.role === 'tool') pending--; expect(pending).toBeGreaterThanOrEqual(0);}
    expect(pending).toBe(0);
    rounds++;
    const message = rounds <= 8 ? {role: 'assistant', content: `Inspection ${rounds}. ` + 'Visual observations. '.repeat(700), tool_calls: [{function: {name: 'get_project', arguments: {}}}]} : {role: 'assistant', content: 'Review complete.'};
    return new Response(JSON.stringify({message, done: true}) + '\n');
  }));
  const {directory, service} = await session(); await service.start(); await service.send(goal);
  await vi.waitFor(() => expect(service.snapshot().status).toBe('ready'));
  expect(service.snapshot().error).toBeNull(); expect(summaries).toBe(0); expect(rounds).toBe(9);
  expect(service.snapshot().activity.filter(a => a.label === 'get_project')).toHaveLength(8);
  expect(service.snapshot().activity.some(a => a.label === 'Compacting conversation' && a.status === 'completed')).toBe(true);
  const saved = JSON.parse(await readFile(path.join(directory, 'ollama-session.json'), 'utf8'));
  expect(saved.memory).toContain('read_context_result'); expect(saved.history.some((m: {content: string}) => m.content === goal)).toBe(true);
});

it('counts MCP error results even when successful reads occur between failed calls', async () => {
  let round = 0; mcpState.failAnalysis = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const meta = metadata(url); if(meta) return meta;
    const name = ++round % 2 ? 'get_video_analysis' : 'get_project';
    return Response.json({message: {role: 'assistant', content: '', tool_calls: [{function: {name, arguments: {}}}]}, done: true});
  }));
  const {service} = await session(); await service.start(); await service.send('Read the video analysis');
  await vi.waitFor(() => expect(service.snapshot().status).toBe('ready'));
  expect(round).toBe(5); expect(service.snapshot().error).toContain('Stopped the error loop');
  expect(mcpState.calls.filter(name => name === 'get_video_analysis')).toHaveLength(3);
});

it('recovers a reversed cut through targeted repair and executes only the corrected proposal', async () => {
  let round = 0;
  const proposal = {revision: 305, reportId: '88926f48-23b5-4ae7-bffa-6f704751c09f', title: 'Devlog', shots: [{id: 'loadout', start: 36, end: 28, evidence: [12, 20], confidence: 'high', reason: 'Loadout menu'}]};
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const meta = metadata(url); if(meta) return meta;
    const body = JSON.parse(init.body as string); round++;
    const call = (name: string, args: unknown) => ({role: 'assistant', content: '', tool_calls: [{function: {name, arguments: args}}]});
    let message;
    if(round === 1) message = call('save_video_cut', proposal);
    else if(round === 2) {
      expect(mcpState.savedCuts).toHaveLength(0);
      const failure = body.messages.at(-1).content;
      expect(failure).toContain('strictly greater'); expect(failure).toContain('"start":36');
      expect(body.tools.some((tool: {function: {name: string}}) => tool.function.name === 'repair_video_cut')).toBe(true);
      const draftId = /draftId=([0-9a-f-]{36})/.exec(failure)![1];
      message = call('repair_video_cut', {draftId, changes: [{id: 'loadout', start: 12}]});
    } else message = {role: 'assistant', content: 'Corrected proposal saved.'};
    return Response.json({message, done: true});
  }));
  const {directory, service} = await session(); await service.start(); service.setAutoApprove(true); await service.send('Save the cut');
  await vi.waitFor(() => expect(service.snapshot().status).toBe('ready'));
  expect(service.snapshot().error).toBeNull(); expect(round).toBe(3);
  expect(mcpState.savedCuts).toEqual([{...proposal, goal: '', expectedVersion: null, shots: [{...proposal.shots[0], start: 12}]}]);
  expect(JSON.parse(await readFile(path.join(directory, 'ollama-session.json'), 'utf8')).cutDraft).toBeNull();
});

it('never executes calls from an output-truncated generation', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => metadata(url) ?? Response.json({message: {role: 'assistant', content: '', tool_calls: [{function: {name: 'get_project', arguments: {}}}]}, done: true, done_reason: 'length'})));
  const {service} = await session(); await service.start(); await service.send('Read project');
  await vi.waitFor(() => expect(service.snapshot().status).toBe('ready'));
  expect(service.snapshot().error).toContain('truncated response'); expect(mcpState.calls).toEqual([]);
});

it('continues inspection and saves a cut without requiring a separate observation call', async () => {
  mcpState.structuredImage = true; let round = 0;
  const reportId = '88926f48-23b5-4ae7-bffa-6f704751c09f';
  const description = 'Red title on black background; small text is unclear.';
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const meta = metadata(url); if(meta) return meta;
    const body = JSON.parse(init.body as string); round++;
    if(round >= 3) expect(body.messages[0].content).toContain(description);
    const call = (name: string, args: unknown, content = '') => ({role: 'assistant', content, thinking: 'Private transient reasoning', tool_calls: [{function: {name, arguments: args}}]});
    const message = round <= 2 ? call('inspect_video', {reportId, time: 6}, round === 2 ? description : '')
      : round === 3 ? call('save_video_cut', {revision: 1, reportId, title: 'Title shot', shots: [{id: 'title', start: 5, end: 7, evidence: [6], confidence: 'medium', reason: 'Title'}]}, description)
      : {role: 'assistant', content: 'Proposal saved.'};
    return Response.json({message, done: true});
  }));
  const {directory, service} = await session(); await service.start(); service.setAutoApprove(true); await service.send('Inspect the source and save a cut');
  await vi.waitFor(() => expect(service.snapshot().status).toBe('ready'));
  expect(service.snapshot().error).toBeNull(); expect(round).toBe(4);
  expect(mcpState.calls).toEqual(['inspect_video', 'inspect_video', 'save_video_cut']);
  const saved = JSON.parse(await readFile(path.join(directory, 'ollama-session.json'), 'utf8'));
  expect(saved.work.observations).toEqual([]);
  expect(saved.work.comments).toContainEqual({reportId, frames: [6], text: description});
  expect(saved.work.reports[0].notedPages).toEqual([]);
  expect(JSON.stringify(saved.history)).not.toContain('Private transient reasoning');
  await service.init(); expect(service.snapshot().error).toBeNull();
});

it('accepts prose after inspection without a forced retry and retains its image on continuation compaction', async () => {
  mcpState.structuredImage = true; let round = 0;
  const reportId = '88926f48-23b5-4ae7-bffa-6f704751c09f';
  const description = 'Red title on black background. ' + 'Small text is unclear. '.repeat(4000);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const meta = metadata(url); if(meta) return meta;
    const body = JSON.parse(init.body as string); round++;
    if(round === 3) {
      const images = body.messages.filter((message: {images?: string[]}) => message.images?.length);
      expect(images).toHaveLength(1);
      expect(images[0].content).toContain(reportId);
      expect(images[0].content).toContain('"time":6');
      expect(body.messages[0].content).toContain('Local checkpoint');
      expect(body.messages[0].content).toContain('Red title on black background');
    }
    const message = round === 1 ? {role: 'assistant', content: '', tool_calls: [{function: {name: 'inspect_video', arguments: {reportId, time: 6}}}]}
      : {role: 'assistant', content: round === 2 ? description : 'Ready to continue.'};
    return Response.json({message, done: true});
  }));
  const {directory, service} = await session(); await service.start(); await service.send('Inspect the source');
  await vi.waitFor(() => expect(service.snapshot().status).toBe('ready'));
  expect(service.snapshot().error).toBeNull(); expect(round).toBe(2);
  const saved = JSON.parse(await readFile(path.join(directory, 'ollama-session.json'), 'utf8'));
  expect(saved.work.comments).toEqual([{reportId, frames: [6], text: description}]);
  await service.send('Continue');
  await vi.waitFor(() => expect(service.snapshot().status).toBe('ready'));
  expect(service.snapshot().error).toBeNull(); expect(round).toBe(3);
  expect(mcpState.calls).toEqual(['inspect_video']);
});

it('still accepts optional timestamped observations and persists them independently of reasoning', async () => {
  mcpState.structuredImage = true; let round = 0;
  const reportId = '88926f48-23b5-4ae7-bffa-6f704751c09f';
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const meta = metadata(url); if(meta) return meta;
    round++;
    const message = round <= 2 ? {role: 'assistant', content: '', thinking: 'Private transient reasoning', tool_calls: [{function: round === 1
      ? {name: 'inspect_video', arguments: {reportId, time: 6}}
      : {name: 'record_video_observations', arguments: {reportId, observations: [{time: 6, description: 'Red title on black background', confidence: 'high'}]}}}]}
      : {role: 'assistant', content: 'Visual observations saved.'};
    return Response.json({message, done: true});
  }));
  const {directory, service} = await session(); await service.start(); await service.send('Inspect the source');
  await vi.waitFor(() => expect(service.snapshot().status).toBe('ready'));
  expect(service.snapshot().error).toBeNull(); expect(round).toBe(3);
  const saved = JSON.parse(await readFile(path.join(directory, 'ollama-session.json'), 'utf8'));
  expect(saved.work.observations).toEqual([{reportId, time: 6, description: 'Red title on black background', confidence: 'high'}]);
  expect(JSON.stringify(saved.history)).not.toContain('Private transient reasoning');
});
