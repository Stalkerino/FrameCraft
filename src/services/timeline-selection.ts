import type {Clip} from '../../shared/project';

export function timelineSelection(state: {selectedId: string | null; selectedIds: string[]}): string[] {
  return state.selectedId ? state.selectedIds.includes(state.selectedId) ? state.selectedIds : [state.selectedId] : [];
}

export function groupMoveDelta(clips: Clip[], delta: number): number {
  return Math.max(-Math.min(...clips.map(clip => clip.start)), Math.round(delta));
}

export function intersects(a: {left: number; top: number; right: number; bottom: number}, b: {left: number; top: number; right: number; bottom: number}) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
