/**
 * Content Transport tools — Export/import jobs, packages, permissions
 * (adapted from reference src/tools/content-transport.ts).
 *
 * Ref pattern: registerContentTransportTools(server) registered 7 server.tool()
 * calls. Adapted into ONE ToolRegistration dispatching on `operation`.
 * All 7 operations' input fields and SAC API calls preserved.
 */

import { z } from 'zod';
import type { SacClient } from '../sac-client.js';
import type { ToolRegistration } from '../../../core/types.js';
import { toolSuccess, toolError, requireAlteration } from './_helpers.js';

export function contentTransportTool(client: SacClient): ToolRegistration {
  return {
    name: 'content-transport',
    description:
      'Content transport tools — export/import jobs, content items, permissions, moves. Dispatch via `operation`.',
    inputSchema: {
      operation: z
        .enum([
          'create_export_job',
          'get_job_status',
          'create_import_job',
          'delete_content',
          'get_content_item',
          'get_permissions',
          'move_item',
        ])
        .describe('Operation to perform'),
      jobId: z.string().optional().describe('Job ID'),
      itemId: z.string().optional().describe('Content item ID'),
      waveItemId: z.string().optional().describe('Wave item ID'),
      targetId: z.string().optional().describe('Target location ID'),
      body: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Job/item definition or move parameters'),
      allowalteration: z
        .boolean()
        .optional()
        .describe('Must be true for write operations'),
    },
    handler: async (args) => {
      const { operation, jobId, itemId, waveItemId, targetId, body, allowalteration } = args as {
        operation: string;
        jobId?: string;
        itemId?: string;
        waveItemId?: string;
        targetId?: string;
        body?: Record<string, unknown>;
        allowalteration?: boolean;
      };
      try {
        switch (operation) {
          case 'create_export_job': {
            const guard = requireAlteration(allowalteration);
            if (guard) return guard;
            const result = await client.sacPost('/api/v1/content/jobs', body);
            return toolSuccess(result);
          }
          case 'get_job_status': {
            const result = await client.sacGet(
              `/api/v1/content/jobs/${encodeURIComponent(jobId ?? '')}`,
            );
            return toolSuccess(result);
          }
          case 'create_import_job': {
            const guard = requireAlteration(allowalteration);
            if (guard) return guard;
            const result = await client.sacPost('/api/v1/content/jobs', body);
            return toolSuccess(result);
          }
          case 'delete_content': {
            const guard = requireAlteration(allowalteration);
            if (guard) return guard;
            await client.sacDelete(`/api/v1/content/${encodeURIComponent(itemId ?? '')}`);
            return toolSuccess({ deleted: true });
          }
          case 'get_content_item': {
            const result = await client.sacGet(
              `/api/v1/content/${encodeURIComponent(itemId ?? '')}/${encodeURIComponent(waveItemId ?? '')}`,
            );
            return toolSuccess(result);
          }
          case 'get_permissions': {
            const result = await client.sacGet(
              `/api/v1/content/permissions/${encodeURIComponent(itemId ?? '')}`,
            );
            return toolSuccess(result);
          }
          case 'move_item': {
            const guard = requireAlteration(allowalteration);
            if (guard) return guard;
            const result = await client.sacPut(
              `/api/v1/content/${encodeURIComponent(itemId ?? '')}/${encodeURIComponent(targetId ?? '')}`,
              body ?? {},
            );
            return toolSuccess(result);
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
