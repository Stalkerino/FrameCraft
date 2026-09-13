import {readFile,writeFile,mkdir,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {AudioActivityDetector} from '../../shared/audio-activity';
import type {AutoAudioSettings} from '../../shared/auto-audio';
import {runProcess,ffmpegPath} from './process-service';

export class AudioActivityService {
  constructor(private cache:string) {}
  async analyze(file:string,seconds:number,fps:number,settings:AutoAudioSettings,signal:AbortSignal,onProgress:(value:number)=>void) {
    const key=createHash('sha256').update(JSON.stringify({version:1,file,fps,threshold:settings.thresholdDb,min:settings.minActiveMs,hold:settings.holdMs,rise:settings.transientRiseDb,peak:settings.transientMinDb,spacing:settings.minSpacingMs})).digest('hex');
    const cached=path.join(this.cache,`${key}.json`);
    try{const value=JSON.parse(await readFile(cached,'utf8'));onProgress(1);return value as ReturnType<AudioActivityDetector['finish']>;}catch{/* Stream once when not cached. */}
    const detector=new AudioActivityDetector(settings,fps);let tail=Buffer.alloc(0);
    await runProcess(ffmpegPath(),['-v','error','-nostdin','-threads','1','-i',file,'-map','0:a:0','-vn','-sn','-dn','-ac','2','-ar','8000','-filter_threads','1','-f','f32le','pipe:1'],24*60*60_000,{signal,onOutput:chunk=>{
      const bytes=tail.length?Buffer.concat([tail,chunk]):chunk;const end=bytes.length-bytes.length%4;
      for(let i=0;i<end;i+=4)detector.push(bytes.readFloatLE(i));tail=Buffer.from(bytes.subarray(end));onProgress(Math.min(1,detector.seconds/seconds));
    }});
    const result=detector.finish();await mkdir(this.cache,{recursive:true});const temporary=`${cached}.${randomUUID()}`;
    try{await writeFile(temporary,JSON.stringify(result));await rename(temporary,cached);}finally{await unlink(temporary).catch(()=>{});}
    return result;
  }
}
