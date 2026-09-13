import type {ExportSettings} from '../../../shared/media-settings';
import type {Project} from '../../../shared/project';
import {useRenderPlan} from '../../hooks/useRenderPlan';

const executionLabel = {cpu: 'CPU', conditional: 'Depends on hardware', browser: 'Browser', none: 'Not needed', 'gpu-required': 'GPU required'};

export function RenderPlanSummary({project, settings}: {project: Project; settings: ExportSettings}) {
  const {plan, error} = useRenderPlan(project.id, project.revision, settings);
  return <details className="render-plan">
    <summary>Processing plan <span>{error ? 'Unavailable' : plan?.summary ?? 'Reading project…'}</span></summary>
    {error && <p role="status">{error}</p>}
    {plan && <div className="render-plan__content">
      <p className="render-plan__notice">Planned processing · hardware not tested</p>
      <dl className="render-plan__stages">{plan.stages.map(stage => <div key={stage.id}>
        <dt>{stage.label} <span data-execution={stage.execution}>{executionLabel[stage.execution]}</span></dt>
        <dd>{stage.description}</dd>
      </div>)}</dl>
      {plan.blockers.length > 0 && <div><strong>{plan.engine !== 'remotion-compatibility' ? 'Native GPU export is blocked by' : 'Why the full composition is needed'}</strong><ul>{plan.blockers.map((blocker, index) => <li key={`${blocker.code}-${blocker.clipId ?? index}`}>
        {blocker.clipName && <b>{blocker.clipName}: </b>}{blocker.message}
      </li>)}</ul></div>}
      <p className="render-plan__notice">{plan.notes[0]}</p>
    </div>}
  </details>;
}
