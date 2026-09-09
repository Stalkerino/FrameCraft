import {hostname, networkInterfaces} from 'node:os';
import {isIP} from 'node:net';

/** Permit this machine's addresses when network listening is explicitly enabled. */
export function serverOrigins(host: string, port: number, addresses?: string[], name = hostname()) {
  const hosts = new Set(['127.0.0.1', 'localhost', host]);
  if(host === '0.0.0.0' || host === '::') {
    addresses ??= Object.values(networkInterfaces()).flatMap(entries => entries?.map(entry => entry.address) || []);
    hosts.add(name);
    for(const address of addresses) if(isIP(address) === 4 || (host === '::' && isIP(address) === 6 && !address.includes('%'))) hosts.add(address);
  }
  const origins = new Set([...hosts].map(value => `http://${isIP(value) === 6 ? `[${value}]` : value.toLowerCase()}:${port}`));
  origins.add('http://127.0.0.1:5173'); origins.add('http://localhost:5173');
  return origins;
}
