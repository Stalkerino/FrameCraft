import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import type {Tool} from '@modelcontextprotocol/sdk/types.js';
import path from 'node:path';

export class AgentMcpClient {
  private client = new Client({name: 'Framecraft Ollama', version: '0.1.0'});
  tools: Tool[] = [];
  async connect(root: string, url: string) {
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    const transport = new StdioClientTransport({command: process.execPath, args: [path.join(root, 'scripts/mcp.mjs')], cwd: root, env: {...env, FRAMECRAFT_URL: url}, stderr: 'pipe'});
    transport.stderr?.on('data', () => undefined);
    await this.client.connect(transport);
    let cursor: string | undefined;
    do {const page = await this.client.listTools({cursor}); this.tools.push(...page.tools); cursor = page.nextCursor;} while(cursor);
  }
  call(name: string, args: Record<string, unknown>, signal: AbortSignal) {return this.client.callTool({name, arguments: args}, undefined, {signal, timeout: 300000, resetTimeoutOnProgress: true});}
  close() {return this.client.close();}
}
