import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {saveVideoCutSchema, visualShotSchema} from '../../shared/visual-rush';
import type {Tool} from '@modelcontextprotocol/sdk/types.js';

const draftInput = saveVideoCutSchema.extend({shots: z.array(visualShotSchema.innerType().strict()).min(1)}).strict();
const patchSchema = z.object({id: z.string().min(1), start: z.number().finite().nonnegative().optional(), end: z.number().finite().positive().optional(), evidence: z.array(z.number().finite().nonnegative()).min(1).optional()}).strict();
const repairSchema = z.object({draftId: z.string().uuid(), revision: z.number().int().nonnegative().optional(), changes: z.array(patchSchema).min(1)}).strict();
const savedSchema = z.object({id: z.string().uuid(), projectId: z.string().nullable(), input: draftInput});

export const repairVideoCutTool: Tool = {name: 'repair_video_cut', description: 'Repair and SAVE the failed video-cut proposal identified by draftId. Change only the named shot start/end/evidence fields; all other shots, reasons, IDs and metadata are retained exactly. OMIT unchanged optional fields; never send an empty evidence array. Choose exact evidence from inspectedEvidenceInsideShot for that shot when provided. Pass a fresh revision only after a revision conflict. Times are source seconds, not timeline frames. This goes through the same validation and approval as save_video_cut; it does not apply the cut to the timeline.', inputSchema: {
  type: 'object', properties: {draftId: {type: 'string', format: 'uuid'}, revision: {type: 'integer', minimum: 0}, changes: {type: 'array', minItems: 1, items: {type: 'object', properties: {id: {type: 'string'}, start: {type: 'number', minimum: 0}, end: {type: 'number', exclusiveMinimum: 0}, evidence: {type: 'array', minItems: 1, items: {type: 'number', minimum: 0}}}, required: ['id'], additionalProperties: false}}}, required: ['draftId', 'changes'], additionalProperties: false,
}};

/** A failed, unsaved proposal is retained locally so repair cannot rewrite good shots. */
export class OllamaCutDraft {
  private draft: z.infer<typeof savedSchema> | null = null;
  serialize() {return structuredClone(this.draft);}
  restore(value: unknown) {const result = savedSchema.safeParse(value); this.draft = result.success ? result.data : null;}
  reset() {this.draft = null;}
  remember(input: Record<string, unknown>, projectId: string | null) {
    const result = draftInput.safeParse(input); if(!result.success) return null;
    if(this.draft?.projectId !== projectId || JSON.stringify(this.draft?.input) !== JSON.stringify(result.data)) this.draft = {id: randomUUID(), projectId, input: result.data};
    return this.draft!.id;
  }
  prepare(input: Record<string, unknown>, projectId: string | null): {name: 'save_video_cut'; arguments: z.infer<typeof draftInput>} {
    const args = repairSchema.parse(input);
    if(!this.draft || args.draftId !== this.draft.id) throw new Error('Unknown or superseded cut draft. Use the draftId from the latest failed save_video_cut.');
    if(projectId !== this.draft.projectId) throw new Error('This failed proposal belongs to another project.');
    const next = structuredClone(this.draft.input);
    if(args.revision !== undefined) next.revision = args.revision;
    const seen = new Set<string>();
    for(const {id, ...patch} of args.changes) {
      if(seen.has(id)) throw new Error(`Duplicate repair for shot ${id}.`); seen.add(id);
      const matches = next.shots.filter(shot => shot.id === id);
      if(matches.length !== 1) throw new Error(`Choose one existing unique shot ID; ${id} matched ${matches.length} shots.`);
      if(!Object.keys(patch).length) throw new Error(`Provide start, end or evidence to repair shot ${id}.`);
      Object.assign(matches[0], patch);
    }
    // Do not consume/mutate the draft: validation, approval and MCP execution follow.
    return {name: 'save_video_cut', arguments: next};
  }
}
