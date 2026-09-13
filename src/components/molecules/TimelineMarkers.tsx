import type {CSSProperties} from 'react';
import {formatTimecode} from '../../../shared/project';
import type {TimelineMarker} from '../../../shared/project-organization';
import {useEditor} from '../../stores/editor-store';
export function TimelineMarkers({markers, fps, width, pixelsPerFrame, onEdit}: {markers: TimelineMarker[]; fps: number; width: number; pixelsPerFrame: number; onEdit: (id: string) => void}) {
  if(!markers.length) return null;
  return <div className="timeline-markers" onPointerDown={e => e.stopPropagation()}>
    <div className="track-label">MARKERS <span>{markers.length}</span></div><div className="timeline-markers__lane" style={{width}}>
      {markers.map(marker => <button key={marker.id} aria-label={`Go to marker ${marker.name}`} title={`${marker.name} · ${formatTimecode(marker.frame, fps)}${marker.end != null ? ` – ${formatTimecode(marker.end, fps)}` : ''}\n${marker.note}\nDouble-click to edit`}
        style={{left: marker.frame * pixelsPerFrame, width: marker.end != null ? Math.max(10, (marker.end - marker.frame) * pixelsPerFrame) : 10, '--marker-color': marker.color} as CSSProperties}
        className={marker.end != null ? 'timeline-markers__range' : ''} onClick={() => useEditor.getState().seekTo(marker.frame)} onDoubleClick={() => onEdit(marker.id)}><span>{marker.name}</span></button>)}
    </div>
  </div>;
}
