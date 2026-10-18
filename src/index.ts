import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { registerMercadonaTools } from './mercadona.js';
import { loadMercadonaEnv } from './env.js';

loadMercadonaEnv();

const server = new McpServer({ name: 'mercadona-mcp', version: '0.1.0' });

registerMercadonaTools(server);

server.registerTool(
  'greet',
  {
    description: 'Return a friendly greeting for a person.',
    inputSchema: z.object({ name: z.string().trim().min(1).describe('Name of the person to greet') }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ name }) => ({
    content: [{ type: 'text', text: `Hello, ${name}!` }],
  }),
);

server.registerTool(
  'add',
  {
    description: 'Add two numbers using JavaScript number arithmetic.',
    inputSchema: z.object({
      a: z.number().describe('First number'),
      b: z.number().describe('Second number'),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ a, b }) => {
    const sum = a + b;
    if (!Number.isFinite(sum)) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'The sum exceeds the supported numeric range.' }],
      };
    }
    return { content: [{ type: 'text', text: String(sum) }] };
  },
);

// stdout belongs to the MCP protocol; diagnostic messages must go to stderr.
try {
  await server.connect(new StdioServerTransport());
} catch (error) {
  console.error('Failed to start MCP server:', error);
  process.exitCode = 1;
}
