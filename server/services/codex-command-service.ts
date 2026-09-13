import {access, realpath, stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {cliInstallationDirectories, type InstallationPathsOptions} from './cli-installation-paths';

export interface Executable {command: string; args: string[]}
interface Options {platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; node?: string; available?: (file: string) => Promise<boolean>; listDirectories?: InstallationPathsOptions['listDirectories']}

/** Resolve npm's Windows shim to its JS entry point; never execute a shell command string. */
export async function resolveCodex({platform = process.platform, env = process.env, node = process.execPath, available, listDirectories}: Options = {}): Promise<Executable> {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const exists = available || (async (file: string) => {
    try {await access(file, platform === 'win32' || /\.(?:c?js|mjs)$/i.test(file) ? constants.R_OK : constants.X_OK); return (await stat(file)).isFile();} catch {return false;}
  });
  const searchPath = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] || '';
  const directories = [...searchPath.split(platform === 'win32' ? ';' : ':'), paths.dirname(node)].filter(Boolean).map(dir => dir.replace(/^"|"$/g, ''));
  const resolve = async (candidate: string): Promise<Executable | undefined> => {
    if(!await exists(candidate)) return;
    // POSIX npm installs expose a symlink with an `env node` shebang. Use the
    // already-running Node executable, even if Node is absent from desktop PATH.
    const target = await realpath(candidate).catch(() => candidate);
    if(/\.(?:c?js|mjs)$/i.test(target)) return {command: node, args: [target]};
    if(platform === 'win32' && /\.(?:cmd|bat|ps1)$/i.test(candidate)) {
      const script = paths.join(paths.dirname(candidate), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
      if(await exists(script)) return {command: node, args: [script]};
      return;
    }
    return {command: candidate, args: []};
  };
  const override = env.FRAMECRAFT_CODEX_PATH?.trim().replace(/^"|"$/g, '');
  if(override) {
    const result = await resolve(override); if(result) return result;
    throw new Error(`FRAMECRAFT_CODEX_PATH could not be opened: ${override}. Correct it or remove it to use automatic Codex discovery.`);
  }
  const search = async (bins: string[]) => {
    for(const dir of new Set(bins)) {
      const names = platform === 'win32' ? ['codex.exe', 'codex.cmd', 'codex.ps1', 'codex'] : ['codex'];
      for(const name of names) {const result = await resolve(paths.join(dir, name)); if(result) return result;}
    }
  };
  const onPath = await search(directories); if(onPath) return onPath;
  const installed = await search(await cliInstallationDirectories({platform, env, listDirectories}));
  if(installed) return installed;
  throw new Error('Codex CLI was not found in PATH or common user installation folders. If it is installed in a custom location, set FRAMECRAFT_CODEX_PATH to its executable or npm codex.js entry point and restart Framecraft. Otherwise install Codex CLI and run codex login.');
}

export function codexMcpArguments(root: string, url: string, node = process.execPath, platform: NodeJS.Platform = process.platform): string[] {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  // JSON basic strings are also TOML basic strings, including escaped Windows separators.
  const quote = JSON.stringify;
  const bridge = `{command = ${quote(node)}, args = [${quote(paths.join(root, 'scripts', 'mcp.mjs'))}], cwd = ${quote(root)}, env = {FRAMECRAFT_URL = ${quote(url)}}, enabled = true}`;
  return ['-c', `mcp_servers.framecraft=${bridge}`];
}
