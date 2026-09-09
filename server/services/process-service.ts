import {spawn} from 'node:child_process';

export type ProcessFailureKind = 'exit' | 'signal' | 'spawn' | 'timeout' | 'abort';

const runningProcesses = new Set<{stop: (reason: Error) => void; closed: Promise<void>}>();
let shutdownReason: Error | undefined;

/** Worker shutdown: stop encoders before their parent exits or scratch files are removed. */
export async function stopRunningProcesses(reason = new Error('Render worker is stopping')): Promise<void> {
  shutdownReason ??= reason;
  await Promise.all([...runningProcesses].map(child => {
    child.stop(shutdownReason!);
    return child.closed;
  }));
}

export class ProcessError extends Error {
  readonly name = 'ProcessError';

  constructor(
    message: string,
    readonly binary: string,
    readonly kind: ProcessFailureKind,
    readonly exitCode: number | null,
    readonly signal: NodeJS.Signals | null,
    readonly stderr: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : {cause});
  }
}

/** No shell interpolation: paths and arguments work on Windows and Linux. */
export function runProcess(binary: string, args: string[], timeout = 600_000, options: {signal?: AbortSignal; onOutput?: (chunk: Buffer) => void} = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    if(shutdownReason || options.signal?.aborted) {
      reject(new ProcessError(`${binary} was cancelled`, binary, 'abort', null, null, '', shutdownReason ?? options.signal?.reason));
      return;
    }
    const child = spawn(binary, args, {shell: false, windowsHide: true});
    let stdout = ''; let stderr = ''; let settled = false;
    let termination: 'timeout' | 'abort' | Error | undefined;
    let cancellationReason: unknown;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if(settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', abort);
      if(error) reject(error); else resolve(stdout);
    };
    // Wait for close before rejecting so callers can safely remove temporary files.
    const terminate = (reason: 'timeout' | 'abort' | Error, cause?: unknown) => {
      if(settled || termination) return;
      termination = reason;
      cancellationReason = cause;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 1000);
      killTimer.unref();
    };
    const abort = () => terminate('abort', options.signal?.reason);
    let notifyClosed!: () => void;
    const tracked = {
      stop: (reason: Error) => terminate('abort', reason),
      closed: new Promise<void>(resolveClosed => {notifyClosed = resolveClosed;}),
    };
    runningProcesses.add(tracked);
    const timer = setTimeout(() => terminate('timeout'), timeout);
    options.signal?.addEventListener('abort', abort, {once: true});
    // Cover cancellation occurring between the initial check and listener setup.
    if(options.signal?.aborted) abort();
    child.stdout.on('data', chunk => {
      if(termination) return;
      try {
        if(options.onOutput) options.onOutput(chunk);
        else stdout = (stdout + chunk.toString()).slice(-4_000_000);
      } catch(error) {
        terminate(error instanceof Error ? error : new Error(String(error)));
      }
    });
    child.stderr.on('data', chunk => {stderr = (stderr + chunk.toString()).slice(-6000);});
    child.on('error', (error: NodeJS.ErrnoException) => {
      if(termination instanceof Error) {finish(termination); return;}
      if(termination) {
        const description = termination === 'timeout' ? `timed out after ${timeout} ms` : 'was cancelled';
        finish(new ProcessError(`${binary} ${description}; stopping the process failed: ${error.message}`, binary, termination, null, null, stderr, error));
        return;
      }
      const hint = error.code === 'ENOENT' && /(?:^|[\\/])(?:ffmpeg|ffprobe)(?:\.exe)?$/i.test(binary)
        ? ' Install FFmpeg (including ffprobe), or set FFMPEG_PATH and FFPROBE_PATH.' : '';
      finish(new ProcessError(`Cannot run ${binary}: ${error.message}.${hint}`, binary, 'spawn', null, null, stderr, error));
    });
    child.on('close', (code, signal) => {
      runningProcesses.delete(tracked);
      notifyClosed();
      if(termination instanceof Error) {finish(termination); return;}
      const details = stderr.trim() ? `\n${stderr.trim().slice(-1800)}` : ' No error output was produced.';
      if(termination) {
        const description = termination === 'timeout' ? `timed out after ${timeout} ms` : 'was cancelled';
        finish(new ProcessError(`${binary} ${description}.${details}`, binary, termination, code, signal, stderr, termination === 'abort' ? cancellationReason : undefined));
      } else if(signal) {
        const hint = signal === 'SIGKILL' ? ' The process was forcibly stopped; check available memory and system logs.' : '';
        finish(new ProcessError(`${binary} was terminated by ${signal}.${hint}${details}`, binary, 'signal', code, signal, stderr));
      } else if(code !== 0) {
        const description = code === null ? 'closed without an exit status' : `exited with code ${code}`;
        finish(new ProcessError(`${binary} ${description}.${details}`, binary, 'exit', code, null, stderr));
      } else finish();
    });
  });
}
export const ffmpegPath = () => process.env.FFMPEG_PATH || 'ffmpeg';
export const ffprobePath = () => process.env.FFPROBE_PATH || 'ffprobe';
