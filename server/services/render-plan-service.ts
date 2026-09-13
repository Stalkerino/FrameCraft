import type {Project} from '../../shared/project';
import {projectForSequence} from '../../shared/project-sequences';
import {describeRenderPlan, renderPlanRequestSchema} from '../../shared/render-plan';

export function planProjectRender(project: Project, body: unknown) {
  const request = renderPlanRequestSchema.parse(body);
  if(request.revision !== undefined && request.revision !== project.revision) throw Object.assign(new Error('Project changed. Refresh the render plan.'), {status: 409});
  return describeRenderPlan(projectForSequence(project, request.sequenceId), request);
}
