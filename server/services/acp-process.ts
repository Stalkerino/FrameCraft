import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {Readable, Writable} from 'node:stream';
import path from 'node:path';
import {ClientSideConnection, ndJsonStream, type Client} from '@agentclientprotocol/sdk';
import type {Executable} from './codex-command-service';

/** ACP is isolated from Codex's app-server protocol. The child owns native tools. */
export class AcpProcess {
  readonly connection: ClientSideConnection;
  private child: ChildProcessWithoutNullStreams;
  private stopped = false;
  private stderr = '';
  constructor(executable: Executable, cwd: string, client: Client, onClose: (error: Error) => void) {
    const env = {...process.env}; const key = Object.keys(env).find(k => k.toLowerCase() === 'path') ?? 'PATH';
    env[key] = [path.dirname(process.execPath), env[key]].filter(Boolean).join(path.delimiter);
    this.child = spawn(executable.command, executable.args, {cwd, env, shell: false, windowsHide: true, stdio: 'pipe'});
    this.child.stderr.on('data', chunk => {this.stderr = (this.stderr + chunk.toString()).slice(-4000);});
    const failed = (error: Error) => {if(this.stopped) return; this.close(); onClose(error);};
    this.child.on('error', error => failed(new Error(`Could not start CLI agent: ${error.message}`)));
    this.child.stdin.on('error', failed);
    this.child.stdout.on('error', failed);
    this.child.on('close', code => failed(new Error(`CLI agent stopped (${code ?? 'signal'}). ${this.stderr.trim()}`)));
    this.connection = new ClientSideConnection(() => client, ndJsonStream(Writable.toWeb(this.child.stdin), Readable.toWeb(this.child.stdout) as ReadableStream<Uint8Array>));
    void this.connection.closed.then(() => failed(new Error(`CLI agent connection closed. ${this.stderr.trim()}`))).catch(failed);
  }
  async timed<T>(operation: Promise<T>, label: string, milliseconds = 60_000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {return await Promise.race([operation, new Promise<never>((_, reject) => {timer = setTimeout(() => reject(new Error(`CLI agent did not finish ${label}. Check its ACP arguments and terminal sign-in. ${this.stderr.trim()}`)), milliseconds);})]);}
    finally {clearTimeout(timer);}
  }
  close() {if(this.stopped) return; this.stopped = true; this.child.stdin.destroy(); this.child.stdout.destroy(); this.child.kill();}
}
