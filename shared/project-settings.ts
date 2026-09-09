import type {Project} from './project';
import type {CanvasSettings} from './media-settings';
import {reframeAudioEnvelope} from './audio-envelope';
import {reframeVisualKeyframes} from './visual-editing';
/** Convert frame boundaries, not rounded durations, to keep adjacent edits adjacent. */
export function reframeProject(project: Project, fps: number): Project {
  if(fps === project.fps) return structuredClone(project);
  const ratio = fps / project.fps; const frame = (n: number) => Math.round(n * ratio);
  return {...project, fps, clips: project.clips.map(clip => {
    const start = frame(clip.start); let sourceStart = frame(clip.sourceStart); let duration = Math.max(1, frame(clip.start + clip.duration) - start);
    if(clip.kind === 'video' || clip.kind === 'audio') {
      const asset = project.assets.find(a => a.id === clip.assetId)!; const maximum = Math.floor(asset.duration * fps + 1e-7);
      if(maximum < 1) throw new Error('A source is shorter than one frame at this frame rate.');
      sourceStart = Math.min(sourceStart, maximum - 1); duration = Math.min(duration, maximum - sourceStart);
    }
    return {...clip, start, duration, sourceStart, transitionFrames: Math.max(1, frame(clip.transitionFrames)), motionOffset: clip.motionOffset === undefined ? undefined : frame(clip.motionOffset),
      ...(clip.audioEnvelope ? {audioEnvelope: reframeAudioEnvelope(clip.audioEnvelope, ratio)} : {}),
      ...(clip.keyframes ? {keyframes: reframeVisualKeyframes(clip.keyframes, ratio)} : {}),
      zoom: clip.zoom ? {...clip.zoom, start: frame(clip.zoom.start), end: Math.max(frame(clip.zoom.start) + 1, frame(clip.zoom.end))} : clip.zoom,
      caption: clip.caption ? {...clip.caption, words: clip.caption.words.map(w => ({...w, start: frame(w.start), end: Math.max(frame(w.start) + 1, frame(w.end))}))} : clip.caption};
  })};
}
export function updateCanvasSettings(project: Project, settings: CanvasSettings): Project {
  const next = reframeProject(project, settings.fps); const factor = Math.min(settings.width / project.width, settings.height / project.height);
  return {...next, ...settings, clips: next.clips.map(clip => ({...clip, fontSize: Math.min(2000, Math.max(4, clip.fontSize * factor)), annotation: clip.annotation ? {...clip.annotation, stroke: Math.min(300, Math.max(.1, clip.annotation.stroke * factor))} : undefined}))};
}
