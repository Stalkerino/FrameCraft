import {expect, it} from 'vitest';
import {ProcessError, runProcess, stopRunningProcesses} from '../server/services/process-service';

it('waits for every encoder to close, force-stops an unresponsive child, and blocks new spawns', async () => {
  const processes: Promise<unknown>[] = [];
  const pids: number[] = [];
  const ready = [false, true].map(ignoreSignal => new Promise<void>(resolve => {
    processes.push(runProcess(process.execPath, ['-e', `
      process.on('SIGTERM', () => {${ignoreSignal ? '' : 'setTimeout(() => process.exit(0), 50);'}});
      setInterval(() => {}, 1000);
      process.stdout.write(String(process.pid));
    `], 5000, {onOutput: chunk => {pids.push(Number(chunk.toString())); resolve();}}).catch(error => error));
  }));
  await Promise.all(ready);
  const reason = new Error('Export watchdog stopped the worker');
  await stopRunningProcesses(reason);
  for(const result of await Promise.all(processes)) {
    expect(result).toBeInstanceOf(ProcessError);
    expect(result).toMatchObject({kind: 'abort', cause: reason});
  }
  for(const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
  await expect(runProcess('must-not-spawn-after-shutdown', [])).rejects.toMatchObject({kind: 'abort', cause: reason});
});
