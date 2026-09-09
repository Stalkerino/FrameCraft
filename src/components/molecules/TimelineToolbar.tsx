import {ClipboardPaste, Copy, CopyPlus, Layers3, LocateFixed, Magnet, Maximize2, Minus, MousePointer2, Plus, Redo2, Scissors, Sparkles, Trash2, Undo2} from 'lucide-react';
import type {Project} from '../../../shared/project';
import {canSplitAt, splitTarget} from '../../../shared/timeline-editing';
import {useEditor} from '../../stores/editor-store';
import {useAnalysis} from '../../stores/analysis-store';
import {useWorkspace} from '../../stores/workspace-store';
import {Button, IconButton} from '../atoms/Button';
import {AddTrackMenu} from './AddTrackMenu';

export function TimelineToolbar({project, onFit}: {project?: Project; onFit: () => void}) {
  const {frame, selectedId, selectedTrackId, timelineTool, zoom, busy, clipboard, snapshot} = useEditor();
  const {snapping, followPlayhead, configure} = useWorkspace();
  const selected = project?.clips.find(c => c.id === selectedId);
  const target = project && splitTarget(project, selectedId, selectedTrackId, frame);
  const gameplay = () => {useAnalysis.setState({tab: 'gameplay', assetId: selected?.kind === 'video' ? selected.assetId ?? '' : ''}); useEditor.setState({libraryTab: 'assist'}); useWorkspace.getState().configure({showLibrary: true});};
  return <div className="timeline-toolbar">
    <div className="timeline-toolbar__row timeline-toolbar__sequence">
      <div className="timeline-toolbar__title"><Layers3 size={14}/><strong>Timeline</strong><span className="timeline-sequence-name">{project?.name || 'No project'}</span><span className="timeline-count">{project?.clips.length || 0} clips</span></div>
      <div className="timeline-toolbar__sequence-actions"><Button variant="ghost" icon={<Sparkles size={13}/>} onClick={gameplay} disabled={!project?.assets.some(a => a.kind === 'video')}>Smart cut</Button><AddTrackMenu/></div>
    </div>
    <div className="timeline-toolbar__row">
      <div className="timeline-tools" role="toolbar" aria-label="Timeline editing tools">
        <div className="timeline-tool-group" role="group" aria-label="Selection and cutting">
          <IconButton label="Selection tool" title="Selection tool (V) · drag edges to trim" aria-pressed={timelineTool === 'select'} className={timelineTool === 'select' ? 'active' : ''} onClick={() => useEditor.setState({timelineTool: 'select'})}><MousePointer2 size={16}/></IconButton>
          <IconButton label="Cut tool (C)" aria-pressed={timelineTool === 'razor'} className={timelineTool === 'razor' ? 'active' : ''} title="Razor (C): click a clip to cut at that position" onClick={() => useEditor.setState({timelineTool: timelineTool === 'razor' ? 'select' : 'razor'})}><Scissors size={16}/></IconButton>
          <Button aria-label="Split selected clip (S)" title={canSplitAt(target, frame) ? 'Split at the playhead (S)' : 'Place the playhead inside the selected clip'} disabled={busy || !canSplitAt(target, frame)} onClick={() => void useEditor.getState().splitClip()}>Split</Button>
        </div>
        <div className="timeline-tool-group" role="group" aria-label="Clipboard and deletion">
          <IconButton label="Copy selected clip (Ctrl+C)" disabled={!selected} onClick={() => useEditor.getState().copyClip()}><Copy size={15}/></IconButton>
          <IconButton label="Paste clip at playhead (Ctrl+V)" disabled={!clipboard || clipboard.projectId !== project?.id || busy} onClick={() => void useEditor.getState().pasteClip()}><ClipboardPaste size={15}/></IconButton>
          <IconButton label="Duplicate selected clip (Ctrl+D)" title="Duplicate after the selected clip (Ctrl+D)" disabled={!selected || busy} onClick={() => void useEditor.getState().duplicateClip()}><CopyPlus size={15}/></IconButton>
          <IconButton label="Delete selected clip" disabled={!selected || busy} onClick={() => selected && void useEditor.getState().execute([{type: 'clip.remove', id: selected.id}], `Removed ${selected.name}`.slice(0, 180))}><Trash2 size={15}/></IconButton>
        </div>
        <div className="timeline-tool-group" role="group" aria-label="Edit history">
          <IconButton label="Undo timeline edit (Ctrl+Z)" disabled={!snapshot?.canUndo || busy} onClick={() => void useEditor.getState().history('undo')}><Undo2 size={16}/></IconButton>
          <IconButton label="Redo timeline edit (Ctrl+Y / Ctrl+Shift+Z)" disabled={!snapshot?.canRedo || busy} onClick={() => void useEditor.getState().history('redo')}><Redo2 size={16}/></IconButton>
        </div>
        <div className="timeline-tool-group" role="group" aria-label="Timeline behavior">
          <Button variant="ghost" icon={<Magnet size={14}/>} aria-label="Snap clips (N)" aria-pressed={snapping} className={snapping ? 'active' : ''} onClick={() => configure({snapping: !snapping})}>Snap</Button>
          <IconButton label="Follow playhead" aria-pressed={followPlayhead} className={followPlayhead ? 'active' : ''} onClick={() => configure({followPlayhead: !followPlayhead})}><LocateFixed size={16}/></IconButton>
        </div>
      </div>
      <div className="timeline-zoom">
        <IconButton label="Fit timeline" onClick={onFit}><Maximize2 size={14}/></IconButton>
        <IconButton label="Zoom out timeline" onClick={() => useEditor.setState({zoom: Math.max(.01, zoom * .8)})}><Minus size={14}/></IconButton>
        <input aria-label="Timeline zoom" type="range" min="0.01" max="4" step="0.01" value={zoom} onChange={e => useEditor.setState({zoom: Number(e.target.value)})}/>
        <IconButton label="Zoom in timeline" onClick={() => useEditor.setState({zoom: Math.min(4, zoom * 1.25)})}><Plus size={14}/></IconButton><span>{Math.round(zoom * 100)}%</span>
      </div>
    </div>
  </div>;
}
