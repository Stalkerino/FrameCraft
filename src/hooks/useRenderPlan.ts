import {useEffect, useState} from 'react';
import {exportSettingsSchema, type ExportSettings} from '../../shared/media-settings';
import type {RenderPlan} from '../../shared/render-plan';
import {editorApi} from '../services/editor-api';

export function useRenderPlan(projectId: string, revision: number, settings: ExportSettings) {
  const [state, setState] = useState<{plan?: RenderPlan; error?: string}>({});
  const key = JSON.stringify({revision, settings});
  useEffect(() => {
    const controller = new AbortController();
    const input = JSON.parse(key);
    const parsed = exportSettingsSchema.safeParse(input.settings);
    setState({});
    if(!parsed.success) return () => controller.abort();
    const timer = setTimeout(() => {
      void editorApi.renderPlan({revision: input.revision, settings: parsed.data}, controller.signal).then(plan => {
        if(!controller.signal.aborted) setState(plan.projectId === projectId ? {plan} : {error: 'Project changed. Reopen export settings.'});
      }, error => {if(!controller.signal.aborted) setState({error: error.message});});
    }, 150);
    return () => {clearTimeout(timer); controller.abort();};
  }, [projectId, key]);
  return state;
}
