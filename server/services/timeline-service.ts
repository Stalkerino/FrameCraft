import {editTimelineRanges} from '../../shared/timeline-ranges';
import {timelineRangeRequestSchema} from '../../shared/timeline-range-request';
import type {Activity} from '../../shared/project';
import type {ProjectRepository} from '../repositories/project-repository';
import type {z} from 'zod';

export class TimelineService {
  constructor(private projects: ProjectRepository) {}
  async ranges(input: z.infer<typeof timelineRangeRequestSchema>, source: Activity['source']) {
    const body = timelineRangeRequestSchema.parse(input);
    const project = this.projects.snapshot().project;
    if(project.revision !== body.revision) throw Object.assign(new Error('Project changed. Read the timeline again before editing ranges.'), {status: 409});
    const {operation, ranges, trackIds} = body;
    const {clips, ...summary} = editTimelineRanges(project, {operation, ranges, trackIds});
    if(!body.apply) return {revision: project.revision, ...summary, resultClipCount: clips.length};
    const snapshot = await this.projects.execute([{type: 'timeline.edit-ranges', operation: body.operation, ranges: body.ranges, trackIds: body.trackIds}], body.revision, source, body.operation === 'remove' ? 'Removed timeline ranges with synchronized cuts' : 'Assembled synchronized timeline sections');
    return {...snapshot, summary};
  }
}
