/**
 * Content tools — Stories, Resources, FileRepository, Repositories, WidgetQuery
 * (adapted from reference src/tools/content.ts).
 *
 * Ref pattern: registerContentTools(server) registered 10 server.tool() calls.
 * Adapted into ONE ToolRegistration dispatching on `operation`. All 10
 * operations' input fields and SAC API calls preserved verbatim, including the
 * filerepository manual query-string building (encodeURIComponent for OData).
 */

import { z } from 'zod';
import type { SacClient } from '../sac-client.js';
import type { ToolRegistration } from '../../../core/types.js';
import { toolSuccess, toolError, buildODataQuery, requireAlteration } from './_helpers.js';

export function contentTool(client: SacClient): ToolRegistration {
  return {
    name: 'content',
    description:
      'Content tools — stories, resources, file repository, repositories, widget data, OData metadata. Dispatch via `operation`.',
    inputSchema: {
      operation: z
        .enum([
          'stories_list',
          'stories_copy',
          'stories_rename',
          'stories_delete',
          'metadata_get',
          'resources_list',
          'resources_get',
          'filerepository_list',
          'repositories_list',
          'widget_get_data',
        ])
        .describe('Operation to perform'),
      includeModels: z.boolean().optional().describe('Include model metadata for each story'),
      sourceStoryId: z.string().optional().describe('Source story ID (for stories_copy)'),
      copyToFolder: z.string().optional().describe('Target folder (for stories_copy)'),
      newName: z.string().optional().describe('New name (for stories_copy / stories_rename)'),
      storyId: z.string().optional().describe('Story ID'),
      widgetId: z.string().optional().describe('Widget ID'),
      type: z.string().optional().describe('Widget type (default kpiTile)'),
      resourceId: z.string().optional().describe('Resource ID'),
      applyManagePrivilege: z
        .boolean()
        .optional()
        .describe('filerepository_list: true = all tenant content (default)'),
      $top: z.number().optional().describe('Max results (default 20)'),
      $skip: z.number().optional().describe('Skip N results'),
      $filter: z.string().optional().describe('OData filter'),
      $orderby: z.string().optional().describe("e.g. 'name desc'"),
      $select: z.string().optional().describe('Comma-separated fields'),
      $expand: z.string().optional().describe('Expand related entities'),
      $inlinecount: z.enum(['allpages', 'none']).optional().describe('Include total count'),
      $format: z.enum(['json', 'xml']).optional().describe('Response format'),
      $count: z.boolean().optional().describe('Include total count in response'),
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
          case 'stories_list': {
            const params = new URLSearchParams();
            if (a.includeModels) params.append('include', 'models');
            const qs = params.toString() ? `?${params.toString()}` : '';
            const result = await client.sacGet(`/api/v1/stories${qs}`);
            return toolSuccess(result);
          }
          case 'stories_copy': {
            const guard = requireAlteration(a.allowalteration);
            if (guard) return guard;
            let path = `/api/v1/stories?copyFrom=${encodeURIComponent(String(a.sourceStoryId ?? ''))}`;
            if (a.copyToFolder) path += `&copyTo=${encodeURIComponent(String(a.copyToFolder))}`;
            const body = a.newName ? { name: a.newName } : undefined;
            const result = await client.sacPost(path, body);
            return toolSuccess(result);
          }
          case 'stories_rename': {
            const guard = requireAlteration(a.allowalteration);
            if (guard) return guard;
            const result = await client.sacPatch(
              `/api/v1/stories/${encodeURIComponent(String(a.storyId ?? ''))}`,
              { name: a.newName },
            );
            return toolSuccess(result);
          }
          case 'stories_delete': {
            const guard = requireAlteration(a.allowalteration);
            if (guard) return guard;
            await client.sacDelete(`/api/v1/stories/${encodeURIComponent(String(a.storyId ?? ''))}`);
            return toolSuccess({ deleted: true });
          }
          case 'metadata_get': {
            const result = await client.sacGet('/api/v1/$metadata');
            return toolSuccess(result);
          }
          case 'resources_list': {
            const top = (a.$top as number | undefined) ?? 20;
            const queryArgs = { ...a, $top: top };
            const qs = buildODataQuery(
              queryArgs as Record<string, string | number | boolean | undefined>,
            );
            const result = await client.sacGet(`/api/v1/Resources${qs}`);
            if (Array.isArray(result) && result.length > top) {
              return toolSuccess(result.slice(0, top));
            }
            if (result && typeof result === 'object' && 'value' in result && Array.isArray((result as { value: unknown[] }).value)) {
              const val = (result as { value: unknown[] }).value;
              if (val.length > top) {
                return toolSuccess({ ...result, value: val.slice(0, top) });
              }
            }
            return toolSuccess(result);
          }
          case 'resources_get': {
            const result = await client.sacGet(
              `/api/v1/Resources('${encodeURIComponent(String(a.resourceId ?? ''))}')`,
            );
            return toolSuccess(result);
          }
          case 'filerepository_list': {
            const top = (a.$top as number | undefined) ?? 20;
            const parts: string[] = [];
            const enc = encodeURIComponent;
            parts.push(`applyManagePrivilege=${(a.applyManagePrivilege ?? true).toString()}`);
            parts.push(`$top=${top}`);
            if (a.$skip) parts.push(`$skip=${a.$skip}`);
            if (a.$filter) parts.push(`$filter=${enc(String(a.$filter))}`);
            if (a.$orderby) parts.push(`$orderby=${enc(String(a.$orderby))}`);
            if (a.$select) parts.push(`$select=${enc(String(a.$select))}`);
            if (a.$count) parts.push(`$count=true`);
            const result = await client.sacGet(
              `/api/v1/filerepository/Resources?${parts.join('&')}`,
            );
            return toolSuccess(result);
          }
          case 'repositories_list': {
            const top = (a.$top as number | undefined) ?? 20;
            const queryArgs = { ...a, $top: top };
            const qs = buildODataQuery(
              queryArgs as Record<string, string | number | boolean | undefined>,
            );
            const result = await client.sacGet(`/api/v1/Repositories${qs}`);
            if (Array.isArray(result) && result.length > top) {
              return toolSuccess(result.slice(0, top));
            }
            if (result && typeof result === 'object' && 'value' in result && Array.isArray((result as { value: unknown[] }).value)) {
              const val = (result as { value: unknown[] }).value;
              if (val.length > top) {
                return toolSuccess({ ...result, value: val.slice(0, top) });
              }
            }
            return toolSuccess(result);
          }
          case 'widget_get_data': {
            const qs = buildODataQuery({
              storyId: a.storyId as string | undefined,
              widgetId: a.widgetId as string | undefined,
              type: a.type as string | undefined,
            });
            const result = await client.sacGet(`/api/v1/widgetquery/getWidgetData${qs}`);
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
