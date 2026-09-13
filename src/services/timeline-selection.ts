import type {Clip, Project} from '../../shared/project';
import {relatedClipIds} from '../../shared/editorial-tools';

export function timelineSelection(state: {selectedId: string | null; selectedIds: string[]; snapshot?: {project: Project} | null}): string[] {
  const ids = state.selectedId ? state.selectedIds.includes(state.selectedId) ? state.selectedIds : [state.selectedId] : [];
  return state.snapshot ? relatedClipIds(state.snapshot.project, ids) : ids;
}

export function groupMoveDelta(clips: Clip[], delta: number): number {
  return Math.max(-Math.min(...clips.map(clip => clip.start)), Math.round(delta));
}

export function intersects(a: {left: number; top: number; right: number; bottom: number}, b: {left: number; top: number; right: number; bottom: number}) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
