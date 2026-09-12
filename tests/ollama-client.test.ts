import {afterEach, expect, it, vi} from 'vitest';
import {OllamaClient} from '../server/services/ollama-client';
import {agentProviderSettingsSchema} from '../shared/agent';
import {ollamaGenerationOptions, ollamaRuntimeSnapshot} from '../server/services/ollama-runtime';

afterEach(() => vi.unstubAllGlobals());
it('decodes split UTF-8/NDJSON chunks and exposes complete tool calls', async () => {
  const payload = new TextEncoder().encode(JSON.stringify({message: {role: 'assistant', content: 'Café 🎬'}}) + '\n' + JSON.stringify({message: {tool_calls: [{function: {name: 'get_project', arguments: {}}}]}, done: true}) + '\n');
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(new ReadableStream({start(controller) {for(const byte of payload) controller.enqueue(new Uint8Array([byte])); controller.close();}})));
  vi.stubGlobal('fetch', fetcher);
  const parts: unknown[] = [];
  await new OllamaClient('http://192.168.1.50:11434/').chat({model: 'local'}, new AbortController().signal, part => parts.push(part));
  expect(parts).toEqual([{role: 'assistant', content: 'Café 🎬'}, {tool_calls: [{function: {name: 'get_project', arguments: {}}}]}]);
  expect(fetcher.mock.calls[0][0]).toBe('http://192.168.1.50:11434/api/chat');
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).keep_alive).toBe('5m');
});
it('rejects an incomplete stream and propagates server errors', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":{"content":"partial"}}\n')));
  await expect(new OllamaClient('http://localhost:11434').chat({}, new AbortController().signal, () => undefined)).rejects.toThrow('before completing');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"model needs more memory"}\n')));
  await expect(new OllamaClient('http://localhost:11434').chat({}, new AbortController().signal, () => undefined)).rejects.toThrow('more memory');
});
it('requests a complete nonstreaming response and never emits incomplete output', async () => {
  const message = {role: 'assistant', content: '', tool_calls: [{function: {name: 'get_project', arguments: {}}}]};
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({message, done: true}));
  vi.stubGlobal('fetch', fetcher);
  const receive = vi.fn(); const client = new OllamaClient('http://localhost:11434');
  await client.chat({}, new AbortController().signal, receive, false);
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).stream).toBe(false);
  expect(receive).toHaveBeenCalledExactlyOnceWith(message);
  receive.mockClear(); fetcher.mockImplementation(async () => Response.json({message, done: false}));
  await expect(client.chat({}, new AbortController().signal, receive, false)).rejects.toThrow('before completing');
  expect(receive).not.toHaveBeenCalled();
});
it('accepts LAN hosts and HTTPS prefixes but rejects non-HTTP URLs and embedded credentials', () => {
  for(const url of ['http://192.168.1.50:11434', 'https://ollama.example.test/models']) expect(agentProviderSettingsSchema.safeParse({provider: 'ollama', ollamaUrl: url}).success).toBe(true);
  for(const url of ['file:///tmp/model', 'http://user:password@host', 'http://host/?token=secret']) expect(agentProviderSettingsSchema.safeParse({provider: 'ollama', ollamaUrl: url}).success).toBe(false);
});
it.each([true, false])('returns terminal metrics, including output truncation (stream=%s)', async stream => {
  const terminal = {done: true, done_reason: 'length', message: {content: '', tool_calls: [{function: {name: 'save_video_cut', arguments: {}}}]}, prompt_eval_count: 1800, eval_count: 4096, total_duration: 9e9, load_duration: 2e9, prompt_eval_duration: 3e9, eval_duration: 4e9};
  const cancel = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => stream ? new Response(new ReadableStream({start(controller) {controller.enqueue(new TextEncoder().encode(JSON.stringify(terminal) + '\n'));}, cancel})) : Response.json(terminal)));
  const metrics = await new OllamaClient('http://localhost:11434').chat({}, new AbortController().signal, () => undefined, stream);
  expect(metrics).toEqual({doneReason: 'length', promptTokens: 1800, outputTokens: 4096, totalDurationNs: 9e9, loadDurationNs: 2e9, promptEvalDurationNs: 3e9, evalDurationNs: 4e9});
  if(stream) expect(cancel).toHaveBeenCalledOnce();
});
it('times out a stalled response body even with an external signal', async () => {
  const external = new AbortController();
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => new Response(new ReadableStream({start(controller) {
    controller.enqueue(new TextEncoder().encode('{"message":{"content":"partial"}}\n'));
    init.signal!.addEventListener('abort', () => controller.error(init.signal!.reason), {once: true});
  }}))));
  await expect(new OllamaClient('http://localhost:11434', 10).chat({}, external.signal, () => undefined)).rejects.toThrow('No tool calls from this incomplete response were executed');
  expect(external.signal.aborted).toBe(false);
});
it('preserves explicit cancellation instead of reporting a timeout', async () => {
  const external = new AbortController(); const reason = new Error('User interrupted');
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason), {once: true}))));
  const response = new OllamaClient('http://localhost:11434').chat({}, external.signal, () => undefined);
  external.abort(reason);
  await expect(response).rejects.toBe(reason);
});
it('reads actual runtime allocation and calculates inference speed independently of model download sizes', async () => {
  const models = [{name: 'local:9b', size: 10 * 1024 ** 3, size_vram: 8 * 1024 ** 3, context_length: 16384}];
  const fetcher = vi.fn(async () => Response.json({models})); vi.stubGlobal('fetch', fetcher);
  const running = await new OllamaClient('http://localhost:11434').running();
  expect(fetcher).toHaveBeenCalledWith('http://localhost:11434/api/ps', expect.objectContaining({method: 'GET'}));
  expect(ollamaGenerationOptions(16384)).toEqual({num_ctx: 16384, num_predict: 4096, temperature: 0.1});
  expect(ollamaRuntimeSnapshot('local:9b', {outputTokens: 100, evalDurationNs: 2e9, totalDurationNs: 3e9}, running)).toMatchObject({contextLength: 16384, vramBytes: 8 * 1024 ** 3, cpuBytes: 2 * 1024 ** 3, tokensPerSecond: 50, generationMilliseconds: 3000});
  expect(ollamaRuntimeSnapshot('other', {}, running).vramBytes).toBeUndefined();
});
