import type {z} from 'zod';
import {audioDuckCommands, audioDuckSchema} from '../../shared/audio-mix';
import type {Activity} from '../../shared/project';
import type {ProjectRepository} from '../repositories/project-repository';
export class AudioMixService {
  constructor(private projects: ProjectRepository) {}
  async duck(input: z.infer<typeof audioDuckSchema>, source: Activity['source']) {
    const body = audioDuckSchema.parse(input); const project = this.projects.snapshot().project;
    if(body.revision !== project.revision) throw Object.assign(new Error('Project changed. Read the clips again before changing the mix.'), {status: 409});
    const commands = audioDuckCommands(project, body);
    if(!body.apply) return {revision: project.revision, commands, warning: 'Ducking follows foreground clip timing, not detected speech or loudness. Applying replaces the target clips’ existing fades and volume automation.'};
    return this.projects.execute(commands, body.revision, source, 'Ducked selected audio beneath foreground clips');
  }
}
