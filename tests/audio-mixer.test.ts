import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {expect,it} from 'vitest';
import {audioMixIdentity,audibleTrackIds,masterMixSchema,needsAudioMix,trackMixSchema} from '../shared/audio-mixer';
import {applyCommand,projectSchema} from '../shared/project';
import {projectForSequence} from '../shared/project-sequences';
import {AudioRenderService} from '../server/services/audio-render-service';
import {MediaFileRepository} from '../server/repositories/media-file-repository';
import {ffmpegPath,runProcess} from '../server/services/process-service';

const project=()=>projectSchema.parse({version:1,id:'mix-test',name:'Mixer',revision:0,width:320,height:180,fps:30,masterVolume:1,
  assets:[{id:'tone',kind:'audio',name:'Tone',src:'/media/tone.wav',duration:2}],
  clips:[{id:'tone',kind:'audio',name:'Tone',track:'audio',assetId:'tone',start:0,duration:60}],
  tracks:[{id:'audio',type:'audio',name:'Audio 1'},{id:'second',type:'audio',name:'Audio 2'}]});
it('preserves independent sequence buses and excludes visual-only edits from audio identity',()=>{
  let p=project();const key=audioMixIdentity(p);expect(needsAudioMix(p)).toBe(false);
  expect(audioMixIdentity({...p,revision:9,backgroundColor:'#ff0000',colorGrade:{exposure:1,contrast:1,saturation:1,temperature:0,tint:0,gamma:1,hue:0}})).toBe(key);
  p=applyCommand(p,{type:'project.audio-mix',mix:masterMixSchema.parse({gainDb:6,limiter:{ceilingDb:-1}})});
  p=applyCommand(p,{type:'sequence.create',id:'parent',name:'Parent'});expect(p.audioMix).toBeUndefined();expect(projectForSequence(p,'main').audioMix?.gainDb).toBe(6);
  p=applyCommand(p,{type:'sequence.insert',id:'nested',sequenceId:'main',start:0,sourceStart:0,duration:60});expect(needsAudioMix(p)).toBe(true);
  expect(()=>trackMixSchema.parse({gainDb:25})).toThrow();expect(()=>masterMixSchema.parse({normalization:{targetLufs:0}})).toThrow();
});
it('solo remains subordinate to mute and hidden tracks',()=>{
  let p=project();p=applyCommand(p,{type:'track.update',id:'audio',patch:{mix:trackMixSchema.parse({solo:true})}});expect([...audibleTrackIds(p)]).toEqual(['audio']);
  p=applyCommand(p,{type:'track.update',id:'audio',patch:{muted:true}});expect([...audibleTrackIds(p)]).toEqual([]);
});
it('renders real stereo bus gain/pan, nested clocks, normalization and limiting without video work',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'framecraft-mixer-'));await mkdir(path.join(dir,'media'));
  try{
    await runProcess(ffmpegPath(),['-v','error','-nostdin','-f','lavfi','-i','aevalsrc=0.15*sin(2*PI*440*t)|0.05*sin(2*PI*880*t):s=48000:d=2','-c:a','pcm_f32le','-y',path.join(dir,'media/tone.wav')],10000);
    const renderer=new AudioRenderService(new MediaFileRepository(path.join(dir,'media')),path.join(dir,'cache'));
    let p=project();p=applyCommand(p,{type:'track.update',id:'audio',patch:{mix:trackMixSchema.parse({gainDb:6,pan:-1})}});
    const first=await renderer.render(p,true);const levels=first.master!;
    expect(levels.integratedLufs).not.toBeNull();expect(levels.leftPeakDb).not.toBeNull();expect(levels.rightPeakDb).toBeNull();expect(levels.samplePeakDb).toBeLessThan(0);
    const chunks:Buffer[]=[];await runProcess(ffmpegPath(),['-v','error','-i',first.file,'-f','f32le','-'],10000,{onOutput:chunk=>{chunks.push(chunk);}});const pcm=Buffer.concat(chunks);
    expect(pcm.length).toBe(2*48000*2*4);
    let sum=0;for(let n=100;n<95000;n++){sum+=pcm.readFloatLE(n*8)**2;expect(pcm.readFloatLE(n*8+4)).toBe(0);}expect(Math.sqrt(sum/94900)).toBeCloseTo(Math.sqrt((.15**2+.05**2)/2)*10**(6/20),3);
    const cached=await renderer.render({...p,revision:99});expect(cached.file).toBe(first.file);
    p=applyCommand(p,{type:'sequence.create',id:'parent',name:'Parent'});p=applyCommand(p,{type:'sequence.insert',id:'nested',sequenceId:'main',start:15,sourceStart:15,duration:30});
    p=applyCommand(p,{type:'clip.update',id:'nested',patch:{volume:.5}});const nested=await renderer.render(p,true);
    expect(nested.seconds).toBe(1.5);expect(nested.master!.leftPeakDb!).toBeCloseTo(levels.leftPeakDb!-6.0206,1);
    p=applyCommand(project(),{type:'project.audio-mix',mix:masterMixSchema.parse({normalization:{targetLufs:-16},limiter:{ceilingDb:-1}})});
    const normalized=await renderer.render(p,true);expect(normalized.master!.integratedLufs!).toBeCloseTo(-16,0);expect(normalized.master!.truePeakDb!).toBeLessThanOrEqual(-.9);
    p=applyCommand(p,{type:'project.audio-mix',mix:masterMixSchema.parse({gainDb:24,limiter:{ceilingDb:-3}})});
    const limited=await renderer.render(p,true);expect(limited.master!.truePeakDb!).toBeLessThanOrEqual(-2.8);expect(limited.seconds).toBe(2);
    p=applyCommand(p,{type:'project.audio-mix',mix:masterMixSchema.parse({muted:true,normalization:{targetLufs:-16},limiter:{ceilingDb:-1}})});
    const silent=await renderer.render(p,true);expect(silent.master!.integratedLufs).toBeNull();expect(silent.master!.truePeakDb).toBeNull();
  }finally{await rm(dir,{recursive:true,force:true});}
},30000);
