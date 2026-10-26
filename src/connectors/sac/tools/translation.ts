/**
 * Translation tools — Artifacts metadata, XLIFF download/upload
 * (adapted from reference src/tools/translation.ts).
 *
 * Ref pattern: registerTranslationTools(server) registered 4 server.tool()
 * calls. Adapted into ONE ToolRegistration dispatching on `operation`.
 */

import { z } from 'zod';
import type { SacClient } from '../sac-client.js';
import type { ToolRegistration } from '../../../core/types.js';
import { toolSuccess, toolError, buildODataQuery } from './_helpers.js';

export function translationTool(client: SacClient): ToolRegistration {
  return {
    name: 'translation',
    description:
      'Translation tools — list/get translatable artifacts, download XLIFF (single/bulk). Dispatch via `operation`.',
    inputSchema: {
      operation: z
        .enum(['list_artifacts', 'get_artifact', 'download_xliff', 'download_xliff_bulk'])
        .describe('Operation to perform'),
      artifactId: z.string().optional().describe('Artifact ID'),
      body: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Bulk request with artifact IDs (download_xliff_bulk)'),
      $top: z.number().optional().describe('Max results'),
      $skip: z.number().optional().describe('Skip N results'),
      $filter: z.string().optional().describe('OData filter'),
    },
    handler: async (args) => {
      const a = args as Record<string, unknown>;
      const operation = a.operation as string;
      try {
        switch (operation) {
          case 'list_artifacts': {
            const qs = buildODataQuery(
              a as Record<string, string | number | boolean | undefined>,
            );
            const result = await client.sacGet(`/api/v1/ts/artifacts/metadata${qs}`);
            return toolSuccess(result);
          }
          case 'get_artifact': {
            const result = await client.sacGet(
              `/api/v1/ts/artifacts/${encodeURIComponent(String(a.artifactId ?? ''))}/metadata`,
            );
            return toolSuccess(result);
          }
          case 'download_xliff': {
            const result = await client.sacGet(
              `/api/v1/ts/artifacts/${encodeURIComponent(String(a.artifactId ?? ''))}/source/xliff`,
            );
            return toolSuccess(result);
          }
          case 'download_xliff_bulk': {
            const result = await client.sacPost(
              '/api/v1/ts/artifacts/source/xliff',
              a.body,
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
