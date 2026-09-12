import type {AgentOllamaRuntime} from '../../shared/agent';
import type {OllamaChatMetrics, OllamaRunningModel} from './ollama-client';

/** Bounded, repeatable editor generations. Context size is still the user's choice. */
export function ollamaGenerationOptions(contextLength: number) {
  return {num_ctx: contextLength, num_predict: 4096, temperature: 0.1};
}

/** Runtime allocation comes from /api/ps, never from a model's download size. */
export function ollamaRuntimeSnapshot(model: string, metrics: OllamaChatMetrics, running?: {models: OllamaRunningModel[]}): AgentOllamaRuntime {
  const loaded = running?.models.find(item => item.name === model || item.model === model);
  const finite = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
  const totalBytes = finite(loaded?.size); const vramBytes = finite(loaded?.size_vram);
  return {
    model, contextLength: finite(loaded?.context_length), totalBytes, vramBytes,
    cpuBytes: totalBytes !== undefined && vramBytes !== undefined ? Math.max(0, totalBytes - vramBytes) : undefined,
    promptTokens: metrics.promptTokens, outputTokens: metrics.outputTokens, doneReason: metrics.doneReason,
    tokensPerSecond: metrics.outputTokens !== undefined && metrics.evalDurationNs && metrics.evalDurationNs > 0 ? metrics.outputTokens / metrics.evalDurationNs * 1e9 : undefined,
    generationMilliseconds: metrics.totalDurationNs !== undefined ? metrics.totalDurationNs / 1e6 : undefined,
    loadMilliseconds: metrics.loadDurationNs !== undefined ? metrics.loadDurationNs / 1e6 : undefined,
  };
}
