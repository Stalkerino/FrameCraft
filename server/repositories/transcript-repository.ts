import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {transcriptSchema, validateTranscript, type Transcript} from '../../shared/transcript';

/** Separate from timeline history: a long transcript is stored once per source. */
export class TranscriptRepository {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private directory: string) {}
  private file(id: string) {return path.join(this.directory, `${createHash('sha256').update(id).digest('hex')}.json`);}
  async get(assetId: string): Promise<Transcript | null> {
    try {return transcriptSchema.parse(JSON.parse(await readFile(this.file(assetId), 'utf8')));}
    catch(error) {if((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error;}
  }
  save(input: Transcript, duration: number, expectedRevision: number | null): Promise<Transcript> {
    const next = this.queue.then(async () => {
      const previous = await this.get(input.assetId);
      if((previous?.revision ?? null) !== expectedRevision) throw Object.assign(new Error('Transcript changed; reopen it before saving.'), {status: 409});
      const transcript = validateTranscript({...input, revision: (previous?.revision ?? -1) + 1, updatedAt: new Date().toISOString()}, duration);
      await mkdir(this.directory, {recursive: true});
      const temporary = path.join(this.directory, `${randomUUID()}.tmp`);
      await writeFile(temporary, JSON.stringify(transcript)); await rename(temporary, this.file(input.assetId));
      return transcript;
    });
    this.queue = next.catch(() => undefined); return next;
  }
}
