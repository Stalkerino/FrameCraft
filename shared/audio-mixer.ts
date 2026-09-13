import type {Project} from './project';
import {projectTracks} from './tracks';
import {activeSequenceId, projectForSequence} from './project-sequences';

export * from './audio-mixer-settings';

/** Stereo balance: center preserves stereo unchanged, either extreme sums both
 * source channels into that side. No channel is silently discarded. */
export function stereoPanFilter(pan=0) {
  return pan<0 ? `pan=stereo|c0=c0+${-pan}*c1|c1=${1+pan}*c1` : `pan=stereo|c0=${1-pan}*c0|c1=c1+${pan}*c0`;
}
export const dbGain=(db=0)=>10**(db/20);
export function audibleTrackIds(project:Project) {
  const tracks=projectTracks(project).filter(t=>t.type!=='text');const solo=tracks.some(t=>t.mix?.solo);
  return new Set(tracks.filter(t=>!t.hidden&&!t.muted&&(!solo||t.mix?.solo)).map(t=>t.id));
}
export function needsAudioMix(project:Project):boolean {
  return !!project.audioMix || projectTracks(project).some(t=>!!t.mix) || project.clips.some(c=>!!c.audioDucking || c.kind==='sequence'&&needsAudioMix(projectForSequence(project,c.sequenceId!)));
}
/** Audio-only identity keeps canvas edits, playhead changes and grading from
 * restarting audio preparation. Nested timelines retain their own clocks. */
export function audioMixIdentity(project:Project):string {
  const visit=(p:Project):unknown=>({id:activeSequenceId(p),fps:p.fps,duration:p.clips.reduce((n,c)=>Math.max(n,c.start+c.duration),Math.max(1,Math.round(p.fps))),
    masterVolume:p.masterVolume,audioMix:p.audioMix,tracks:projectTracks(p).filter(t=>t.type!=='text').map(t=>({id:t.id,hidden:t.hidden,muted:t.muted,mix:t.mix})),
    clips:p.clips.filter(c=>['video','audio','sequence'].includes(c.kind)).map(c=>({id:c.id,track:c.track,trackId:c.trackId,start:c.start,duration:c.duration,sourceStart:c.sourceStart,volume:c.volume,audioEnvelope:c.audioEnvelope,audioDucking:c.audioDucking,
      source:c.kind==='sequence'?visit(projectForSequence(p,c.sequenceId!)):p.assets.filter(a=>a.id===c.assetId).map(a=>({id:a.id,src:a.src,hasAudio:a.hasAudio}))}))});
  return JSON.stringify({projectId:project.id,timeline:visit(project)});
}
