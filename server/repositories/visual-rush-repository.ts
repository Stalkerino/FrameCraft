import {mkdir, readFile, readdir, rename, writeFile, unlink, stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {z} from 'zod';
import {videoCutSchema, type VideoCut, type VisualReport} from '../../shared/visual-rush';
export class VisualRushRepository {
  constructor(readonly directory: string) {}
  private file(kind: 'reports' | 'cuts', id: string) {return path.join(this.directory, kind, `${z.string().uuid().parse(id)}.json`);}
  private async write(file: string, data: unknown) {await mkdir(path.dirname(file), {recursive: true}); const temporary = `${file}.${randomUUID()}.tmp`; try {await writeFile(temporary, JSON.stringify(data)); await rename(temporary, file);} finally {await unlink(temporary).catch(() => undefined);}}
  async report(id: string): Promise<VisualReport> {return JSON.parse(await readFile(this.file('reports', id), 'utf8'));}
  saveReport(report: VisualReport) {return this.write(this.file('reports', report.id), report);}
  async completedInspections(reportId: string) {
    const directory = path.join(this.directory, 'images', z.string().uuid().parse(reportId));
    let entries;
    try {entries = await readdir(directory, {withFileTypes: true});}
    catch(error) {if((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error;}
    const completed: string[] = [];
    for(const entry of entries) if(entry.isDirectory()) {
      try {const image = await stat(path.join(directory, entry.name, 'sheet.jpg')); if(image.isFile() && image.size > 0) completed.push(entry.name);}
      catch(error) {if((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;}
    }
    return completed;
  }
  async cut(id: string): Promise<VideoCut> {return videoCutSchema.parse(JSON.parse(await readFile(this.file('cuts', id), 'utf8')));}
  saveCut(cut: VideoCut) {return this.write(this.file('cuts', cut.id), videoCutSchema.parse(cut));}
  private async list<T>(kind: 'reports' | 'cuts'): Promise<T[]> {const directory = path.join(this.directory, kind); await mkdir(directory, {recursive: true}); return Promise.all((await readdir(directory)).filter(file => /^[a-f0-9-]+\.json$/.test(file)).map(async file => JSON.parse(await readFile(path.join(directory, file), 'utf8'))));}
  async reports(assetIds: string[]) {return (await this.list<VisualReport>('reports')).filter(report => assetIds.includes(report.assetId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));}
  async cuts(projectId: string) {return (await this.list<VideoCut>('cuts')).filter(cut => cut.projectId === projectId).map(cut => videoCutSchema.parse(cut)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));}
}
