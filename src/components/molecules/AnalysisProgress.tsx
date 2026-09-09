import {LoaderCircle, X} from 'lucide-react';
import type {AnalysisJob} from '../../../shared/transcript';
import {analysisApi} from '../../services/analysis-api';
import {useAnalysis} from '../../stores/analysis-store';
import {useAssistAction} from '../../hooks/use-assist-action';
export function AnalysisProgress({job}: {job?: AnalysisJob}) {
  const {run} = useAssistAction(); if(!job) return null;
  const active = job.status === 'running' || job.status === 'queued';
  return <div className={`analysis-progress analysis-progress--${job.status}`} role="status">
    <div>{active && <LoaderCircle className="spin" size={14}/>}<span>{job.message}</span>{active && <button aria-label="Cancel analysis" onClick={() => void run(async () => useAnalysis.getState().add(await analysisApi.cancel(job.id)))}><X size={14}/></button>}</div>
    {active && <progress value={job.progress} max={1} aria-label="Analysis progress"/>}
  </div>;
}
