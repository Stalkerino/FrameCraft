import type {z} from 'zod';
import {audioDuckCommands, audioDuckSchema} from '../../shared/audio-mix';
import type {Activity} from '../../shared/project';
import type {ProjectRepository} from '../repositories/project-repository';
import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {audioMixIdentity, audioMixRequestSchema, setAudioMixerSchema, type AudioMixJob} from '../../shared/audio-mixer';
import {projectTracks} from '../../shared/tracks';
import {activeSequenceId, projectForSequence} from '../../shared/project-sequences';
import type {Command} from '../../shared/project';
import type {AudioRenderService} from './audio-render-service';
export class AudioMixService {
  private jobs=new Map<string,AudioMixJob>();
  private keys=new Map<string,string>();
  private controllers=new Map<string,AbortController>();
  private queue:Promise<void>=Promise.resolve();
  private closed=false;
  constructor(private projects: ProjectRepository,private renderer?:AudioRenderService) {}
  close(){this.closed=true;for(const controller of this.controllers.values())controller.abort();}
  async set(input:z.infer<typeof setAudioMixerSchema>,source:Activity['source']) {
    const body=setAudioMixerSchema.parse(input);const project=this.projects.snapshot().project;const commands:Command[]=[];
    if(new Set(body.tracks?.map(t=>t.id)).size!==(body.tracks?.length??0))throw new Error('Choose each track once.');
    for(const update of body.tracks??[]) {
      if(!projectTracks(project).some(t=>t.id===update.id&&t.type!=='text'))throw new Error('Choose an audio or video track.');
      commands.push({type:'track.update',id:update.id,patch:{...(update.mix!==undefined?{mix:update.mix}:{}),...(update.muted!==undefined?{muted:update.muted}:{})}});
    }
    if(body.master!==undefined)commands.push({type:'project.audio-mix',mix:body.master});
    if(!commands.length)throw new Error('Choose track or master settings to change.');
    return this.projects.execute(commands,body.revision,source,'Updated audio mixer');
  }
  create(input:z.infer<typeof audioMixRequestSchema>) {
    if(this.closed||!this.renderer)throw new Error('Audio mixer is unavailable.');
    const body=audioMixRequestSchema.parse(input);const project=projectForSequence(this.projects.snapshot().project);
    if(project.revision!==body.revision)throw Object.assign(new Error('Timeline changed; request the current mix.'),{status:409});
    const key=audioMixIdentity(project)+String(body.measure)+(body.measure?String(project.revision):'');
    const existing=this.keys.get(key);const previous=existing?this.jobs.get(existing):undefined;
    const cachedFile=previous?.url?.match(/\/mixes\/([a-f0-9]{64})\/file$/)?.[1];
    if(previous&&['queued','processing','done'].includes(previous.status)&&
      (previous.status!=='done'||cachedFile&&existsSync(this.file(cachedFile))))return this.get(previous.id);
    // Superseded preview mixes cannot pile up while editing a fader. Explicit
    // measurement jobs remain cancellable and keep their revision provenance.
    for(const [id,job] of this.jobs)if(!body.measure&&job.projectId===project.id&&job.sequenceId===activeSequenceId(project)&&this.controllers.has(id)&&!job.id.startsWith('measure-'))this.controllers.get(id)?.abort();
    if([...this.controllers.values()].filter(c=>!c.signal.aborted).length>=4)throw new Error('Audio queue is full. Cancel a measurement or wait for it to finish.');
    const id=(body.measure?'measure-':'mix-')+randomUUID();const controller=new AbortController();
    const job:AudioMixJob={id,projectId:project.id,sequenceId:activeSequenceId(project),revision:project.revision,status:'queued',progress:0};
    this.jobs.set(id,job);this.keys.set(key,id);this.controllers.set(id,controller);
    const work=async()=>{
      try{
        controller.signal.throwIfAborted();job.status='processing';
        const result=await this.renderer!.render(project,body.measure,controller.signal,()=>{});
        job.url=`/api/audio/mixes/${result.key}/file`;job.master=result.master;job.tracks=result.tracks.filter(t=>t.levels).map(t=>({id:t.id,name:t.name,levels:t.levels!}));job.status='done';job.progress=1;
      }catch(error){job.status=controller.signal.aborted?'cancelled':'error';job.error=(error as Error).message;}finally{this.controllers.delete(id);}
      while(this.jobs.size>32){const entry=[...this.jobs].find(([key])=>!this.controllers.has(key)&&key!==id);if(!entry)break;this.jobs.delete(entry[0]);for(const [key,value]of this.keys)if(value===entry[0])this.keys.delete(key);}
    };
    this.queue=this.queue.then(work,work);return structuredClone(job);
  }
  get(id:string){const job=this.jobs.get(id);if(!job)throw Object.assign(new Error('Audio mix job not found.'),{status:404});return structuredClone(job);}
  cancel(id:string){this.get(id);this.controllers.get(id)?.abort();return this.get(id);}
  file(key:string){if(!/^[a-f0-9]{64}$/.test(key)||!this.renderer)throw new Error('Invalid mix file.');return path.join(this.renderer.cache,`${key}.wav`);}
  async duck(input: z.infer<typeof audioDuckSchema>, source: Activity['source']) {
    const body = audioDuckSchema.parse(input); const project = this.projects.snapshot().project;
    if(body.revision !== project.revision) throw Object.assign(new Error('Project changed. Read the clips again before changing the mix.'), {status: 409});
    const commands = audioDuckCommands(project, body);
    if(!body.apply) return {revision: project.revision, commands, warning: 'Ducking follows foreground clip timing, not detected speech or loudness. Applying replaces the target clips’ existing fades and volume automation.'};
    return this.projects.execute(commands, body.revision, source, 'Ducked selected audio beneath foreground clips');
  }
}
