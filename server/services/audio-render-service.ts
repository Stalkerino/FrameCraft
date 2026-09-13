import {filterFileArguments} from './filter-file-service';
import {reframeProject} from '../../shared/project-settings';
import {createHash, randomUUID} from 'node:crypto';
import {access, mkdir, readFile, readdir, rename, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {durationOf, type Project} from '../../shared/project';
import {projectForSequence} from '../../shared/project-sequences';
import {clipTrackId, projectTracks} from '../../shared/tracks';
import {audioVolumeFilter} from '../../shared/audio-envelope';
import {audibleTrackIds, audioMixIdentity, dbGain, stereoPanFilter, type AudioMeasurement} from '../../shared/audio-mixer';
import type {MediaFileRepository} from '../repositories/media-file-repository';
import {ffmpegPath, ffprobePath, runProcess} from './process-service';
import {runEncodingProcess} from './ffmpeg-progress-service';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const finite=(value:unknown)=>Number.isFinite(Number(value))?Number(value):null;
export interface RenderedAudio {key:string;file:string;seconds:number;master?:AudioMeasurement;tracks:{id:string;name:string;file:string;levels?:AudioMeasurement}[]}
interface Context {signal?:AbortSignal;progress:(detail:string)=>void;used:Set<string>;sequence:Map<string,Promise<RenderedAudio>>}

/** Float audio buses on disk; one FFmpeg process at a time, at most eight
 * inputs per sum. Shared by browser/native preview, measurement and export.
 * Cached source/track buses survive fader changes; video frames never enter. */
export class AudioRenderService {
  private sourceInfo=new Map<string,{stamp:string;audio:boolean}>();
  constructor(private files:MediaFileRepository,readonly cache:string) {}
  async render(project:Project,measure=false,signal?:AbortSignal,progress:(detail:string)=>void=()=>{}) {
    await mkdir(this.cache,{recursive:true});
    const context:Context={signal,progress,used:new Set(),sequence:new Map()};
    const result=await this.sequence(project,context);
    if(measure) {
      result.master=await this.measure(result.file,context);
      for(const track of result.tracks)track.levels=await this.measure(track.file,context);
    }
    // Only this service's derived cache, never imported media or user exports.
    // Recent files remain available to players and other export workers.
    await this.prune(context.used);
    return result;
  }
  private async sequence(project:Project,context:Context):Promise<RenderedAudio> {
    const identity=audioMixIdentity(project);const existing=context.sequence.get(identity);if(existing)return existing;
    const pending=this.buildSequence(project,context);context.sequence.set(identity,pending);return pending;
  }
  private async buildSequence(project:Project,context:Context):Promise<RenderedAudio> {
    const seconds=durationOf(project)/project.fps;const audible=audibleTrackIds(project);const tracks:RenderedAudio['tracks']=[];
    for(const track of projectTracks(project).filter(t=>t.type!=='text')) {
      const clips:string[]=[];
      if(audible.has(track.id))for(const clip of project.clips.filter(c=>clipTrackId(project,c)===track.id&&['audio','video','sequence'].includes(c.kind)&&c.volume>0)) {
        let source:string;
        if(clip.kind==='sequence')source=(await this.sequence(reframeProject(projectForSequence(project,clip.sequenceId!),project.fps),context)).file;
        else {
          const asset=project.assets.find(a=>a.id===clip.assetId);if(!asset)throw new Error(`Missing audio source for ${clip.name}.`);
          if(asset.hasAudio===false)continue;
          source=this.files.resolve(asset.src);
          const info=await stat(source),stamp=`${info.size}:${info.mtimeMs}`;let audio=this.sourceInfo.get(source);
          if(audio?.stamp!==stamp){const metadata=JSON.parse(await runProcess(ffprobePath(),['-v','error','-select_streams','a:0','-show_entries','stream=index','-of','json',source],15000,{signal:context.signal}));audio={stamp,audio:!!metadata.streams?.length};this.sourceInfo.set(source,audio);}
          if(!audio.audio){if(clip.kind==='audio')throw new Error(`${clip.name} has no audio stream.`);continue;}
        }
        const samples=Math.round(clip.duration/project.fps*48000),delay=Math.round(clip.start/project.fps*48000);
        const filters=`asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,${audioVolumeFilter(clip.audioEnvelope,project.fps,clip.volume)},${audioVolumeFilter(clip.audioDucking,project.fps,1)},apad=whole_len=${samples},atrim=end_sample=${samples},adelay=${delay}S:all=1`;
        clips.push(await this.node([{file:source,start:clip.sourceStart/project.fps,duration:clip.duration/project.fps}],`[0:a]${filters}[out]`,context,`Reading ${clip.name}`));
      }
      const sum=await this.sum(clips,seconds,context);
      const output=await this.node([{file:sum}],`[0:a]volume=${dbGain(track.mix?.gainDb)},${stereoPanFilter(track.mix?.pan)}[out]`,context,`Mixing ${track.name}`);
      tracks.push({id:track.id,name:track.name,file:output});
    }
    const sum=await this.sum(tracks.map(t=>t.file),seconds,context);const mix=project.audioMix;
    let file=await this.node([{file:sum}],`[0:a]volume=${mix?.muted?0:(project.masterVolume??1)*dbGain(mix?.gainDb)},${stereoPanFilter(mix?.pan)}[out]`,context,'Master bus');
    if(mix?.normalization) {
      const levels=await this.measure(file,context);
      const gain=levels.integratedLufs===null?0:Math.max(-24,Math.min(24,mix.normalization.targetLufs-levels.integratedLufs));
      file=await this.node([{file}],`[0:a]volume=${dbGain(gain)}[out]`,context,'Loudness normalization');
    }
    if(mix?.limiter)file=await this.node([{file}],`[0:a]aresample=192000,alimiter=limit=${dbGain(mix.limiter.ceilingDb)}:level=false:latency=true:attack=5:release=50,aresample=48000,apad=whole_len=${Math.round(seconds*48000)},atrim=end_sample=${Math.round(seconds*48000)}[out]`,context,'Oversampled master limiter');
    return {key:path.basename(file,'.wav'),file,seconds,tracks};
  }
  private async sum(inputs:string[],seconds:number,context:Context):Promise<string> {
    if(inputs.length>8){const partial:string[]=[];for(let i=0;i<inputs.length;i+=8)partial.push(await this.sum(inputs.slice(i,i+8),seconds,context));return this.sum(partial,seconds,context);}
    const samples=Math.round(seconds*48000);
    const graph=inputs.length?`${inputs.map((_,i)=>`[${i}:a]`).join('')}amix=inputs=${inputs.length}:normalize=0:duration=longest:dropout_transition=0,apad=whole_len=${samples},atrim=end_sample=${samples}[out]`:`anullsrc=r=48000:cl=stereo,atrim=end_sample=${samples}[out]`;
    return this.node(inputs.map(file=>({file})),graph,context,'Summing audio buses');
  }
  private async node(inputs:{file:string;start?:number;duration?:number}[],graph:string,context:Context,label:string) {
    context.signal?.throwIfAborted();
    const identities=await Promise.all(inputs.map(async input=>{const info=await stat(input.file);return {...input,size:info.size,mtime:info.mtimeMs};}));
    const key=hash({version:1,identities,graph});const output=path.join(this.cache,`${key}.wav`);context.used.add(output);
    try{await access(output);return output;}catch{/* Cache miss. */}
    const temporary=path.join(this.cache,`${key}-${randomUUID()}`);const script=`${temporary}.txt`;const wave=`${temporary}.wav`;
    await writeFile(script,graph);const args=['-hide_banner','-loglevel','error','-nostdin'];
    for(const input of inputs){args.push('-threads','1');if(input.start!==undefined)args.push('-ss',String(input.start));if(input.duration!==undefined)args.push('-t',String(input.duration));args.push('-vn','-sn','-dn','-i',input.file);}
    args.push('-filter_complex_threads','1',...await filterFileArguments(script),'-map','[out]','-vn','-ac','2','-ar','48000','-c:a','pcm_f32le','-rf64','auto','-progress','pipe:1','-nostats','-y',wave);
    try {
      context.progress(label);
      await runEncodingProcess(ffmpegPath(),args,{signal:context.signal,onProgress:p=>context.progress(`${label} · ${(p.outTimeUs/1e6).toFixed(1)} s`)});
      await rename(wave,output);
    }finally{await rm(script,{force:true});await rm(wave,{force:true});}
    return output;
  }
  private async measure(file:string,context:Context):Promise<AudioMeasurement> {
    const cache=`${file}.json`;try{return JSON.parse(await readFile(cache,'utf8'));}catch{/* Not measured. */}
    let log='';context.progress('Measuring LUFS and true peaks');
    await runProcess(ffmpegPath(),['-hide_banner','-nostdin','-threads','1','-i',file,'-vn','-filter_threads','1','-af','astats=metadata=0:reset=0,loudnorm=I=-16:TP=-1:LRA=11:print_format=json','-f','null','-'],24*60*60_000,{signal:context.signal,onDiagnostic:chunk=>{log=(log+chunk).slice(-24000);context.progress('Measuring audio · '+log.slice(-80));}});
    const json=log.match(/\{\s*"input_i"[\s\S]*?\}/)?.[0];if(!json)throw new Error('FFmpeg did not return loudness measurements.');const measured=JSON.parse(json);
    const peaks=[...log.matchAll(/Peak level dB:\s*([-+\w.]+)/g)].map(m=>finite(m[1]));
    const result:AudioMeasurement={integratedLufs:finite(measured.input_i),truePeakDb:finite(measured.input_tp),loudnessRange:finite(measured.input_lra),leftPeakDb:peaks[0]??null,rightPeakDb:peaks[1]??null,samplePeakDb:peaks[2]??null};
    const temporary=`${cache}.${randomUUID()}`;await writeFile(temporary,JSON.stringify(result));await rename(temporary,cache);return result;
  }
  private async prune(used:Set<string>) {
    const entries=await readdir(this.cache);let bytes=0;const files:{file:string;size:number;mtime:number}[]=[];
    for(const name of entries.filter(name=>/^[a-f0-9]{64}\.wav$/.test(name)))try{const file=path.join(this.cache,name);const info=await stat(file);bytes+=info.size;files.push({file,size:info.size,mtime:info.mtimeMs});}catch{/* Another worker evicted it. */}
    for(const entry of files.sort((a,b)=>a.mtime-b.mtime)) {
      if(bytes<=2*1024**3)break;if(used.has(entry.file)||Date.now()-entry.mtime<60*60_000)continue;
      try{await rm(entry.file);await rm(`${entry.file}.json`,{force:true});bytes-=entry.size;}catch{/* An open Windows player may retain it. */}
    }
  }
}
