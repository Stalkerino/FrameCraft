import {inspectVideoSchema} from '../../shared/visual-rush';

const reportId = {type: 'string', format: 'uuid'};
export const localVideoCutHelp = 'Every shot requires start AND end in SOURCE SECONDS: 0 <= start < end <= the report source duration. Evidence uses the half-open interval start <= time < end: a timestamp equal to end is NOT inside the shot. Example: start=0,end=10,evidence=[0.5,9.5] is valid; evidence=[10] is not. Use exact inspected timestamps; do not round the source duration upward. On validation errors fix ALL listed numeric fields, not the descriptions. Resubmit the corrected proposal; previous inspections remain valid.';
const branch = (fields: Record<string, unknown>) => ({type: 'object', properties: {reportId, ...fields}, required: ['reportId', ...Object.keys(fields)], additionalProperties: false});
/** Express the refinement as alternatives in the model's JSON schema too. */
export const localInspectionParameters: Record<string, unknown> = {
  type: 'object', required: ['inspection'], additionalProperties: false,
  properties: {inspection: {oneOf: [
    branch({page: {type: 'integer', minimum: 0}}),
    branch({time: {type: 'number', minimum: 0}}),
    branch({start: {type: 'number', minimum: 0}, end: {type: 'number', exclusiveMinimum: 0}}),
  ]}},
};
/** Flat model-facing contract; the adapter keeps the MCP contract unchanged. */
export const localInspectionToolParameters: Record<string, unknown> = {
  type: 'object', required: ['reportId'], additionalProperties: false,
  properties: {reportId, page: {type: 'integer', minimum: 0}, time: {type: 'number', minimum: 0}, start: {type: 'number', minimum: 0}, end: {type: 'number', exclusiveMinimum: 0}},
};
export const localInspectionHelp = 'Pass inspection fields directly. Overview: {"reportId":"<report UUID>","page":0}. Single frame at 6 seconds: {"reportId":"<report UUID>","time":6}. Sequence: {"reportId":"<report UUID>","start":6,"end":8}. Use exactly one mode: page, time, OR start/end. Times are SOURCE SECONDS, never timeline frames or timecode strings. Keep times within the source duration in get_video_analysis. For a sequence, end MUST be greater than start. Do not combine page/time/range.';

export function prepareLocalToolArguments(name: string, input: Record<string, unknown>): {arguments: Record<string, unknown>; note?: string} {
  if(name !== 'inspect_video') return {arguments: input};
  const wrapped = Object.hasOwn(input, 'inspection');
  const inspection = wrapped ? input.inspection : input;
  if(!inspection || typeof inspection !== 'object' || Array.isArray(inspection)) throw new Error(`inspection must be an object, received ${typeof inspection}. Do not put JSON inside a quoted string. ${localInspectionHelp}`);
  const value = {...inspection as Record<string, unknown>};
  const unknown = Object.keys(value).filter(key => !['reportId', 'page', 'time', 'start', 'end'].includes(key));
  if(unknown.length || (wrapped && Object.keys(input).some(key => key !== 'inspection'))) throw new Error(`Unrecognized inspection fields. ${localInspectionHelp}`);
  const notes: string[] = [];
  for(const key of ['page', 'time', 'start', 'end']) {
    const raw = value[key];
    if(typeof raw === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw) && Number.isFinite(Number(raw))) {
      value[key] = Number(raw); notes.push(`Parsed ${key}=${raw} as a number.`);
    }
  }
  let normalized = value;
  // Unambiguous, read-only repair: a zero-length range requests the frame at that time.
  // Never swap reversed ranges or repair modifying tools such as save_video_cut.
  if(value.page === undefined && value.time === undefined && typeof value.start === 'number' && Number.isFinite(value.start) && value.start >= 0 && value.start === value.end) {
    normalized = {reportId: value.reportId, time: value.start};
    notes.push(`Interpreted start=end=${value.start} as a single-frame inspection at ${value.start} source seconds.`);
  }
  const parsed = inspectVideoSchema.safeParse(normalized);
  if(!parsed.success) throw new Error(`Invalid inspection: ${parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}. ${localInspectionHelp}`);
  return {arguments: {inspection: parsed.data}, note: notes.length ? notes.join(' ') : undefined};
}
