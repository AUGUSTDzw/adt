/**
 * Multi Actions tools — Execute and get status
 * (adapted from reference src/tools/multi-actions.ts).
 *
 * Ref pattern: registerMultiActionTools(server) registered 2 server.tool()
 * calls. Adapted into ONE ToolRegistration dispatching on `operation`.
 * The nested parameterValues schema is preserved verbatim.
 */

import { z } from 'zod';
import type { SacClient } from '../sac-client.js';
import type { ToolRegistration } from '../../../core/types.js';
import { toolSuccess, toolError, requireAlteration } from './_helpers.js';

export function multiActionsTool(client: SacClient): ToolRegistration {
  return {
    name: 'multi-actions',
    description:
      'Multi actions — execute a multi action and get execution status. Dispatch via `operation`.',
    inputSchema: {
      operation: z
        .enum(['execute', 'get_status'])
        .describe('Operation to perform'),
      multiActionId: z
        .string()
        .optional()
        .describe('ID as packageId:objectId, e.g. t.TEST:CEEFOKMRUKJBY5BN47F1NS2L8G'),
      executionId: z.string().optional().describe('Execution ID (get_status)'),
      parameterValues: z
        .array(
          z.object({
            parameterId: z.string().describe('Parameter ID'),
            value: z.union([
              z.number(),
              z.object({
                memberIds: z.union([z.array(z.string()), z.array(z.array(z.string()))]),
                hierarchyId: z.string().nullable().optional(),
              }),
            ]),
          }),
        )
        .optional()
        .describe('Parameters array, empty [] if none required'),
      allowalteration: z
        .boolean()
        .optional()
        .describe('Must be true for write operations'),
    },
    handler: async (args) => {
      const a = args as Record<string, unknown>;
      const operation = a.operation as string;
      try {
        if (operation === 'execute') {
          const guard = requireAlteration(a.allowalteration);
          if (guard) return guard;
          const result = await client.sacPost(
            `/api/v1/multiActions/${a.multiActionId}/executions`,
            { parameterValues: a.parameterValues ?? [] },
          );
          return toolSuccess(result);
        }
        if (operation === 'get_status') {
          const result = await client.sacGet(
            `/api/v1/multiActions/${a.multiActionId}/executions/${a.executionId}`,
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
