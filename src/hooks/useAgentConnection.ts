import {useCallback, useEffect, useRef, useState} from 'react';
import {editorApi, type ServerStatus} from '../services/editor-api';

export function useAgentConnection() {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if(inFlight.current) return;
    inFlight.current = true; setChecking(true);
    try {const value = await editorApi.status(); if(mounted.current) {setStatus(value); setError(null);}}
    catch {if(mounted.current) setError('The editor service is unavailable. Start npm run dev in the Framecraft folder and keep that terminal open.');}
    finally {inFlight.current = false; if(mounted.current) setChecking(false);}
  }, []);
  useEffect(() => {
    mounted.current = true; void refresh(); const timer = setInterval(() => {void refresh();}, 2000);
    return () => {mounted.current = false; clearInterval(timer);};
  }, [refresh]);
  return {status, error, checking, refresh, connected: !error && (status?.agentConnections?.length || 0) > 0};
}
