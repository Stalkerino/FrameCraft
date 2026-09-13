import {useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode} from 'react';
import {useWorkspace} from '../../stores/workspace-store';
import {ResizeHandle} from '../atoms/ResizeHandle';
import {WorkspaceToolbar} from '../molecules/WorkspaceToolbar';
import {WindowFrame} from '../molecules/WindowFrame';
export function EditorLayout({header, library, preview, inspector, timeline, overlays}: {header: ReactNode; library: ReactNode; preview: ReactNode; inspector: ReactNode; timeline: ReactNode; overlays?: ReactNode}) {
  const root = useRef<HTMLDivElement>(null); const workspace = useWorkspace();
  const [bounds, setBounds] = useState({width: 1440, height: 900});
  useLayoutEffect(() => {const element = root.current; if(!element) return; const observer = new ResizeObserver(([entry]) => setBounds({width: entry.contentRect.width, height: entry.contentRect.height})); observer.observe(element); return () => observer.disconnect();}, []);
  const sideBudget = Math.max(500, bounds.width - 330 - 12);
  const requested = (workspace.showLibrary ? workspace.libraryWidth : 0) + (workspace.showInspector ? workspace.inspectorWidth : 0);
  const ratio = Math.min(1, sideBudget / Math.max(1, requested));
  const left = workspace.showLibrary ? workspace.libraryWidth * ratio : 0;
  const right = workspace.showInspector ? workspace.inspectorWidth * ratio : 0;
  const maxTimeline = Math.max(180, bounds.height - 310);
  const timelineHeight = Math.min(workspace.timelineHeight, maxTimeline);
  const styles = {'--library-width': `${left}px`, '--inspector-width': `${right}px`, '--timeline-height': `${timelineHeight}px`, '--left-handle': workspace.showLibrary ? '6px' : '0px', '--right-handle': workspace.showInspector ? '6px' : '0px'} as CSSProperties;
  return <div className="editor-layout" ref={root} style={styles}>{header}<WorkspaceToolbar/>
    <div className="editor-workspace">
      <div className="workspace-panel workspace-panel--library" hidden={!workspace.showLibrary}>{library}</div>
      {workspace.showLibrary ? <ResizeHandle label="Resize media panel" orientation="vertical" value={left} min={250} max={Math.max(250, Math.min(520, bounds.width - right - 342))} onResize={libraryWidth => workspace.configure({libraryWidth}, false)} onCommit={workspace.save}/> : <div/>}
      {preview}
      {workspace.showInspector ? <ResizeHandle label="Resize properties panel" orientation="vertical" value={right} min={280} max={Math.max(280, Math.min(620, bounds.width - left - 342))} direction={-1} onResize={inspectorWidth => workspace.configure({inspectorWidth}, false)} onCommit={workspace.save}/> : <div/>}
      <div className="workspace-panel workspace-panel--inspector" hidden={!workspace.showInspector}>{inspector}</div>
    </div>
    <ResizeHandle label="Resize timeline" orientation="horizontal" value={timelineHeight} min={180} max={maxTimeline} direction={-1} onResize={timelineHeight => workspace.configure({timelineHeight}, false)} onCommit={workspace.save}/>
    {timeline}{overlays}<WindowFrame/>
  </div>;
}
