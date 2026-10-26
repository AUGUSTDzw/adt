/**
 * Data Import tools — Models, Jobs, Public Dimensions, Currency/Unit Conversions
 * (adapted from reference src/tools/data-import.ts).
 *
 * Ref pattern: registerDataImportTools(server) registered 24 server.tool()
 * calls across Models, Jobs (create/upload/validate/run/status/invalid/delete),
 * One-Click Import, Public Dimensions, Currency Conversions, Unit Conversions.
 * Adapted into ONE ToolRegistration dispatching on `operation`. Every
 * operation's input fields and SAC API path are preserved verbatim, including
 * the shared importMethod / jobSettings / mapping / defaultValues schemas.
 */

import { z } from 'zod';
import type { SacClient } from '../sac-client.js';
import type { ToolRegistration } from '../../../core/types.js';
import { toolSuccess, toolError, requireAlteration } from './_helpers.js';

const BASE = '/api/v1/dataimport';

const importMethodSchema = z
  .enum(['Update', 'Append', 'CleanAndReplace', 'DeleteAndUpsert', 'DropAndInsert'])
  .optional()
  .describe('Import method');
const jobSettingsSchema = z
  .object({
    importMethod: importMethodSchema,
    dimensionScope: z.array(z.string()).optional().describe('Dimensions for CleanAndReplace scope'),
    executeWithFailedRows: z.boolean().optional().describe('Proceed even if invalid rows (default: true)'),
    ignoreAdditionalColumns: z.boolean().optional().describe('Ignore extra columns (default: false)'),
    pivotOptions: z
      .object({
        pivotColumnStart: z.number().describe('Starting column index'),
        pivotKeyName: z.string().describe('Pivoted dimension name'),
        pivotValueName: z.string().describe('Measure column name'),
      })
      .optional()
      .describe('Pivot settings'),
    dateFormats: z.record(z.string(), z.string()).optional().describe('Date format per column'),
    reverseSignByAccountType: z.boolean().optional().describe('Reverse sign for INC/LEQ accounts'),
  })
  .optional()
  .describe('Job settings');
const mappingSchema = z
  .record(z.string(), z.string())
  .optional()
  .describe('Column mapping: { source: target }');
const defaultValuesSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .describe('Default values for missing columns');
const importTypeSchema = z
  .enum(['factData', 'masterData', 'masterFactData', 'privateFactData'])
  .optional()
  .describe('Import type');

function sliceTop(result: unknown, top: number | undefined, key: string): unknown {
  if (top && Array.isArray(result)) return result.slice(0, top);
  if (
    top &&
    result &&
    typeof result === 'object' &&
    key in (result as Record<string, unknown>) &&
    Array.isArray((result as Record<string, unknown>)[key])
  ) {
    const r = result as Record<string, unknown>;
    r[key] = (r[key] as unknown[]).slice(0, top);
  }
  return result;
}

export function dataImportTool(client: SacClient): ToolRegistration {
  return {
    name: 'data-import',
    description:
      'Data import tools — models, jobs, one-click import, public dimensions, currency/unit conversions. Dispatch via `operation`.',
    inputSchema: {
      operation: z
        .enum([
          'list_models',
          'get_model',
          'get_model_metadata',
          'create_job',
          'list_jobs',
          'upload_data',
          'validate_job',
          'run_job',
          'get_job_status',
          'get_invalid_rows',
          'delete_job',
          'oneclick',
          'list_public_dimensions',
          'get_public_dimension',
          'get_public_dimension_metadata',
          'create_public_dimension_job',
          'list_currency_conversions',
          'get_currency_conversion',
          'get_currency_conversion_metadata',
          'create_currency_conversion_job',
          'list_unit_conversions',
          'get_unit_conversion',
          'get_unit_conversion_metadata',
          'create_unit_conversion_job',
        ])
        .describe('Operation to perform'),
      modelId: z.string().optional().describe('Model ID'),
      jobId: z.string().optional().describe('Job ID'),
      publicDimensionId: z.string().optional().describe('Public dimension ID'),
      currencyConversionId: z.string().optional().describe('Currency conversion ID'),
      unitConversionId: z.string().optional().describe('Unit conversion ID'),
      importType: importTypeSchema,
      Mapping: mappingSchema,
      DefaultValues: defaultValuesSchema,
      JobSettings: jobSettingsSchema,
      Data: z.array(z.record(z.string(), z.unknown())).optional().describe('Data rows to import'),
      DeletedData: z
        .array(z.record(z.string(), z.unknown()))
        .optional()
        .describe('Rows to delete (currency/unit jobs only)'),
      top: z.number().optional().describe('Max number of results'),
      overrideExecuteWithFailedRows: z
        .boolean()
        .optional()
        .describe('Force write despite failed rows'),
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
          case 'list_models': {
            const top = a.top as number | undefined;
            const url = top ? `${BASE}/models?$top=${top}` : `${BASE}/models`;
            const result = await client.sacGet(url);
            return toolSuccess(sliceTop(result, top, 'models'));
          }
          case 'get_model': {
            const result = await client.sacGet(`${BASE}/models/${a.modelId}`);
            return toolSuccess(result);
          }
          case 'get_model_metadata': {
            const result = await client.sacGet(`${BASE}/models/${a.modelId}/metadata`);
            return toolSuccess(result);
          }
          case 'create_job': {
            const guard = requireAlteration(a.allowalteration);
            if (guard) return guard;
            const path = a.importType
              ? `${BASE}/models/${a.modelId}/${a.importType}`
              : `${BASE}/models/${a.modelId}`;
            const body: Record<string, unknown> = {};
            if (a.Mapping) body.Mapping = a.Mapping;
            if (a.JobSettings) body.JobSettings = a.JobSettings;
            const result = await client.sacPost(
              path,
              Object.keys(body).length > 0 ? body : undefined,
            );
            return toolSuccess(result);
          }
          case 'list_jobs': {
            const top = a.top as number | undefined;
            const url = top ? `${BASE}/jobs?$top=${top}` : `${BASE}/jobs`;
            const result = await client.sacGet(url);
            return toolSuccess(sliceTop(result, top, 'jobs'));
          }
          case 'upload_data': {
            const guard = requireAlteration(a.allowalteration);
            if (guard) return guard;
            const body: Record<string, unknown> = { Data: a.Data };
            if (a.DeletedData) body.DeletedData = a.DeletedData;
            if (a.Mapping) body.Mapping = a.Mapping;
            if (a.DefaultValues) body.DefaultValues = a.DefaultValues;
            const result = await client.sacPost(`${BASE}/jobs/${a.jobId}`, body);
            return toolSuccess(result);
          }
          case 'validate_job': {
            const result = await client.sacPost(`${BASE}/jobs/${a.jobId}/validate`);
            return toolSuccess(result);
          }
          case 'run_job': {
            const guard = requireAlteration(a.allowalteration);
            if (guard) return guard;
            const body = a.overrideExecuteWithFailedRows
              ? { overrideExecuteWithFailedRows: true }
              : undefined;
            const result = await client.sacPost(`${BASE}/jobs/${a.jobId}/run`, body);
            return toolSuccess(result);
          }
          case 'get_job_status': {
            const result = await client.sacGet(`${BASE}/jobs/${a.jobId}/status`);
            return toolSuccess(result);
          }
          case 'get_invalid_rows': {
            const result = await client.sacGet(`${BASE}/jobs/${a.jobId}/invalidRows`);
            return toolSuccess(result);
          }
          case 'delete_job': {
            const guard = requireAlteration(a.allowalteration);
            if (guard) return guard;
            await client.sacDelete(`${BASE}/jobs/${a.jobId}`);
            return toolSuccess({ deleted: true });
          }
          case 'oneclick': {
            const guard = requireAlteration(a.allowalteration);
            if (guard) return guard;
            const path = a.importType
              ? `${BASE}/import/${a.modelId}/${a.importType}`
              : `${BASE}/import/${a.modelId}`;
            const body: Record<string, unknown> = { Data: a.Data };
            if (a.Mapping) body.Mapping = a.Mapping;
            if (a.DefaultValues) body.DefaultValues = a.DefaultValues;
            if (a.JobSettings) body.JobSettings = a.JobSettings;
            const result = await client.sacPost(path, body);
            return toolSuccess(result);
          }
          case 'list_public_dimensions': {
            const top = a.top as number | undefined;
            const url = top ? `${BASE}/publicDimensions?$top=${top}` : `${BASE}/publicDimensions`;
            const result = await client.sacGet(url);
            return toolSuccess(sliceTop(result, top, 'publicDimensions'));
          }
          case 'get_public_dimension': {
            const result = await client.sacGet(`${BASE}/publicDimensions/${a.publicDimensionId}`);
            return toolSuccess(result);
          }
          case 'get_public_dimension_metadata': {
            const result = await client.sacGet(
              `${BASE}/publicDimensions/${a.publicDimensionId}/metadata`,
            );
            return toolSuccess(result);
          }
          case 'create_public_dimension_job': {
            const guard = requireAlteration(a.allowalteration);
            if (guard) return guard;
            const body: Record<string, unknown> = {};
            if (a.Mapping) body.Mapping = a.Mapping;
            const result = await client.sacPost(
              `${BASE}/publicDimensions/${a.publicDimensionId}/publicDimensionData`,
              Object.keys(body).length > 0 ? body : undefined,
            );
            return toolSuccess(result);
          }
          case 'list_currency_conversions': {
            const top = a.top as number | undefined;
            const url = top
              ? `${BASE}/currencyConversions?$top=${top}`
              : `${BASE}/currencyConversions`;
            const result = await client.sacGet(url);
            return toolSuccess(sliceTop(result, top, 'currencyConversions'));
          }
          case 'get_currency_conversion': {
            const result = await client.sacGet(
              `${BASE}/currencyConversions/${a.currencyConversionId}`,
            );
            return toolSuccess(result);
          }
          case 'get_currency_conversion_metadata': {
            const result = await client.sacGet(
              `${BASE}/currencyConversions/${a.currencyConversionId}/metadata`,
            );
            return toolSuccess(result);
          }
          case 'create_currency_conversion_job': {
            const guard = requireAlteration(a.allowalteration);
            if (guard) return guard;
            const importType = a.importType as string | undefined;
            const path = importType
              ? `${BASE}/currencyConversions/${a.currencyConversionId}/${importType}`
              : `${BASE}/currencyConversions/${a.currencyConversionId}`;
            const body: Record<string, unknown> = {};
            if (a.Mapping) body.Mapping = a.Mapping;
            if (a.JobSettings) body.JobSettings = a.JobSettings;
            const result = await client.sacPost(
              path,
              Object.keys(body).length > 0 ? body : undefined,
            );
            return toolSuccess(result);
          }
          case 'list_unit_conversions': {
            const top = a.top as number | undefined;
            const url = top
              ? `${BASE}/unitConversions?$top=${top}`
              : `${BASE}/unitConversions`;
            const result = await client.sacGet(url);
            return toolSuccess(sliceTop(result, top, 'unitConversions'));
          }
          case 'get_unit_conversion': {
            const result = await client.sacGet(`${BASE}/unitConversions/${a.unitConversionId}`);
            return toolSuccess(result);
          }
          case 'get_unit_conversion_metadata': {
            const result = await client.sacGet(
              `${BASE}/unitConversions/${a.unitConversionId}/metadata`,
            );
            return toolSuccess(result);
          }
          case 'create_unit_conversion_job': {
            const guard = requireAlteration(a.allowalteration);
            if (guard) return guard;
            const importType = a.importType as string | undefined;
            const path = importType
              ? `${BASE}/unitConversions/${a.unitConversionId}/${importType}`
              : `${BASE}/unitConversions/${a.unitConversionId}`;
            const body: Record<string, unknown> = {};
            if (a.Mapping) body.Mapping = a.Mapping;
            if (a.DefaultValues) body.DefaultValues = a.DefaultValues;
            if (a.JobSettings) body.JobSettings = a.JobSettings;
            const result = await client.sacPost(
              path,
              Object.keys(body).length > 0 ? body : undefined,
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
