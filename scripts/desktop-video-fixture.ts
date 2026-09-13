import {mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {createDemo} from '../shared/demo';
import {clipSchema, projectSchema} from '../shared/project';
import {writeStoredProject} from '../server/repositories/project-storage';
const directory = process.argv[2];
if(!directory || !path.basename(directory).startsWith('framecraft-desktop-surface-')) throw new Error('Use an isolated desktop smoke directory');
await mkdir(path.join(directory, 'media'), {recursive: true});
execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=1', '-c:v', 'libx264', '-threads', '1', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', path.join(directory, 'media/source.mp4')], {timeout: 10000});
const project = projectSchema.parse({...createDemo(), id: 'native-desktop-check', name: 'Native desktop check', width: 320, height: 180, fps: 30,
  assets: [{id: 'source', name: 'Synthetic source', kind: 'video', src: '/media/source.mp4', width: 320, height: 180, fps: 30, duration: 1}],
  clips: [clipSchema.parse({id: 'cut-a', name: 'First cut', kind: 'video', assetId: 'source', track: 'visual', start: 0, duration: 6, transition: 'none'}),
    clipSchema.parse({id: 'cut-b', name: 'Second cut', kind: 'video', assetId: 'source', track: 'visual', start: 6, sourceStart: 12, duration: 6, transition: 'none'}),
    clipSchema.parse({id: 'title', name: 'GPU title', kind: 'text', track: 'text', start: 0, duration: 12, text: 'NATIVE GPU', fontSize: 18, x: 50, y: 12, animation: 'none'})]});
// Written only before this isolated editor starts; never touch the user's project.
await writeStoredProject(path.join(directory, 'project.json'), {project, past: [], future: [], activity: [], updatedAt: new Date().toISOString()});
