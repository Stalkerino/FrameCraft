import {z} from 'zod';
import {canvasSettingsSchema} from './media-settings';
import {defaultTracks} from './tracks';
import {projectSchema, type Project} from './project';

const revision = z.number().int().nonnegative();
const name = z.string().trim().min(1).max(120);
export const projectActionSchema = z.discriminatedUnion('action', [
  z.object({action: z.literal('new'), revision, name, settings: canvasSettingsSchema}),
  z.object({action: z.literal('copy'), revision, name}),
  z.object({action: z.literal('open'), revision, id: z.string().min(1).max(200)}),
]);
export type ProjectAction = z.infer<typeof projectActionSchema>;
export type ProjectActionDraft = ProjectAction extends infer T ? T extends ProjectAction ? Omit<T, 'revision'> : never : never;
export interface ProjectSummary {
  id: string; name: string; updatedAt: string; width: number; height: number; fps: number;
  clipCount: number; assetCount: number; durationSeconds: number; thumbnail?: string;
}
export interface ProjectCatalog {activeId: string; projects: ProjectSummary[]}
export function blankProject(id: string, input: Extract<ProjectAction, {action: 'new'}>): Project {
  return projectSchema.parse({version: 1, id, name: input.name, revision: 0, ...input.settings, tracks: structuredClone(defaultTracks), assets: [], clips: []});
}
