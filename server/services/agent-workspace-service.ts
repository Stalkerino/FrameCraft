import {agentWorkspacePath} from './agent-workspace-path';
import {createHash, randomUUID} from 'node:crypto';
import {readFile, writeFile, readdir, realpath, stat, mkdir, rename, link, rm} from 'node:fs/promises';
import path from 'node:path';
import {toJsonSchemaCompat} from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import type {Tool} from '@modelcontextprotocol/sdk/types.js';
import type {AgentProviderSettings} from '../../shared/agent';
import {workspaceToolSchemas, type WorkspaceToolName} from '../../shared/agent-workspace';
import {runWorkspaceCommand} from './workspace-command-service';

const descriptions: Record<WorkspaceToolName, string> = {
  list_workspace_files: 'List a workspace directory, paged by 100 entries. Returns workspace root, host platform and Node executable. Discover source files and generated assets here.',
  read_workspace_file: 'Read UTF-8 text in a workspace file, paged by character offset. Returns SHA-256 for conflict-safe writes. Maximum file size 2 MB.',
  write_workspace_file: 'Create or replace a UTF-8 workspace file, including scripts, SVG assets and code. Pass expectedSha256=null only for a new file; read existing files for their hash first. Creates parent folders. Import generated media through editor tools.',
  edit_workspace_file: 'Replace exactly one matching text passage in a workspace file. Read first for expectedSha256; fails on stale content or nonunique matches. Timeline edits must use editor tools, not project JSON.',
  run_workspace_command: 'Execute a finite command on the Framecraft host with an executable and literal argument array, not a shell string. Use node for portable scripts, FFmpeg to generate media, or git. Shell syntax needs an explicit shell executable; on Windows .cmd scripts need cmd.exe /d /s /c. Commands have the host user permissions, not a sandbox. No interactive input. Returns exit status and bounded output. Do not overwrite live project data, remove user media, launch background servers, or claim success on nonzero exit.',
};
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function inside(root: string, target: string) {const relative = path.relative(root, target); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));}

export class AgentWorkspaceService {
  constructor(private options: {root: string; data: string}, private settings: () => AgentProviderSettings) {}
  get tools(): Tool[] {
    const access = this.settings().workspaceAccess;
    if(!access || access === 'disabled') return [];
    return (Object.keys(workspaceToolSchemas) as WorkspaceToolName[]).filter(name => access === 'commands' || name !== 'run_workspace_command').map(name => ({name, description: descriptions[name], inputSchema: toJsonSchemaCompat(workspaceToolSchemas[name]) as Tool['inputSchema']}));
  }
  has(name: string) {return this.tools.some(tool => tool.name === name);}
  async root() {return realpath(path.resolve(agentWorkspacePath(this.options.root), this.settings().workspacePath || '.'));}
  async validate() {if(this.settings().workspaceAccess && this.settings().workspaceAccess !== 'disabled' && !(await stat(await this.root())).isDirectory()) throw new Error('Workspace path must be an existing directory on the Framecraft host.');}
  private async resolve(input: string, write = false) {
    const root = await this.root(); const target = path.resolve(root, input);
    if(!inside(root, target)) throw new Error('Path must stay inside the configured workspace.');
    // Check existing ancestors too, so missing files cannot escape through a directory symlink.
    let ancestor = target;
    while(true) {
      try {
        const canonical = await realpath(ancestor);
        if(!inside(root, canonical)) throw new Error('Symlink points outside the configured workspace.');
        if(write) {
          const data = await realpath(this.options.data).catch(() => path.resolve(this.options.data));
          const git = await realpath(path.join(this.options.root, '.git')).catch(() => path.resolve(this.options.root, '.git'));
          const destination = path.resolve(canonical, path.relative(ancestor, target));
          if(inside(data, destination) || inside(git, destination) || path.relative(root, destination).split(path.sep).some(part => part.toLowerCase() === '.git')) throw new Error('Use editor MCP tools for live project data and commands for Git operations. Direct writes here are disabled.');
        }
        break;
      } catch(error) {if((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; ancestor = path.dirname(ancestor);}
    }
    return target;
  }
  private async text(file: string) {
    const info = await stat(file);
    if(!info.isFile() || info.size > 2_000_000) throw new Error('Read a regular UTF-8 text file of at most 2 MB. Use commands for larger or binary files.');
    const content = await readFile(file, 'utf8');
    if(content.includes('\0')) throw new Error('This file is binary; use an editor media tool or a command.');
    return content;
  }
  private async save(input: string, content: string, expected: string | null, signal: AbortSignal) {
    if(Buffer.byteLength(content) > 2_000_000) throw new Error('Text file exceeds 2 MB.');
    const target = await this.resolve(input, true);
    let original: string | undefined;
    try {original = await this.text(target);} catch(error) {if((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;}
    if((original === undefined ? null : hash(original)) !== expected) throw new Error('File changed or already exists. Read it again before writing.');
    signal.throwIfAborted(); await mkdir(path.dirname(target), {recursive: true});
    const temporary = path.join(path.dirname(target), `.framecraft-${randomUUID()}.tmp`);
    try {
      const mode = original === undefined ? undefined : (await stat(target)).mode;
      await writeFile(temporary, content, {flag: 'wx', mode});
      await this.resolve(input, true); signal.throwIfAborted();
      if(expected === null) await link(temporary, target); // Exclusive creation, never silently overwrite.
      else {
        if(hash(await this.text(target)) !== expected) throw new Error('File changed while writing. Read it again.');
        await rename(temporary, target);
      }
    } finally {await rm(temporary, {force: true});}
    return {path: target, sha256: hash(content), bytes: Buffer.byteLength(content), saved: true};
  }
  async call(name: string, args: Record<string, unknown>, signal: AbortSignal) {
    if(!this.has(name)) throw new Error('Workspace tool is disabled. Ask the user to enable it in AI provider settings.');
    signal.throwIfAborted();
    let result: unknown; let isError = false;
    switch(name as WorkspaceToolName) {
      case 'list_workspace_files': {
        const input = workspaceToolSchemas.list_workspace_files.parse(args);
        const entries = (await readdir(await this.resolve(input.path), {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name));
        result = {root: await this.root(), platform: process.platform, nodeExecutable: process.execPath, entries: entries.slice(input.offset, input.offset + 100).map(entry => ({name: entry.name, type: entry.isSymbolicLink() ? 'symlink' : entry.isDirectory() ? 'directory' : 'file'})), nextOffset: input.offset + 100 < entries.length ? input.offset + 100 : null}; break;
      }
      case 'read_workspace_file': {
        const input = workspaceToolSchemas.read_workspace_file.parse(args); const content = await this.text(await this.resolve(input.path));
        result = {path: input.path, sha256: hash(content), totalCharacters: content.length, offset: input.offset, content: content.slice(input.offset, input.offset + input.limit), nextOffset: input.offset + input.limit < content.length ? input.offset + input.limit : null}; break;
      }
      case 'write_workspace_file': {
        const input = workspaceToolSchemas.write_workspace_file.parse(args); result = await this.save(input.path, input.content, input.expectedSha256, signal); break;
      }
      case 'edit_workspace_file': {
        const input = workspaceToolSchemas.edit_workspace_file.parse(args); const content = await this.text(await this.resolve(input.path, true));
        const index = content.indexOf(input.search);
        if(index < 0 || content.indexOf(input.search, index + 1) >= 0) throw new Error('Search must match exactly once. Read the file and choose a unique passage.');
        result = await this.save(input.path, content.slice(0, index) + input.replacement + content.slice(index + input.search.length), input.expectedSha256, signal); break;
      }
      case 'run_workspace_command': {
        const input = workspaceToolSchemas.run_workspace_command.parse(args);
        const output = await runWorkspaceCommand(input.executable, input.args, await this.resolve(input.cwd), input.timeoutMs, signal);
        result = output; isError = output.exitCode !== 0 || output.timedOut; break;
      }
    }
    return {isError, content: [{type: 'text' as const, text: JSON.stringify(result)}]};
  }
}
