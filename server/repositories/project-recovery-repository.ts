import {mkdir, readdir, readFile, stat, unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import type {RecoveryVersion} from '../../shared/project-care';
import {projectStorageKey, readStoredProject, writeStoredProject, type StoredProject} from './project-storage';

const versionFile = /^[0-9a-f-]{36}\.json$/;
/** Compact snapshots exclude undo history. Retention removes only our version
 * files, never originals, media, exports or the current recovery head. */
export class ProjectRecoveryRepository {
  private lastCheckpoint = new Map<string, number>();
  constructor(private directory: string, private limit = 30, private byteLimit = 64 * 1024 * 1024) {}
  private folder(id: string) {return path.join(this.directory, projectStorageKey(id));}
  async protect(state: StoredProject) {
    await mkdir(this.directory, {recursive: true});
    const compact = {...state, past: [], future: []};
    await writeStoredProject(path.join(this.directory, 'active.json'), compact);
    if(Date.now() - (this.lastCheckpoint.get(state.project.id) ?? 0) >= 60_000) await this.save(state, 'Automatic checkpoint');
  }
  async recover() {
    try {return await readStoredProject(path.join(this.directory, 'active.json'));} catch {return undefined;}
  }
  async save(state: StoredProject, label: string): Promise<RecoveryVersion> {
    const folder = this.folder(state.project.id); await mkdir(folder, {recursive: true});
    const id = randomUUID(); const createdAt = new Date().toISOString();
    const file = path.join(folder, `${id}.json`);
    await writeStoredProject(file, {...state, past: [], future: [], updatedAt: createdAt, recoveryLabel: label} as StoredProject);
    this.lastCheckpoint.set(state.project.id, Date.now());
    const versions = (await this.list(state.project.id)).sort((a, b) => a.id === id ? -1 : b.id === id ? 1 : b.createdAt.localeCompare(a.createdAt)); let bytes = 0;
    for(const [index, entry] of versions.entries()) {
      bytes += entry.bytes;
      if(index > 0 && (index >= this.limit || bytes > this.byteLimit)) await unlink(path.join(folder, `${entry.id}.json`));
    }
    return {id, projectId: state.project.id, name: state.project.name, revision: state.project.revision, label, createdAt, bytes: (await stat(file)).size};
  }
  async list(projectId: string): Promise<RecoveryVersion[]> {
    const folder = this.folder(projectId);
    const names = await readdir(folder).catch(error => {if(error.code === 'ENOENT') return []; throw error;});
    const versions: RecoveryVersion[] = [];
    for(const name of names.filter(name => versionFile.test(name))) {
      try {
        const file = path.join(folder, name); const data = JSON.parse(await readFile(file, 'utf8'));
        if(data.project?.id !== projectId || typeof data.project.name !== 'string' || !Number.isSafeInteger(data.project.revision) || typeof data.updatedAt !== 'string') continue;
        versions.push({id: name.slice(0, -5), projectId, name: data.project.name, revision: data.project.revision, createdAt: data.updatedAt, label: typeof data.recoveryLabel === 'string' ? data.recoveryLabel : 'Automatic checkpoint', bytes: (await stat(file)).size});
      } catch { /* A damaged checkpoint must not hide the remaining versions. */ }
    }
    return versions.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.revision - a.revision);
  }
  async get(projectId: string, id: string) {
    if(!versionFile.test(`${id}.json`)) throw new Error('Invalid recovery version');
    const state = await readStoredProject(path.join(this.folder(projectId), `${id}.json`));
    if(state.project.id !== projectId) throw new Error('This backup belongs to another project');
    return state;
  }
}
