/**
 * Schedule & Publication tools — Schedules CRUD
 * (adapted from reference src/tools/schedule-publication.ts).
 *
 * Ref pattern: registerSchedulePublicationTools(server) registered 4 server.tool()
 * calls. Adapted into ONE ToolRegistration dispatching on `operation`.
 */

import { z } from 'zod';
import type { SacClient } from '../sac-client.js';
import type { ToolRegistration } from '../../../core/types.js';
import { toolSuccess, toolError, requireAlteration } from './_helpers.js';

export function schedulePublicationTool(client: SacClient): ToolRegistration {
  return {
    name: 'schedule-publication',
    description:
      'Schedule & publication tools — get template, create, update, delete schedules. Dispatch via `operation`.',
    inputSchema: {
      operation: z
        .enum(['get_template', 'create', 'update', 'delete'])
        .describe('Operation to perform'),
      scheduleId: z.string().optional().describe('Schedule ID (update/delete)'),
      body: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Schedule definition / fields to update / deletion parameters'),
      allowalteration: z
        .boolean()
        .optional()
        .describe('Must be true for write operations'),
    },
    handler: async (args) => {
      const a = args as Record<string, unknown>;
      const operation = a.operation as string;
      try {
        switch (operation) {
          case 'get_template': {
            const result = await client.sacGet('/api/v1/ps/schedules/template');
            return toolSuccess(result);
          }
          case 'create': {
            const guard = requireAlteration(a.allowalteration);
            if (guard) return guard;
            const result = await client.sacPost('/api/v1/ps/schedules', a.body);
            return toolSuccess(result);
          }
          case 'update': {
            const guard = requireAlteration(a.allowalteration);
            if (guard) return guard;
            const result = await client.sacPatch(
              `/api/v1/ps/schedules/${encodeURIComponent(String(a.scheduleId ?? ''))}`,
              a.body ?? {},
            );
            return toolSuccess(result);
          }
          case 'delete': {
            const guard = requireAlteration(a.allowalteration);
            if (guard) return guard;
            await client.sacDelete(
              `/api/v1/ps/schedules/${encodeURIComponent(String(a.scheduleId ?? ''))}`,
              a.body,
            );
            return toolSuccess({ deleted: true });
          }
          default:
            return toolError(`Unknown operation: ${operation}`);
        }
      } catch (err) {
        return toolError(err);
      }
    },
  };
}
