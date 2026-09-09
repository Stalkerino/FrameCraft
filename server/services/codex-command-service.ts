import {access, stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';

export interface Executable {command: string; args: string[]}
interface Options {platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; node?: string; available?: (file: string) => Promise<boolean>}

/** Resolve npm's Windows shim to its JS entry point; never execute a shell command string. */
export async function resolveCodex({platform = process.platform, env = process.env, node = process.execPath, available}: Options = {}): Promise<Executable> {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const exists = available || (async (file: string) => {
    try {await access(file, platform === 'win32' || /\.(?:c?js|mjs)$/i.test(file) ? constants.R_OK : constants.X_OK); return (await stat(file)).isFile();} catch {return false;}
  });
  const searchPath = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] || '';
  const directories = [paths.dirname(node), ...searchPath.split(platform === 'win32' ? ';' : ':')].filter(Boolean).map(dir => dir.replace(/^"|"$/g, ''));
  const candidates = env.FRAMECRAFT_CODEX_PATH ? [env.FRAMECRAFT_CODEX_PATH] : directories.flatMap(dir => (platform === 'win32' ? ['codex.exe', 'codex.cmd', 'codex'] : ['codex']).map(name => paths.join(dir, name)));
  for(const candidate of candidates) {
    if(!await exists(candidate)) continue;
    if(/\.(?:c?js|mjs)$/i.test(candidate)) return {command: node, args: [candidate]};
    if(platform === 'win32' && /\.(?:cmd|bat)$/i.test(candidate)) {
      const script = paths.join(paths.dirname(candidate), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
      if(await exists(script)) return {command: node, args: [script]};
      continue;
    }
    return {command: candidate, args: []};
  }
  throw new Error('Codex CLI was not found. Install it and run codex login, then restart Framecraft. You can also set FRAMECRAFT_CODEX_PATH to the Codex executable or npm codex.js entry point.');
}

export function codexMcpArguments(root: string, url: string, node = process.execPath, platform: NodeJS.Platform = process.platform): string[] {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  // JSON basic strings are also TOML basic strings, including escaped Windows separators.
  const quote = JSON.stringify;
  const bridge = `{command = ${quote(node)}, args = [${quote(paths.join(root, 'scripts', 'mcp.mjs'))}], cwd = ${quote(root)}, env = {FRAMECRAFT_URL = ${quote(url)}}, enabled = true}`;
  return ['-c', `mcp_servers.framecraft=${bridge}`];
}
