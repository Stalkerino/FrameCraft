import type {AnalysisJob} from '../../shared/transcript';
import {analysisApi} from './analysis-api';
export type VoicePhase = 'idle' | 'requesting' | 'listening' | 'transcribing';
export const localDictationAvailable = () => !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
export const localDictationUnavailableReason = () => !window.isSecureContext ? 'Microphone access requires localhost or HTTPS. Open http://localhost:4318 on this computer, or use HTTPS over the network.' : 'This browser cannot record audio. Check microphone access in its site settings.';
export function createLocalDictation(language: string, callbacks: {transcript: (text: string) => void; error: (text: string) => void; phase: (phase: VoicePhase) => void; progress: (text: string) => void}) {
  let stream: MediaStream | null = null; let recorder: MediaRecorder | null = null; let disposed = false; let jobId: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined; const controller = new AbortController(); const chunks: Blob[] = [];
  const release = () => {clearTimeout(timer); stream?.getTracks().forEach(track => track.stop()); stream = null;};
  const fail = (error: unknown) => {if(!disposed) {callbacks.error(error instanceof Error ? error.message : String(error)); callbacks.phase('idle');} release();};
  const transcribe = async (blob: Blob) => {
    callbacks.phase('transcribing'); callbacks.progress('Preparing local transcription…');
    try {
      const body = new FormData(); body.append('audio', blob, 'dictation'); body.append('language', language.startsWith('fr') ? 'french' : 'english');
      const response = await fetch('/api/analysis/dictation', {method: 'POST', body});
      let job: AnalysisJob = await response.json(); if(!response.ok) throw new Error(job.error || 'Unable to transcribe this recording.');
      jobId = job.id;
      if(disposed) {await analysisApi.cancel(job.id); return;}
      while(job.status === 'queued' || job.status === 'running') {
        callbacks.progress(job.message);
        await new Promise<void>((resolve, reject) => {const abort = () => {clearTimeout(poll); reject(new Error('Cancelled'));}; const poll = setTimeout(() => {controller.signal.removeEventListener('abort', abort); resolve();}, 800); controller.signal.addEventListener('abort', abort, {once: true});});
        const result = await fetch(`/api/analysis/jobs/${job.id}`, {signal: controller.signal}); job = await result.json(); if(!result.ok) throw new Error(job.error || 'Transcription no longer available.');
      }
      if(!disposed) {if(job.status !== 'done' || !job.text) throw new Error(job.error || 'Dictation cancelled.'); callbacks.transcript(job.text); callbacks.phase('idle');}
    } catch(error) {fail(error);} finally {jobId = null;}
  };
  const stop = () => {if(recorder?.state === 'recording') {callbacks.phase('transcribing'); recorder.stop(); release();}};
  return {
    async start() {
      if(!localDictationAvailable()) {fail(new Error(localDictationUnavailableReason())); return;}
      callbacks.phase('requesting');
      try {
        stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true}, video: false});
        if(disposed) {release(); return;}
        const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
        recorder = new MediaRecorder(stream, {...(mimeType ? {mimeType} : {}), audioBitsPerSecond: 64000});
        recorder.ondataavailable = event => {if(event.data.size) chunks.push(event.data);};
        recorder.onerror = () => {if(recorder) recorder.onstop = null; fail(new Error('Audio recording failed. Try another microphone.'));};
        recorder.onstop = () => {release(); if(!disposed) void transcribe(new Blob(chunks, {type: recorder?.mimeType || 'audio/webm'}));};
        recorder.start(1000); callbacks.phase('listening'); timer = setTimeout(stop, 120000);
      } catch(error) {const name = (error as Error).name; fail(new Error(name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in your browser’s site settings and try again.' : name === 'NotFoundError' ? 'No microphone was found. Connect a microphone and try again.' : (error as Error).message));}
    },
    stop,
    dispose() {disposed = true; controller.abort(); if(recorder) {recorder.onstop = null; recorder.onerror = null; recorder.ondataavailable = null; if(recorder.state !== 'inactive') recorder.stop();} release(); if(jobId) void analysisApi.cancel(jobId).catch(() => undefined);},
  };
}
