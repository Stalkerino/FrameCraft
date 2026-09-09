import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {expect, it} from 'vitest';
import {ProcessError, runProcess} from '../server/services/process-service';

it('returns stdout and preserves a numeric exit code with stderr', async () => {
  expect(await runProcess(process.execPath, ['-e', 'process.stdout.write("ready")'])).toBe('ready');
  await expect(runProcess(process.execPath, ['-e', 'process.stderr.write("encoder failed", () => process.exit(8))'])).rejects.toMatchObject({
    name: 'ProcessError', kind: 'exit', exitCode: 8, signal: null, stderr: 'encoder failed',
    message: expect.stringContaining('exited with code 8'),
  });
});

it.skipIf(process.platform === 'win32')('reports the termination signal when no exit code or stderr exists', async () => {
  await expect(runProcess(process.execPath, ['-e', 'process.kill(process.pid, "SIGKILL")'])).rejects.toMatchObject({
    name: 'ProcessError', kind: 'signal', exitCode: null, signal: 'SIGKILL', stderr: '',
    message: expect.stringContaining('was terminated by SIGKILL'),
  });
});

it('distinguishes a timeout from an external process termination', async () => {
  await expect(runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], 100)).rejects.toMatchObject({
    name: 'ProcessError', kind: 'timeout', message: expect.stringContaining('timed out after 100 ms'),
  });
});

it('preserves cancellation and stderr while waiting for the child to close', async () => {
  const controller = new AbortController();
  const reason = new Error('User cancelled export');
  await expect(runProcess(process.execPath, ['-e', 'process.stderr.write("encoding started", () => process.stdout.write("ready")); setInterval(() => {}, 1000)'], 2000, {
    signal: controller.signal,
    onOutput: () => controller.abort(reason),
  })).rejects.toMatchObject({
    name: 'ProcessError', kind: 'abort', cause: reason, stderr: 'encoding started',
    message: expect.stringContaining('was cancelled'),
  });
  await expect(runProcess('must-not-spawn', [], 100, {signal: controller.signal})).rejects.toMatchObject({kind: 'abort', cause: reason});
});

it('reports a missing executable without suggesting FFmpeg for unrelated tools', async () => {
  const missing = join(tmpdir(), 'framecraft-missing-process', 'node');
  const failure = await runProcess(missing, []).catch(error => error as ProcessError);
  expect(failure).toBeInstanceOf(ProcessError);
  expect(failure).toMatchObject({binary: missing, kind: 'spawn', exitCode: null, signal: null});
  expect((failure as ProcessError).message).not.toContain('Install FFmpeg');
});
