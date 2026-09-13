import {test,expect} from '@playwright/test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {Project} from '../../shared/project';
import type {AudioMixJob} from '../../shared/audio-mixer';

test('edits the track mixer, measures through MCP and uses the same stereo mix in preview/export',async({page,request})=>{
  const project=async():Promise<Project>=>(await(await request.get('/api/project')).json()).project;
  const previous=await project();
  const created=await request.post('/api/projects',{data:{action:'new',revision:(await project()).revision,name:'Mixer integration',settings:{width:320,height:180,fps:30,backgroundColor:'#102030',masterVolume:1}}});expect(created.ok()).toBe(true);
  const directory=path.resolve('.cache/e2e-mixer');await mkdir(directory,{recursive:true});const source=path.join(directory,'stereo.wav');
  execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-v','error','-f','lavfi','-i','aevalsrc=0.15*sin(2*PI*440*t)|0.05*sin(2*PI*880*t):s=48000:d=2','-c:a','pcm_f32le','-y',source]);
  const client=new Client({name:'mixer-test',version:'1'});await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve('scripts/mcp.mjs')],env:{...process.env as Record<string,string>,FRAMECRAFT_URL:'http://127.0.0.1:4319'}}));
  const call=async<T>(name:string,args:Record<string,unknown>):Promise<T>=>{const result=await client.callTool({name,arguments:args});expect(result.isError,JSON.stringify(result)).not.toBe(true);return JSON.parse((result.content as {type:string;text:string}[]).find(c=>c.type==='text')!.text);};
  try{
    await call('import_media',{filePath:source});let p=await project();const asset=p.assets.find(a=>a.name==='stereo.wav')!;
    await call('edit_project',{revision:p.revision,label:'Add mixer test audio',commands:[{type:'clip.add',clip:{id:'sound',name:'Sound',kind:'audio',track:'audio',assetId:asset.id,start:0,duration:60}}]});
    await page.goto('/');await page.getByRole('button',{name:'Audio mixer',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Audio mixer'});
    const gain=dialog.getByRole('spinbutton',{name:'Audio 1 gain',exact:true});await gain.fill('6');await gain.press('Enter');
    await expect.poll(async()=>(await project()).tracks?.find(t=>t.id==='audio')?.mix?.gainDb).toBe(6);
    const pan=dialog.getByRole('spinbutton',{name:'Audio 1 pan',exact:true});await pan.fill('-100');await pan.press('Enter');
    await expect.poll(async()=>(await project()).tracks?.find(t=>t.id==='audio')?.mix?.pan).toBe(-1);
    await dialog.getByRole('button',{name:'Undo',exact:true}).click();await expect(pan).toHaveValue('0');await dialog.getByRole('button',{name:'Redo',exact:true}).click();await expect(pan).toHaveValue('-100');
    await call('set_audio_mixer',{revision:(await project()).revision,master:{gainDb:0,pan:0,muted:false,normalization:{targetLufs:-16},limiter:{ceilingDb:-1}}});
    const start=await call<AudioMixJob>('prepare_audio_mix',{revision:(await project()).revision,measure:true});let job=start;
    await expect.poll(async()=>{job=await call<AudioMixJob>('get_audio_mix',{id:start.id});return job.status;},{timeout:30000}).toMatch(/done|error/);expect(job.status,job.error).toBe('done');expect(job.master!.integratedLufs!).toBeCloseTo(-16,0);expect(job.master!.rightPeakDb).toBeNull();
    await dialog.getByRole('button',{name:'Measure mix',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Measured mix');
    await dialog.getByRole('button',{name:'Close audio mixer'}).click();
    const audio=page.locator('audio[src*="/api/audio/mixes/"]');await expect(audio).toHaveCount(1);await expect.poll(()=>audio.evaluate((element:HTMLAudioElement)=>element.readyState)).toBeGreaterThanOrEqual(2);
    await page.getByRole('button',{name:'Play',exact:true}).click();await expect.poll(()=>audio.evaluate((element:HTMLAudioElement)=>element.currentTime)).toBeGreaterThan(.15);await page.getByRole('button',{name:'Pause',exact:true}).click();
    const render=await call<{id:string}>('export_video',{revision:(await project()).revision,settings:{renderer:'compatible',width:320,height:180,fps:30,audio:true,startSeconds:.5,endSeconds:1.5}});
    let rendered:{status:string;error?:string;url?:string}={status:'queued'};await expect.poll(async()=>{rendered=await(await request.get(`/api/render/${render.id}`)).json();return rendered.status;},{timeout:90000}).toMatch(/done|error/);expect(rendered.status,rendered.error).toBe('done');
    const output=path.join(directory,'mixed.mp4');await writeFile(output,await(await request.get(rendered.url!)).body());
    const pcm=execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-v','error','-i',output,'-map','0:a:0','-ac','2','-ar','48000','-f','f32le','-']);
    const cached=path.join(directory,'reference.wav');await writeFile(cached,await(await request.get(job.url!)).body());
    const reference=execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-v','error','-ss','0.5','-i',cached,'-t','1','-ac','2','-ar','48000','-f','f32le','-']);
    const rms=(bytes:Buffer,channel:number)=>{let sum=0;for(let n=4800;n<43000;n++)sum+=bytes.readFloatLE(n*8+channel*4)**2;return Math.sqrt(sum/(43000-4800));};
    expect(rms(pcm,0)).toBeCloseTo(rms(reference,0),2);expect(rms(pcm,1)).toBeLessThan(.0001);expect(pcm.length/8/48000).toBeCloseTo(1,1);
    await page.reload();await page.getByRole('button',{name:'Audio mixer',exact:true}).click();await expect(page.getByRole('spinbutton',{name:'Audio 1 gain',exact:true})).toHaveValue('6');
  }finally{await client.close();await request.post('/api/projects',{data:{action:'open',id:previous.id,revision:(await project()).revision}});}
});
