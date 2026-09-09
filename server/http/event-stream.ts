import type {Request, Response, NextFunction} from 'express';
import type {EventEmitter} from 'node:events';
import {isConnectionError} from './connection-errors';

/** Snapshot streams retain only the latest state per event while a client is slow. */
export function createEventStream(req: Request, res: Response, next: NextFunction) {
  let closed = false;
  let blocked = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const subscriptions: (() => void)[] = [];
  const pending = new Map<string, string>();
  const close = () => {
    if(closed) return;
    closed = true;
    clearInterval(timer);
    pending.clear();
    for(const unsubscribe of subscriptions) unsubscribe();
    subscriptions.length = 0;
    req.off('aborted', disconnect);
    res.off('drain', drain);
  };
  const disconnect = () => {close(); if(!res.destroyed) res.destroy();};
  const fail = (error: Error) => {
    const alreadyClosed = closed;
    close();
    if(!alreadyClosed && !isConnectionError(error)) next(error);
    if(!res.destroyed) res.destroy();
  };
  const writable = () => {
    if(closed || req.aborted || res.destroyed || res.writableEnded || res.socket?.destroyed) {
      disconnect(); return false;
    }
    return true;
  };
  const write = (message: string) => {
    if(!writable()) return;
    try {blocked = !res.write(message, error => {if(error) fail(error);});}
    catch(error) {fail(error as Error);}
  };
  const drain = () => {
    blocked = false;
    for(const [event, message] of pending) {
      pending.delete(event);
      write(message);
      if(blocked || closed) break;
    }
  };
  // Install before flushing: socket failures can arrive asynchronously after write().
  res.on('error', fail);
  res.once('close', close);
  res.once('finish', close);
  res.on('drain', drain);
  req.once('aborted', disconnect);
  if(writable()) {
    try {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
    } catch(error) {fail(error as Error);}
  }
  if(!closed) timer = setInterval(() => {if(!blocked) write(': heartbeat\n\n');}, 20_000);
  return {
    send(value: unknown, event = '') {
      if(!writable()) return;
      const message = `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(value)}\n\n`;
      if(!blocked) {write(message); return;}
      pending.set(event, message);
      // A stalled browser reconnects and receives fresh snapshots instead of accumulating RAM.
      if([...pending.values()].reduce((bytes, item) => bytes + Buffer.byteLength(item), 0) > 8 * 1024 * 1024) disconnect();
    },
    subscribe<T>(source: EventEmitter, listener: (value: T) => void) {
      if(closed) return;
      source.on('change', listener);
      subscriptions.push(() => {source.off('change', listener);});
    },
  };
}
