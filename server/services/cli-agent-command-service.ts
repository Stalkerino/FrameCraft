import {access, open, readFile, realpath, stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {cliAgentPresets, type CliAgentConfig, type CliAgentProvider} from '../../shared/agent-providers';
import {cliInstallationDirectories} from './cli-installation-paths';
import type {Executable} from './codex-command-service';

export async function resolveCliAgent(provider: CliAgentProvider, config: CliAgentConfig, options: {platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; node?: string; available?: (file: string) => Promise<boolean>; read?: (file: string) => Promise<string>} = {}): Promise<Executable> {
  const platform = options.platform ?? process.platform; const windows = platform === 'win32'; const paths = windows ? path.win32 : path.posix;
  const node = options.node ?? process.execPath; const env = options.env ?? process.env; const read = options.read ?? (file => readFile(file, 'utf8'));
  const exists = options.available ?? (async file => {try {await access(file, windows || /\.[cm]?js$/i.test(file) ? constants.R_OK : constants.X_OK); return (await stat(file)).isFile();} catch {return false;}});
  const preset = cliAgentPresets[provider]; const command = config.command.trim().replace(/^"|"$/g, '') || preset.command;
  if(!command) throw new Error('Choose an ACP executable in AI Settings.');
  const nodeScript = async (file: string) => {
    if(/\.[cm]?js$/i.test(file)) return true;
    // Some npm bins (notably OpenCode) are extensionless Node scripts.
    const handle = await open(file, 'r').catch(() => undefined); if(!handle) return false;
    try {const buffer = Buffer.alloc(128); const {bytesRead} = await handle.read(buffer, 0, buffer.length, 0); return /^#![^\r\n]*\bnode\b/.test(buffer.subarray(0, bytesRead).toString());}
    finally {await handle.close();}
  };
  const resolve = async (file: string): Promise<Executable | undefined> => {
    if(!await exists(file)) return;
    const target = await realpath(file).catch(() => file);
    if(await nodeScript(target)) return {command: node, args: [target, ...config.args]};
    if(windows && /\.(cmd|bat|ps1)$/i.test(file)) {
      // Read npm package metadata, never execute a .cmd wrapper through a shell.
      if(preset.npmPackage) {
        const root = paths.join(paths.dirname(file), 'node_modules', preset.npmPackage);
        try {
          const pkg = JSON.parse(await read(paths.join(root, 'package.json')));
          const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[paths.basename(file).replace(/\.(cmd|bat|ps1)$/i, '')];
          if(typeof bin === 'string') {
            const entry = paths.resolve(root, bin);
            if(await exists(entry)) return await nodeScript(entry) ? {command: node, args: [entry, ...config.args]} : {command: entry, args: config.args};
          }
        } catch {}
      }
      return;
    }
    return {command: target, args: config.args};
  };
  if(paths.isAbsolute(command) || /[\\/]/.test(command)) {
    const result = await resolve(paths.resolve(config.cwd, command)); if(result) return result;
  } else {
    const search = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
    const home = env[windows ? 'USERPROFILE' : 'HOME'] ?? (platform === process.platform ? homedir() : '');
    const directories = [...search.split(windows ? ';' : ':'), paths.dirname(node), ...await cliInstallationDirectories({platform, env}), ...(home ? [paths.join(home, '.opencode', 'bin'), paths.join(home, '.bun', 'bin')] : [])];
    for(const directory of new Set(directories.filter(Boolean))) for(const suffix of windows && !paths.extname(command) ? ['.exe', '.cmd', '.ps1', ''] : ['']) {
      const result = await resolve(paths.join(directory.replace(/^"|"$/g, ''), command + suffix)); if(result) return result;
    }
  }
  throw new Error(`Could not find ${command}. ${preset.setup} You can set its full executable or npm JavaScript entry path in AI Settings. Custom Windows .cmd/.ps1 wrappers require the underlying .exe or .js entry point.`);
}
