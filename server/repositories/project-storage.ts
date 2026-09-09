import {readFile, rename, writeFile, stat, unlink} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {projectSchema, validateProject, type Activity, type Project} from '../../shared/project';
import {normalizeProjectTracks} from '../../shared/tracks';

export interface StoredProject {project: Project; past: Project[]; future: Project[]; activity: Activity[]; updatedAt: string}
export const projectStorageKey = (id: string) => createHash('sha256').update(id).digest('hex');
export async function readStoredProject(file: string): Promise<StoredProject> {
  const stored = JSON.parse(await readFile(file, 'utf8')) as StoredProject;
  const normalize = (project: Project) => validateProject(normalizeProjectTracks(projectSchema.parse(project)));
  return {...stored, project: normalize(stored.project), past: (stored.past ?? []).map(normalize), future: (stored.future ?? []).map(normalize), activity: stored.activity ?? [], updatedAt: stored.updatedAt ?? (await stat(file)).mtime.toISOString()};
}
export async function writeStoredProject(file: string, state: StoredProject) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {await writeFile(temporary, JSON.stringify(state, null, 2)); await rename(temporary, file);}
  finally {await unlink(temporary).catch(() => undefined);}
}
