export interface OllamaCall {function: {name: string; arguments: Record<string, unknown>}}
export interface OllamaMessage {role: 'user' | 'assistant' | 'tool' | 'system'; content: string; thinking?: string; tool_name?: string; tool_calls?: OllamaCall[]; images?: string[]}
export interface OllamaTool {type: 'function'; function: {name: string; description: string; parameters: Record<string, unknown>}}
export interface OllamaChatMetrics {
  doneReason?: string; promptTokens?: number; outputTokens?: number;
  totalDurationNs?: number; loadDurationNs?: number; promptEvalDurationNs?: number; evalDurationNs?: number;
}
export interface OllamaRunningModel {name?: string; model?: string; size?: number; size_vram?: number; context_length?: number}

function chatMetrics(part: Record<string, unknown>): OllamaChatMetrics {
  const number = (key: string) => typeof part[key] === 'number' && Number.isFinite(part[key]) && part[key] >= 0 ? part[key] : undefined;
  return {
    doneReason: typeof part.done_reason === 'string' ? part.done_reason : undefined,
    promptTokens: number('prompt_eval_count'), outputTokens: number('eval_count'),
    totalDurationNs: number('total_duration'), loadDurationNs: number('load_duration'),
    promptEvalDurationNs: number('prompt_eval_duration'), evalDurationNs: number('eval_duration'),
  };
}

export function isOllamaToolParserError(error: unknown): boolean {
  return error instanceof Error && /XML syntax error|(?:failed to parse|error parsing) tool call/i.test(error.message);
}

export class OllamaClient {
  constructor(readonly url: string, private readonly generationTimeoutMs = 180_000) {}
  private async request(route: string, body?: unknown, signal?: AbortSignal) {
    let response: Response;
    try {response = await fetch(`${this.url.replace(/\/$/, '')}/api/${route}`, {method: body === undefined ? 'GET' : 'POST', headers: {'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body), signal: signal ?? AbortSignal.timeout(15000), redirect: 'error'});}
    catch(error) {if(signal?.aborted) throw error; throw new Error(`Cannot reach Ollama at ${this.url}: ${(error as Error).message}`);}
    if(!response.ok) throw new Error(`Ollama ${response.status}: ${(await response.text()).slice(0, 2000)}`);
    return response;
  }
  async models() {return await (await this.request('tags')).json() as {models: {name: string}[]};}
  async show(model: string) {return await (await this.request('show', {model})).json() as {capabilities?: string[]; remote_host?: string; remote_model?: string};}
  async running(signal?: AbortSignal) {
    return await (await this.request('ps', undefined, signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : undefined)).json() as {models: OllamaRunningModel[]};
  }
  async chat(body: Record<string, unknown>, signal: AbortSignal, onMessage: (part: Partial<OllamaMessage>) => void, stream = true): Promise<OllamaChatMetrics> {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), this.generationTimeoutMs); timer.unref();
    const combinedSignal = AbortSignal.any([signal, deadline.signal]);
    try {return await this.receiveChat(body, combinedSignal, onMessage, stream);}
    catch(error) {
      if(signal.aborted) throw signal.reason;
      if(deadline.signal.aborted) throw new Error(`Ollama took more than ${Math.round(this.generationTimeoutMs / 1000)} seconds for one response. Try a smaller model or the 16 GB context preset, and check whether Ollama is using GPU memory. No tool calls from this incomplete response were executed.`);
      throw error;
    } finally {clearTimeout(timer);}
  }
  private async receiveChat(body: Record<string, unknown>, signal: AbortSignal, onMessage: (part: Partial<OllamaMessage>) => void, stream: boolean): Promise<OllamaChatMetrics> {
    signal.throwIfAborted();
    const response = await this.request('chat', {...body, stream, keep_alive: '5m'}, signal);
    if(!stream) {
      const part = await response.json();
      if(part.error) throw new Error(String(part.error));
      if(part.done !== true || !part.message) throw new Error('Ollama disconnected before completing its response');
      signal.throwIfAborted();
      onMessage(part.message);
      return chatMetrics(part);
    }
    if(!response.body) throw new Error('Ollama returned an empty response');
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let metrics: OllamaChatMetrics | undefined;
    const consume = (line: string) => {
      if(!line.trim()) return;
      const part = JSON.parse(line); if(part.error) throw new Error(String(part.error));
      if(part.message) onMessage(part.message); if(part.done === true) metrics = chatMetrics(part);
    };
    try {
      while(!metrics) {
        const result = await reader.read(); if(result.done) break;
        buffer += decoder.decode(result.value, {stream: true});
        let end: number; while(!metrics && (end = buffer.indexOf('\n')) >= 0) {consume(buffer.slice(0, end)); buffer = buffer.slice(end + 1);}
        if(buffer.length > 16 * 1024 * 1024) throw new Error('Ollama returned an oversized stream record');
      }
      if(!metrics) consume(buffer + decoder.decode());
      signal.throwIfAborted();
      if(!metrics) throw new Error('Ollama disconnected before completing its response');
      return metrics;
    } finally {await reader.cancel().catch(() => undefined); reader.releaseLock();}
  }
}
