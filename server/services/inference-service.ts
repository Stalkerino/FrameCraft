import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import type {InferenceMessage, InferenceRequest, InferenceResult} from '../../shared/inference';

export type Progress = (progress: number, message: string) => void;
export interface InferenceProvider {run(request: InferenceRequest, signal: AbortSignal, progress: Progress): Promise<InferenceResult>}
/** A cancellable worker per job isolates CPU work and releases model memory afterwards. */
export class LocalInferenceProvider implements InferenceProvider {
  constructor(private root: string) {}
  run(request: InferenceRequest, signal: AbortSignal, progress: Progress): Promise<InferenceResult> {
    return new Promise((resolve, reject) => {
      signal.throwIfAborted();
      const child = spawn(process.execPath, [path.join(this.root, 'scripts', 'analysis-worker.mjs')], {shell: false, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true});
      let stderr = ''; let settled = false;
      const finish = (error?: Error, result?: InferenceResult) => {if(settled) return; settled = true; clearTimeout(timeout); signal.removeEventListener('abort', abort); child.kill(); if(error) reject(error); else resolve(result!);};
      const abort = () => finish(new Error('Analysis cancelled'));
      const timeout = setTimeout(() => finish(new Error('Analysis exceeded two hours. Try a shorter source.')), 2 * 60 * 60_000);
      signal.addEventListener('abort', abort, {once: true});
      child.stderr?.on('data', data => {stderr = (stderr + data).slice(-2000);});
      child.on('error', error => finish(error));
      child.on('exit', code => finish(new Error(`Local analysis stopped (${code}). ${stderr}`)));
      child.on('message', (message: InferenceMessage) => {
        if(message.type === 'progress') progress(message.progress, message.message);
        else if(message.type === 'result') finish(undefined, message.result);
        else finish(new Error(message.error));
      });
      child.send!(request, error => {if(error) finish(error);});
    });
  }
}

export async function withExtractedAudio<T>(source: string, temporaryRoot: string, signal: AbortSignal, consume: (file: string) => Promise<T>, maxSeconds?: number): Promise<T> {
  const directory = await mkdtemp(path.join(temporaryRoot, 'speech-')); const file = path.join(directory, 'audio.f32');
  try {
    await new Promise<void>((resolve, reject) => {
      signal.throwIfAborted();
      const child = spawn(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, ...(maxSeconds ? ['-t', String(maxSeconds)] : []), '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', file], {shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']});
      let stderr = ''; const abort = () => {child.kill();}; signal.addEventListener('abort', abort, {once: true});
      const timer = setTimeout(abort, 10 * 60_000);
      child.stderr?.on('data', data => {stderr = (stderr + data).slice(-2000);});
      const cleanup = () => {clearTimeout(timer); signal.removeEventListener('abort', abort);};
      child.on('error', error => {cleanup(); reject(error);});
      child.on('close', code => {cleanup(); if(signal.aborted) reject(new Error('Analysis cancelled')); else if(code !== 0) reject(new Error(`Could not extract speech. ${stderr}`)); else resolve();});
    });
    signal.throwIfAborted(); return await consume(file);
  } finally {await rm(directory, {recursive: true, force: true});}
}
