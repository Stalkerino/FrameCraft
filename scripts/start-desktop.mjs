import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {root, runtime, readConfig, run, mainModule} from './install/runtime.mjs';
import {desktopBuildEnvironment} from './build/desktop-environment.mjs';

export async function launchDesktop() {
  const build = await readFile(path.join(runtime, 'desktop-build.json'), 'utf8').then(JSON.parse).catch(() => null);
  if(!build || build.platform !== process.platform || build.arch !== process.arch) throw new Error('Build Framecraft on this computer first: npm run desktop:build');
  const executable = path.resolve(root, build.executable);
  if(!(await stat(executable).catch(() => null))?.isFile()) throw new Error('The recorded desktop executable is missing. Run npm run desktop:build again.');
  const env = desktopBuildEnvironment(await readConfig().catch(() => ({})));
  console.log(`Starting Framecraft desktop (${build.profile})…`);
  await run(executable, [], {env});
}
if(mainModule(import.meta.url)) launchDesktop().catch(error => {console.error(error.message); process.exitCode = 1;});
