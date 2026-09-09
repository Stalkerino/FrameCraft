import {colorGradeCommands, colorGradeRequestSchema, type ColorGradeRequest} from '../../shared/color-grade-editing';
import type {Activity} from '../../shared/project';
import type {ProjectRepository} from '../repositories/project-repository';
export class ColorGradingService {
  constructor(private projects: ProjectRepository) {}
  async set(input: ColorGradeRequest, source: Activity['source']) {
    const body = colorGradeRequestSchema.parse(input); const project = this.projects.snapshot().project;
    if(project.revision !== body.revision) throw Object.assign(new Error('Project changed. Read the timeline before changing its grade.'), {status: 409});
    const {commands, ...summary} = colorGradeCommands(project, body);
    if(!body.apply) return {revision: project.revision, scope: body.scope, ...summary};
    const snapshot = await this.projects.execute(commands, project.revision, source, body.grade === null ? 'Reset selected color grading' : 'Updated selected color grading');
    return {...snapshot, summary};
  }
}
