import {readdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';

export interface InstallationPathsOptions {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  listDirectories?: (directory: string) => Promise<string[]>;
}

/** Desktop launchers often lack the PATH additions made by terminal profiles.
 * Inspect known installation roots only; never source a shell or scan the disk. */
export async function cliInstallationDirectories({platform, env, listDirectories = async directory => {
  try {return (await readdir(directory, {withFileTypes: true})).filter(entry => entry.isDirectory() || entry.isSymbolicLink()).map(entry => entry.name);}
  catch {return [];}
}}: InstallationPathsOptions): Promise<string[]> {
  const windows = platform === 'win32'; const paths = windows ? path.win32 : path.posix;
  const variable = (name: string) => windows ? Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] : env[name];
  const home = variable(windows ? 'USERPROFILE' : 'HOME') || (platform === process.platform ? homedir() : '');
  const atHome = (...parts: string[]) => home ? paths.join(home, ...parts) : undefined;
  const data = variable('XDG_DATA_HOME') || atHome('.local', 'share');
  const npmPrefix = variable('npm_config_prefix') || variable('NPM_CONFIG_PREFIX');
  const nvmRoots = windows
    ? [variable('NVM_HOME'), atHome('AppData', 'Roaming', 'nvm'), atHome('AppData', 'Local', 'nvm')]
    : [variable('NVM_DIR'), atHome('.nvm'), data ? paths.join(data, 'nvm') : undefined];
  const bins = [variable('NVM_BIN'), variable('NVM_SYMLINK'),
    ...(npmPrefix ? [windows ? npmPrefix : paths.join(npmPrefix, 'bin')] : []),
    ...(windows ? [paths.join(variable('APPDATA') || atHome('AppData', 'Roaming') || '', 'npm')]
      : [atHome('.local', 'bin'), atHome('.npm-global', 'bin'), '/usr/local/bin', '/usr/bin', '/opt/homebrew/bin']),
    atHome('.cargo', 'bin'), paths.join(variable('VOLTA_HOME') || atHome('.volta') || '', 'bin')];
  const versionRoots = [...new Set(nvmRoots.filter((root): root is string => !!root))]
    .flatMap(root => windows ? [root] : [paths.join(root, 'versions', 'node'), root]);
  const versions = await Promise.all(versionRoots.map(async root => (await listDirectories(root))
    .filter(name => /^v?\d+\.\d+\.\d+$/.test(name))
    .sort((a, b) => b.localeCompare(a, 'en', {numeric: true}))
    .map(name => windows ? paths.join(root, name) : paths.join(root, name, 'bin'))));
  return [...new Set([...bins, ...versions.flat()].filter((dir): dir is string => !!dir && paths.isAbsolute(dir)))];
}
