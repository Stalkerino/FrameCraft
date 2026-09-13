import type {Clip} from './project';

export const typewriterCharacters = (frame: number, fps: number, length: number) => Math.min(length, Math.max(0, Math.floor(frame / fps * 45)));
export const visibleCaptionWords = (clip: Clip) => clip.caption!.words.filter(word => word.end > clip.sourceStart && word.start < clip.sourceStart + clip.duration);
