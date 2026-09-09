import {mkdir, readdir} from 'node:fs/promises';
import path from 'node:path';
import type {ProjectCatalog, ProjectSummary} from '../../shared/project-library';
import {projectStorageKey, readStoredProject, writeStoredProject, type StoredProject} from './project-storage';

/** Inactive projects are archived here; the live repository remains authoritative for the active one. */
export class ProjectCatalogRepository {
  constructor(private directory: string) {}
  init() {return mkdir(this.directory, {recursive: true});}
  private file(id: string) {return path.join(this.directory, `${projectStorageKey(id)}.json`);}
  save(state: StoredProject) {return writeStoredProject(this.file(state.project.id), state);}
  async get(id: string) {
    try {const state = await readStoredProject(this.file(id)); if(state.project.id !== id) throw new Error('Project ID does not match its saved file'); return state;}
    catch(error) {if((error as NodeJS.ErrnoException).code === 'ENOENT') throw Object.assign(new Error('Saved project was not found'), {status: 404}); throw error;}
  }
  async list(active: StoredProject): Promise<ProjectCatalog> {
    const entries = await readdir(this.directory);
    const states = await Promise.all(entries.filter(name => /^[a-f0-9]{64}\.json$/.test(name) && name !== path.basename(this.file(active.project.id))).map(name => readStoredProject(path.join(this.directory, name))));
    const projects: ProjectSummary[] = [...states, active].map(({project, updatedAt}) => ({id: project.id, name: project.name, updatedAt, width: project.width, height: project.height, fps: project.fps, clipCount: project.clips.length, assetCount: project.assets.length, durationSeconds: Math.max(0, ...project.clips.map(c => c.start + c.duration)) / project.fps, thumbnail: project.assets.find(a => a.thumbnail)?.thumbnail}));
    return {activeId: active.project.id, projects: projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name))};
  }
}
