import {spawn} from 'node:child_process';

/** Finite, noninteractive commands on the editor host. This is not an OS sandbox. */
export function runWorkspaceCommand(executable: string, args: string[], cwd: string, timeoutMs: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<{exitCode: number | null; signal: string | null; stdout: string; stderr: string; truncated: boolean; timedOut: boolean}>((resolve, reject) => {
    const child = spawn(executable === 'node' ? process.execPath : executable, args, {cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = ''; let stderr = ''; let truncated = false; let timedOut = false; let stopping = false;
    const stop = () => {
      if(stopping || !child.pid) return; stopping = true;
      if(process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {shell: false, windowsHide: true, stdio: 'ignore'});
        killer.on('error', () => child.kill('SIGKILL'));
        killer.on('exit', code => {if(code !== 0) child.kill('SIGKILL');});
      } else {
        try {process.kill(-child.pid, 'SIGKILL');} catch {child.kill('SIGKILL');}
      }
    };
    const timer = setTimeout(() => {timedOut = true; stop();}, timeoutMs);
    signal.addEventListener('abort', stop, {once: true}); if(signal.aborted) stop();
    const clean = () => {clearTimeout(timer); signal.removeEventListener('abort', stop);};
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {stdout += chunk; if(stdout.length > 32000) {stdout = stdout.slice(-32000); truncated = true;}});
    child.stderr.on('data', (chunk: string) => {stderr += chunk; if(stderr.length > 32000) {stderr = stderr.slice(-32000); truncated = true;}});
    child.once('error', error => {clean(); reject(error);});
    child.once('close', (exitCode, exitSignal) => {
      clean();
      if(signal.aborted) {reject(signal.reason ?? new Error('Command stopped')); return;}
      resolve({exitCode, signal: exitSignal, stdout, stderr, truncated, timedOut});
    });
  });
}
