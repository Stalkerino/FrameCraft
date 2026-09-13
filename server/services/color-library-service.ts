import {mkdir, readdir, readFile, writeFile, rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {colorLutSchema} from '../../shared/color-lut';
import {parseColorCube} from './cube-parser';
import type {ProjectRepository} from '../repositories/project-repository';
import type {Activity} from '../../shared/project';
export class ColorLibraryService {
  constructor(private directory:string,private projects:ProjectRepository){}
  async list(){await mkdir(this.directory,{recursive:true});const names=await readdir(this.directory);return Promise.all(names.filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).map(async name=>{const {data,...entry}=colorLutSchema.parse(JSON.parse(await readFile(path.join(this.directory,name),'utf8')));return entry;}));}
  async import(text:string,name:string,revision:number,source:Activity['source']){
    if(this.projects.snapshot().project.revision!==revision)throw Object.assign(new Error('Project changed. Import the LUT again.'),{status:409});
    const lut=parseColorCube(text,name);await mkdir(this.directory,{recursive:true});
    const temporary=path.join(this.directory,`${lut.id}-${randomUUID()}.tmp`);await writeFile(temporary,JSON.stringify(lut));await rename(temporary,path.join(this.directory,`${lut.id}.json`));
    const snapshot=await this.projects.execute([{type:'color-lut.add',lut}],revision,source,'Imported color LUT');return {...snapshot,lutId:lut.id};
  }
  async attach(id:string,revision:number,source:Activity['source']){if(!/^[a-f0-9]{64}$/.test(id))throw new Error('Invalid LUT id.');const lut=colorLutSchema.parse(JSON.parse(await readFile(path.join(this.directory,`${id}.json`),'utf8')));return this.projects.execute([{type:'color-lut.add',lut}],revision,source,'Added library LUT to project');}
}
