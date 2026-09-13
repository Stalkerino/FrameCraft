import {statSync} from 'node:fs';
import path from 'node:path';

/** A missing/stale executable is null, never an explicit Remotion override. */
export function resolveBrowserPath({root, env = process.env, configured, cached, platform = process.platform, isFile = file => {try {return statSync(file).isFile();} catch {return false;}}}) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const variable = name => Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  const candidates = [variable('CHROME_PATH'), configured, cached];
  if(platform === 'win32') {
    for(const directory of [variable('PROGRAMFILES'), variable('PROGRAMFILES(X86)'), variable('LOCALAPPDATA')].filter(Boolean)) {
      candidates.push(paths.join(directory, 'Google/Chrome/Application/chrome.exe'), paths.join(directory, 'Microsoft/Edge/Application/msedge.exe'));
    }
  } else if(platform === 'linux') {
    for(const directory of (variable('PATH') || '/usr/bin:/usr/local/bin').split(':').filter(Boolean)) for(const name of ['chromium', 'chromium-browser', 'google-chrome']) candidates.push(paths.join(directory, name));
  }
  for(const candidate of candidates) {
    if(typeof candidate !== 'string' || !candidate.trim()) continue;
    const file = paths.resolve(root, candidate.trim().replace(/^"|"$/g, ''));
    if(isFile(file)) return file;
  }
  return null;
}
