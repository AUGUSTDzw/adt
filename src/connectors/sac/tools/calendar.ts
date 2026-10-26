/**
 * Calendar tools — Get, update, and copy calendar events
 * (adapted from reference src/tools/calendar.ts).
 *
 * Adaptation: the ref's registerCalendarTools(server) registered THREE
 * server.tool() calls (sac_calendar_get_event, sac_calendar_update_event,
 * sac_calendar_copy_event). The connector-registry expects ONE tool per
 * namespace, so we expose ONE ToolRegistration that dispatches on an
 * `operation` field. Every operation's input fields and SAC API call are
 * preserved verbatim.
 */

import { z } from 'zod';
import type { SacClient } from '../sac-client.js';
import type { ToolRegistration } from '../../../core/types.js';
import { toolSuccess, toolError, requireAlteration } from './_helpers.js';

export function calendarTool(client: SacClient): ToolRegistration {
  return {
    name: 'calendar',
    description:
      'Calendar tools — get/update/copy calendar events. Dispatch via `operation`.',
    inputSchema: {
      operation: z
        .enum(['get_event', 'update_event', 'copy_event'])
        .describe('Operation to perform'),
      eventId: z.string().optional().describe('Event ID'),
      body: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Event definition / fields to update'),
      allowalteration: z
        .boolean()
        .optional()
        .describe('Must be true for write operations'),
    },
    handler: async (args) => {
      const { operation, eventId, body, allowalteration } = args as {
        operation: 'get_event' | 'update_event' | 'copy_event';
        eventId?: string;
        body?: Record<string, unknown>;
        allowalteration?: boolean;
      };
      try {
        if (operation === 'get_event') {
          const result = await client.sacGet(
            `/api/v1/calendar/events/${encodeURIComponent(eventId ?? '')}`,
          );
          return toolSuccess(result);
        }
        if (operation === 'update_event') {
          const guard = requireAlteration(allowalteration);
          if (guard) return guard;
          const result = await client.sacPatch(
            `/api/v1/calendar/events/${encodeURIComponent(eventId ?? '')}`,
            body ?? {},
          );
          return toolSuccess(result);
        }
        // copy_event
        const guard = requireAlteration(allowalteration);
        if (guard) return guard;
        const result = await client.sacPost('/api/v1/calendar/events', body);
        return toolSuccess(result);
      } catch (err) {
        return toolError(err);
      }
    },
  };
}
