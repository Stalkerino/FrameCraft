import {constants} from 'node:fs';
import {copyFile, mkdir, rename, unlink} from 'node:fs/promises';
import path from 'node:path';
import type {ExportSettings} from '../../../shared/media-settings';
import {ffprobePath, runProcess} from '../process-service';

/** Headers only; validation must not decode exported pixels on the CPU. */
export async function checkNativeVideoGeometry(file: string, settings: Pick<ExportSettings, 'width' | 'height'>) {
  const probe = JSON.parse(await runProcess(ffprobePath(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,sample_aspect_ratio', '-of', 'json', file], 15000));
  const stream = probe.streams?.[0];
  if(stream?.width !== settings.width || stream?.height !== settings.height || stream.sample_aspect_ratio !== '1:1') throw new Error('The GPU produced unexpected output geometry.');
}

export async function publishNativeExport(source: string, exports: string, filename: string) {
  await mkdir(exports, {recursive: true});
  const temporary = path.join(exports, `${filename}.partial`);
  let copied = false;
  try {
    await copyFile(source, temporary, constants.COPYFILE_EXCL); copied = true;
    await rename(temporary, path.join(exports, filename));
  } catch(error) {
    if(copied) await unlink(temporary).catch(() => {});
    throw error;
  }
}
