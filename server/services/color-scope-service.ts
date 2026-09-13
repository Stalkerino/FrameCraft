import sharp from 'sharp';
import {analyzeColorPixels} from '../../shared/color-scopes';
import {activeSequenceId, projectForSequence} from '../../shared/project-sequences';
import {updateCanvasSettings} from '../../shared/project-settings';
import type {ProjectRepository} from '../repositories/project-repository';
import type {RenderService} from './render-service';

/** Explicit captures share the render queue; no continuous decoders or GPU probes. */
export class ColorScopeService {
  private captures=new Map<string,{projectId:string;sequenceId:string;revision:number;frame:number;result?:ReturnType<typeof analyzeColorPixels>}>();
  constructor(private projects:ProjectRepository,private renders:RenderService){}
  create(revision:number,frame:number){
    const original=this.projects.snapshot().project;if(original.revision!==revision)throw Object.assign(new Error('Project changed. Capture the current frame again.'),{status:409});
    if([...this.captures.keys()].some(id=>['queued','rendering'].includes(this.renders.jobs.get(id)?.status??'')))throw new Error('A scope capture is already in progress.');
    const project=projectForSequence(original);const scale=Math.min(1,512/project.width,512/project.height);const width=Math.round(project.width*scale/2)*2;const height=Math.round(project.height*scale/2)*2;
    const sampled=width<64||height<64?project:updateCanvasSettings(project,{width,height,fps:project.fps,backgroundColor:project.backgroundColor??'#080c0e',masterVolume:project.masterVolume??1});
    const job=this.renders.create(sampled,'frame',frame);this.captures.set(job.id,{projectId:project.id,sequenceId:activeSequenceId(project),revision,frame});
    // Only statistics are retained here, with a bounded cache. Captures remain ordinary saved PNGs.
    if(this.captures.size>16)this.captures.delete(this.captures.keys().next().value!);return {id:job.id,status:job.status};
  }
  async get(id:string){const capture=this.captures.get(id);if(!capture)throw Object.assign(new Error('Scope capture not found.'),{status:404});const job=this.renders.jobs.get(id);if(!job)throw new Error('Scope render not found.');
    if(job.status==='done'&&!capture.result){const output=await this.renders.output(id);const {data,info}=await sharp(output.path).resize({width:256,height:256,fit:'inside',withoutEnlargement:true}).toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});capture.result=analyzeColorPixels(data,info.width,info.height);}
    return {id,...capture,status:job.status,error:job.error,url:job.url};
  }
}
