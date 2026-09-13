import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {autoAudioAnalyzeSchema,autoAudioApplySchema,autoDuckCommands,timelineAudioCues,spaceAudioCues,type AutoAudioSettings,type AutoAudioApply,type AutoAudioReport} from '../../shared/auto-audio';
import {clipSchema,durationOf,type Activity,type Asset,type Command,type Project} from '../../shared/project';
import {projectTracks,trackSchema} from '../../shared/tracks';
import {activeSequenceId,projectForSequence} from '../../shared/project-sequences';
import type {ProjectRepository} from '../repositories/project-repository';
import type {AudioRenderService} from './audio-render-service';
import type {AudioActivityService} from './audio-activity-service';
import type {SoundLibraryService} from './sound-library-service';

export class AutoAudioService {
  private reports=new Map<string,AutoAudioReport>();private controllers=new Map<string,AbortController>();private queue:Promise<void>=Promise.resolve();private closed=false;
  constructor(private projects:ProjectRepository,private renderer:AudioRenderService,private detector:AudioActivityService,private sounds:SoundLibraryService,private directory:string) {}
  close(){this.closed=true;for(const controller of this.controllers.values())controller.abort();}
  create(input:AutoAudioSettings) {
    if(this.closed)throw new Error('Auto audio is shutting down.');
    if(this.controllers.size>=2)throw new Error('An audio analysis is already queued. Cancel it or wait for completion.');
    const settings=autoAudioAnalyzeSchema.parse(input),project=projectForSequence(this.projects.snapshot().project);
    if(project.revision!==settings.revision)throw Object.assign(new Error('Timeline changed. Analyze the current sequence.'),{status:409});
    const tracks=projectTracks(project);
    if(new Set(settings.sourceTrackIds).size!==settings.sourceTrackIds.length||settings.sourceTrackIds.some(id=>!tracks.some(t=>t.id===id&&t.type!=='text')))throw new Error('Choose existing audio/video detector tracks once.');
    if(settings.excludeClipIds.some(id=>!project.clips.some(c=>c.id===id)))throw new Error('An excluded clip no longer exists.');
    const report:AutoAudioReport={id:randomUUID(),projectId:project.id,sequenceId:activeSequenceId(project),revision:project.revision,fps:project.fps,durationFrames:durationOf(project),settings,status:'queued',progress:0,activity:[],cues:[]};
    const controller=new AbortController();this.reports.set(report.id,report);this.controllers.set(report.id,controller);
    const work=async()=>{
      try{
        controller.signal.throwIfAborted();report.status='analyzing';report.detail='Preparing selected foreground audio';
        const cues=timelineAudioCues(project,settings);
        if(settings.sourceTrackIds.length) {
          const source:Project={...project,audioMix:null,masterVolume:1,tracks:tracks.map(t=>({...t,muted:t.muted||!settings.sourceTrackIds.includes(t.id),mix:t.mix?{...t.mix,solo:false}:null})),clips:project.clips.map(c=>settings.excludeClipIds.includes(c.id)?{...c,volume:0}:c)};
          const mixed=await this.renderer.render(source,false,controller.signal,detail=>{report.detail=detail;});
          report.detail='Detecting activity and audio attacks';report.progress=.2;
          const detected=await this.detector.analyze(mixed.file,mixed.seconds,project.fps,settings,controller.signal,value=>{report.progress=.2+.75*value;});
          report.activity=detected.activity; cues.push(...detected.cues);
        }
        controller.signal.throwIfAborted();report.cues=spaceAudioCues(cues,Math.max(1,Math.round(settings.minSpacingMs/1000*project.fps)),report.durationFrames);
        report.status='ready';report.progress=1;report.detail=`${report.activity.length} activity ranges · ${report.cues.length} suggested cues. Energy detection, not speech or visual recognition.`;
      }catch(error){report.status=controller.signal.aborted?'cancelled':'error';report.error=(error as Error).message;}
      finally{this.controllers.delete(report.id);await this.save(report).catch(error=>{report.status='error';report.error=`Could not save analysis: ${error.message}`;});}
      while(this.reports.size>16){const old=[...this.reports.keys()].find(id=>id!==report.id&&!this.controllers.has(id));if(!old)break;this.reports.delete(old);}
    };
    this.queue=this.queue.then(work,work);return structuredClone(report);
  }
  async get(id:string):Promise<AutoAudioReport> {
    if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid audio report id.');
    const report=this.reports.get(id);if(report)return structuredClone(report);
    try{return JSON.parse(await readFile(path.join(this.directory,`${id}.json`),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')throw Object.assign(new Error('Audio analysis report not found.'),{status:404});throw error;}
  }
  async cancel(id:string){await this.get(id);this.controllers.get(id)?.abort();return this.get(id);}
  private async save(report:AutoAudioReport) {
    await mkdir(this.directory,{recursive:true});const temporary=path.join(this.directory,`${report.id}.${randomUUID()}.tmp`);
    try{await writeFile(temporary,JSON.stringify(report));await rename(temporary,path.join(this.directory,`${report.id}.json`));}finally{await unlink(temporary).catch(()=>{});}
  }
  async apply(input:AutoAudioApply,source:Activity['source']) {
    const body=autoAudioApplySchema.parse(input),report=await this.get(body.reportId),project=this.projects.snapshot().project;
    if(report.status!=='ready')throw new Error('Wait for a completed audio analysis.');
    if(report.projectId!==project.id||report.sequenceId!==activeSequenceId(project)||report.revision!==body.revision||project.revision!==body.revision)throw Object.assign(new Error('Analysis is outdated. Analyze the current sequence again before applying.'),{status:409});
    const commands:Command[]=body.duck?autoDuckCommands(project,report,body.duck):[];
    if(new Set(body.placements.map(p=>p.candidateId)).size!==body.placements.length)throw new Error('Choose each suggested cue once.');
    const placements=body.placements.map(p=>{const cue=report.cues.find(c=>c.id===p.candidateId);if(!cue)throw new Error('Suggested cue is missing.');const frame=p.frame??cue.frame;if(frame>=report.durationFrames)throw new Error('Place sounds within the analyzed timeline.');
      const sound=this.sounds.library.get(p.sound.id);if(sound.version!==p.sound.version)throw Object.assign(new Error('Sound preset changed. Refresh its version.'),{status:409});return {...p,frame};});
    let track=body.trackId?projectTracks(project).find(t=>t.id===body.trackId):undefined;
    if(body.trackId&&track?.type!=='audio')throw new Error('Choose an audio track for the SFX.');
    const assets=new Map<string,Asset>();
    try{
      if(placements.length&&!track){track=trackSchema.parse({id:`sfx-${randomUUID()}`,name:'Auto SFX',type:'audio'});commands.push({type:'track.add',track});}
      for(const placement of placements) {
        const key=JSON.stringify(placement.sound);let asset=assets.get(key);
        if(!asset){asset=await this.sounds.prepareAsset(project.id,placement.sound);assets.set(key,asset);commands.push({type:'asset.add',asset});}
        const duration=Math.min(Math.floor(asset.duration*project.fps+1e-7),report.durationFrames-placement.frame);if(duration<1)throw new Error('Sound duration must cover at least one timeline frame.');
        commands.push({type:'clip.add',clip:clipSchema.parse({id:randomUUID(),kind:'audio',track:'audio',trackId:track!.id,assetId:asset.id,name:asset.name,start:placement.frame,duration,volume:placement.volume,autoAudio:{reportId:report.id,candidateId:placement.candidateId}})});
      }
      if(!commands.length)throw new Error('Select ducking targets or sound cues to apply.');
      const current=this.projects.snapshot().project;
      if(current.id!==project.id||current.revision!==project.revision||activeSequenceId(current)!==report.sequenceId)throw Object.assign(new Error('Timeline changed during sound preparation. No edits were applied.'),{status:409});
      const snapshot=await this.projects.execute(commands,body.revision,source,'Applied activity ducking and selected sound cues');
      report.appliedRevision=snapshot.project.revision;this.reports.set(report.id,report);await this.save(report).catch(()=>{});return snapshot;
    }catch(error){for(const asset of assets.values())await this.projects.addImportedAsset(asset,project.id,source).catch(()=>{});throw error;}
  }
}
