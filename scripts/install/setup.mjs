import {createWriteStream, existsSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import path from 'node:path';
import {root, runtime, environment, readConfig, run, npmCli, findExecutable, fingerprint, desktopQuote, mainModule} from './runtime.mjs';
const storedPath = file => {const relative = path.relative(root, file); return relative.startsWith('..' + path.sep) || path.isAbsolute(relative) ? file : relative;};

export async function setup({start = true} = {}) {
  if(Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required. Run the platform installer.');
  const {framecraftAt} = await import('./launch.mjs');
  if(await framecraftAt(`http://127.0.0.1:${process.env.PORT || 4318}`)) throw new Error('Stop the running Framecraft server before installing or updating dependencies. Use Start instead to open the existing editor.');
  await mkdir(runtime, {recursive: true});
  const log = createWriteStream(path.join(runtime, 'install.log'), {flags: 'a'});
  log.write(`\nFramecraft setup ${new Date().toISOString()} ${process.platform} ${process.arch} Node ${process.version}\n`);
  console.log(`Framecraft setup · ${root}\nLog: ${path.join(runtime, 'install.log')}`);
  try {
    const config = await readConfig().catch(() => ({}));
    const env = environment(config);
    for(const [name, key] of [['ffmpeg', 'FFMPEG_PATH'], ['ffprobe', 'FFPROBE_PATH']]) {
      const binary = env[key] || findExecutable(name, env);
      if(!binary) throw new Error(`${name} is missing. Run ${process.platform === 'win32' ? 'Install-Windows.cmd' : 'sh Install-Linux.sh'} to prepare system dependencies.`);
      console.log((await run(binary, ['-version'], {env, capture: true, log})).split('\n')[0]);
      config[key] = storedPath(binary); env[key] = binary;
    }
    const codecs = await run(env.FFMPEG_PATH, ['-hide_banner', '-encoders'], {env, capture: true, log});
    if(!/\blibx264\b/.test(codecs) || !/\baac\b/.test(codecs)) throw new Error('FFmpeg needs libx264 and AAC support. On Fedora/openSUSE enable the distribution\'s multimedia repository and install its complete FFmpeg package, then rerun setup.');
    console.log('Installing the locked application dependencies...');
    await run(process.execPath, [await npmCli(), 'ci', '--include=dev', '--no-fund', '--no-audit'], {env, log});
    console.log('Preparing the rendering browser (download only; no GPU test)...');
    const {ensureBrowser} = await import('@remotion/renderer');
    const systemBrowser = env.CHROME_PATH || (process.platform === 'linux' ? findExecutable('chromium', env) || findExecutable('chromium-browser', env) : undefined);
    const browser = await ensureBrowser({...(systemBrowser ? {browserExecutable: systemBrowser} : {}), logLevel: 'info'});
    if(!('path' in browser)) throw new Error('The rendering browser could not be prepared. Check the download connection and rerun setup.');
    if(!existsSync(browser.path)) throw new Error(`Rendering browser missing: ${browser.path}`);
    config.CHROME_PATH = storedPath(browser.path); env.CHROME_PATH = browser.path;
    await run(browser.path, ['--version'], {env, capture: true, log});
    console.log('Building Framecraft...');
    await run(process.execPath, [await npmCli(), 'run', 'build'], {env, log});
    await writeFile(path.join(runtime, 'config.json'), JSON.stringify(config, null, 2) + '\n');
    await writeFile(path.join(runtime, 'installed.json'), JSON.stringify({fingerprint: await fingerprint(), installedAt: new Date().toISOString()}, null, 2) + '\n');
    if(process.platform === 'linux') {
      await writeFile(path.join(root, 'Framecraft.desktop'), ['[Desktop Entry]', 'Type=Application', 'Name=Framecraft', 'Comment=Local video editor',
        `Exec=${desktopQuote(process.execPath)} ${desktopQuote(path.join(root, 'scripts/install/launch.mjs'))}`, 'Terminal=true', 'Categories=AudioVideo;Video;', ''].join('\n'), {mode: 0o755});
    }
    console.log('\nSetup complete. Next time use Start-Windows.cmd or Start-Linux.sh.');
    console.log('AI is optional: choose your network Ollama URL in the editor, or install/sign in to Codex CLI separately.');
  } catch(error) {log.write(`\nERROR: ${error.stack ?? error}\n`); throw error;}
  finally {log.end(); await once(log, 'finish');}
  if(start) {const {launch} = await import('./launch.mjs'); await launch();}
}
if(mainModule(import.meta.url)) setup({start: !process.argv.includes('--no-launch')}).catch(error => {console.error(`\nSetup failed: ${error.message}\nLog: ${path.join(runtime, 'install.log')}`); process.exitCode = 1;});
