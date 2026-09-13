import {useEffect, useState} from 'react';
import type {EncoderCapabilities} from '../../shared/encoding';
import type {ExportSettings} from '../../shared/media-settings';
import {editorApi} from '../services/editor-api';

export function useEncoderCapabilities(codec: ExportSettings['codec'], renderer: ExportSettings['renderer'] = 'compatible') {
  const [state, setState] = useState<{capabilities?: EncoderCapabilities; error?: string}>({});
  useEffect(() => {
    let disposed = false;
    setState({});
    void editorApi.encoders(codec, renderer).then(capabilities => {if(!disposed) setState({capabilities});}, error => {if(!disposed) setState({error: error.message});});
    return () => {disposed = true;};
  }, [codec, renderer]);
  return state;
}
