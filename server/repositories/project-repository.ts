import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {applyCommand, type Activity, type Asset, type Command, type Snapshot} from '../../shared/project';
import {createDemo} from '../../shared/demo';
import {normalizeProjectTracks} from '../../shared/tracks';
import {blankProject, projectActionSchema, type ProjectAction} from '../../shared/project-library';
import {ProjectCatalogRepository} from './project-catalog-repository';
import {readStoredProject, writeStoredProject, type StoredProject} from './project-storage';

export class ProjectRepository extends EventEmitter {
  private state!: StoredProject;
  private catalog: ProjectCatalogRepository;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private directory: string) {super(); this.catalog = new ProjectCatalogRepository(path.join(directory, 'projects'));}
  async init() {
    await mkdir(this.directory, {recursive: true});
    try {
      this.state = await readStoredProject(path.join(this.directory, 'project.json'));
    } catch(error) {
      if((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Cannot read saved project; preserved original file. ${String(error)}`);
      this.state = {project: normalizeProjectTracks(createDemo()), past: [], future: [], activity: [], updatedAt: new Date().toISOString()};
      await this.persist(this.state);
    }
    await this.catalog.init();
  }
  snapshot(): Snapshot {return structuredClone({project: this.state.project, canUndo: this.state.past.length > 0, canRedo: this.state.future.length > 0, activity: this.state.activity});}
  private persist(state: StoredProject) {return writeStoredProject(path.join(this.directory, 'project.json'), state);}
  private serial<T>(fn: () => Promise<T>): Promise<T> {const next = this.queue.then(fn); this.queue = next.catch(() => undefined); return next;}
  listProjects() {return this.serial(() => this.catalog.list(this.state));}
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
  addImportedAsset(asset: Asset, projectId: string, source: Activity['source']) {
    return this.serial(async () => {
      const active = projectId === this.state.project.id;
      const previous = active ? this.state : await this.catalog.get(projectId);
      const state = this.changed(previous, [{type: 'asset.add', asset}]);
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
    this.record(state, source, label);
    await this.persist(state); this.state = state;
    const snapshot = this.snapshot(); this.emit('change', snapshot); return snapshot;
  }
}
