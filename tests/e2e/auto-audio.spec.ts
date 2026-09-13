import {test,expect} from '@playwright/test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {Project} from '../../shared/project';
import type {AutoAudioReport} from '../../shared/auto-audio';

test('detects actual foreground activity, preserves fades, applies reviewed SFX atomically and exports ducked audio',async({page,request})=>{
  const project=async():Promise<Project>=>(await(await request.get('/api/project')).json()).project;
  const previous=await project();const created=await request.post('/api/projects',{data:{action:'new',revision:previous.revision,name:'Auto audio integration',settings:{width:320,height:180,fps:30,backgroundColor:'#102030',masterVolume:1}}});expect(created.ok()).toBe(true);
  const directory=path.resolve('.cache/e2e-auto-audio');await mkdir(directory,{recursive:true});
  const client=new Client({name:'auto-audio-test',version:'1'});await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve('scripts/mcp.mjs')],env:{...process.env as Record<string,string>,FRAMECRAFT_URL:'http://127.0.0.1:4319'}}));
  const call=async<T>(name:string,args:Record<string,unknown>):Promise<T>=>{const result=await client.callTool({name,arguments:args});expect(result.isError,JSON.stringify(result)).not.toBe(true);return JSON.parse((result.content as {type:string;text:string}[]).find(c=>c.type==='text')!.text);};
  try{
    for(const [name,expression]of [['music','0.1*sin(2*PI*220*t)'],['foreground','0.4*sin(2*PI*880*t)*(between(t,1,2)+between(t,4,5))']]) {
      const file=path.join(directory,`${name}.wav`);
      execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-v','error','-f','lavfi','-i',`aevalsrc='${expression}':s=48000:d=6`,'-c:a','pcm_f32le','-y',file]);await call('import_media',{filePath:file});
    }
    const p=await project(),music=p.assets.find(a=>a.name==='music.wav')!,foreground=p.assets.find(a=>a.name==='foreground.wav')!;
    const manual={duration:180,offset:0,fadeIn:15,fadeOut:15,keyframes:[]};
    await call('edit_project',{revision:p.revision,label:'Build foreground and background',commands:[{type:'track.add',track:{id:'foreground',type:'audio',name:'Foreground'}},
      {type:'clip.add',clip:{id:'music',name:'Music',kind:'audio',track:'audio',assetId:music.id,start:0,duration:180,volume:.5,audioEnvelope:manual}},
      {type:'clip.add',clip:{id:'foreground',name:'Foreground',kind:'audio',track:'audio',trackId:'foreground',assetId:foreground.id,start:0,duration:180}},
      {type:'marker.set',marker:{id:'reveal',name:'Reveal',frame:90,color:'#ffffff',note:''}}]});
    await page.goto('/');await page.getByRole('button',{name:'Audio mixer',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Audio mixer'});await dialog.getByRole('button',{name:'Auto audio',exact:true}).click();
    await dialog.getByRole('checkbox',{name:'Detect Foreground',exact:true}).check();await dialog.getByRole('checkbox',{name:'Duck Music',exact:true}).check();
    const response=page.waitForResponse(r=>r.url().endsWith('/api/auto-audio/analyze')&&r.request().method()==='POST');await dialog.getByRole('button',{name:'Analyze sequence',exact:true}).click();
    const started=await(await response).json();let report:AutoAudioReport=started;
    await expect.poll(async()=>{report=await call<AutoAudioReport>('get_auto_audio_report',{id:started.id});return report.status;},{timeout:30000}).toMatch(/ready|error/);expect(report.status,report.error).toBe('ready');
    expect(report.activity).toHaveLength(2);expect(report.activity[0].start).toBeGreaterThanOrEqual(29);expect(report.activity[0].end).toBeLessThanOrEqual(61);
    await dialog.getByRole('button',{name:'Clear cues',exact:true}).click();const marker=report.cues.find(c=>c.kind==='marker')!;expect(marker.frame).toBe(90);await dialog.getByRole('checkbox',{name:`Use ${marker.id}`,exact:true}).check();
    const editedFrame=dialog.getByRole('spinbutton',{name:`${marker.id} frame`,exact:true});await editedFrame.fill('92');await editedFrame.press('Enter');
    await dialog.getByRole('button',{name:'Apply selected audio edits',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Applied at revision');
    const applied=await project();expect(applied.clips.find(c=>c.id==='music')?.audioEnvelope).toEqual(manual);expect(applied.clips.find(c=>c.id==='music')?.audioDucking?.keyframes.some(k=>k.value===.25)).toBe(true);
    expect(applied.clips.filter(c=>c.autoAudio)).toHaveLength(1);expect(applied.clips.find(c=>c.autoAudio)?.start).toBe(92);
    const rejected=await request.post('/api/auto-audio/apply',{data:{reportId:report.id,revision:report.revision,duck:{targetClipIds:['music']}}});expect(rejected.status()).toBe(409);expect((await project()).revision).toBe(applied.revision);
    await call('undo_redo',{revision:applied.revision,direction:'undo'});const undone=await project();expect(undone.clips.find(c=>c.id==='music')?.audioDucking).toBeUndefined();expect(undone.clips.some(c=>c.autoAudio)).toBe(false);
    await call('undo_redo',{revision:undone.revision,direction:'redo'});
    await dialog.getByRole('button',{name:'Close audio mixer'}).click();await expect(page.locator('audio[src*="/api/audio/mixes/"]')).toHaveCount(1);
    const render=await call<{id:string}>('export_video',{revision:(await project()).revision,settings:{renderer:'compatible',width:320,height:180,fps:30,audio:true,endSeconds:3.5}});
    let result:{status:string;error?:string;url?:string}={status:'queued'};await expect.poll(async()=>{result=await(await request.get(`/api/render/${render.id}`)).json();return result.status;},{timeout:90000}).toMatch(/done|error/);expect(result.status,result.error).toBe('done');
    const output=path.join(directory,'auto-audio.mp4');await writeFile(output,await(await request.get(result.url!)).body());const pcm=execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-v','error','-i',output,'-map','0:a:0','-ac','1','-ar','48000','-f','f32le','-']);
    const tone=(start:number)=>{let sum=0;for(let n=Math.round(start*48000);n<Math.round((start+.2)*48000);n++)sum+=pcm.readFloatLE(n*4)*Math.sin(2*Math.PI*220*n/48000);return Math.abs(sum)/9600;};
    expect(tone(1.4)/tone(.6)).toBeCloseTo(.25,1);
    // MCP can also apply an edited subset, with an existing reusable sound.
    const next=await call<AutoAudioReport>('analyze_auto_audio',{revision:(await project()).revision,sourceTrackIds:[],includeCuts:false,includeMarkers:true});let ready=next;
    await expect.poll(async()=>{ready=await call<AutoAudioReport>('get_auto_audio_report',{id:next.id});return ready.status;}).toBe('ready');
    await call('apply_auto_audio',{reportId:ready.id,revision:ready.revision,placements:[{candidateId:ready.cues[0].id,frame:100,sound:{id:'whoosh-soft',version:1,values:{duration:.3}},volume:.3}]});expect((await project()).clips.filter(c=>c.autoAudio)).toHaveLength(2);
  }finally{await client.close();await request.post('/api/projects',{data:{action:'open',id:previous.id,revision:(await project()).revision}});}
});
