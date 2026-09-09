import {pipeline, env} from '@huggingface/transformers';
import {readFile} from 'node:fs/promises';
import {availableParallelism} from 'node:os';
import type {InferenceRequest, InferenceMessage, InferenceResult} from '../../shared/inference';

const send = (message: InferenceMessage) => process.send?.(message);
process.once('message', async (input: InferenceRequest) => {
  try {
    env.cacheDir = input.cacheDir;
    env.allowLocalModels = false;
    const session_options = {intraOpNumThreads: Math.min(4, availableParallelism()), interOpNumThreads: 1};
    const progress_callback = (event: {status: string; progress?: number; file?: string}) => {
      if(event.status === 'progress') send({type: 'progress', progress: .05 + (event.progress ?? 0) / 100 * .3, message: `Loading local model · ${event.file ?? ''}`});
    };
    let result: InferenceResult;
    if(input.kind === 'transcription') {
      const model = 'onnx-community/whisper-base_timestamped';
      const transcriber = await pipeline('automatic-speech-recognition', model, {dtype: 'q8', device: 'cpu', session_options, progress_callback});
      const data = await readFile(input.file); const audio = new Float32Array(data.byteLength / 4);
      for(let i = 0; i < audio.length; i++) audio[i] = data.readFloatLE(i * 4);
      send({type: 'progress', progress: .4, message: 'Transcribing speech locally…'});
      const output = await transcriber(audio, {return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5, ...(input.language === 'auto' ? {} : {language: input.language}), task: 'transcribe'});
      const single = Array.isArray(output) ? output[0] : output;
      result = {model, chunks: single.chunks?.map(c => ({text: c.text, timestamp: c.timestamp})) ?? []};
      await transcriber.dispose();
    } else {
      const model = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
      const encoder = await pipeline('feature-extraction', model, {dtype: 'q8', device: 'cpu', session_options, progress_callback});
      const vectors: number[][] = [];
      for(let i = 0; i < input.texts.length; i += 16) {
        const output = await encoder(input.texts.slice(i, i + 16), {pooling: 'mean', normalize: true});
        vectors.push(...output.tolist() as number[][]);
        send({type: 'progress', progress: .4 + .55 * Math.min(1, (i + 16) / input.texts.length), message: `Indexing speech · ${Math.min(i + 16, input.texts.length)}/${input.texts.length}`});
      }
      result = {model, vectors}; await encoder.dispose();
    }
    send({type: 'result', result});
  } catch(error) {send({type: 'error', error: (error as Error).message});}
  finally {process.disconnect?.();}
});
