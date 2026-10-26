/**
 * RFC table reader — port of reference/sap-rfc-mcp-server/sap_rfc_mcp_server/
 * rfc_table_reader.py.
 *
 * Enhanced RFC_READ_TABLE with automatic field selection to avoid the
 * DATA_BUFFER_EXCEEDED error. Preserves the ref's behaviour:
 *   - DDIF_FIELDINFO_GET(TABNAME, LANGU) -> DFIES_TAB for structure discovery
 *   - RFC_READ_TABLE(QUERY_TABLE, DELIMITER, ROWCOUNT, FIELDS, OPTIONS)
 *   - field-selection fits requested fields within a 512-char buffer (key fields
 *     first, then shortest) so wide tables don't overflow the WA line
 *   - DATA_BUFFER_EXCEEDED triggers a retry with a minimal key-field set
 */

import type { SapRfcClient } from './sap-client.js';
import { logger } from '../../core/utils/logger.js';

const MAX_BUFFER_SIZE = 512;
const SAFETY_MARGIN = 50;

interface FieldInfo {
  name: string;
  type: string;
  length: number;
  decimals: number;
  description: string;
  key: boolean;
}
interface StructureInfo {
  tableName: string;
  fields: Record<string, FieldInfo>;
  structureAvailable: boolean;
  error?: string;
}

export interface ReadTableOptions {
  fields?: string[];
  where?: string;
  maxRows?: number;
  delimiter?: string;
}
export interface ReadTableResult {
  rows: Array<Record<string, string>>;
  columns: string[];
}

export class TableReader {
  constructor(private client: SapRfcClient) {}

  async read(table: string, opts: ReadTableOptions = {}): Promise<ReadTableResult> {
    const maxRows = opts.maxRows ?? 100;
    const delimiter = opts.delimiter ?? '|';
    const structure = await this.getStructure(table);
    const [selected] = this.calculateFieldSelection(structure, opts.fields);
    return this.readSafe(table, selected, opts.where, maxRows, delimiter, structure);
  }

  private async getStructure(table: string): Promise<StructureInfo> {
    try {
      const result = (await this.client.call('DDIF_FIELDINFO_GET', {
        TABNAME: table,
        LANGU: 'E',
      })) as { DFIES_TAB?: Array<Record<string, string>> };
      const fields: Record<string, FieldInfo> = {};
      for (const f of result.DFIES_TAB ?? []) {
        const name = String(f.FIELDNAME ?? '');
        if (!name) continue;
        fields[name] = {
          name,
          type: String(f.DATATYPE ?? ''),
          length: Number(f.LENG ?? 20),
          decimals: Number(f.DECIMALS ?? 0),
          description: String(f.FIELDTEXT ?? ''),
          key: f.KEYFLAG === 'X',
        };
      }
      return { tableName: table, fields, structureAvailable: Object.keys(fields).length > 0 };
    } catch (e) {
      logger.warn({ err: String(e), table }, 'table structure lookup failed');
      return { tableName: table, fields: {}, structureAvailable: false, error: String(e) };
    }
  }

  private calculateFieldSelection(
    structure: StructureInfo,
    requested?: string[],
  ): [string[], number] {
    if (!structure.structureAvailable) return [['MANDT'], 50];
    const available = structure.fields;
    if (requested && requested.length) {
      const selected: string[] = [];
      let total = 0;
      for (const name of requested) {
        const f = available[name];
        if (!f) {
          logger.warn({ field: name }, 'requested field not found in table structure');
          continue;
        }
        if (total + f.length <= MAX_BUFFER_SIZE) {
          selected.push(name);
          total += f.length;
        } else {
          logger.warn({ field: name, len: f.length }, 'field would exceed buffer limit');
          break;
        }
      }
      return [selected, total];
    }
    const sorted = Object.values(available).sort(
      (a, b) => Number(a.key !== b.key) || a.length - b.length || a.name.localeCompare(b.name),
    );
    const selected: string[] = [];
    let total = 0;
    for (const f of sorted) {
      if (total + f.length <= MAX_BUFFER_SIZE - SAFETY_MARGIN) {
        selected.push(f.name);
        total += f.length;
      } else {
        break;
      }
    }
    if (!selected.length && sorted.length) {
      selected.push(sorted[0].name);
      total = sorted[0].length;
    }
    return [selected, total];
  }

  private async readSafe(
    table: string,
    fields: string[],
    where: string | undefined,
    maxRows: number,
    delimiter: string,
    structure: StructureInfo,
  ): Promise<ReadTableResult> {
    const params: Record<string, unknown> = {
      QUERY_TABLE: table,
      DELIMITER: delimiter,
      ROWCOUNT: maxRows,
      FIELDS: fields.map((f) => ({ FIELDNAME: f })),
    };
    if (where) params.OPTIONS = [{ TEXT: where }];
    try {
      const result = (await this.client.call('RFC_READ_TABLE', params)) as {
        DATA?: Array<{ WA: string }>;
      };
      const rows: Array<Record<string, string>> = [];
      for (const r of result.DATA ?? []) {
        const line = r.WA ?? '';
        if (delimiter && line.includes(delimiter)) {
          const vals = line.split(delimiter);
          const row: Record<string, string> = {};
          vals.forEach((v, i) => {
            if (i < fields.length) row[fields[i]] = v.trim();
          });
          rows.push(row);
        } else if (fields.length === 1) {
          rows.push({ [fields[0]]: line.trim() });
        } else {
          rows.push({ raw: line });
        }
      }
      return { rows, columns: fields };
    } catch (e) {
      const msg = String(e);
      if (msg.includes('DATA_BUFFER_EXCEEDED') && structure.structureAvailable) {
        logger.warn({ table }, 'buffer exceeded, retrying with minimal key fields');
        const keys = Object.values(structure.fields)
          .filter((f) => f.key)
          .slice(0, 2)
          .map((f) => f.name);
        const minimal = keys.length ? keys : [Object.keys(structure.fields)[0]];
        return this.readSafe(table, minimal, where, maxRows, delimiter, structure);
      }
      throw e;
    }
  }
}
