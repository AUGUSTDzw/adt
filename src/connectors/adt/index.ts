/**
 * ADT connector factory.
 *
 * Returns a `SapConnector` exposing 7 tools under `sap.adt.*` (the registry
 * adds the prefix). Tool registrations and signatures are kept verbatim from
 * the task brief; the only adjustment vs. the brief's literal `let client!` is
 * exposing the `AdtClient` instance as `conn.client` so tests can stub its
 * instance methods via `vi.spyOn(conn.client, 'readSource')` — the same
 * mockability hook the SAC connector (Task 8) uses.
 *
 * Per the brief's YAGNI rule: resources() and prompts() are omitted.
 */

import { AdtClient } from './adt-client.js';
import type { SapConnector, ToolRegistration, ConnectorConfig } from '../../core/types.js';
import { z } from 'zod';

export interface AdtConnector extends SapConnector {
  /** The AdtClient instance (null before init). Exposed for test stubbing. */
  client: AdtClient | null;
}

export function createAdtConnector(): AdtConnector {
  const conn: AdtConnector = {
    id: 'adt',
    client: null,
    async init(cfg: ConnectorConfig): Promise<void> {
      conn.client = new AdtClient(cfg);
    },
    tools(): ToolRegistration[] {
      if (!conn.client) {
        throw new Error('ADT connector not initialized — call init(cfg) first');
      }
      const client = conn.client;
      const objUrl = z.string();
      return [
        { name: 'read_source', description: 'Read ABAP source for an object', inputSchema: { objectUrl: objUrl },
          handler: async (a) => ({ content: [{ type: 'text', text: String(await client.readSource((a as any).objectUrl)) }] }) },
        { name: 'write_source', description: 'Write ABAP source for an object', inputSchema: { objectUrl: objUrl, content: z.string() },
          handler: async (a) => ({ content: [{ type: 'text', text: await client.writeSource((a as any).objectUrl, (a as any).content) }] }) },
        { name: 'search_objects', description: 'Search ABAP repository objects', inputSchema: { query: z.string() },
          handler: async (a) => ({ content: [{ type: 'json', json: await client.search((a as any).query) }] }) },
        { name: 'activate', description: 'Activate an ABAP object', inputSchema: { objectUrl: objUrl },
          handler: async (a) => ({ content: [{ type: 'text', text: String(await client.activate((a as any).objectUrl)) }] }) },
        { name: 'run_unit_tests', description: 'Run ABAP Unit tests for an object', inputSchema: { objectUrl: objUrl },
          handler: async (a) => ({ content: [{ type: 'json', json: await client.runUnitTests((a as any).objectUrl) }] }) },
        { name: 'run_atc', description: 'Run ABAP Test Cockpit', inputSchema: { objectUrl: objUrl },
          handler: async (a) => ({ content: [{ type: 'json', json: await client.runAtc((a as any).objectUrl) }] }) },
        { name: 'manage_transports', description: 'Manage transports (add/release/import)', inputSchema: { action: z.enum(['add','release','import']), transportId: z.string(), objectUrl: objUrl.optional() },
          handler: async (a) => ({ content: [{ type: 'text', text: await client.manageTransports((a as any).action, (a as any).transportId, (a as any).objectUrl) }] }) },
      ];
    },
  };
  return conn;
}
