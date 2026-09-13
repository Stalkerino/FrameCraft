import {randomUUID} from 'node:crypto';
import type {Project} from '../../shared/project';

/** A render can read only its own images across the renderer's ephemeral origin.
 * Authorizations expire when that render finishes; API CORS remains unchanged. */
export class RenderMediaAccess {
  private grants=new Map<string,Set<string>>();
  prepare(project:Project){const token=randomUUID();const paths=new Set(project.assets.filter(asset=>asset.kind==='image'&&/^\/(project-media|media)\//.test(asset.src)).map(asset=>asset.src));
    this.grants.set(token,paths);return {project:{...project,assets:project.assets.map(asset=>paths.has(asset.src)?{...asset,src:`${asset.src}?framecraft-render=${token}`}:asset)},release:()=>{this.grants.delete(token);}};
  }
  permits(path:string,token:unknown,origin:string){if(typeof token!=='string'||!this.grants.get(token)?.has(path))return false;try{const url=new URL(origin);return url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname);}catch{return false;}}
}
