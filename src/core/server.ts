import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Registry } from './registry.js';
import type { AppConfig } from './config.js';
import { redact } from './utils/sensitive-redact.js';
import { logger } from './utils/logger.js';

export function buildMcpServer(registry: Registry): McpServer {
  const server = new McpServer({ name: 'sap-mcp-unified', version: '0.1.0' });

  for (const t of registry.allTools()) {
    server.tool(
      t.name,
      t.description,
      t.inputSchema,
      async (args, ctx) => {
        const res = await t.handler(args, ctx);
        return redact(res) as any;
      },
    );
  }
  for (const r of registry.allResources()) {
    server.resource(r.name, r.uri, async (uri) => redact(await r.read(String(uri))) as any);
  }
  for (const p of registry.allPrompts()) {
    server.prompt(p.name, p.args ?? {}, async (args) => redact(await p.render(args)) as any);
  }
  return server;
}

export async function startServer(registry: Registry, config: AppConfig): Promise<void> {
  const server = buildMcpServer(registry);

  if (config.transport === 'http') {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });
    await server.connect(transport);
    logger.info({ port: config.httpPort }, 'SAP MCP server listening (HTTP)');
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('SAP MCP server started (stdio)');
  }
}
