import {constants} from 'node:fs';
import {access, copyFile, link, unlink} from 'node:fs/promises';
import path from 'node:path';
import type {Project} from '../../shared/project';
import {projectStorageKey} from '../repositories/project-storage';

export function defaultExportPath(directory: string, project: Pick<Project, 'id' | 'name' | 'sequenceName'>, extension: string) {
  const title = project.sequenceName ? `${project.name} - ${project.sequenceName}` : project.name;
  const name = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/g, '').slice(0, 100) || 'Framecraft';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(directory, 'projects', projectStorageKey(project.id), 'exported', `${name}-${timestamp}.${extension}`);
}

export function validateExportPath(file: string, extension: string) {
  if(!path.isAbsolute(file) || file.includes('\0') || file !== file.trim()) throw new Error('Choose an absolute export file path on this machine.');
  const name = path.basename(file);
  if(/[<>:"|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) throw new Error('Choose a valid export filename.');
  if(path.extname(file).toLowerCase() !== `.${extension}`) throw new Error(`The selected video format requires a .${extension} filename.`);
  return path.resolve(file);
}

export async function requireUnusedExport(file: string) {
  try {await access(file);} catch(error) {if((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error;}
  throw new Error('An export already exists at this path. Choose another filename to preserve it.');
}

/** No-overwrite publication. Both paths are in the destination directory; a
 * hard link avoids copying large videos. Filesystems without links use EXCL. */
export async function publishExport(source: string, destination: string) {
  try {await link(source, destination);}
  catch(error) {
    const code = (error as NodeJS.ErrnoException).code;
    if(!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS'].includes(code ?? '')) throw error;
    await copyFile(source, destination, constants.COPYFILE_EXCL);
  }
  await unlink(source).catch(() => undefined);
}
