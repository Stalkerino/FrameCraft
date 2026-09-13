import type {Project, RenderJob} from '../../../shared/project';

export interface RenderTask {project: Project; job: RenderJob; workspace: string; root: string; exports: string; mediaBase: string}
export interface RenderProgress {progress: number; phase: string; detail?: string; encoder?: string; warning?: string}
export type RenderMessage = {type: 'ready'} | ({type: 'progress'} & RenderProgress) | {type: 'done'; file: string} | {type: 'error'; error: string};

/** Native engines plug in here; HTTP/MCP and project editing do not depend on Remotion. */
export interface RenderEngine {
  readonly id: string;
  render(task: RenderTask, onProgress: (progress: RenderProgress) => void): Promise<string>;
}
