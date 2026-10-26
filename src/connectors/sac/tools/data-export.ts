/**
 * Data Export tools — Administration & Provider data
 * (adapted from reference src/tools/data-export.ts).
 *
 * Ref pattern: registerDataExportTools(server) registered 22 server.tool()
 * calls across Namespaces, Providers, Subscriptions, Admin/Provider metadata,
 * Fact Data (incl. aggregation/difference), Master Data, Audit, Currency,
 * Unit Conversion, Public Dimensions, and a generic entity-set reader.
 * Adapted into ONE ToolRegistration dispatching on `operation`. Every
 * operation's input fields and SAC API path are preserved verbatim.
 */

import { z } from 'zod';
import type { SacClient } from '../sac-client.js';
import type { ToolRegistration } from '../../../core/types.js';
import { toolSuccess, toolError, buildODataQuery, requireAlteration } from './_helpers.js';

const ADMIN = '/api/v1/dataexport/administration';
const PROVIDERS = '/api/v1/dataexport/providers';

export function dataExportTool(client: SacClient): ToolRegistration {
  return {
    name: 'data-export',
    description:
      'Data export tools — namespaces, providers, subscriptions, fact data, master data, audit, currency/unit conversion, public dimensions. Dispatch via `operation`.',
    inputSchema: {
      operation: z
        .enum([
          'list_namespaces',
          'get_namespace',
          'list_providers',
          'list_subscriptions',
          'get_subscription',
          'list_provider_subscriptions',
          'create_subscription',
          'delete_subscription',
          'admin_metadata',
          'get_provider_metadata',
          'get_provider_entities',
          'get_fact_data',
          'get_fact_data_aggregation',
          'get_fact_data_difference',
          'get_master_data',
          'get_dimension_master',
          'get_dimension_master_hierarchy',
          'get_audit_data',
          'get_currency_table',
          'get_conversion_rates',
          'get_public_dimension_data',
          'get_data',
        ])
        .describe('Operation to perform'),
      namespace: z.string().optional().describe('Namespace ID'),
      namespaceId: z.string().optional().describe('Namespace ID (alt key)'),
      provider: z.string().optional().describe('Provider ID'),
      providerId: z.string().optional().describe('Provider ID (alt key)'),
      subscriptionId: z.string().optional().describe('Subscription ID'),
      dimension: z.string().optional().describe('Dimension name'),
      entitySet: z.string().optional().describe('Entity set name (get_data)'),
      NamespaceID: z.string().optional().describe('Create subscription: namespace ID'),
      ProviderID: z.string().optional().describe('Create subscription: provider ID'),
      EntitySetName: z
        .enum(['FactData', 'FactDataDifference', 'FactDataAggregation'])
        .optional()
        .describe('Create subscription: entity set to track'),
      ExternalID: z.string().optional().describe('Create subscription: external ID'),
      Filter: z.string().optional().describe('Create subscription: OData filter'),
      Selection: z
        .string()
        .optional()
        .describe('Create subscription: dims/measures for FactDataAggregation'),
      Description: z.string().optional().describe('Create subscription: description'),
      deleteChain: z.boolean().optional().describe('Delete subscription: delete entire chain'),
      deleteEntitySetName: z
        .string()
        .optional()
        .describe('Delete subscription: delete all for this EntitySetName'),
      $top: z.number().optional().describe('Max results'),
      $skip: z.number().optional().describe('Skip N'),
      $filter: z.string().optional().describe('OData filter'),
      $select: z.string().optional().describe('Columns'),
      $orderby: z.string().optional().describe('Order by'),
      $count: z.boolean().optional().describe('Include count'),
      $format: z.string().optional().describe('json or text/csv'),
      delimiter: z.string().optional().describe('CSV delimiter'),
      pagesize: z.number().optional().describe('Page size'),
      deltaid: z.string().optional().describe('Delta ID'),
      externalid: z.string().optional().describe('External ID'),
      trackChanges: z.boolean().optional().describe('Create subscription (initial load)'),
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
          case 'list_namespaces': {
            const result = await client.sacGet(`${ADMIN}/Namespaces`);
            return toolSuccess(result);
          }
          case 'get_namespace': {
            const ns = a.namespaceId ?? a.namespace;
            const result = await client.sacGet(
              `${ADMIN}/Namespaces(NamespaceID='${ns}')`,
            );
            return toolSuccess(result);
          }
          case 'list_providers': {
            const ns = a.namespaceId ?? a.namespace;
            const result = await client.sacGet(
              `${ADMIN}/Namespaces(NamespaceID='${ns}')/Providers`,
            );
            return toolSuccess(result);
          }
          case 'list_subscriptions': {
            const result = await client.sacGet(`${ADMIN}/Subscriptions`);
            return toolSuccess(result);
          }
          case 'get_subscription': {
            const result = await client.sacGet(
              `${ADMIN}/Subscriptions(NamespaceID='${a.namespaceId}',ProviderID='${a.providerId}',SubscriptionID='${a.subscriptionId}')`,
            );
            return toolSuccess(result);
          }
          case 'list_provider_subscriptions': {
            const result = await client.sacGet(
              `${ADMIN}/Providers(NamespaceID='${a.namespaceId}',ProviderID='${a.providerId}')/Subscriptions`,
            );
            return toolSuccess(result);
          }
          case 'create_subscription': {
            const guard = requireAlteration(a.allowalteration);
            if (guard) return guard;
            const requestBody: Record<string, string> = {
              NamespaceID: String(a.NamespaceID),
              ProviderID: String(a.ProviderID),
              EntitySetName: String(a.EntitySetName),
            };
            if (a.ExternalID) requestBody.ExternalID = String(a.ExternalID);
            if (a.Filter) requestBody.Filter = String(a.Filter);
            if (a.Selection) requestBody.Selection = String(a.Selection);
            if (a.Description) requestBody.Description = String(a.Description);
            const result = await client.sacPost(`${ADMIN}/Subscriptions`, requestBody);
            return toolSuccess(result);
          }
          case 'delete_subscription': {
            const guard = requireAlteration(a.allowalteration);
            if (guard) return guard;
            let path = `${ADMIN}/Subscriptions(NamespaceID='${a.namespaceId}',ProviderID='${a.providerId}',SubscriptionID='${a.subscriptionId ?? ''}')`;
            const params = new URLSearchParams();
            if (a.deleteChain) params.append('deleteChain', 'true');
            if (a.deleteEntitySetName)
              params.append('deleteEntitySetName', String(a.deleteEntitySetName));
            const qs = params.toString();
            if (qs) path += `?${qs}`;
            await client.sacDelete(path);
            return toolSuccess({ deleted: true });
          }
          case 'admin_metadata': {
            const qs = a.$format ? `?$format=${a.$format}` : '';
            const result = await client.sacGet(`${ADMIN}/$metadata${qs}`);
            return toolSuccess(result);
          }
          case 'get_provider_metadata': {
            const qs = a.$format ? `?$format=${a.$format}` : '';
            const result = await client.sacGet(
              `${PROVIDERS}/${a.namespace}/${a.provider}/$metadata${qs}`,
            );
            return toolSuccess(result);
          }
          case 'get_provider_entities': {
            const result = await client.sacGet(`${PROVIDERS}/${a.namespace}/${a.provider}/`);
            return toolSuccess(result);
          }
          case 'get_fact_data': {
            const odata = {
              $top: a.$top,
              $skip: a.$skip,
              $filter: a.$filter,
              $select: a.$select,
              $orderby: a.$orderby,
              $count: a.$count,
              $format: a.$format,
            } as Record<string, string | number | boolean | undefined>;
            const qs = buildODataQuery(odata);
            const params = new URLSearchParams(qs ? qs.slice(1) : '');
            if (a.deltaid) params.set('deltaid', String(a.deltaid));
            if (a.externalid) params.set('externalid', String(a.externalid));
            if (a.delimiter) params.set('delimiter', String(a.delimiter));
            const queryString = params.toString() ? `?${params.toString()}` : '';
            const extraHeaders: Record<string, string> = {};
            if (a.trackChanges) extraHeaders.Prefer = 'odata.track-changes';
            const result = await client.sacGet(
              `${PROVIDERS}/${a.namespace}/${a.provider}/FactData${queryString}`,
              extraHeaders,
            );
            return toolSuccess(result);
          }
          case 'get_fact_data_aggregation': {
            const odata = {
              $select: a.$select,
              $filter: a.$filter,
              $top: a.$top,
              $skip: a.$skip,
              $orderby: a.$orderby,
              $count: a.$count,
              $format: a.$format,
            } as Record<string, string | number | boolean | undefined>;
            const qs = buildODataQuery(odata);
            const params = new URLSearchParams(qs ? qs.slice(1) : '');
            if (a.deltaid) params.set('deltaid', String(a.deltaid));
            const queryString = params.toString() ? `?${params.toString()}` : '';
            const extraHeaders: Record<string, string> = {};
            if (a.trackChanges) extraHeaders.Prefer = 'odata.track-changes';
            const result = await client.sacGet(
              `${PROVIDERS}/${a.namespace}/${a.provider}/FactDataAggregation${queryString}`,
              extraHeaders,
            );
            return toolSuccess(result);
          }
          case 'get_fact_data_difference': {
            const odata = {
              $filter: a.$filter,
              $select: a.$select,
              $top: a.$top,
              $skip: a.$skip,
              $format: a.$format,
            } as Record<string, string | number | boolean | undefined>;
            const qs = buildODataQuery(odata);
            const params = new URLSearchParams(qs ? qs.slice(1) : '');
            if (a.deltaid) params.set('deltaid', String(a.deltaid));
            const queryString = params.toString() ? `?${params.toString()}` : '';
            const extraHeaders: Record<string, string> = {};
            if (a.trackChanges) extraHeaders.Prefer = 'odata.track-changes';
            const result = await client.sacGet(
              `${PROVIDERS}/${a.namespace}/${a.provider}/FactDataDifference${queryString}`,
              extraHeaders,
            );
            return toolSuccess(result);
          }
          case 'get_master_data': {
            const odata = {
              $top: a.$top,
              $skip: a.$skip,
              $filter: a.$filter,
              $select: a.$select,
              $orderby: a.$orderby,
              $count: a.$count,
              $format: a.$format,
            } as Record<string, string | number | boolean | undefined>;
            const qs = buildODataQuery(odata);
            const result = await client.sacGet(
              `${PROVIDERS}/${a.namespace}/${a.provider}/MasterData${qs}`,
            );
            return toolSuccess(result);
          }
          case 'get_dimension_master': {
            const odata = {
              $top: a.$top,
              $skip: a.$skip,
              $filter: a.$filter,
              $select: a.$select,
              $orderby: a.$orderby,
              $format: a.$format,
            } as Record<string, string | number | boolean | undefined>;
            const qs = buildODataQuery(odata);
            const result = await client.sacGet(
              `${PROVIDERS}/${a.namespace}/${a.provider}/${a.dimension}Master${qs}`,
            );
            return toolSuccess(result);
          }
          case 'get_dimension_master_hierarchy': {
            const odata = {
              $top: a.$top,
              $skip: a.$skip,
              $filter: a.$filter,
              $select: a.$select,
              $orderby: a.$orderby,
              $format: a.$format,
            } as Record<string, string | number | boolean | undefined>;
            const qs = buildODataQuery(odata);
            const result = await client.sacGet(
              `${PROVIDERS}/${a.namespace}/${a.provider}/${a.dimension}MasterWithHierarchy${qs}`,
            );
            return toolSuccess(result);
          }
          case 'get_audit_data': {
            const odata = {
              $top: a.$top,
              $skip: a.$skip,
              $filter: a.$filter,
              $select: a.$select,
              $orderby: a.$orderby,
              $count: a.$count,
              $format: a.$format,
            } as Record<string, string | number | boolean | undefined>;
            const qs = buildODataQuery(odata);
            const result = await client.sacGet(
              `${PROVIDERS}/${a.namespace}/${a.provider}/AuditData${qs}`,
            );
            return toolSuccess(result);
          }
          case 'get_currency_table': {
            const ns = (a.namespace as string | undefined) ?? 'sac_currency_tables';
            const odata = {
              $top: a.$top,
              $skip: a.$skip,
              $filter: a.$filter,
              $select: a.$select,
              $format: a.$format,
            } as Record<string, string | number | boolean | undefined>;
            const qs = buildODataQuery(odata);
            const result = await client.sacGet(
              `${PROVIDERS}/${ns}/${a.provider}/CurrencyTable${qs}`,
            );
            return toolSuccess(result);
          }
          case 'get_conversion_rates': {
            const ns = (a.namespace as string | undefined) ?? 'sac_unit_conversion';
            const odata = {
              $top: a.$top,
              $skip: a.$skip,
              $filter: a.$filter,
              $select: a.$select,
              $format: a.$format,
            } as Record<string, string | number | boolean | undefined>;
            const qs = buildODataQuery(odata);
            const result = await client.sacGet(
              `${PROVIDERS}/${ns}/${a.provider}/ConversionRates${qs}`,
            );
            return toolSuccess(result);
          }
          case 'get_public_dimension_data': {
            const odata = {
              $top: a.$top,
              $skip: a.$skip,
              $filter: a.$filter,
              $select: a.$select,
              $orderby: a.$orderby,
              $format: a.$format,
            } as Record<string, string | number | boolean | undefined>;
            const qs = buildODataQuery(odata);
            const result = await client.sacGet(
              `${PROVIDERS}/sac_public_dimensions/${a.provider}/PublicDimensionData${qs}`,
            );
            return toolSuccess(result);
          }
          case 'get_data': {
            const odata = {
              $top: a.$top,
              $skip: a.$skip,
              $filter: a.$filter,
              $select: a.$select,
              $orderby: a.$orderby,
              $count: a.$count,
              $format: a.$format,
            } as Record<string, string | number | boolean | undefined>;
            const qs = buildODataQuery(odata);
            const params = new URLSearchParams(qs ? qs.slice(1) : '');
            if (a.deltaid) params.set('deltaid', String(a.deltaid));
            if (a.externalid) params.set('externalid', String(a.externalid));
            if (a.delimiter) params.set('delimiter', String(a.delimiter));
            if (a.pagesize) params.set('pagesize', String(a.pagesize));
            const queryString = params.toString() ? `?${params.toString()}` : '';
            const extraHeaders: Record<string, string> = {};
            if (a.trackChanges) extraHeaders.Prefer = 'odata.track-changes';
            const result = await client.sacGet(
              `${PROVIDERS}/${a.namespace}/${a.provider}/${a.entitySet}${queryString}`,
              extraHeaders,
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
