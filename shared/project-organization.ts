import {z} from 'zod';
import type {Project} from './project';
const id = z.string().min(1).max(150);
const frame = z.number().int().nonnegative().safe();
export const markerSchema = z.object({id, name: z.string().trim().min(1).max(120), frame, end: frame.nullable().optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#e9b76b'), note: z.string().max(2000).default('')});
export const folderSchema = z.object({id, name: z.string().trim().min(1).max(100), parentId: id.nullable().default(null)});
export type TimelineMarker = z.infer<typeof markerSchema>;
export type MediaFolder = z.infer<typeof folderSchema>;
export const organizationCommands = [
  z.object({type: z.literal('marker.set'), marker: markerSchema}),
  z.object({type: z.literal('marker.remove'), id}),
  z.object({type: z.literal('folder.add'), folder: folderSchema}),
  z.object({type: z.literal('folder.update'), id, patch: folderSchema.omit({id: true}).partial()}),
  z.object({type: z.literal('folder.remove'), id}),
  z.object({type: z.literal('assets.move-folder'), ids: z.array(id).min(1), folderId: id.nullable()}),
] as const;
export const organizationCommandSchema = z.discriminatedUnion('type', organizationCommands);

export function validateOrganization(project: Project) {
  const folders = new Map((project.folders ?? []).map(folder => [folder.id, folder]));
  if(folders.size !== (project.folders?.length ?? 0)) throw new Error('Duplicate media folder ID');
  for(const folder of folders.values()) {
    const seen = new Set([folder.id]); let parent = folder.parentId;
    while(parent) {
      if(seen.has(parent)) throw new Error('Media folders cannot contain themselves');
      seen.add(parent); const ancestor = folders.get(parent); if(!ancestor) throw new Error('Parent media folder does not exist'); parent = ancestor.parentId;
    }
  }
  for(const asset of project.assets) if(asset.folderId && !folders.has(asset.folderId)) throw new Error('Asset media folder does not exist');
  const markers = project.markers ?? [];
  if(new Set(markers.map(marker => marker.id)).size !== markers.length) throw new Error('Duplicate timeline marker ID');
  for(const marker of markers) if(marker.end != null && marker.end <= marker.frame) throw new Error('Marker range end must follow its start');
}

export function applyOrganization(project: Project, command: z.infer<typeof organizationCommandSchema>) {
  switch(command.type) {
    case 'marker.set': project.markers = [...(project.markers ?? []).filter(m => m.id !== command.marker.id), command.marker].sort((a, b) => a.frame - b.frame); break;
    case 'marker.remove': {
      if(!project.markers?.some(m => m.id === command.id)) throw new Error('Marker no longer exists');
      project.markers = project.markers.filter(m => m.id !== command.id); break;
    }
    case 'folder.add': project.folders = [...(project.folders ?? []), command.folder]; break;
    case 'folder.update': {
      const folder = project.folders?.find(f => f.id === command.id); if(!folder) throw new Error('Folder no longer exists'); Object.assign(folder, command.patch); break;
    }
    case 'folder.remove': {
      const folder = project.folders?.find(f => f.id === command.id); if(!folder) throw new Error('Folder no longer exists');
      project.folders = project.folders!.filter(f => f.id !== command.id).map(f => f.parentId === command.id ? {...f, parentId: folder.parentId} : f);
      project.assets = project.assets.map(a => a.folderId === command.id ? {...a, folderId: folder.parentId} : a); break;
    }
    case 'assets.move-folder': {
      const selected = new Set(command.ids);
      if(command.ids.some(id => !project.assets.some(a => a.id === id))) throw new Error('Media no longer belongs to this project');
      project.assets = project.assets.map(a => selected.has(a.id) ? {...a, folderId: command.folderId} : a); break;
    }
  }
}

export function folderOptions(folders: MediaFolder[]): {id: string; label: string}[] {
  const result: {id: string; label: string}[] = [];
  const visit = (parentId: string | null, prefix: string) => {
    for(const folder of folders.filter(f => f.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name))) {
      const label = prefix + folder.name; result.push({id: folder.id, label}); visit(folder.id, label + ' / ');
    }
  };
  visit(null, ''); return result;
}

/** Range edits operate on all tracks before moving global markers. Partial-track
 * edits keep global notes at their original timeline positions. */
export function markersInWindows(markers: TimelineMarker[], windows: {start: number; end: number; outputStart: number}[], assemble: boolean) {
  const occupied = new Set(markers.map(m => m.id)); const result: TimelineMarker[] = [];
  for(const marker of markers) {
    const fragments: TimelineMarker[] = [];
    for(const window of windows) {
      const start = Math.max(marker.frame, window.start); const end = Math.min(marker.end ?? marker.frame + 1, window.end);
      if(end <= start) continue;
      let id = marker.id;
      if(fragments.length) {let suffix = 2; do {id = `${marker.id.slice(0, 120)}-part-${suffix++}`;} while(occupied.has(id)); occupied.add(id);}
      fragments.push({...marker, id, frame: window.outputStart + start - window.start, end: marker.end == null ? marker.end : window.outputStart + end - window.start});
    }
    if(!assemble && fragments.length > 1 && marker.end != null) result.push({...fragments[0], end: fragments.at(-1)!.end});
    else result.push(...fragments);
  }
  return result.sort((a, b) => a.frame - b.frame);
}

export function insertMarkerTime(project: Project, frame: number, count: number) {
  if(project.markers) project.markers = project.markers.map(marker => ({...marker, frame: marker.frame >= frame ? marker.frame + count : marker.frame,
    end: marker.end != null && marker.end > frame ? marker.end + count : marker.end}));
}
