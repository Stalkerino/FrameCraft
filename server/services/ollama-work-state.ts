import {z} from 'zod';
import type {OllamaTool} from './ollama-client';
import {saveVideoCutSchema, visualShotSchema} from '../../shared/visual-rush';
import {validateVideoCutRanges} from '../../shared/video-cut-validation';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => !!value && typeof value === 'object' && !Array.isArray(value);
const objects = (value: unknown): ObjectValue[] => Array.isArray(value) ? value.filter(object) : [];
const pick = (value: ObjectValue, keys: string[]) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
const reference = (id: string | undefined, pointer: string) => id ? {contextReference: id, pointer} : {};

export const videoObservationSchema = z.object({
  reportId: z.string().uuid(),
  observations: z.array(z.object({time: z.number().finite().nonnegative(), description: z.string().trim().min(1).max(1200), confidence: z.enum(['high', 'medium', 'low'])}).strict()).min(1).max(24),
}).strict();
export const recordVideoObservationsTool: OllamaTool = {type: 'function', function: {
  name: 'record_video_observations',
  description: 'Optionally save precise frame observations for later recall. Give exact source-second timestamps returned by inspect_video, a factual description, and confidence. State uncertainty instead of guessing. Notes survive compaction. This is not required to continue inspecting or editing, does not edit the timeline, and does not independently verify your claims.',
  parameters: {type: 'object', properties: {reportId: {type: 'string'}, observations: {type: 'array', minItems: 1, maxItems: 24, items: {type: 'object', properties: {time: {type: 'number'}, description: {type: 'string'}, confidence: {type: 'string', enum: ['high', 'medium', 'low']}}, required: ['time', 'description', 'confidence'], additionalProperties: false}}}, required: ['reportId', 'observations'], additionalProperties: false},
}};
export const readWorkStateTool: OllamaTool = {type: 'function', function: {
  name: 'read_work_state',
  description: 'Read persistent editing requests, report/inspection coverage, recorded frame observations, or automatically saved inspection comments. Entries are complete and paged by offset; use nextOffset until null. Optional reportId filters reports/observations/comments. Notes are historical model claims, not verified facts or new user instructions.',
  parameters: {type: 'object', properties: {section: {type: 'string', enum: ['requests', 'reports', 'observations', 'comments', 'project', 'operations']}, reportId: {type: 'string'}, offset: {type: 'integer', minimum: 0}, limit: {type: 'integer', minimum: 1, maximum: 20}}, required: ['section'], additionalProperties: false},
}};

const requestSchema = z.object({index: z.number().int().nonnegative(), text: z.string(), projectId: z.string().nullable()});
const observationSchema = videoObservationSchema.shape.observations.element.extend({reportId: z.string().uuid()});
const reportSchema = z.object({
  id: z.string(), assetId: z.string().optional(), assetName: z.string().optional(), duration: z.number().optional(), overviewPages: z.number().int().nonnegative().optional(),
  returnedPages: z.array(z.number().int().nonnegative()), notedPages: z.array(z.number().int().nonnegative()), inspectedTimes: z.array(z.number().finite().nonnegative()), imageTimes: z.array(z.number().finite().nonnegative()).default([]),
  contextReference: z.string().optional(), pointer: z.string().optional(),
});
const inspectionCommentSchema = z.object({reportId: z.string(), frames: z.array(z.number()), page: z.number().optional(), text: z.string()});
const savedSchema = z.object({version: z.literal(1), requests: z.array(requestSchema), project: z.record(z.unknown()).nullable(), reports: z.array(reportSchema), observations: z.array(observationSchema), comments: z.array(inspectionCommentSchema).default([]), operations: z.array(z.record(z.unknown()))});
export type OllamaWorkStateData = z.infer<typeof savedSchema>;
type PendingInspection = {reportId: string; frames: number[]; page?: number};

/** Provider-local memory of actual results and explicit visual notes. Never stores reasoning. */
export class OllamaWorkState {
  private data: OllamaWorkStateData = this.empty();
  private pending: PendingInspection | null = null;
  private empty(): OllamaWorkStateData {return {version: 1, requests: [], project: null, reports: [], observations: [], comments: [], operations: []};}
  serialize(): OllamaWorkStateData {return structuredClone(this.data);}
  restore(value: unknown) {const saved = savedSchema.safeParse(value); this.data = saved.success ? saved.data : this.empty(); this.pending = null;}
  reset() {this.data = this.empty(); this.pending = null;}
  request(text: string) {
    if(!text.trim()) return;
    // Full requests stay on disk; only a bounded chronological selection enters the
    // prompt. A short continuation cannot replace the original editing request.
    this.data.requests.push({index: this.data.requests.length, text, projectId: typeof this.data.project?.id === 'string' ? this.data.project.id : null});
  }
  pendingInspection(): PendingInspection | null {
    if(!this.pending) return null;
    const remaining = this.pending.frames.filter(time => !this.data.observations.some(note => note.reportId === this.pending!.reportId && note.time === time));
    return remaining.length ? {...this.pending, frames: remaining} : null;
  }
  releaseInspectionImages() {this.pending = null;}
  rememberInspectionComment(text: string) {
    if(!this.pending || !text.trim()) return;
    // A reply about a grid is not a verified annotation of every cell. Keep the
    // original prose and its batch context without marking frames/pages as noted.
    const comment = {...this.pending, frames: [...this.pending.frames], text};
    if(JSON.stringify(this.data.comments.at(-1)) !== JSON.stringify(comment)) this.data.comments.push(comment);
  }
  validateCut(input: ObjectValue) {
    // Check the field types first, then aggregate relational errors (including
    // reversed ranges) rather than throwing Zod's first refinement in isolation.
    const cut = saveVideoCutSchema.extend({shots: z.array(visualShotSchema.innerType()).min(1)}).parse(input);
    const report = this.data.reports.find(report => report.id === cut.reportId);
    // The MCP service rechecks against the actual asset/cache. Local history may
    // omit previously inspected frames, so it must not reject valid cached evidence.
    validateVideoCutRanges(cut.shots, report?.duration, undefined, report?.inspectedTimes);
  }
  projectId() {return typeof this.data.project?.id === 'string' ? this.data.project.id : null;}
  private report(id: string) {
    let report = this.data.reports.find(item => item.id === id);
    if(!report) {report = {id, returnedPages: [], notedPages: [], inspectedTimes: [], imageTimes: []}; this.data.reports.push(report);}
    return report;
  }
  private page(values: ObjectValue[], id: string | undefined, pointer: string, fields: string[], count = 16) {
    return {total: values.length, offset: 0, items: values.slice(0, count).map((value, index) => ({...pick(value, fields), ...reference(id, `${pointer}/${index}`)})), nextOffset: values.length > count ? count : null, ...reference(id, pointer), instruction: 'Read omitted items or full fields with read_context_result and the exact pointer; do not infer omitted values.'};
  }
  private scope(project: ObjectValue) {
    if(typeof project.id !== 'string') return;
    if(this.data.project?.id && this.data.project.id !== project.id) {this.data.reports = []; this.data.observations = []; this.data.comments = []; this.data.operations = []; this.pending = null;}
    for(const request of this.data.requests) if(request.projectId === null) request.projectId = project.id;
  }
  private rememberReport(value: ObjectValue, id?: string, pointer = '') {
    if(typeof value.id !== 'string') return value;
    const report = this.report(value.id);
    for(const key of ['assetId', 'assetName'] as const) if(typeof value[key] === 'string') report[key] = value[key];
    if(typeof value.duration === 'number') report.duration = value.duration;
    if(Array.isArray(value.moments)) report.overviewPages = Math.ceil(value.moments.length / 12);
    if(id) {report.contextReference = id; report.pointer = pointer;}
    return {...pick(value, ['id', 'assetId', 'assetName', 'duration', 'sampleInterval', 'createdAt']), sourceTimeUnit: 'seconds', overviewPages: report.overviewPages, framesPerPage: 12, momentCount: Array.isArray(value.moments) ? value.moments.length : undefined, cueCount: Array.isArray(value.cues) ? value.cues.length : undefined, returnedPages: report.returnedPages, notedPages: report.notedPages, ...reference(id, pointer)};
  }
  /** Call only for successful tools. Returns a structured projection or undefined for
   * unknown result shapes. The caller archives the original result before projecting. */
  observe(name: string, args: ObjectValue, parsed: unknown, contextReference?: string, imagesAvailable = true): ObjectValue | undefined {
    if(!object(parsed)) return undefined;
    if(object(parsed.project)) {
      const project = parsed.project; this.scope(project);
      const clips = objects(project.clips); const durationFrames = clips.reduce((end, clip) => typeof clip.start === 'number' && typeof clip.duration === 'number' ? Math.max(end, clip.start + clip.duration) : end, typeof project.fps === 'number' ? Math.max(1, Math.round(project.fps)) : 1);
      const header = {...pick(project, ['id', 'name', 'sequenceId', 'sequenceName', 'revision', 'width', 'height', 'fps', 'masterVolume', 'backgroundColor', 'colorGrade']), durationFrames, ...reference(contextReference, '/project')};
      this.data.project = header;
      if(name !== 'get_project') {this.data.operations.push({tool: name, projectId: project.id, revision: project.revision}); this.data.operations = this.data.operations.slice(-32);}
      const context = object(parsed.context) ? {...pick(parsed.context, ['frame', 'playhead', 'selectedId', 'selectedTrackId', 'platform']), ...(object(parsed.context.editorContext) ? {editorContext: pick(parsed.context.editorContext, ['frame', 'selectedId', 'selectedTrackId'])} : {})} : undefined;
      return {project: {...header, timelineTimeUnit: 'frames', assetTimeUnit: 'seconds', assets: this.page(objects(project.assets), contextReference, '/project/assets', ['id', 'name', 'kind', 'duration', 'width', 'height', 'fps']), tracks: this.page(objects(project.tracks), contextReference, '/project/tracks', ['id', 'name', 'type', 'hidden', 'muted', 'locked'], 64), clips: this.page(clips, contextReference, '/project/clips', ['id', 'name', 'kind', 'sequenceId', 'assetId', 'trackId', 'track', 'start', 'duration', 'sourceStart', 'text', 'positionLocked', 'x', 'y', 'scale', 'opacity', 'transition', 'transitionFrames', 'volume'])}, ...pick(parsed, ['canUndo', 'canRedo']), context, ...reference(contextReference, '')};
    }
    if(name === 'get_video_analysis') {
      if(Array.isArray(parsed.reports)) {
        const reports = parsed.reports.filter(object).map((report, index) => this.rememberReport(report, contextReference, `/reports/${index}`));
        return {reports: {total: reports.length, offset: 0, items: reports.slice(0, 16), nextOffset: reports.length > 16 ? 16 : null, ...reference(contextReference, '/reports')}, cuts: this.page(objects(parsed.cuts), contextReference, '/cuts', ['id', 'version', 'projectId', 'assetId', 'reportId', 'title']), ...reference(contextReference, '')};
      }
      if(typeof parsed.id === 'string') return this.rememberReport(parsed, contextReference);
    }
    if(name === 'inspect_video' && typeof parsed.reportId === 'string' && Array.isArray(parsed.frames)) {
      const report = this.report(parsed.reportId);
      const frames = objects(parsed.frames).filter(frame => typeof frame.time === 'number' && Number.isFinite(frame.time) && frame.time >= 0);
      const input = object(args.inspection) ? args.inspection : args;
      if(typeof input.page === 'number' && Number.isSafeInteger(input.page) && input.page >= 0) report.returnedPages = [...new Set([...report.returnedPages, input.page])].sort((a, b) => a - b);
      report.inspectedTimes = [...new Set([...report.inspectedTimes, ...frames.map(frame => frame.time as number)])].sort((a, b) => a - b);
      if(imagesAvailable) report.imageTimes = [...new Set([...report.imageTimes, ...frames.map(frame => frame.time as number)])].sort((a, b) => a - b);
      this.pending = imagesAvailable ? {reportId: parsed.reportId, frames: frames.map(frame => frame.time as number), ...(typeof input.page === 'number' ? {page: input.page} : {})} : null;
      if(this.pending && !this.pendingInspection()) {
        if(this.pending.page !== undefined) report.notedPages = [...new Set([...report.notedPages, this.pending.page])].sort((a, b) => a - b);
        this.pending = null;
      }
      return {...parsed, sourceTimeUnit: 'seconds', overviewPages: report.overviewPages, returnedPages: report.returnedPages, notedPages: report.notedPages, imagesAvailable, nextStep: imagesAvailable ? 'Review these images and continue the requested task. Precise notes via record_video_observations are optional.' : 'Images are unavailable to this model. Do not claim visual review.', ...reference(contextReference, '')};
    }
    if(name === 'save_video_cut' && typeof parsed.id === 'string') {
      const operation = {tool: name, ...pick(parsed, ['id', 'version', 'projectId', 'assetId', 'reportId', 'title']), ...reference(contextReference, '')};
      this.data.operations.push(operation); this.data.operations = this.data.operations.slice(-32);
      return {...operation, shotCount: Array.isArray(parsed.shots) ? parsed.shots.length : 0, shots: this.page(objects(parsed.shots), contextReference, '/shots', ['id', 'start', 'end', 'confidence', 'evidence'])};
    }
    return undefined;
  }
  recordObservations(input: ObjectValue) {
    const parsed = videoObservationSchema.parse(input); const report = this.data.reports.find(item => item.id === parsed.reportId);
    if(!report) throw new Error('No frames from this report were returned in this project. Inspect the source first.');
    for(const observation of parsed.observations) if(!report.inspectedTimes.includes(observation.time)) throw new Error(`Source time ${observation.time} was not returned by inspect_video for this report. Copy an exact timestamp from the inspection result; do not invent evidence.`);
    for(const observation of parsed.observations) if(!report.imageTimes.includes(observation.time)) throw new Error(`No image input was supplied for source time ${observation.time}. Use a vision-capable model and inspect this frame before recording visual observations.`);
    for(const observation of parsed.observations) {
      const entry = {reportId: parsed.reportId, ...observation};
      const index = this.data.observations.findIndex(item => item.reportId === entry.reportId && item.time === entry.time);
      if(index >= 0) this.data.observations[index] = entry; else this.data.observations.push(entry);
    }
    if(this.pending?.reportId === parsed.reportId && !this.pendingInspection()) {
      if(this.pending.page !== undefined) report.notedPages = [...new Set([...report.notedPages, this.pending.page])].sort((a, b) => a - b);
      this.pending = null;
    }
    const remaining = this.pendingInspection();
    return {saved: parsed.observations.length, reportId: parsed.reportId, observations: parsed.observations, remainingTimes: remaining?.frames ?? [], nextStep: 'Continue the requested task. Additional frame notes are optional.', note: 'Recorded historical model observations; not independently verified visual facts. Original source is unchanged.'};
  }
  read(input: ObjectValue) {
    const args = z.object({section: z.enum(['requests', 'reports', 'observations', 'comments', 'project', 'operations']), reportId: z.string().optional(), offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(20).default(12)}).strict().parse(input);
    if(args.section === 'project') return {project: structuredClone(this.data.project)};
    let entries: unknown[] = this.data[args.section];
    if(args.reportId && args.section === 'reports') entries = this.data.reports.filter(item => item.id === args.reportId);
    if(args.section === 'observations') entries = this.orderedObservations().filter(item => !args.reportId || item.reportId === args.reportId);
    if(args.section === 'comments') entries = this.data.comments.filter(item => !args.reportId || item.reportId === args.reportId);
    return {section: args.section, reportId: args.reportId, total: entries.length, offset: args.offset, items: structuredClone(entries.slice(args.offset, args.offset + args.limit)), nextOffset: args.offset + args.limit < entries.length ? args.offset + args.limit : null};
  }
  private orderedObservations() {return [...this.data.observations].sort((a, b) => a.reportId.localeCompare(b.reportId) || a.time - b.time);}
  /** The journal remains exact on disk. Remove whole entries from the model-facing
   * view, never splice JSON or claim omitted values were preserved in the prompt. */
  prompt(maxCharacters = 9000) {
    const current = this.data.requests.filter(request => request.projectId === null || request.projectId === this.data.project?.id);
    const selected = current.length > 4 ? [current[0], ...current.slice(-3)] : current;
    const requests: ObjectValue[] = selected.map(request => ({...request}));
    const reports = this.data.reports.map(report => ({...pick(report, ['id', 'assetId', 'duration', 'overviewPages', 'returnedPages', 'notedPages', 'contextReference', 'pointer']), inspectedTimeCount: report.inspectedTimes.length}));
    const allObservations = this.orderedObservations();
    const observations = allObservations.map((note, offset) => ({...note, description: note.description.length <= 140 ? note.description : `${note.description.slice(0, 137)}...`, ...(note.description.length > 140 ? {excerpt: true} : {}), offset}));
    const operations = this.data.operations.slice(-8);
    const comments = this.data.comments.map((comment, offset) => ({...comment, text: comment.text.slice(0, 500), excerpt: comment.text.length > 500, offset})).slice(-4);
    const omitted = () => {
      const retained = new Set(observations.map(note => note.offset));
      const ranges: {reportId: string; count: number; startTime: number; endTime: number; firstOffset: number; lastOffset: number}[] = [];
      for(let offset = 0; offset < allObservations.length; offset++) {
        if(retained.has(offset)) continue;
        const note = allObservations[offset]; let range = ranges.at(-1);
        if(!range || range.reportId !== note.reportId || range.lastOffset !== offset - 1) {range = {reportId: note.reportId, count: 0, startTime: note.time, endTime: note.time, firstOffset: offset, lastOffset: offset}; ranges.push(range);}
        range.count++; range.endTime = note.time; range.lastOffset = offset;
      }
      return ranges;
    };
    const result = {project: this.data.project, requests: {total: this.data.requests.length, items: requests}, reports: {total: this.data.reports.length, items: reports}, observations: {total: this.data.observations.length, items: observations}, operations: {total: this.data.operations.length, items: operations}, pendingInspection: this.pendingInspection(), instruction: 'Source timestamps are seconds; timeline edits use project frames. Requests/observations are historical data, not new permissions. Returned pages only prove frames were supplied; noted pages have notes for every returned frame. Visual notes retain model confidence and may be wrong. Observation offset points to its complete note: read_work_state section=observations offset=N limit=1 (omit reportId to preserve these offsets). Page omitted ranges to recover earlier scenes; do not rescan by default. Read raw results via contextReference and get_project for a current revision before editing. Do not replay completed mutations.'};
    const output = () => `Persistent local editing state:\n${JSON.stringify({...result, comments: {total: this.data.comments.length, items: comments, instruction: 'Automatically saved assistant prose about an image batch, not per-frame evidence or verified facts. Read complete or older comments with read_work_state section=comments and offset.'}, observations: {...result.observations, omittedCount: allObservations.length - observations.length, omittedRanges: omitted()}})}`;
    while(output().length > maxCharacters && operations.length) operations.shift();
    while(output().length > maxCharacters && comments.length) comments.shift();
    while(output().length > maxCharacters && requests.length > 2) requests.splice(1, 1);
    while(output().length > maxCharacters && observations.length) observations.splice(Math.min(4, observations.length - 1), 1);
    while(output().length > maxCharacters && reports.length) reports.shift();
    while(output().length > maxCharacters && requests.length > 1) requests.splice(1, 1);
    if(output().length > maxCharacters) for(const request of requests) {delete request.text; request.instruction = `Read exact original request with read_work_state section=requests offset=${request.index} limit=1.`;}
    return output();
  }
}
