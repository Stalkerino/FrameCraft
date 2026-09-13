import {copyFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {applyCommand, validateProject, type Project, type Activity, type Asset, type Command, type Snapshot} from '../../shared/project';
import {ProjectRecoveryRepository} from './project-recovery-repository';
import {createDemo} from '../../shared/demo';
import {normalizeProjectTracks} from '../../shared/tracks';
import {blankProject, projectActionSchema, type ProjectAction} from '../../shared/project-library';
import {ProjectCatalogRepository} from './project-catalog-repository';
import {readStoredProject, writeStoredProject, type StoredProject} from './project-storage';

export class ProjectRepository extends EventEmitter {
  private state!: StoredProject;
  private catalog: ProjectCatalogRepository;
  private recovery: ProjectRecoveryRepository;
  private recoveryNotice?: string;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private directory: string) {super(); this.catalog = new ProjectCatalogRepository(path.join(directory, 'projects')); this.recovery = new ProjectRecoveryRepository(path.join(directory, 'recovery'));}
  async init() {
    await mkdir(this.directory, {recursive: true});
    try {
      this.state = await readStoredProject(path.join(this.directory, 'project.json'));
    } catch(error) {
      const recovered = await this.recovery.recover();
      if(recovered) {
        if((error as NodeJS.ErrnoException).code !== 'ENOENT') await copyFile(path.join(this.directory, 'project.json'), path.join(this.directory, `project-damaged-${randomUUID()}.json`));
        this.state = recovered; this.state.project.revision++;
        this.recoveryNotice = 'Recovered the last protected project after its saved file became unavailable. Check the timeline before continuing; any damaged file was preserved.';
        this.record(this.state, 'editor', 'Recovered project after interrupted or damaged save');
      } else {
        if((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Cannot read saved project; preserved original file. ${String(error)}`);
        this.state = {project: normalizeProjectTracks(createDemo()), past: [], future: [], activity: [], updatedAt: new Date().toISOString()};
      }
      await this.persist(this.state);
    }
    await this.catalog.init();
    await this.recovery.protect(this.state);
  }
  snapshot(): Snapshot {return structuredClone({project: this.state.project, canUndo: this.state.past.length > 0, canRedo: this.state.future.length > 0, activity: this.state.activity, ...(this.recoveryNotice ? {recoveryNotice: this.recoveryNotice} : {})});}
  private persist(state: StoredProject) {return writeStoredProject(path.join(this.directory, 'project.json'), state);}
  private serial<T>(fn: () => Promise<T>): Promise<T> {const next = this.queue.then(fn); this.queue = next.catch(() => undefined); return next;}
  listProjects() {return this.serial(() => this.catalog.list(this.state));}
  listRecovery() {return this.serial(() => this.recovery.list(this.state.project.id));}
  saveCheckpoint(revision: number, label: string) {
    return this.serial(async () => {this.assertRevision(revision); return this.recovery.save(this.state, label);});
  }
  restoreCheckpoint(revision: number, id: string, source: Activity['source']) {
    return this.serial(async () => {
      this.assertRevision(revision); const saved = await this.recovery.get(this.state.project.id, id);
      await this.recovery.save(this.state, 'Before restoring a checkpoint');
      return this.commit({...this.state, project: {...saved.project, revision: revision + 1}, past: [...this.state.past.slice(-49), this.state.project], future: []}, source, `Restored checkpoint from ${saved.updatedAt}`);
    });
  }
  private assertRevision(revision: number) {if(revision !== this.state.project.revision) throw Object.assign(new Error('Project changed. Refresh and try again.'), {status: 409});}
  replaceAssets(assets: Asset[], revision: number, projectId: string, source: Activity['source']) {
    return this.serial(async () => {
      this.assertRevision(revision); if(projectId !== this.state.project.id) throw new Error('Project changed during media replacement');
      const replacements = new Map(assets.map(a => [a.id, a]));
      const project = validateProject({...this.state.project, revision: revision + 1, assets: this.state.project.assets.map(a => replacements.get(a.id) ?? a)});
      return this.commit({...this.state, project, past: [...this.state.past.slice(-49), this.state.project], future: []}, source, 'Replaced media references');
    });
  }
  addPackagedProject(project: Project, source: Activity['source']) {
    return this.serial(async () => {
      const state: StoredProject = {project: validateProject(project), past: [], future: [], activity: [], updatedAt: new Date().toISOString()};
      this.record(state, source, 'Imported portable project'); await this.catalog.save(state);
      await this.recovery.save(state, 'Imported portable project'); return project.id;
    });
  }
  manageProject(input: ProjectAction, source: Activity['source'] = 'editor') {
    return this.serial(async () => {
      const action = projectActionSchema.parse(input);
      if(action.revision !== this.state.project.revision) throw Object.assign(new Error('Project changed. Refresh before opening or creating a project.'), {status: 409});
      if(action.action === 'open' && action.id === this.state.project.id) return this.snapshot();
      let next: StoredProject;
      if(action.action === 'open') next = await this.catalog.get(action.id);
      else next = {project: action.action === 'new' ? blankProject(randomUUID(), action) : {...structuredClone(this.state.project), id: randomUUID(), name: action.name}, past: [], future: [], activity: [], updatedAt: new Date().toISOString()};
      // Save the outgoing state first. The atomic live file is the activation commit point.
      await this.catalog.save(this.state);
      next.project.revision = Math.max(this.state.project.revision, next.project.revision) + 1;
      await this.catalog.save(next);
      return this.commit(next, source, `${action.action === 'new' ? 'Created' : action.action === 'copy' ? 'Saved a copy as' : 'Opened'} ${next.project.name}`);
    });
  }
  /** Imports finish in the project that requested them, even if another browser switches projects. */
  addImportedAsset(asset: Asset, projectId: string, source: Activity['source'], folderId?: string) {
    return this.serial(async () => {
      const active = projectId === this.state.project.id;
      const previous = active ? this.state : await this.catalog.get(projectId);
      // Imports remain usable even if their destination folder was removed while copying.
      const organized = folderId === undefined ? asset : {...asset, folderId: previous.project.folders?.some(f => f.id === folderId) ? folderId : null};
      const state = this.changed(previous, [{type: 'asset.add', asset: organized}]);
      if(active) return this.commit(state, source, `Imported ${asset.name}`);
      this.record(state, source, `Imported ${asset.name}`); await this.catalog.save(state); return this.snapshot();
    });
  }
  private changed(previous: StoredProject, commands: Command[]): StoredProject {
    let next = previous.project;
    for(const command of commands) next = applyCommand(next, command);
    next.revision = previous.project.revision + 1;
    return {...previous, project: next, past: [...previous.past.slice(-49), previous.project], future: []};
  }
  execute(commands: Command[], revision: number, source: Activity['source'], label: string) {
    return this.serial(async () => {
      if(revision !== this.state.project.revision) throw Object.assign(new Error('Project changed. Refreshed the timeline; please try the edit again.'), {status: 409});
      if(commands.length < 1 || commands.length > 100) throw new Error('Provide between 1 and 100 commands');
      // A transaction gets one revision and one undo step, regardless of command count.
      return this.commit(this.changed(this.state, commands), source, label);
    });
  }
  history(direction: 'undo' | 'redo', revision: number, source: Activity['source']) {
    return this.serial(async () => {
      if(revision !== this.state.project.revision) throw Object.assign(new Error('Project changed; refresh before undoing'), {status: 409});
      const state = structuredClone(this.state);
      const from = direction === 'undo' ? state.past : state.future;
      const target = from.pop(); if(!target) throw new Error(`Nothing to ${direction}`);
      (direction === 'undo' ? state.future : state.past).push(state.project);
      state.project = {...target, revision: state.project.revision + 1};
      return this.commit(state, source, direction === 'undo' ? 'Undid the last edit' : 'Redid the last edit');
    });
  }
  private record(state: StoredProject, source: Activity['source'], label: string) {
    state.activity = [{id: randomUUID(), label: label.slice(0, 180), source, at: new Date().toISOString()}, ...state.activity].slice(0, 40);
    state.updatedAt = new Date().toISOString();
  }
  private async commit(state: StoredProject, source: Activity['source'], label: string) {
    await this.recovery.protect(this.state);
    this.record(state, source, label);
    await this.persist(state);
    if(state.project.id !== this.state.project.id) this.recoveryNotice = undefined;
    this.state = state;
    const snapshot = this.snapshot(); this.emit('change', snapshot); return snapshot;
  }
}
