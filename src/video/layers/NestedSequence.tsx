import {useMemo, type CSSProperties} from 'react';
import {Sequence, useCurrentFrame} from 'remotion';
import type {Clip, Project} from '../../../shared/project';
import {projectForSequence} from '../../../shared/project-sequences';
import {reframeProject} from '../../../shared/project-settings';
import {audioEnvelopeGain} from '../../../shared/audio-envelope';
import {ProjectComposition, type CompositionProps} from '../ProjectComposition';

/** Render the live child scene in its own canvas, then transform the complete
 * group. Parent opacity/masks/grades are never distributed across child layers. */
export function NestedSequence({clip, project, muted, style, audioOnly, ...media}: Pick<CompositionProps, 'mediaBase' | 'previewSources' | 'pendingPreviews' | 'onPreviewSourceError'> & {
  clip: Clip; project: Project; muted?: boolean; style?: CSSProperties; audioOnly?: boolean;
}) {
  const frame = useCurrentFrame();
  const child = useMemo(() => reframeProject(projectForSequence(project, clip.sequenceId!), project.fps), [project, clip.sequenceId]);
  const volume = muted ? 0 : clip.volume * (project.masterVolume ?? 1) * audioEnvelopeGain(clip.audioEnvelope, frame);
  const input = {...child, masterVolume: (child.masterVolume ?? 1) * volume};
  const content = <Sequence from={-clip.sourceStart} layout="none"><ProjectComposition project={input} audioOnly={audioOnly} {...media}/></Sequence>;
  if(audioOnly) return content;
  const contain = Math.min(project.width / child.width, project.height / child.height);
  return <div data-preview-clip={clip.id} style={{...style, position: 'absolute'}}><div data-nested-content style={{position: 'absolute', left: '50%', top: '50%', width: child.width, height: child.height, transform: `translate(-50%, -50%) scale(${contain})`, overflow: 'hidden'}}>{content}</div></div>;
}
