import {createReadStream, createWriteStream} from 'node:fs';
import {mkdir, readFile, realpath, stat, writeFile} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {createHash, randomUUID} from 'node:crypto';
import path from 'node:path';
import {z} from 'zod';
import {projectSchema, validateProject, type Activity, type Project} from '../../shared/project';
import type {ProjectTransferJob} from '../../shared/project-care';
import type {ProjectRepository} from '../repositories/project-repository';
import type {MediaFileRepository} from '../repositories/media-file-repository';

const portablePath = z.string().regex(/^(media|thumbnails)\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
const manifestSchema = z.object({format: z.literal('framecraft-project'), version: z.literal(1), project: projectSchema,
  files: z.array(z.object({path: portablePath, bytes: z.number().int().nonnegative().safe(), sha256: z.string().regex(/^[a-f0-9]{64}$/)})).max(2000)});
type Manifest = z.infer<typeof manifestSchema>;
/** Streaming copies, one transfer at a time. Manifest is written last: a failed
 * or cancelled folder is never mistaken for a complete portable project. */
export class ProjectTransferService {
  private jobs = new Map<string, ProjectTransferJob>();
  private controllers = new Map<string, AbortController>();
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  constructor(private projects: ProjectRepository, private files: MediaFileRepository) {}
  get(id: string) {const job = this.jobs.get(id); if(!job) throw Object.assign(new Error('Project transfer not found'), {status: 404}); return structuredClone(job);}
  list() {return [...this.jobs.values()].map(job => structuredClone(job));}
  cancel(id: string) {
    const job = this.get(id); this.controllers.get(id)?.abort();
    if(job.status === 'queued') {this.jobs.get(id)!.status = 'cancelled'; this.controllers.delete(id);}
    return this.get(id);
  }
  close() {this.closed = true; for(const controller of this.controllers.values()) controller.abort();}
  export(directory: string, revision: number) {
    const project = this.projects.snapshot().project;
    if(project.revision !== revision) throw Object.assign(new Error('Project changed. Refresh before packaging.'), {status: 409});
    return this.start('export', directory, project.id, (job, signal) => this.pack(project, job, signal));
  }
  import(directory: string, source: Activity['source']) {
    return this.start('import', directory, randomUUID(), (job, signal) => this.unpack(job, source, signal));
  }
  private start(kind: ProjectTransferJob['kind'], directory: string, projectId: string, work: (job: ProjectTransferJob, signal: AbortSignal) => Promise<void>) {
    if(this.closed) throw new Error('Project transfers are shutting down');
    if(!path.isAbsolute(directory)) throw new Error('Use an absolute folder path on the editor machine');
    if(this.controllers.size >= 4) throw new Error('Wait for an existing project transfer to finish');
    const job: ProjectTransferJob = {id: randomUUID(), kind, directory: path.resolve(directory), projectId, status: 'queued', progress: 0, files: 0, totalFiles: 0, bytes: 0, totalBytes: 0};
    const controller = new AbortController(); this.jobs.set(job.id, job); this.controllers.set(job.id, controller);
    for(const [id, old] of this.jobs) if(this.jobs.size > 30 && ['done', 'error', 'cancelled'].includes(old.status)) this.jobs.delete(id);
    const run = async () => {
      try {controller.signal.throwIfAborted(); job.status = 'copying'; await work(job, controller.signal); job.status = 'done'; job.progress = 1;}
      catch(error) {job.status = controller.signal.aborted ? 'cancelled' : 'error'; job.error = (error as Error).message;}
      finally {this.controllers.delete(job.id);}
    };
    this.queue = this.queue.then(run, run); return this.get(job.id);
  }
  private async copy(from: string, to: string, job: ProjectTransferJob, signal: AbortSignal) {
    await mkdir(path.dirname(to), {recursive: true}); const digest = createHash('sha256'); let bytes = 0;
    await pipeline(createReadStream(from), new Transform({transform(chunk, _encoding, callback) {
      digest.update(chunk); bytes += chunk.length; job.bytes += chunk.length;
      job.progress = Math.min(.99, job.bytes / Math.max(1, job.totalBytes)); callback(null, chunk);
    }}), createWriteStream(to, {flags: 'wx'}), {signal});
    job.files++; return {bytes, sha256: digest.digest('hex')};
  }
  private async pack(project: Project, job: ProjectTransferJob, signal: AbortSignal) {
    const portable = structuredClone(project); const references = new Map<string, {source: string; relative: string; bytes: number}>();
    const add = async (url: string, folder: 'media' | 'thumbnails') => {
      const source = this.files.resolve(url); const existing = references.get(source); if(existing) return existing.relative;
      const info = await stat(source); if(!info.isFile()) throw new Error(`Media is not a file: ${source}`);
      const ext = path.extname(source).toLowerCase(); if(!/^\.[a-z0-9]+$/.test(ext)) throw new Error(`Unsupported media filename: ${source}`);
      const relative = `${folder}/${randomUUID()}${ext}`; references.set(source, {source, relative, bytes: info.size}); return relative;
    };
    for(const asset of portable.assets) {
      signal.throwIfAborted();
      try {asset.src = await add(asset.src, 'media');} catch(error) {throw new Error(`Cannot package ${asset.name}: ${(error as Error).message}. Relink missing media first.`);}
      // Proxies are disposable caches. Source files and embedded effect recipes
      // are sufficient to regenerate playback on the destination machine.
      asset.previewSrc = undefined;
      if(asset.thumbnail) try {asset.thumbnail = await add(asset.thumbnail, 'thumbnails');} catch {asset.thumbnail = undefined;}
    }
    job.totalFiles = references.size; job.totalBytes = [...references.values()].reduce((sum, file) => sum + file.bytes, 0);
    await mkdir(path.dirname(job.directory), {recursive: true});
    // Reserve a NEW directory: never merge into or overwrite a user's folder.
    await mkdir(job.directory);
    const entries: Manifest['files'] = [];
    for(const file of references.values()) {
      const copied = await this.copy(file.source, path.join(job.directory, file.relative), job, signal);
      if(copied.bytes !== file.bytes) throw new Error('A source changed during packaging. Retry into a new folder.');
      entries.push({path: file.relative, ...copied});
    }
    signal.throwIfAborted();
    await writeFile(path.join(job.directory, 'framecraft-project.json'), JSON.stringify({format: 'framecraft-project', version: 1, project: portable, files: entries} satisfies Manifest, null, 2), {flag: 'wx'});
  }
  private async unpack(job: ProjectTransferJob, source: Activity['source'], signal: AbortSignal) {
    const manifestFile = path.join(job.directory, 'framecraft-project.json');
    if((await stat(manifestFile)).size > 32 * 1024 * 1024) throw new Error('Portable project manifest is too large');
    const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestFile, 'utf8')));
    const root = await realpath(job.directory); const entries = new Map(manifest.files.map(file => [file.path, file]));
    if(entries.size !== manifest.files.length) throw new Error('Duplicate portable media entry');
    const project = manifest.project; project.id = job.projectId; project.revision = 0;
    const required = new Set(project.assets.flatMap(asset => [asset.src, ...(asset.thumbnail ? [asset.thumbnail] : [])]));
    const resolved = new Map<string, string>();
    for(const relative of required) {
      portablePath.parse(relative); const entry = entries.get(relative); if(!entry) throw new Error(`Portable media is absent from the manifest: ${relative}`);
      const file = await realpath(path.join(root, relative));
      const inside = path.relative(root, file);
      if(inside.startsWith('..' + path.sep) || inside === '..' || path.isAbsolute(inside)) throw new Error('Portable media must stay inside its project folder');
      const info = await stat(file); if(!info.isFile() || info.size !== entry.bytes) throw new Error(`Portable media size does not match: ${relative}`);
      resolved.set(relative, file);
    }
    // Preflight the entire project before copying large files.
    validateProject(project); job.totalFiles = required.size; job.totalBytes = [...required].reduce((sum, file) => sum + entries.get(file)!.bytes, 0);
    const urls = new Map<string, string>();
    for(const [relative, file] of resolved) {
      const entry = entries.get(relative)!; const folder = relative.startsWith('thumbnails/') ? 'thumbnails' : 'media';
      const url = this.files.url(project.id, folder, `${randomUUID()}${path.extname(relative)}`);
      const copied = await this.copy(file, this.files.resolve(url), job, signal);
      if(copied.bytes !== entry.bytes || copied.sha256 !== entry.sha256) throw new Error(`Portable media checksum does not match: ${relative}`);
      urls.set(relative, url);
    }
    for(const asset of project.assets) {asset.src = urls.get(asset.src)!; asset.thumbnail = asset.thumbnail ? urls.get(asset.thumbnail) : undefined; asset.previewSrc = undefined;}
    signal.throwIfAborted(); await this.projects.addPackagedProject(project, source);
  }
}
