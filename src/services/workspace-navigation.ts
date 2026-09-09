import {useEditor} from '../stores/editor-store';
import {useWorkspace} from '../stores/workspace-store';

export function openLibraryPanel(tab: ReturnType<typeof useEditor.getState>['libraryTab']) {
  useEditor.setState({libraryTab: tab});
  if(!useWorkspace.getState().showLibrary) useWorkspace.getState().configure({showLibrary: true});
}
export function openInspectorPanel(tab: 'properties' | 'codex') {
  useEditor.setState({inspectorTab: tab});
  if(!useWorkspace.getState().showInspector) useWorkspace.getState().configure({showInspector: true});
}
