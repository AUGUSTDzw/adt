/**
 * RFC metadata manager — port of reference/sap-rfc-mcp-server/sap_rfc_mcp_server/
 * metadata_manager.py + metadata_cache.py.
 *
 * pyrfc.Connection.call -> SapRfcClient.call. The Python ref's on-disk JSON
 * cache (24h TTL, search index, RAG export) is collapsed to an in-memory Map
 * with a 300s TTL per the brief's YAGNI rule — enough to amortise repeated
 * get_function_metadata calls within a session without the I/O surface area.
 *
 * SAP RFC functions used (from the ref):
 *   - RFC_GET_FUNCTION_INTERFACE_US(FUNCNAME, LANGUAGE) -> PARAMS table
 *   - RFC_READ_TABLE(QUERY_TABLE='INFO_FUNCT', FIELDS, OPTIONS, DELIMITER)
 *   - DDIF_FIELDINFO_GET(TABNAME, LANGU) -> DFIES_TAB
 */

import type { SapRfcClient } from './sap-client.js';
import { logger } from '../../core/utils/logger.js';

interface CacheEntry {
  metadata: unknown;
  cachedAt: number;
}

const DEFAULT_TTL_MS = 300_000;

export class MetadataManager {
  private readonly cache = new Map<string, CacheEntry>();
  constructor(
    private client: SapRfcClient,
    private ttlMs: number = DEFAULT_TTL_MS,
    private language: string = 'EN',
  ) {}

  async getMetadata(fn: string, forceRefresh = false): Promise<unknown> {
    if (!forceRefresh) {
      const hit = this.cache.get(fn);
      if (hit && Date.now() - hit.cachedAt < this.ttlMs) return hit.metadata;
    }
    const metadata = await this.retrieve(fn);
    this.cache.set(fn, { metadata, cachedAt: Date.now() });
    return metadata;
  }

  /** Search RFC function modules by name pattern (port of get_rfc_functions). */
  async search(pattern: string, limit = 50): Promise<unknown> {
    const where = pattern.includes('*')
      ? `FUNCNAME LIKE '${pattern.replace(/\*/g, '%')}' AND FMODE = 'R'`
      : `FUNCNAME LIKE '%${pattern}%' AND FMODE = 'R'`;
    const fields = [
      { FIELDNAME: 'FUNCNAME' },
      { FIELDNAME: 'DEVCLASS' },
      { FIELDNAME: 'STEXT' },
    ];
    const result = (await this.client.call('RFC_READ_TABLE', {
      QUERY_TABLE: 'INFO_FUNCT',
      DELIMITER: '|',
      FIELDS: fields,
      OPTIONS: [{ TEXT: where }],
      ROWCOUNT: limit,
    })) as { DATA?: Array<{ WA: string }> };
    const rows: Array<Record<string, string>> = [];
    for (const r of result.DATA ?? []) {
      const v = r.WA.split('|');
      rows.push({
        FUNCNAME: (v[0] ?? '').trim(),
        DEVCLASS: (v[1] ?? '').trim(),
        STEXT: (v[2] ?? '').trim(),
      });
    }
    return rows;
  }

  private async retrieve(fn: string): Promise<unknown> {
    const info = await this.getFunctionInfo(fn);
    const iface = await this.getFunctionInterface(fn);
    const params = (iface as { PARAMS?: unknown[] }).PARAMS ?? [];
    const inputs: Record<string, unknown> = {};
    const outputs: Record<string, unknown> = {};
    const tables: Record<string, unknown> = {};
    for (const p of params as Array<Record<string, unknown>>) {
      const name = String(p.PARAMETER ?? '');
      const cls = String(p.PARAMCLASS ?? '');
      const entry: Record<string, unknown> = {
        type: String(p.EXID ?? 'ANY'),
        length: Number(p.INTLENGTH ?? 0),
        decimals: Number(p.DECIMALS ?? 0),
      };
      if (p.DEFAULT) entry.default = String(p.DEFAULT);
      if (p.PARAMTEXT) entry.description = String(p.PARAMTEXT).trim();
      if (cls === 'I') inputs[name] = entry;
      else if (cls === 'E') outputs[name] = entry;
      else if (cls === 'T') tables[name] = entry;
      else if (cls === 'C') {
        inputs[name] = { ...entry };
        outputs[name] = { ...entry };
      }
    }
    return {
      _metadata: info,
      _language: this.language,
      inputs,
      outputs,
      tables,
      _schemaVersion: '2.0',
    };
  }

  private async getFunctionInfo(fn: string): Promise<unknown> {
    try {
      const result = (await this.client.call('RFC_READ_TABLE', {
        QUERY_TABLE: 'INFO_FUNCT',
        DELIMITER: '|',
        FIELDS: [
          { FIELDNAME: 'STEXT' },
          { FIELDNAME: 'AREA' },
          { FIELDNAME: 'APPL' },
          { FIELDNAME: 'DEVCLASS' },
          { FIELDNAME: 'FREEDATE' },
        ],
        OPTIONS: [{ TEXT: `FUNCNAME = '${fn}' AND ACTIVE = 'X' AND FMODE = 'R'` }],
      })) as { DATA?: Array<{ WA: string }> };
      if (!result.DATA?.length) throw new Error(`Function ${fn} not found in INFO_FUNCT`);
      const v = result.DATA[0].WA.split('|');
      return {
        function_name: fn,
        description: (v[0] ?? '').trim(),
        area: (v[1] ?? '').trim(),
        application: (v[2] ?? '').trim(),
        dev_class: (v[3] ?? '').trim(),
        release_date: (v[4] ?? '').trim(),
      };
    } catch (e) {
      logger.warn({ err: String(e), fn }, 'RFC getFunctionInfo failed');
      throw e;
    }
  }

  private async getFunctionInterface(fn: string): Promise<unknown> {
    try {
      return await this.client.call('RFC_GET_FUNCTION_INTERFACE_US', {
        FUNCNAME: fn,
        LANGUAGE: this.language,
      });
    } catch (e) {
      if (this.language !== 'EN') {
        logger.warn({ err: String(e), fn, lang: this.language }, 'interface fetch failed, retrying EN');
        return await this.client.call('RFC_GET_FUNCTION_INTERFACE_US', {
          FUNCNAME: fn,
          LANGUAGE: 'EN',
        });
      }
      throw e;
    }
  }
}
