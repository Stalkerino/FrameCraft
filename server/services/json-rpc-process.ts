import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createInterface} from 'node:readline';
import {EventEmitter} from 'node:events';
import type {Executable} from './codex-command-service';

export interface RpcMessage {id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: {message: string; code?: number}}
export class JsonRpcProcess extends EventEmitter {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 0;
  private closed = false;
  private stderr = '';
  private pending = new Map<number, {resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>}>();
  constructor(executable: Executable, cwd: string) {
    super();
    this.child = spawn(executable.command, executable.args, {cwd, shell: false, windowsHide: true, stdio: 'pipe'});
    const lines = createInterface({input: this.child.stdout});
    lines.on('line', line => {
      let message: RpcMessage; try {message = JSON.parse(line);} catch {return;}
      if(message.method) {this.emit('message', message); return;}
      const pending = typeof message.id === 'number' ? this.pending.get(message.id) : undefined;
      if(!pending) return;
      clearTimeout(pending.timer); this.pending.delete(message.id as number);
      if(message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
    });
    this.child.stderr.on('data', chunk => {this.stderr = (this.stderr + chunk.toString()).slice(-2000);});
    this.child.stdin.on('error', error => this.fail(error));
    this.child.on('error', error => this.fail(new Error(`Could not start Codex: ${error.message}`)));
    this.child.on('close', code => {lines.close(); this.fail(new Error(`Codex stopped (${code ?? 'signal'}). ${this.stderr.trim()}`));});
  }
  private fail(error: Error) {
    if(this.closed) return; this.closed = true;
    for(const pending of this.pending.values()) {clearTimeout(pending.timer); pending.reject(error);}
    this.pending.clear(); this.emit('closed', error);
  }
  send(message: RpcMessage) {
    if(this.closed) throw new Error('Codex is not running. Start the session again.');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  request<T>(method: string, params: Record<string, unknown> = {}, timeout = 45_000): Promise<T> {
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {this.pending.delete(id); reject(new Error(`Codex did not answer ${method}. Retry the connection.`));}, timeout);
      this.pending.set(id, {resolve: value => resolve(value as T), reject, timer});
      try {this.send({id, method, params});} catch(error) {clearTimeout(timer); this.pending.delete(id); reject(error);}
    });
  }
  close() {this.fail(new Error('Codex session closed.')); this.child.kill();}
}
