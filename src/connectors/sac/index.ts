/**
 * SAC connector factory.
 *
 * Adapted from reference/sap_analytics_cloud_mcp/src/tools/index.ts, which
 * was a barrel that called registerXxxTools(server) for each tool module.
 * Here, createSacConnector() returns a SapConnector whose tools() returns
 * one ToolRegistration per adapted tool module (11 tools total).
 *
 * The connector exposes the SacClient instance as `conn.client` so tests (and
 * the registry) can stub instance methods (e.g. vi.spyOn(conn.client, 'sacGet'))
 * — this is the mockability hook required by the brief.
 *
 * Per the brief's YAGNI rule: resources() and prompts() are omitted (the ref's
 * src/resources and src/prompts were not exercised by the 11-tool contract).
 */

import { SacClient } from './sac-client.js';
import type { SapConnector, ToolRegistration, ConnectorConfig } from '../../core/types.js';
import { calendarTool } from './tools/calendar.js';
import { contentTransportTool } from './tools/content-transport.js';
import { contentTool } from './tools/content.js';
import { dataExportTool } from './tools/data-export.js';
import { dataImportTool } from './tools/data-import.js';
import { monitoringTool } from './tools/monitoring.js';
import { multiActionsTool } from './tools/multi-actions.js';
import { schedulePublicationTool } from './tools/schedule-publication.js';
import { smartQueryTool } from './tools/smart-query.js';
import { translationTool } from './tools/translation.js';
import { userManagementTool } from './tools/user-management.js';

export interface SacConnector extends SapConnector {
  /** The SacClient instance (null before init). Exposed for test stubbing. */
  client: SacClient | null;
}

export function createSacConnector(): SacConnector {
  const conn: SacConnector = {
    id: 'sac',
    client: null,
    async init(cfg: ConnectorConfig): Promise<void> {
      const url = String(cfg.url ?? '');
      const token = String(cfg.token ?? '');
      conn.client = new SacClient({ url, token });
    },
    tools(): ToolRegistration[] {
      if (!conn.client) {
        throw new Error('SAC connector not initialized — call init(cfg) first');
      }
      const client = conn.client;
      return [
        calendarTool(client),
        contentTransportTool(client),
        contentTool(client),
        dataExportTool(client),
        dataImportTool(client),
        monitoringTool(client),
        multiActionsTool(client),
        schedulePublicationTool(client),
        smartQueryTool(client),
        translationTool(client),
        userManagementTool(client),
      ];
    },
  };
  return conn;
}
