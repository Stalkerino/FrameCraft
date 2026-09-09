import {useEffect, useState} from 'react';
import {visualRushApi} from '../services/visual-rush-api';
export function useVisualRush(projectId?: string) {
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof visualRushApi.list>>>({reports: [], cuts: []}); const [error, setError] = useState('');
  useEffect(() => {let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {try {const catalog = await visualRushApi.list(); if(!stopped) {setCatalog(catalog); setError('');}} catch(error) {if(!stopped) setError((error as Error).message);} finally {if(!stopped) timer = setTimeout(refresh, 2000);}};
    void refresh(); return () => {stopped = true; clearTimeout(timer);};
  }, [projectId]);
  return {...catalog, error};
}
