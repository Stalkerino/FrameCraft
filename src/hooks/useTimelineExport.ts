import {useState} from 'react';
import type {Project} from '../../shared/project';
import type {TimelineExportResult} from '../../shared/timeline-interchange';
import {timelineExportApi} from '../services/timeline-export-api';
export function useTimelineExport(project: Project) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [result, setResult] = useState<TimelineExportResult | null>(null);
  const create = async (mediaRoot: string) => {
    setBusy(true); setError(''); setResult(null);
    try {setResult(await timelineExportApi.create({revision: project.revision, format: 'premiere-xml', mediaRoot: mediaRoot.trim() || undefined}));}
    catch(error) {setError((error as Error).message);} finally {setBusy(false);}
  };
  return {busy, error, result, create, clear: () => setResult(null)};
}
