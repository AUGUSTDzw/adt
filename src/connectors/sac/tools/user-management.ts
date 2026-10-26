/**
 * User Management tools — SCIM v2 Users, Teams (Groups), Bulk
 * (adapted from reference src/tools/user-management.ts).
 *
 * Ref pattern: registerUserManagementTools(server) registered 10 server.tool()
 * calls (users list/get/create/update/patch/delete, teams list/create/patch,
 * users bulk). Adapted into ONE ToolRegistration dispatching on `operation`.
 * All input fields and SAC API paths preserved verbatim, including the
 * x-sap-sac-create-team-folder extra header on teams_create.
 */

import { z } from 'zod';
import type { SacClient } from '../sac-client.js';
import type { ToolRegistration } from '../../../core/types.js';
import { toolSuccess, toolError, buildODataQuery, requireAlteration } from './_helpers.js';

export function userManagementTool(client: SacClient): ToolRegistration {
  return {
    name: 'user-management',
    description:
      'User management (SCIM v2) — users & teams CRUD, bulk operations. Dispatch via `operation`.',
    inputSchema: {
      operation: z
        .enum([
          'users_list',
          'users_get',
          'users_create',
          'users_update',
          'users_patch',
          'users_delete',
          'teams_list',
          'teams_create',
          'teams_patch',
          'users_bulk',
        ])
        .describe('Operation to perform'),
      userId: z.string().optional().describe('User UUID'),
      groupId: z.string().optional().describe('Group UUID'),
      body: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('SCIM User/Group resource or PatchOp'),
      filter: z.string().optional().describe('SCIM filter'),
      startIndex: z.number().optional().describe('1-based start index'),
      count: z.number().optional().describe('Max results'),
      createTeamFolder: z
        .boolean()
        .optional()
        .describe('teams_create: create associated team folder'),
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
          case 'users_list': {
            const qs = buildODataQuery({
              filter: a.filter as string | undefined,
              startIndex: a.startIndex as number | undefined,
              count: a.count as number | undefined,
            });
            const result = await client.sacGet(`/api/v1/scim2/Users${qs}`);
            return toolSuccess(result);
          }
          case 'users_get': {
            const result = await client.sacGet(
              `/api/v1/scim2/Users/${encodeURIComponent(String(a.userId ?? ''))}`,
            );
            return toolSuccess(result);
          }
          case 'users_create': {
            const guard = requireAlteration(a.allowalteration);
            if (guard) return guard;
            const result = await client.sacPost('/api/v1/scim2/Users', a.body);
            return toolSuccess(result);
          }
          case 'users_update': {
            const guard = requireAlteration(a.allowalteration);
            if (guard) return guard;
            const result = await client.sacPut(
              `/api/v1/scim2/Users/${encodeURIComponent(String(a.userId ?? ''))}`,
              a.body ?? {},
            );
            return toolSuccess(result);
          }
          case 'users_patch': {
            const guard = requireAlteration(a.allowalteration);
            if (guard) return guard;
            const result = await client.sacPatch(
              `/api/v1/scim2/Users/${encodeURIComponent(String(a.userId ?? ''))}`,
              a.body ?? {},
            );
            return toolSuccess(result);
          }
          case 'users_delete': {
            const guard = requireAlteration(a.allowalteration);
            if (guard) return guard;
            await client.sacDelete(
              `/api/v1/scim2/Users/${encodeURIComponent(String(a.userId ?? ''))}`,
            );
            return toolSuccess({ deleted: true });
          }
          case 'teams_list': {
            const qs = buildODataQuery({
              filter: a.filter as string | undefined,
              startIndex: a.startIndex as number | undefined,
              count: a.count as number | undefined,
            });
            const result = await client.sacGet(`/api/v1/scim2/Groups${qs}`);
            return toolSuccess(result);
          }
          case 'teams_create': {
            const guard = requireAlteration(a.allowalteration);
            if (guard) return guard;
            const extra: Record<string, string> = {};
            if (a.createTeamFolder) extra['x-sap-sac-create-team-folder'] = 'true';
            const result = await client.sacPost(
              '/api/v1/scim2/Groups',
              a.body,
              extra,
            );
            return toolSuccess(result);
          }
          case 'teams_patch': {
            const guard = requireAlteration(a.allowalteration);
            if (guard) return guard;
            const result = await client.sacPatch(
              `/api/v1/scim2/Groups/${encodeURIComponent(String(a.groupId ?? ''))}`,
              a.body ?? {},
            );
            return toolSuccess(result);
          }
          case 'users_bulk': {
            const guard = requireAlteration(a.allowalteration);
            if (guard) return guard;
            const result = await client.sacPost('/api/v1/scim2/Bulk', a.body);
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
