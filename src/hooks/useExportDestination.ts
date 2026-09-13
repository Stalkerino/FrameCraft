import {useEffect, useRef, useState} from 'react';
import {extensionFor, type ExportSettings} from '../../shared/media-settings';
import {exportDestinationApi} from '../services/export-destination-api';

export function useExportDestination(projectId: string, codec: ExportSettings['codec']) {
  const [outputPath, setOutputPath] = useState('');
  const [defaultPath, setDefaultPath] = useState('');
  const [error, setError] = useState('');
  const changed = useRef(false);
  const extension = extensionFor(codec);
  useEffect(() => {
    let disposed = false;
    setOutputPath(file => file ? file.replace(/\.[^./\\]+$/, `.${extension}`) : file);
    void exportDestinationApi.defaults(codec).then(result => {
      if(disposed) return;
      if(result.projectId !== projectId) throw new Error('Project changed. Reopen export settings.');
      setDefaultPath(result.outputPath); setError('');
      if(!changed.current) setOutputPath(result.outputPath);
    }).catch(e => {if(!disposed) setError((e as Error).message);});
    return () => {disposed = true;};
  }, [projectId, codec, extension]);
  return {outputPath, error, change: (file: string) => {changed.current = true; setOutputPath(file);}, reset: () => {changed.current = false; setOutputPath(defaultPath);}};
}
