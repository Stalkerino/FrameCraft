import {expect, it} from 'vitest';
import {EncodingStalledError, runEncodingProcess, type EncodingProgress} from '../server/services/ffmpeg-progress-service';
import {ProcessError, stopRunningProcesses} from '../server/services/process-service';

it('parses split progress blocks and keeps encoding alive when output time advances without new frames', async () => {
  const updates: EncodingProgress[] = [];
  await runEncodingProcess(process.execPath, ['-e', String.raw`
    process.stdout.write('ignored=' + 'x'.repeat(100000));
    setTimeout(() => process.stdout.write('\nframe=7\nout_time_'), 10);
    setTimeout(() => process.stdout.write('us=1000\ntotal_size=44\nprogress=continue\n'), 20);
    setTimeout(() => process.stdout.write('frame=7\nout_time_ms=2000\ntotal_size=N/A\nprogress=continue\n'), 60);
    setTimeout(() => process.stdout.write('frame=7\nout_time_us=3000\ntotal_size=44\nprogress=continue\n'), 100);
    setTimeout(() => process.stdout.write('frame=7\nout_time_us=4000\ntotal_size=88\nprogress=end\n'), 140);
  `], {initialProgressTimeoutMs: 200, stalledProgressTimeoutMs: 80, onProgress: value => updates.push(value)});
  expect(updates).toEqual([
    {frame: 7, outTimeUs: 1000, totalSize: 44},
    {frame: 7, outTimeUs: 2000, totalSize: 44},
    {frame: 7, outTimeUs: 3000, totalSize: 44},
    {frame: 7, outTimeUs: 4000, totalSize: 88},
  ]);
});

it('repeated identical reports still stall and the process has closed before retry is allowed', async () => {
  const failure = await runEncodingProcess(process.execPath, ['-e', String.raw`
    process.stderr.write(String(process.pid));
    const progress = () => process.stdout.write('frame=3\nout_time_us=123\ntotal_size=44\nprogress=continue\n');
    progress(); setInterval(progress, 10);
  `], {initialProgressTimeoutMs: 200, stalledProgressTimeoutMs: 80}).catch(error => error);
  expect(failure).toBeInstanceOf(EncodingStalledError);
  expect(failure).toMatchObject({lastProgress: {frame: 3, outTimeUs: 123, totalSize: 44}, timeoutMs: 80});
  expect(failure.cause).toBeInstanceOf(ProcessError);
  expect(() => process.kill(Number(failure.cause.stderr), 0)).toThrow();
});

it('preserves worker shutdown cancellation instead of reporting an encoder stall', async () => {
  const reason = new Error('Editor disconnected');
  const failure = await runEncodingProcess(process.execPath, ['-e', String.raw`
    process.stdout.write('frame=1\nprogress=continue\n'); setInterval(() => {}, 1000);
  `], {initialProgressTimeoutMs: 200, stalledProgressTimeoutMs: 80, onProgress: () => {void stopRunningProcesses(reason);}}).catch(error => error);
  expect(failure).not.toBeInstanceOf(EncodingStalledError);
  expect(failure).toMatchObject({kind: 'abort', cause: reason});
});
