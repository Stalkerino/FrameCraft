import {cp, mkdir, readFile, readdir, rm, writeFile, chmod, access} from 'node:fs/promises';
import path from 'node:path';
import {root, runtime, run, npmCli} from '../install/runtime.mjs';

export const releaseDirectory = path.join(runtime, 'release');
export function releaseVersion(value) {
  const version = value.replace(/^v/, '');
  if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) throw new Error('Release version must be semver, for example v0.1.0 or v0.2.0-beta.1.');
  return version;
}

export async function stageRelease(version, env) {
  // This directory contains generated packaging output only. Never copy a checkout
  // wholesale: that would distribute user projects, credentials and build caches.
  await rm(releaseDirectory, {recursive: true, force: true});
  const app = path.join(releaseDirectory, 'app'); await mkdir(app, {recursive: true});
  for(const name of ['dist', 'server', 'shared', 'src', 'public', 'package.json', 'package-lock.json', 'tsconfig.json']) {
    await cp(path.join(root, name), path.join(app, name), {recursive: true});
  }
  for(const name of ['mcp.mjs', 'analysis-worker.mjs', 'desktop-backend.mjs', 'release/runtime.mjs', 'install/runtime.mjs', 'install/browser.mjs', 'install/browser-path.mjs']) {
    await mkdir(path.dirname(path.join(app, 'scripts', name)), {recursive: true});
    await cp(path.join(root, 'scripts', name), path.join(app, 'scripts', name));
  }
  console.log('Installing production dependencies in isolated release staging…');
  await run(process.execPath, [await npmCli(), 'ci', '--omit=dev', '--no-audit', '--no-fund'], {cwd: app, env});
  // npm's executable shortcuts are not used by the backend; omit absolute links.
  await rm(path.join(app, 'node_modules/.bin'), {recursive: true, force: true});
  await mkdir(path.join(app, 'runtime'));
  const node = path.join(app, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
  await cp(process.execPath, node); await chmod(node, 0o755);
  const manifest = JSON.parse(await readFile(path.join(root, 'shared/vulkan-runtime.json'), 'utf8'));
  const media = path.join(runtime, 'vulkan', manifest.release);
  const destination = path.join(app, '.runtime/vulkan', manifest.release);
  await mkdir(destination, {recursive: true});
  await cp(path.join(media, 'bin'), path.join(destination, 'bin'), {recursive: true});
  await cp(path.join(media, 'LICENSE.txt'), path.join(destination, 'LICENSE.txt'));
  const libraries = path.join(releaseDirectory, 'libraries'); await mkdir(libraries);
  const sdk = path.join(runtime, 'vulkan-shared', manifest.release);
  const source = path.join(sdk, process.platform === 'win32' ? 'bin' : 'lib');
  const names = (await readdir(source)).filter(name => process.platform === 'win32' ? /\.dll$/i.test(name) : /\.so\.\d+$/.test(name));
  if(names.length < 4) throw new Error('The native preview runtime is incomplete.');
  for(const name of names) await cp(path.join(source, name), path.join(libraries, name), {dereference: true});
  const notices = path.join(app, 'notices'); await mkdir(notices);
  await cp(path.join(sdk, 'LICENSE.txt'), path.join(notices, 'FFmpeg-GPL-3.txt'));
  if(process.platform === 'linux') {
    let fonts;
    for(const candidate of ['/usr/share/fonts/truetype/liberation', '/usr/share/fonts/truetype/liberation2', '/usr/share/fonts/liberation']) {
      if(await access(path.join(candidate, 'LiberationSans-Regular.ttf')).then(() => true, () => false)) {fonts = candidate; break;}
    }
    if(!fonts) throw new Error('Install fonts-liberation before packaging native title support.');
    await mkdir(path.join(app, 'runtime/fonts'));
    for(const name of ['LiberationSans-Regular.ttf', 'LiberationSans-Bold.ttf']) await cp(path.join(fonts, name), path.join(app, 'runtime/fonts', name));
    let license;
    for(const file of ['/usr/share/doc/fonts-liberation/copyright', '/usr/share/doc/fonts-liberation2/copyright', '/usr/share/licenses/ttf-liberation/LICENSE']) {
      if(await access(file).then(() => true, () => false)) {license = file; break;}
    }
    if(!license) throw new Error('Liberation font redistribution license was not found.');
    await cp(license, path.join(notices, 'Liberation-LICENSE.txt'));
  }
  // Official Node distributions include Node and embedded dependency licenses.
  const response = await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`, {signal: AbortSignal.timeout(60000)});
  if(!response.ok) throw new Error('Could not include the bundled Node license.');
  await writeFile(path.join(notices, 'Node-LICENSE.txt'), await response.text());
  const metadata = {version, platform: process.platform, arch: process.arch, node: process.version, mediaRelease: manifest.release,
    source: `https://github.com/Stalkerino/FrameCraft/tree/${process.env.GITHUB_SHA || `v${version}`}`, commit: process.env.GITHUB_SHA || null,
    media: [manifest.platforms[`${process.platform}-${process.arch}`], manifest.sharedPlatforms[`${process.platform}-${process.arch}`]]};
  await writeFile(path.join(app, 'release.json'), JSON.stringify(metadata, null, 2) + '\n');
  await writeFile(path.join(notices, 'THIRD-PARTY.txt'), `Node licenses: Node-LICENSE.txt. JavaScript dependency licenses are retained in app/node_modules.\nFFmpeg and its bundled libraries: FFmpeg-GPL-3.txt; upstream build recipes and source references: https://github.com/BtbN/FFmpeg-Builds/releases/tag/${manifest.release}\nExact binary archive names and SHA-256 hashes: ../release.json and ../shared/vulkan-runtime.json.\nThe compatibility renderer is Remotion; its license is included in node_modules/remotion/LICENSE.md.\n`);
  return {app, libraries, names};
}
