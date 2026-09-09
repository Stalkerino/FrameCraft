import {describe, expect, it} from 'vitest';
import {serverOrigins} from '../server/services/network-service';

describe('server network origins', () => {
  it('allows local network addresses only when explicitly listening on all interfaces', () => {
    const local = serverOrigins('127.0.0.1', 4318, ['192.168.8.189'], 'StalkyPC');
    expect(local.has('http://192.168.8.189:4318')).toBe(false);
    const network = serverOrigins('0.0.0.0', 4318, ['192.168.8.189'], 'StalkyPC');
    expect(network.has('http://192.168.8.189:4318')).toBe(true);
    expect(network.has('http://0.0.0.0:4318')).toBe(true);
    expect(network.has('http://stalkypc:4318')).toBe(true);
    expect(network.has('http://unrelated.example:4318')).toBe(false);
    expect(network.has('http://192.168.8.189:5000')).toBe(false);
  });
  it('preserves loopback clients and formats IPv6 origins on a custom port', () => {
    const origins = serverOrigins('::', 4319, ['192.168.8.189', '::1'], 'workstation');
    expect(origins.has('http://127.0.0.1:4319')).toBe(true);
    expect(origins.has('http://localhost:4319')).toBe(true);
    expect(origins.has('http://[::1]:4319')).toBe(true);
    expect(origins.has('http://127.0.0.1:5173')).toBe(true);
  });
});
