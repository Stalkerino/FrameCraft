import {z} from 'zod';
import {timelineRangeEditSchema} from './timeline-ranges';
export const timelineRangeRequestSchema = timelineRangeEditSchema.extend({revision: z.number().int().nonnegative(), apply: z.boolean().default(false)});
