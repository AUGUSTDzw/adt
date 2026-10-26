/**
 * Monitoring tools — Audit export and monitoring
 * (adapted from reference src/tools/monitoring.ts).
 *
 * Ref pattern: registerMonitoringTools(server) registered 2 server.tool()
 * calls. Adapted into ONE ToolRegistration dispatching on `operation`.
 */

import { z } from 'zod';
import type { SacClient } from '../sac-client.js';
import type { ToolRegistration } from '../../../core/types.js';
import { toolSuccess, toolError, buildODataQuery, pickOData } from './_helpers.js';

export function monitoringTool(client: SacClient): ToolRegistration {
  return {
    name: 'monitoring',
    description:
      'Monitoring tools — audit activity export and per-model monitoring data. Dispatch via `operation`.',
    inputSchema: {
      operation: z
        .enum(['audit_export', 'monitoring_get'])
        .describe('Operation to perform'),
      modelId: z.string().optional().describe('Model ID (monitoring_get)'),
      $top: z.number().optional().describe('Max results'),
      $skip: z.number().optional().describe('Skip N results'),
      $filter: z.string().optional().describe('OData filter'),
      $orderby: z.string().optional().describe('Order by'),
      $select: z.string().optional().describe('Fields to return'),
    },
    handler: async (args) => {
      const a = args as Record<string, unknown>;
      const operation = a.operation as string;
      try {
        if (operation === 'audit_export') {
          const qs = buildODataQuery(pickOData(a));
          const result = await client.sacGet(
            `/api/v1/audit/activities/exportActivities${qs}`,
          );
          return toolSuccess(result);
        }
        if (operation === 'monitoring_get') {
          const result = await client.sacGet(
            `/api/v1/monitoring/${encodeURIComponent(String(a.modelId ?? ''))}`,
          );
          return toolSuccess(result);
        }
        return toolError(`Unknown operation: ${operation}`);
      } catch (err) {
        return toolError(err);
      }
    },
  };
}
