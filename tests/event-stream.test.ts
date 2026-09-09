import {EventEmitter} from 'node:events';
import type {Request, Response} from 'express';
import {afterEach, expect, it, vi} from 'vitest';
import {createEventStream} from '../server/http/event-stream';

afterEach(() => vi.useRealTimers());

function connection() {
  vi.useFakeTimers();
  const req = Object.assign(new EventEmitter(), {aborted: false});
  const res = Object.assign(new EventEmitter(), {
    destroyed: false, writableEnded: false,
    setHeader: vi.fn(), flushHeaders: vi.fn(), write: vi.fn((_message: string, _callback: (error?: Error) => void) => true),
    destroy: vi.fn(() => {res.destroyed = true; res.emit('close');}),
  });
  const next = vi.fn();
  const stream = createEventStream(req as Request, res as unknown as Response, next);
  const source = new EventEmitter();
  stream.subscribe(source, value => stream.send(value));
  return {req, res, next, stream, source};
}

it('handles an asynchronous broken pipe, releases subscriptions and stops subsequent writes', () => {
  const {req, res, next, stream, source} = connection();
  stream.send({revision: 1});
  const error = Object.assign(new Error('write EPIPE'), {code: 'EPIPE'});
  res.write.mock.calls[0][1](error);
  // Node may deliver both the write callback and a response error for the same failure.
  expect(() => res.emit('error', error)).not.toThrow();
  source.emit('change', {revision: 2}); stream.send({revision: 3});
  vi.advanceTimersByTime(60_000);
  expect(res.write).toHaveBeenCalledTimes(1);
  expect(source.listenerCount('change')).toBe(0);
  expect(req.listenerCount('aborted')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  expect(next).not.toHaveBeenCalled();
});

it('coalesces slow-client updates and resumes with the newest snapshot on drain', () => {
  const {res, stream} = connection();
  res.write.mockReturnValueOnce(false);
  stream.send(1); stream.send(2); stream.send(3); stream.send({status: 'ready'}, 'agent');
  expect(res.write).toHaveBeenCalledTimes(1);
  res.emit('drain');
  expect(res.write.mock.calls.map(call => call[0])).toEqual(['data: 1\n\n', 'data: 3\n\n', 'event: agent\ndata: {"status":"ready"}\n\n']);
  res.emit('close');
  expect(vi.getTimerCount()).toBe(0);
});

it('cleans up on request abort and forwards unexpected write failures', () => {
  const aborted = connection();
  aborted.req.aborted = true; aborted.req.emit('aborted');
  aborted.stream.send('ignored');
  expect(aborted.res.write).not.toHaveBeenCalled();
  expect(aborted.source.listenerCount('change')).toBe(0);
  const failed = connection();
  const error = new Error('unexpected failure');
  failed.res.emit('error', error);
  expect(failed.next).toHaveBeenCalledWith(error);
  expect(failed.source.listenerCount('change')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
