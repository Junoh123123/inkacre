// Thin MCP transport for an agent whose current tool catalog lacks this server.
// It does not choose operations, interpret a task, or modify tool responses.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [name, ...extra] = process.argv.slice(2);
if (extra.length || !name || (name !== '--list' && !name.startsWith('workspace_'))) {
  throw new Error('Usage: ./app-local scripts/workspace-tool.mjs --list | workspace_TOOL < arguments.json');
}
const args = name === '--list' ? undefined : JSON.parse(readFileSync(0, 'utf8'));
const client = new Client({ name: 'workspace-conversation-agent', version: '1.0.0' });
try {
  await client.connect(new StdioClientTransport({
    command: fileURLToPath(new URL('../app-local', import.meta.url)), args: ['mcp'], stderr: 'inherit',
    env: { ...process.env },
  }));
  const result = name === '--list'
    ? { instructions: client.getInstructions(), ...await client.listTools() }
    : await client.callTool({ name, arguments: args });
  console.log(JSON.stringify(result));
  if (result.isError) process.exitCode = 1;
} finally {
  await client.close();
}
