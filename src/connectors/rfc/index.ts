/**
 * RFC connector factory — exposes 4 tools under the `sap.rfc.*` namespace.
 *
 * Ported from reference/sap-rfc-mcp-server. The ref exposed its MCP tools via a
 * flat server.register() loop; here they are collapsed into one SapConnector
 * per the unified registry contract.
 *
 * Tools (registry adds the `sap.rfc.` prefix):
 *   - call_function            : call an RFC function module / BAPI
 *   - read_table               : read rows from an SAP table via RFC_READ_TABLE
 *   - get_function_metadata    : parameter metadata for an RFC function module
 *   - search_functions         : search RFC function modules by name pattern
 */

import type { SapConnector, ToolRegistration, ConnectorConfig } from '../../core/types.js';
import { z } from 'zod';
import { SapRfcClient } from './sap-client.js';
import { MetadataManager } from './metadata-manager.js';
import { TableReader } from './table-reader.js';

export function createRfcConnector(): SapConnector {
  let client!: SapRfcClient;
  let meta!: MetadataManager;
  let tables!: TableReader;
  return {
    id: 'rfc',
    async init(cfg: ConnectorConfig) {
      client = new SapRfcClient(cfg);
      await client.connect();
      meta = new MetadataManager(client);
      tables = new TableReader(client);
    },
    tools(): ToolRegistration[] {
      return [
        {
          name: 'call_function',
          description: 'Call an SAP RFC function module / BAPI',
          inputSchema: {
            function: z.string(),
            imports: z.record(z.unknown()).optional(),
            tables: z.record(z.unknown()).optional(),
          },
          handler: async (a) => {
            const args = a as {
              function: string;
              imports?: Record<string, unknown>;
              tables?: Record<string, unknown>;
            };
            const params = { ...(args.imports ?? {}), ...(args.tables ?? {}) };
            const result = await client.call(args.function, params);
            return { content: [{ type: 'json', json: result }] };
          },
        },
        {
          name: 'read_table',
          description: 'Read rows from an SAP table via RFC_READ_TABLE',
          inputSchema: {
            table: z.string(),
            fields: z.array(z.string()).optional(),
            where: z.string().optional(),
            maxRows: z.number().optional(),
          },
          handler: async (a) => {
            const args = a as {
              table: string;
              fields?: string[];
              where?: string;
              maxRows?: number;
            };
            const result = await tables.read(args.table, args);
            return { content: [{ type: 'json', json: result }] };
          },
        },
        {
          name: 'get_function_metadata',
          description: 'Get parameter metadata for an RFC function module',
          inputSchema: { function: z.string() },
          handler: async (a) => {
            const args = a as { function: string };
            const result = await meta.getMetadata(args.function);
            return { content: [{ type: 'json', json: result }] };
          },
        },
        {
          name: 'search_functions',
          description: 'Search RFC function modules by name pattern',
          inputSchema: { pattern: z.string() },
          handler: async (a) => {
            const args = a as { pattern: string };
            const result = await meta.search(args.pattern);
            return { content: [{ type: 'json', json: result }] };
          },
        },
      ];
    },
    async shutdown() {
      await client?.close();
    },
  };
}
