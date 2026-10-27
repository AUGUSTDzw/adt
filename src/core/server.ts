import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Registry } from './registry.js';
import type { AppConfig } from './config.js';
import { redact } from './utils/sensitive-redact.js';
import { auditWrite } from './utils/audit.js';
import { logger } from './utils/logger.js';

/** Tools whose name indicates a write operation (audit + read-only gating). */
const WRITE_TOOL_PATTERN = /^(write|create|delete|update|activate|release|implement|set|schedule|deploy|push|stage|publish|add|rename|extract|force|run|git_pull|git_create|git_unlink)/i;

/** Result cache: TTL for read-only tools, invalidated on any write. */
class ResultCache {
  private entries = new Map<string, { value: unknown; expiresAt: number }>();
  constructor(private ttlMs = 60_000) {}

  get(key: string): unknown | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: unknown): void {
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  clear(): void {
    this.entries.clear();
  }
}

export function buildMcpServer(registry: Registry): McpServer {
  const server = new McpServer({ name: 'sap-mcp-unified', version: '0.1.0' });
  const cache = new ResultCache();

  for (const t of registry.allTools()) {
    const isWrite = t.write ?? WRITE_TOOL_PATTERN.test(t.name);
    server.tool(
      t.name,
      t.description,
      t.inputSchema,
      async (args, ctx) => {
        const cacheKey = `${t.name}:${JSON.stringify(args ?? {})}`;
        if (!isWrite) {
          const hit = cache.get(cacheKey);
          if (hit !== undefined) return hit as any;
        } else {
          auditWrite(t.name, args);
          cache.clear();
        }
        const res = await t.handler(args, ctx);
        const redacted = redact(res);
        if (!isWrite) cache.set(cacheKey, redacted);
        return redacted as any;
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
    const port = config.httpPort ?? 8080;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });
    await server.connect(transport);
    const httpServer = createServer(
      async (req: IncomingMessage, res: ServerResponse) => {
        if (config.httpToken) {
          const auth = req.headers.authorization ?? '';
          if (auth !== `Bearer ${config.httpToken}`) {
            res.writeHead(401, { 'content-type': 'application/json' });
            res.end(
              JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'unauthorized' } }),
            );
            return;
          }
        }
        try {
          await transport.handleRequest(req, res);
        } catch (e) {
          logger.error({ err: String(e) }, 'HTTP MCP request failed');
          if (!res.headersSent) {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(
              JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'internal error' } }),
            );
          }
        }
      },
    );
    httpServer.listen(port);
    logger.info({ port }, 'SAP MCP server listening (HTTP)');
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('SAP MCP server started (stdio)');
  }
}
