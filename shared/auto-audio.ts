import {z} from 'zod';
import type {Command,Project} from './project';
import {durationOf} from './project';
import {projectTracks,clipTrackId,trackClips} from './tracks';
import {projectForSequence} from './project-sequences';
import {duckingKeyframes} from './audio-ducking';
import {soundPreviewSchema} from './sound-presets';

export const autoAudioAnalyzeSchema=z.object({
  revision:z.number().int().nonnegative(),sourceTrackIds:z.array(z.string().min(1)).default([]),excludeClipIds:z.array(z.string().min(1)).default([]),
  thresholdDb:z.number().min(-80).max(0).default(-36),minActiveMs:z.number().min(20).max(2000).default(120),holdMs:z.number().min(0).max(3000).default(180),
  transientRiseDb:z.number().min(1).max(30).default(8),transientMinDb:z.number().min(-60).max(0).default(-24),minSpacingMs:z.number().min(100).max(30000).default(800),
  includeCuts:z.boolean().default(true),includeMarkers:z.boolean().default(true),
}).strict();
export type AutoAudioSettings=z.infer<typeof autoAudioAnalyzeSchema>;
export interface AudioActivity {id:string;start:number;end:number;peakDb:number}
export interface AudioCue {id:string;frame:number;kind:'transient'|'cut'|'transition'|'marker';reason:string;peakDb?:number;clipId?:string}
export interface AutoAudioReport {id:string;projectId:string;sequenceId:string;revision:number;fps:number;durationFrames:number;status:'queued'|'analyzing'|'ready'|'error'|'cancelled';progress:number;detail?:string;error?:string;settings:AutoAudioSettings;activity:AudioActivity[];cues:AudioCue[];appliedRevision?:number}
export const autoAudioApplySchema=z.object({reportId:z.string().uuid(),revision:z.number().int().nonnegative(),
  duck:z.object({targetClipIds:z.array(z.string().min(1)).min(1),gain:z.number().min(0).max(1).default(.25),attackFrames:z.number().int().nonnegative().default(6),releaseFrames:z.number().int().nonnegative().default(12),activityIds:z.array(z.string()).optional()}).optional(),
  placements:z.array(z.object({candidateId:z.string().min(1),frame:z.number().int().nonnegative().optional(),sound:soundPreviewSchema,volume:z.number().min(0).max(1).default(.65)})).default([]),
  trackId:z.string().min(1).optional(),
}).strict();
export type AutoAudioApply=z.infer<typeof autoAudioApplySchema>;

/** Timeline evidence only, including visible cuts inside nested sequences.
 * Audio attacks are added separately from measured samples, never inferred
 * from clip names or described as recognized gameplay/visual events. */
export function timelineAudioCues(project:Project,settings:AutoAudioSettings):AudioCue[] {
  const cues:AudioCue[]=[];
  const visit=(p:Project,map:(frame:number)=>number,visible:(frame:number)=>boolean,prefix:string)=>{
    for(const track of projectTracks(p).filter(t=>t.type==='visual'&&!t.hidden)) {
      const clips=trackClips(p,track.id);
      for(const [index,clip]of clips.entries()) {
        const frame=map(clip.start);const previous=clips[index-1];const transition=clip.transition!=='none'||!!clip.presetTransition;
        if(settings.includeCuts&&frame>0&&visible(clip.start)&&(transition||previous&&previous.start+previous.duration===clip.start))cues.push({id:`${prefix}${clip.id}`,frame,kind:transition?'transition':'cut',clipId:clip.id,reason:`${transition?'Transition':'Cut'} on ${track.name}: ${clip.name}`});
        if(clip.kind==='sequence') {
          const child=projectForSequence(p,clip.sequenceId!);const toParent=(f:number)=>clip.start+f/child.fps*p.fps-clip.sourceStart;
          visit(child,f=>map(toParent(f)),f=>{const parent=toParent(f);return parent>=clip.start&&parent<clip.start+clip.duration&&visible(parent);},`${prefix}${clip.id}/`);
        }
      }
    }
    if(settings.includeMarkers)for(const marker of p.markers??[])if(visible(marker.frame))cues.push({id:`${prefix}marker-${marker.id}`,frame:map(marker.frame),kind:'marker',reason:`Marker: ${marker.name}`});
  };
  visit(project,f=>Math.round(f),f=>f>=0&&f<durationOf(project),'');return cues;
}
export function spaceAudioCues(cues:AudioCue[],spacingFrames:number,duration:number):AudioCue[] {
  const priority={marker:4,transition:3,cut:2,transient:1};const chosen:AudioCue[]=[];
  for(const cue of [...cues].sort((a,b)=>priority[b.kind]-priority[a.kind]||(b.peakDb??-100)-(a.peakDb??-100)||a.frame-b.frame)) {
    if(cue.frame<0||cue.frame>=duration||chosen.some(other=>Math.abs(other.frame-cue.frame)<spacingFrames))continue;
    chosen.push(cue);
  }
  return chosen.sort((a,b)=>a.frame-b.frame).map((cue,index)=>({...cue,id:`cue-${index}`}));
}
export function autoDuckCommands(project:Project,report:AutoAudioReport,duck:NonNullable<AutoAudioApply['duck']>):Command[] {
  if(new Set(duck.targetClipIds).size!==duck.targetClipIds.length)throw new Error('Choose each ducking target once.');
  const ids=duck.activityIds?new Set(duck.activityIds):undefined;
  if(ids&&[...ids].some(id=>!report.activity.some(range=>range.id===id)))throw new Error('An activity range is missing from the report.');
  const activity=report.activity.filter(range=>!ids||ids.has(range.id));
  return duck.targetClipIds.map(id=>{
    const clip=project.clips.find(c=>c.id===id);if(!clip||!['audio','video','sequence'].includes(clip.kind))throw new Error('Choose audio, video or nested sequence clips to duck.');
    if(report.settings.sourceTrackIds.includes(clipTrackId(project,clip))&&!report.settings.excludeClipIds.includes(id))throw new Error('A ducking target contributed to the detector. Analyze again with that clip excluded.');
    const ranges=activity.map(r=>({start:r.start-clip.start,end:r.end-clip.start})).filter(r=>r.end+duck.releaseFrames>0&&r.start-duck.attackFrames<clip.duration);
    if(!ranges.length)throw new Error(`No detected activity overlaps ${clip.name}. No ducking was applied.`);
    return {type:'clip.update',id,patch:{audioDucking:{duration:clip.duration,offset:0,fadeIn:0,fadeOut:0,keyframes:duckingKeyframes(clip.duration,ranges,{gain:duck.gain,attack:duck.attackFrames,release:duck.releaseFrames})}}};
  });
}
