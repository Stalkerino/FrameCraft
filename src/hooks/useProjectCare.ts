import {useCallback, useEffect, useRef, useState} from 'react';
import type {MediaHealth, ProjectTransferJob, RecoveryVersion} from '../../shared/project-care';
import {projectCareApi} from '../services/project-care-api';
import {useEditor} from '../stores/editor-store';

export function useProjectCare() {
  const project = useEditor(state => state.snapshot?.project);
  const [versions, setVersions] = useState<RecoveryVersion[]>([]); const [media, setMedia] = useState<MediaHealth>();
  const [jobs, setJobs] = useState<ProjectTransferJob[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const mounted = useRef(true); const generation = useRef(0);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false; generation.current++;};}, []);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    const [saved, health] = await Promise.all([projectCareApi.versions(), projectCareApi.media()]);
    if(mounted.current && current === generation.current) {setVersions(saved); setMedia(health);}
  }, []);
  useEffect(() => {void refresh().catch(error => {if(mounted.current) setError(error.message);});}, [project?.id, project?.revision, refresh]);
  useEffect(() => {
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {const result = await projectCareApi.transfers(); if(!stopped) setJobs(result);}
      catch(error) {if(!stopped) setError((error as Error).message);}
      if(!stopped) timer = setTimeout(poll, 1500);
    };
    void poll(); return () => {stopped = true; clearTimeout(timer);};
  }, []);
  const perform = async (action: () => Promise<unknown>) => {
    if(busy) return; setBusy(true); setError('');
    try {await action(); await refresh();}
    catch(error) {if(mounted.current) setError((error as Error).message);}
    finally {if(mounted.current) setBusy(false);}
  };
  const current = () => {const value = useEditor.getState().snapshot?.project; if(!value || value.id !== project?.id) throw new Error('Project changed. Reopen project safety.'); return value;};
  return {versions, media, jobs, busy, error, refresh: () => perform(refresh),
    checkpoint: (label: string) => perform(() => projectCareApi.checkpoint(current().revision, label)),
    restore: (id: string) => perform(async () => {
      useEditor.setState({playing: false}); const snapshot = await projectCareApi.restore(current().revision, id);
      useEditor.getState().accept(snapshot); useEditor.getState().seekTo(0);
    }),
    relink: (assetId: string, filePath: string) => perform(async () => {useEditor.setState({playing: false}); useEditor.getState().accept(await projectCareApi.relink(current().revision, assetId, filePath));}),
    transfer: (kind: 'export' | 'import', directory: string) => perform(async () => {
      const job = kind === 'export' ? await projectCareApi.package(current().revision, directory) : await projectCareApi.import(directory);
      if(mounted.current) setJobs(existing => [...existing, job]);
    }),
    cancel: (id: string) => perform(() => projectCareApi.cancel(id)),
  };
}
export type ProjectCareController = ReturnType<typeof useProjectCare>;
