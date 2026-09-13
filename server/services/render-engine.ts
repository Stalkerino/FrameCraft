import type {RenderProgress, RenderTask} from './rendering/engine-contract';
import {needsAudioMix} from '../../shared/audio-mixer';
import {renderWithAudioMix} from './rendering/mixed-audio-export';

export type {RenderEngine, RenderMessage, RenderProgress, RenderTask} from './rendering/engine-contract';

/** The existing worker protocol stays stable while native engines are introduced. */
export const renderProject = async (task: RenderTask, onProgress: (progress: RenderProgress) => void) => {
  const render=(engine:import('./rendering/engine-contract').RenderEngine)=>task.job.kind==='video'&&task.job.settings?.audio&&needsAudioMix(task.project)
    ?renderWithAudioMix(engine,task,onProgress):engine.render(task,onProgress);
  if(task.job.kind === 'video' && task.job.settings?.renderer === 'native-vulkan') {
    const {nativeVulkanEngine} = await import('./rendering/native-vulkan-engine');
    return render(nativeVulkanEngine);
  }
  if(task.job.kind === 'video' && task.job.settings?.renderer === 'native-gpu') {
    const {nativeGpuEngine} = await import('./rendering/native-gpu-engine');
    return render(nativeGpuEngine);
  }
  const {remotionEngine} = await import('./rendering/remotion-engine');
  return render(remotionEngine);
};
