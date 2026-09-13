import path from 'node:path';
import {rename} from 'node:fs/promises';
import {dataDir,mediaDir} from '../../config';
import {MediaFileRepository} from '../../repositories/media-file-repository';
import {AudioRenderService} from '../audio-render-service';
import {runEncodingProcess} from '../ffmpeg-progress-service';
import {ffmpegPath} from '../process-service';
import {reframeProject} from '../../../shared/project-settings';
import {durationOf} from '../../../shared/project';
import type {RenderTask,RenderProgress,RenderEngine} from './engine-contract';

/** Mix once over the sequence's original clock, then trim for export. Copy
 * encoded video packets: this never decodes or re-encodes GPU video frames. */
export async function renderWithAudioMix(engine:RenderEngine,task:RenderTask,progress:(value:RenderProgress)=>void) {
  const settings=task.job.settings!;
  const mixer=new AudioRenderService(new MediaFileRepository(mediaDir),path.join(dataDir,'audio-mixes'));
  const audio=await mixer.render(reframeProject(task.project,settings.fps),false,undefined,detail=>progress({phase:'Preparing timeline mix',progress:.01,detail}));
  const file=await engine.render({...task,job:{...task.job,settings:{...settings,audio:false}}},p=>progress({...p,progress:.05+p.progress*.85}));
  const video=path.join(task.exports,file),output=path.join(task.workspace,`mixed-${file}`);
  // Match the engine's frame-rounded output range at the requested frame rate.
  const startFrame=Math.floor(settings.startSeconds*settings.fps+(settings.renderer==='native-vulkan'?1e-7:0));
  const endFrame=Math.min(durationOf(reframeProject(task.project,settings.fps)),Math.ceil((settings.endSeconds??durationOf(reframeProject(task.project,settings.fps))/settings.fps)*settings.fps-(settings.renderer==='native-vulkan'?1e-7:0)));
  const seconds=(endFrame-startFrame)/settings.fps;
  const codec=settings.audioCodec==='pcm-16'?'pcm_s16le':settings.audioCodec==='opus'?'libopus':settings.audioCodec;
  const args=['-hide_banner','-loglevel','error','-nostdin','-threads','1','-i',video,'-ss',String(startFrame/settings.fps),'-i',audio.file,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a',codec,
    '-af',`apad,atrim=duration=${seconds}`,'-filter_threads','1','-ar',String(settings.sampleRate),'-ac','2',...(settings.audioCodec==='pcm-16'?[]:['-b:a',`${settings.audioBitrate}k`]),'-t',String(seconds),
    ...(['h264','h265','av1'].includes(settings.codec)?['-movflags','+faststart']:[]),...(settings.codec==='h265'?['-tag:v','hvc1']:[]),'-progress','pipe:1','-nostats','-y',output];
  await runEncodingProcess(ffmpegPath(),args,{onProgress:p=>progress({phase:'Writing mastered audio',progress:.91+.08*Math.min(1,p.outTimeUs/1e6/seconds),detail:'Copying encoded video · shared timeline audio mix'})});
  // Both files are isolated render outputs; user publication happens afterward.
  // The render workspace may be on a different filesystem.
  const {copyFile,unlink}=await import('node:fs/promises');
  const staged=`${video}.audio-tmp`;await copyFile(output,staged);try{await rename(staged,video);}finally{await unlink(staged).catch(()=>{});}
  return file;
}
