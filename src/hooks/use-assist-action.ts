import {useState} from 'react';
import {useEditor} from '../stores/editor-store';
/** Shared error and busy handling for real asynchronous analysis actions. */
export function useAssistAction() {
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    if(busy) return;
    setBusy(true);
    try {await action();} catch(error) {useEditor.setState({error: (error as Error).message});} finally {setBusy(false);}
  };
  return {busy, run};
}
