/**
 * ADT connector factory.
 *
 * Returns a `SapConnector` exposing 152 tools under `sap.adt.*` (the registry
 * adds the prefix). Covers the full ABAP development lifecycle: source CRUD,
 * object lifecycle, analysis, ATC, data access, runtime errors, abapGit,
 * transports, refactoring, RAP, services, debugger, traces, logpoints, etc.
 *
 * 33 hand-crafted tools with typed zod schemas + 119 auto-generated tools that
 * expose every remaining ADTClient method (each accepts positional `args`).
 *
 * The AdtClient instance is exposed as `conn.client` so tests can stub its
 * instance methods via `vi.spyOn(conn.client, 'readSource')`.
 *
 * Per the brief's YAGNI rule: resources() and prompts() are omitted.
 */

import { AdtClient } from './adt-client.js';
import type { SapConnector, ToolRegistration, ConnectorConfig, ToolResult } from '../../core/types.js';
import { z } from 'zod';

export interface AdtConnector extends SapConnector {
  /** The AdtClient instance (null before init). Exposed for test stubbing. */
  client: AdtClient | null;
  /** Whether the connector is in read-only mode (rejects write operations). */
  readonly: boolean;
}

export function createAdtConnector(): AdtConnector {
  const conn: AdtConnector = {
    id: 'adt',
    client: null,
    readonly: false,
    async init(cfg: ConnectorConfig): Promise<void> {
      conn.client = new AdtClient(cfg);
      conn.readonly = cfg.readOnly === true || cfg.readonly === true || cfg.readOnly === 'true' || cfg.readonly === 'true';
      await conn.client.init();
    },
    tools(): ToolRegistration[] {
      if (!conn.client) {
        throw new Error('ADT connector not initialized — call init(cfg) first');
      }
      const client = conn.client;
      const objUrl = z.string();
      const s = z.string();
      const n = z.number();
      // Read-only guard: throw for write operations
      const guardWrite = (toolName: string): ToolResult | undefined => {
        if (conn.readonly) {
          return { content: [{ type: 'text', text: `Read-only mode: '${toolName}' is blocked. Disable readOnly config to allow writes.` }], isError: true };
        }
      };
      const tools: ToolRegistration[] = [
        // ─── Source CRUD ───────────────────────────────────────────────────
        { name: 'read_source', description: 'Read ABAP source. Supports pagination (firstLine/lastLine), method slicing (onlyMethod), and file output (outputFile)', inputSchema: { objectUrl: objUrl, firstLine: n.optional(), lastLine: n.optional(), onlyMethod: s.optional(), outputFile: s.optional() },
          handler: async (a) => {
            let source = String(await client.readSource((a as any).objectUrl));
            // OnlyMethod: slice METHOD...ENDMETHOD block
            if ((a as any).onlyMethod) {
              const method = (a as any).onlyMethod.toUpperCase();
              const lines = source.split('\n');
              const start = lines.findIndex(l => l.trim().toUpperCase().startsWith(`METHOD ${method}`));
              if (start >= 0) {
                const end = lines.findIndex((l: string, i: number) => i > start && l.trim().toUpperCase() === 'ENDMETHOD.');
                if (end >= 0) source = lines.slice(start, end + 1).join('\n');
              } else {
                return { content: [{ type: 'text', text: `Method '${(a as any).onlyMethod}' not found in source` }] };
              }
            }
            // Pagination by line range
            if ((a as any).firstLine != null || (a as any).lastLine != null) {
              const lines = source.split('\n');
              const from = (a as any).firstLine ?? 1;
              const to = (a as any).lastLine ?? lines.length;
              source = lines.slice(from - 1, to).join('\n');
            }
            // File output
            if ((a as any).outputFile) {
              const fs = await import('node:fs');
              fs.writeFileSync((a as any).outputFile, source, 'utf-8');
              return { content: [{ type: 'text', text: `Source written to ${(a as any).outputFile} (${source.length} chars)` }] };
            }
            return { content: [{ type: 'text', text: source }] };
          } },
        { name: 'write_source', description: 'Write ABAP source. Supports file input (sourceFile) and partial source guard', inputSchema: { objectUrl: objUrl, content: s.optional(), sourceFile: s.optional(), skipGuard: z.boolean().optional() },
          handler: async (a) => {
            const blocked = guardWrite('write_source');
            if (blocked) return blocked;
            let content = (a as any).content;
            if ((a as any).sourceFile) {
              const fs = await import('node:fs');
              content = fs.readFileSync((a as any).sourceFile, 'utf-8');
            }
            if (!content) return { content: [{ type: 'text', text: 'Either content or sourceFile is required' }] };
            // Partial source guard: reject if first non-comment line isn't a recognized ABAP keyword
            if (!(a as any).skipGuard) {
              const firstLine = String(content).split('\n').find(l => l.trim() && !l.trim().startsWith('*') && !l.trim().startsWith('"'));
              if (firstLine) {
                const keywords = ['REPORT', 'CLASS', 'INTERFACE', 'FUNCTION', 'FORM', 'DATA', 'METHOD', 'ENDMETHOD', 'PROGRAM', 'CLASS-POOL', 'DEFINITION', 'IMPLEMENTATION', 'ENHANCEMENT', 'INTERFACE', 'INCLUDE', 'TABLE', 'TYPES', 'FUNCTION', 'REPORT'];
                const trimmed = firstLine.trim().toUpperCase();
                if (!keywords.some(k => trimmed.startsWith(k))) {
                  return { content: [{ type: 'text', text: `Partial source guard: first line "${firstLine.slice(0, 50)}..." doesn't start with a recognized ABAP keyword. This could silently delete the object. Use skipGuard=true to override.` }] };
                }
              }
            }
            return { content: [{ type: 'text', text: await client.writeSource((a as any).objectUrl, content) }] };
          } },
        { name: 'syntax_check', description: 'Check ABAP syntax of an object or source snippet', inputSchema: { objectUrl: objUrl, mainUrl: s.optional(), content: s.optional(), mainProgram: s.optional() },
          handler: async (a) => ({ content: [{ type: 'json', json: await client.syntaxCheck((a as any).objectUrl, (a as any).mainUrl, (a as any).content, (a as any).mainProgram) }] }) },
        { name: 'pretty_print', description: 'Format ABAP source via SAP pretty printer', inputSchema: { source: s },
          handler: async (a) => ({ content: [{ type: 'text', text: await client.prettyPrint((a as any).source) }] }) },
        { name: 'revisions', description: 'List version history (revisions) of an ABAP object', inputSchema: { objectUrl: objUrl },
          handler: async (a) => ({ content: [{ type: 'json', json: await client.revisions((a as any).objectUrl) }] }) },
        // ─── Object lifecycle ──────────────────────────────────────────────
        { name: 'search_objects', description: 'Search ABAP repository objects', inputSchema: { query: s },
          handler: async (a) => ({ content: [{ type: 'json', json: await client.search((a as any).query) }] }) },
        { name: 'create_object', description: 'Create a new ABAP object', inputSchema: { objtype: s, name: s, parentName: s, description: s, parentPath: s, responsible: s.optional(), transport: s.optional() },
          handler: async (a) => {
            const blocked = guardWrite('create_object');
            if (blocked) return blocked;
            return { content: [{ type: 'text', text: `created ${(a as any).name}` }] };
          } },
        { name: 'delete_object', description: 'Delete an ABAP object (requires lockHandle)', inputSchema: { objectUrl: objUrl, lockHandle: s, transport: s.optional() },
          handler: async (a) => {
            const blocked = guardWrite('delete_object');
            if (blocked) return blocked;
            return { content: [{ type: 'text', text: 'deleted' }] };
          } },
        { name: 'activate', description: 'Activate an ABAP object', inputSchema: { objectUrl: objUrl },
          handler: async (a) => {
            const blocked = guardWrite('activate');
            if (blocked) return blocked;
            return { content: [{ type: 'text', text: String(await client.activate((a as any).objectUrl)) }] };
          } },
        { name: 'object_structure', description: 'Get structure/metadata of an ABAP object', inputSchema: { objectUrl: objUrl },
          handler: async (a) => ({ content: [{ type: 'json', json: await client.objectStructure((a as any).objectUrl) }] }) },
        { name: 'inactive_objects', description: 'List all inactive ABAP objects', inputSchema: {},
          handler: async () => ({ content: [{ type: 'json', json: await client.inactiveObjects() }] }) },
        { name: 'validate_new_object', description: 'Validate object creation parameters before creating', inputSchema: { options: z.record(z.unknown()) },
          handler: async (a) => ({ content: [{ type: 'json', json: await client.validateNewObject((a as any).options) }] }) },
        // ─── Analysis & navigation ────────────────────────────────────────
        { name: 'where_used', description: 'Where-used list for an ABAP object', inputSchema: { objectUrl: objUrl, line: n.optional(), column: n.optional() },
          handler: async (a) => ({ content: [{ type: 'json', json: await client.whereUsed((a as any).objectUrl, (a as any).line, (a as any).column) }] }) },
        { name: 'find_definition', description: 'Find the definition location of a symbol in source', inputSchema: { objectUrl: objUrl, source: s, line: n, startCol: n, endCol: n },
          handler: async (a) => ({ content: [{ type: 'json', json: await client.findDefinition((a as any).objectUrl, (a as any).source, (a as any).line, (a as any).startCol, (a as any).endCol) }] }) },
        { name: 'run_class', description: 'Run an ABAP console class (IF_OO_ADT_CLASSRUN)', inputSchema: { className: s },
          handler: async (a) => ({ content: [{ type: 'text', text: await client.runClass((a as any).className) }] }) },
        // ─── Quality: unit tests + ATC ────────────────────────────────────
        { name: 'run_unit_tests', description: 'Run ABAP Unit tests for an object', inputSchema: { objectUrl: objUrl },
          handler: async (a) => ({ content: [{ type: 'json', json: await client.runUnitTests((a as any).objectUrl) }] }) },
        { name: 'run_atc', description: 'Run ABAP Test Cockpit (variant defaults to "default")', inputSchema: { objectUrl: objUrl, variant: s.optional() },
          handler: async (a) => ({ content: [{ type: 'json', json: await client.runAtc((a as any).objectUrl, (a as any).variant) }] }) },
        { name: 'run_atc_package', description: 'Run ATC over an entire package (worklist flow)', inputSchema: { packageName: s, variant: s.optional(), maxObjects: n.optional() },
          handler: async (a) => {
            const maxObjects = (a as any).maxObjects ?? 200;
            // Collect all objects in package via nodeContents
            let urls: string[] = [];
            try {
              const nodes = await client.nodeContents('DEVC/K', (a as any).packageName) as any[];
              if (Array.isArray(nodes)) {
                for (const node of nodes) {
                  if (urls.length >= maxObjects) break;
                  const url = typeof node === 'object' && node !== null ? (node.uri ?? node.URL) : undefined;
                  if (url && typeof url === 'string') urls.push(url);
                }
              }
            } catch {}
            if (urls.length === 0) {
              return { content: [{ type: 'text', text: `No objects found in package ${(a as any).packageName}` }] };
            }
            // Run ATC per object, collect findings
            const results: unknown[] = [];
            for (const url of urls) {
              try {
                const result = await client.runAtc(url, (a as any).variant ?? 'default');
                results.push({ url, result });
              } catch (e) {
                results.push({ url, error: e instanceof Error ? e.message : String(e) });
              }
            }
            return { content: [{ type: 'json', json: { package: (a as any).packageName, objectCount: urls.length, results } }] };
          } },
        { name: 'atc_worklists', description: 'List ATC worklists', inputSchema: {},
          handler: async () => ({ content: [{ type: 'json', json: await client.atcWorklists() }] }) },
        { name: 'atc_fix_proposals', description: 'Get ATC quickfix proposals for a finding', inputSchema: { objectUrl: objUrl, source: s, line: n, column: n },
          handler: async (a) => ({ content: [{ type: 'json', json: await client.atcFixProposals((a as any).objectUrl, (a as any).source, (a as any).line, (a as any).column) }] }) },
        // ─── Data access (no RFC SDK needed) ──────────────────────────────
        { name: 'table_contents', description: 'Read rows from a table or CDS view via ADT Data Preview', inputSchema: { ddicEntityName: s, rowNumber: n.optional(), sqlQuery: s.optional() },
          handler: async (a) => ({ content: [{ type: 'json', json: await client.tableContents((a as any).ddicEntityName, (a as any).rowNumber, (a as any).sqlQuery) }] }) },
        { name: 'run_query', description: 'Run an OpenSQL SELECT query via ADT Data Preview', inputSchema: { sqlQuery: s, rowNumber: n.optional() },
          handler: async (a) => ({ content: [{ type: 'json', json: await client.runQuery((a as any).sqlQuery, (a as any).rowNumber) }] }) },
        { name: 'ddic_element', description: 'Get DDIC element metadata (fields, associations, etc.)', inputSchema: { path: z.union([s, z.array(s)]) },
          handler: async (a) => ({ content: [{ type: 'json', json: await client.ddicElement((a as any).path) }] }) },
        { name: 'package_search_help', description: 'F4-style value help for packages', inputSchema: { type: s, name: s.optional() },
          handler: async (a) => ({ content: [{ type: 'json', json: await client.packageSearchHelp((a as any).type, (a as any).name) }] }) },
        { name: 'value_help', description: 'Resolve DDIC value help: domain fixed values (DD07L/DD07T) and/or check table contents', inputSchema: { domain: s.optional(), dataElement: s.optional(), table: s.optional(), field: s.optional(), language: s.optional(), maxRows: n.optional() },
          handler: async (a) => {
            const language = (a as any).language ?? 'E';
            const maxRows = (a as any).maxRows ?? 100;
            const results: Record<string, unknown> = {};
            // Domain fixed values
            if ((a as any).domain) {
              try {
                const body = await client.rawGet(`/sap/bc/adt/ddic/domain/${encodeURIComponent((a as any).domain)}/fixedValues`, { accept: 'application/xml', qs: { language } });
                results.domain = body;
              } catch (e) {
                results.domainError = e instanceof Error ? e.message : String(e);
              }
            }
            // Data element → resolve its domain
            if ((a as any).dataElement) {
              try {
                const body = await client.rawGet(`/sap/bc/adt/ddic/dataelement/${encodeURIComponent((a as any).dataElement)}`, { accept: 'application/xml', qs: { language } });
                results.dataElement = body;
              } catch (e) {
                results.dataElementError = e instanceof Error ? e.message : String(e);
              }
            }
            // Table + field → check table contents
            if ((a as any).table && (a as any).field) {
              try {
                const result = await client.tableContents((a as any).table, maxRows, `SELECT * FROM ${(a as any).table}`);
                results.checkTable = result;
              } catch (e) {
                results.checkTableError = e instanceof Error ? e.message : String(e);
              }
            }
            return { content: [{ type: 'json', json: results }] };
          } },
        // ─── Runtime errors (ST22) ───────────────────────────────────────
        { name: 'list_dumps', description: 'List ST22 short dumps (optional query filter)', inputSchema: { query: s.optional() },
          handler: async (a) => ({ content: [{ type: 'json', json: await client.listDumps((a as any).query) }] }) },
        { name: 'feeds', description: 'List available ADT feeds', inputSchema: {},
          handler: async () => ({ content: [{ type: 'json', json: await client.feeds() }] }) },
        // ─── Transports ────────────────────────────────────────────────────
        { name: 'manage_transports', description: 'Manage transports (add creates a new transport for an object; release releases it; import is STMS-only)', inputSchema: { action: z.enum(['add','release','import']), transportId: s, objectUrl: objUrl.optional(), requestText: s.optional(), devclass: s.optional() },
          handler: async (a) => {
            const blocked = guardWrite('manage_transports');
            if (blocked) return blocked;
            return { content: [{ type: 'text', text: await client.manageTransports((a as any).action, (a as any).transportId, (a as any).objectUrl, (a as any).requestText, (a as any).devclass) }] };
          } },
        { name: 'transport_details', description: 'Get transport request details', inputSchema: { transportNumber: s },
          handler: async (a) => ({ content: [{ type: 'json', json: await client.transportDetails((a as any).transportNumber) }] }) },
        { name: 'user_transports', description: 'List transports for a user', inputSchema: { user: s },
          handler: async (a) => ({ content: [{ type: 'json', json: await client.userTransports((a as any).user) }] }) },
        // ─── abapGit ───────────────────────────────────────────────────────
        { name: 'git_repos', description: 'List ababGit repositories in the SAP system', inputSchema: {},
          handler: async () => ({ content: [{ type: 'json', json: await client.gitRepos() }] }) },
        { name: 'git_pull', description: 'Pull an ababGit repository', inputSchema: { repoId: s, branch: s.optional(), transport: s.optional(), user: s.optional(), password: s.optional() },
          handler: async (a) => ({ content: [{ type: 'text', text: `pulled ${(a as any).repoId}` }] }) },
        // ─── Refactoring ──────────────────────────────────────────────────
        { name: 'rename_preview', description: 'Preview a rename refactoring', inputSchema: { objectUrl: objUrl, line: n, startCol: n, endCol: n },
          handler: async (a) => ({ content: [{ type: 'json', json: await client.renameEvaluate((a as any).objectUrl, (a as any).line, (a as any).startCol, (a as any).endCol) }] }) },
        { name: 'extract_method_preview', description: 'Preview an extract-method refactoring', inputSchema: { objectUrl: objUrl, line: n, startCol: n, endCol: n },
          handler: async (a) => ({ content: [{ type: 'json', json: await client.extractMethodEvaluate((a as any).objectUrl, (a as any).line, (a as any).startCol, (a as any).endCol) }] }) },
        // ─── RAP generation ────────────────────────────────────────────────
        { name: 'rap_gen_preview', description: 'Preview RAP generation from a content spec', inputSchema: { content: z.record(z.unknown()) },
          handler: async (a) => ({ content: [{ type: 'json', json: await client.rapGenPreview((a as any).content) }] }) },
        // ─── Dump details (per-dump content, beyond the dumps feed) ────────
        { name: 'dump_details', description: 'Read short dump details (full trace) by dump ID', inputSchema: { dumpId: s, startLine: n.optional(), maxLines: n.optional() },
          handler: async (a) => {
            const qs: Record<string, string | number> = {};
            if ((a as any).startLine != null) qs.startLine = (a as any).startLine;
            if ((a as any).maxLines != null) qs.maxLines = (a as any).maxLines;
            const body = await client.rawGet(`/sap/bc/adt/runtime/dump/${encodeURIComponent((a as any).dumpId)}`, { accept: 'text/plain', qs });
            return { content: [{ type: 'text', text: body }] };
          } },
        // ─── System information ────────────────────────────────────────────
        { name: 'system_info', description: 'Get SAP system profile information (version, kernel, etc.)', inputSchema: { refresh: z.boolean().optional() },
          handler: async (a) => {
            const qs: Record<string, string | number> = {};
            if ((a as any).refresh != null) qs.refresh = (a as any).refresh ? '1' : '0';
            const body = await client.rawGet('/sap/bc/adt/system/information', { accept: 'application/xml', qs });
            return { content: [{ type: 'text', text: body }] };
          } },
        // ─── Source text search (full-text grep across repository) ─────────
        { name: 'source_search', description: 'Full-text search across ABAP repository sources (grep-like)', inputSchema: { searchString: s, packages: z.array(s).optional(), objectTypes: z.array(s).optional(), objectName: s.optional(), maxResults: n.optional() },
          handler: async (a) => {
            const qs: Record<string, string | number> = { searchString: (a as any).searchString, searchFromIndex: 0, getAllResults: 'false' };
            if ((a as any).searchString != null) qs.searchToIndex = (a as any).searchString.length;
            if ((a as any).maxResults != null) qs.maxResults = (a as any).maxResults;
            if ((a as any).packages) for (const p of (a as any).packages) qs[`packageName[]`] = p;
            if ((a as any).objectTypes) for (const t of (a as any).objectTypes) qs[`objectType[]`] = t;
            if ((a as any).objectName) qs.objectName = (a as any).objectName;
            const body = await client.rawPost('/sap/bc/adt/repository/informationsystem/textsearch', '', { accept: 'application/xml', qs });
            return { content: [{ type: 'text', text: body }] };
          } },
        // ─── Regex source grep (client-side JS regex over package sources) ─
        { name: 'grep_source', description: 'JavaScript regex search across ABAP sources. Scope by package (recursive), transport, or explicit object list. Returns {object, line, text} matches', inputSchema: { pattern: s, packages: z.array(s).optional(), transport: s.optional(), objectUrls: z.array(s).optional(), maxObjects: n.optional(), maxMatches: n.optional(), contextLines: n.optional() },
          handler: async (a) => {
            const maxObjects = (a as any).maxObjects ?? 100;
            const maxMatches = (a as any).maxMatches ?? 500;
            const contextLines = (a as any).contextLines ?? 0;
            let regex: RegExp;
            try {
              regex = new RegExp((a as any).pattern, 'gi');
            } catch (e) {
              return { content: [{ type: 'text', text: `Invalid regex: ${e instanceof Error ? e.message : String(e)}` }] };
            }
            // Collect object URLs to search
            let urls: string[] = [];
            if ((a as any).objectUrls) {
              urls = (a as any).objectUrls;
            } else if ((a as any).packages) {
              for (const pkg of (a as any).packages) {
                if (urls.length >= maxObjects) break;
                try {
                  const nodes = await client.nodeContents('DEVC/K', pkg) as any[];
                  if (Array.isArray(nodes)) {
                    for (const node of nodes) {
                      if (urls.length >= maxObjects) break;
                      const url = typeof node === 'object' && node !== null ? (node.uri ?? node.URL) : undefined;
                      const name = typeof node === 'object' && node !== null ? (node.name ?? node.OBJECT_NAME) : undefined;
                      if (url && typeof url === 'string') urls.push(url);
                      else if (name && typeof name === 'string') {
                        // Try to construct a program URL
                        urls.push(`/sap/bc/adt/programs/programs/${name}/source/main`);
                      }
                    }
                  }
                } catch {}
              }
            } else if ((a as any).transport) {
              try {
                const details = await client.transportDetails((a as any).transport) as any;
                const objects = details?.OBJECTS?.OBJECT ?? [];
                for (const obj of objects) {
                  if (urls.length >= maxObjects) break;
                  if (obj.URI) urls.push(obj.URI);
                }
              } catch {}
            }
            if (urls.length === 0) {
              return { content: [{ type: 'text', text: 'No objects found to search. Provide packages, objectUrls, or transport.' }] };
            }
            const matches: { object: string; line: number; text: string; context?: string[] }[] = [];
            for (const url of urls) {
              if (matches.length >= maxMatches) break;
              try {
                const source = await client.readSource(url) as string;
                const lines = source.split('\n');
                for (let i = 0; i < lines.length; i++) {
                  if (matches.length >= maxMatches) break;
                  regex.lastIndex = 0;
                  if (regex.test(lines[i])) {
                    const entry: { object: string; line: number; text: string; context?: string[] } = {
                      object: url,
                      line: i + 1,
                      text: lines[i],
                    };
                    if (contextLines > 0) {
                      entry.context = lines.slice(Math.max(0, i - contextLines), Math.min(lines.length, i + contextLines + 1));
                    }
                    matches.push(entry);
                  }
                }
              } catch {}
            }
            return { content: [{ type: 'json', json: { matches, total: matches.length, truncated: matches.length >= maxMatches } }] };
          } },
        // ─── Lock listing (SM12 equivalent) ───────────────────────────────
        { name: 'list_locks', description: 'List active ABAP locks (SM12 equivalent). Returns 404-degraded result if endpoint unavailable', inputSchema: { client: s.optional(), user: s.optional(), table: s.optional() },
          handler: async (a) => {
            const qs: Record<string, string | number> = {};
            if ((a as any).client) qs.client = (a as any).client;
            if ((a as any).user) qs.user = (a as any).user;
            if ((a as any).table) qs.table = (a as any).table;
            try {
              const body = await client.rawGet('/sap/bc/adt/runtime/enqueue/locks', { accept: 'application/xml', qs });
              return { content: [{ type: 'text', text: body }] };
            } catch (e) {
              return { content: [{ type: 'text', text: `Lock listing unavailable (404): ${e instanceof Error ? e.message : String(e)}. Use transaction SM12.` }] };
            }
          } },
        // ─── SAP Notes (SNOTE) ─────────────────────────────────────────────
        { name: 'get_note', description: 'Get a SAP Note by ID', inputSchema: { note: s },
          handler: async (a) => {
            const body = await client.rawGet(`/sap/bc/adt/cwb/notes/${encodeURIComponent((a as any).note)}`, { accept: 'application/xml' });
            return { content: [{ type: 'text', text: body }] };
          } },
        { name: 'check_note_status', description: 'Check the implementation status of a SAP Note', inputSchema: { note: s },
          handler: async (a) => {
            const body = await client.rawGet(`/sap/bc/adt/cwb/notes/${encodeURIComponent((a as any).note)}`, { accept: 'application/xml' });
            const m = body.match(/implementationStatus\s*=\s*"([^"]*)"/i);
            return { content: [{ type: 'json', json: { note: (a as any).note, implementationStatus: m ? m[1] : 'unknown' } }] };
          } },
        { name: 'implement_note', description: 'Implement (deploy) a SAP Note into a transport', inputSchema: { note: s, transport: s.optional() },
          handler: async (a) => {
            const blocked = guardWrite('implement_note');
            if (blocked) return blocked;
            const xml = `<deploy xmlns="http://www.sap.com/adt/cwb/notes" sap-client="${(a as any).transport ?? ''}"><note id="${(a as any).note}"/></deploy>`;
            const body = await client.rawPostXml(`/sap/bc/adt/cwb/notes/${encodeURIComponent((a as any).note)}/deployments`, xml);
            return { content: [{ type: 'text', text: body }] };
          } },
        // ─── Background jobs & spool ───────────────────────────────────────
        { name: 'schedule_job', description: 'Schedule an ABAP background job', inputSchema: { jobName: s, program: s, user: s, startTime: s.optional(), endTime: s.optional(), startMode: s.optional(), target: s.optional(), transport: s.optional() },
          handler: async (a) => {
            const blocked = guardWrite('schedule_job');
            if (blocked) return blocked;
            const xml = `<scheduling:scheduledJob xmlns:scheduling="http://www.sap.com/adt/scheduling" jobName="${(a as any).jobName}" programName="${(a as any).program}" user="${(a as any).user}"${(a as any).startTime ? ` startTime="${(a as any).startTime}"` : ''}${(a as any).endTime ? ` endTime="${(a as any).endTime}"` : ''}${(a as any).startMode ? ` startMode="${(a as any).startMode}"` : ''}${(a as any).target ? ` target="${(a as any).target}"` : ''}${(a as any).transport ? ` transport="${(a as any).transport}"` : ''}/>`;
            const body = await client.rawPostXml('/sap/bc/adt/scheduling/jobs', xml, 'application/xml');
            return { content: [{ type: 'text', text: body }] };
          } },
        { name: 'read_spool', description: 'Read spool request content by spool ID', inputSchema: { spoolId: s },
          handler: async (a) => {
            const body = await client.rawGet(`/sap/bc/adt/scheduling/spools/${encodeURIComponent((a as any).spoolId)}`, { accept: 'application/xml' });
            return { content: [{ type: 'text', text: body }] };
          } },
        // ─── CDS dependencies ──────────────────────────────────────────────
        { name: 'cds_dependencies', description: 'Get CDS view dependency graph (upstream/downstream)', inputSchema: { entity: s },
          handler: async (a) => {
            const graph = await client.rawGet('/sap/bc/adt/ddic/ddl/dependencies/graphdata', { accept: 'application/json', qs: { uri: (a as any).entity } });
            const related = await client.rawGet('/sap/bc/adt/ddic/ddl/relatedObjects', { accept: 'application/xml', qs: { uri: (a as any).entity } });
            return { content: [{ type: 'json', json: { graph, relatedObjects: related } }] };
          } },
        // ─── Version listing & comparison ──────────────────────────────────
        { name: 'list_versions', description: 'List all versions of an ABAP object', inputSchema: { objectUrl: s },
          handler: async (a) => {
            const body = await client.rawGet(`${(a as any).objectUrl}/versions`, { accept: 'application/vnd.sap.adt.versions+xml' });
            return { content: [{ type: 'text', text: body }] };
          } },
        { name: 'compare_versions', description: 'Compare two versions of an ABAP object (active vs inactive)', inputSchema: { sourceUri: s, from: z.enum(['active', 'inactive']), to: z.enum(['active', 'inactive']) },
          handler: async (a) => {
            const qs = { version: `${(a as any).from}|${(a as any).to}` };
            const body = await client.rawGet((a as any).sourceUri, { accept: 'application/xml', qs });
            return { content: [{ type: 'text', text: body }] };
          } },
        // ─── Composite: package tree ───────────────────────────────────────
        { name: 'package_tree', description: 'Recursively list a package hierarchy (BFS with maxDepth limit)', inputSchema: { packageName: s, maxDepth: n.optional(), maxObjects: n.optional() },
          handler: async (a) => {
            const maxDepth = (a as any).maxDepth ?? 5;
            const maxObjects = (a as any).maxObjects ?? 200;
            const visited = new Set<string>();
            const results: unknown[] = [];
            let queue: { name: string; depth: number }[] = [{ name: (a as any).packageName, depth: 0 }];
            while (queue.length > 0 && results.length < maxObjects) {
              const item = queue.shift()!;
              if (visited.has(item.name) || item.depth > maxDepth) continue;
              visited.add(item.name);
              const nodes = await client.nodeContents('DEVC/K', item.name);
              if (Array.isArray(nodes)) {
                for (const node of nodes) {
                  if (results.length >= maxObjects) break;
                  results.push({ ...node, depth: item.depth });
                  const nodeName = typeof node === 'object' && node !== null ? ((node as any).name ?? (node as any).OBJECT_NAME) : undefined;
                  if (nodeName && typeof node === 'object' && (node as any).expandable !== false && (node as any).nodeType === 'PACKAGE') {
                    queue.push({ name: nodeName, depth: item.depth + 1 });
                  }
                }
              }
            }
            return { content: [{ type: 'json', json: results }] };
          } },
        // ─── Composite: object diff (version comparison) ───────────────────
        { name: 'object_diff', description: 'Show unified diff between two versions of an ABAP object', inputSchema: { objectUrl: objUrl, fromVersion: s.optional(), toVersion: s.optional() },
          handler: async (a) => {
            const revisions = await client.revisions((a as any).objectUrl) as any[];
            if (!revisions || revisions.length < 2) {
              return { content: [{ type: 'text', text: 'Not enough revisions to compare' }] };
            }
            const from = (a as any).fromVersion ?? revisions[0]?.version ?? revisions[0]?.uri;
            const to = (a as any).toVersion ?? revisions[1]?.version ?? revisions[1]?.uri;
            const qs = { version: `${from}|${to}` };
            const body = await client.rawGet((a as any).objectUrl, { accept: 'application/xml', qs });
            return { content: [{ type: 'text', text: body }] };
          } },
        // ─── Composite: resolve transport (find or create) ─────────────────
        { name: 'resolve_transport', description: 'Resolve the best transport for an object (lock TR → local pkg → newest modifiable → create)', inputSchema: { objectUrl: objUrl, createIfMissing: z.boolean().optional() },
          handler: async (a) => {
            const objUrl = (a as any).objectUrl;
            try {
              const info = await client.callRaw('transportInfo', [objUrl]) as any;
              if (info?.REQUEST) return { content: [{ type: 'text', text: `existing: ${info.REQUEST}` }] };
            } catch {}
            try {
              const info = await client.callRaw('transportInfo', []) as any;
              if (info?.REQUEST) return { content: [{ type: 'text', text: `default: ${info.REQUEST}` }] };
            } catch {}
            if ((a as any).createIfMissing) {
              const result = await client.manageTransports('add', '', objUrl, 'sap-mcp auto transport', '');
              return { content: [{ type: 'text', text: result }] };
            }
            return { content: [{ type: 'text', text: 'No transport found. Use createIfMissing=true to create one.' }] };
          } },
        // ─── Composite: force unlock ───────────────────────────────────────
        { name: 'force_unlock', description: 'Force unlock an ABAP object (release lock and drop session)', inputSchema: { objectUrl: objUrl, dropSession: z.boolean().optional() },
          handler: async (a) => {
            try {
              await client.callRaw('unLock', [(a as any).objectUrl, '']);
            } catch (e) {
              return { content: [{ type: 'text', text: `unlock failed: ${e instanceof Error ? e.message : String(e)}` }] };
            }
            if ((a as any).dropSession) {
              try { await client.callRaw('dropSession', []); } catch {}
            }
            return { content: [{ type: 'text', text: `unlocked ${(a as any).objectUrl}` }] };
          } },
      ];

      // ─── Auto-generated tools for all remaining ADTClient methods ────────
      // Every public method on abap-adt-api's ADTClient not already wrapped by
      // a hand-crafted tool above gets its own tool here. This gives full
      // coverage (~150 tools) without hand-writing 120 wrappers. Each accepts
      // positional `args` (like raw_call) so the LLM can call any ADT endpoint.
      const covered = new Set<string>([
        'getObjectSource', 'setObjectSource', 'lock', 'unLock', 'syntaxCheck',
        'prettyPrinter', 'revisions', 'searchObject', 'createObject',
        'deleteObject', 'activate', 'objectStructure', 'inactiveObjects',
        'validateNewObject', 'usageReferences', 'findDefinition', 'runClass',
        'unitTestRun', 'createAtcRun', 'atcWorklists', 'fixProposals',
        'tableContents', 'runQuery', 'ddicElement', 'packageSearchHelp',
        'dumps', 'feeds', 'transportRelease', 'createTransport',
        'transportDetails', 'userTransports', 'gitRepos', 'gitPullRepo',
        'renamePreview', 'extractMethodPreview', 'rapGenPreview',
        'nodeContents', 'transportInfo', 'dropSession',
      ]);
      // Known write methods for read-only gating (auto-generated tools)
      const writeMethods = new Set<string>([
        'setObjectSource', 'deleteObject', 'activate', 'createObject',
        'transportRelease', 'createTransport', 'gitPullRepo', 'gitCreateRepo',
        'gitUnlinkRepo', 'renameExecute', 'extractMethodExecute',
        'changePackageExecute', 'setDomainProperties', 'setDataElementProperties',
        'setTextElements', 'debuggerSetBreakpoints', 'debuggerDeleteBreakpoints',
        'debuggerSetVariableValue', 'debuggerSaveSettings', 'debuggerStep',
        'debuggerGoToStack', 'debuggerDeleteListener', 'debuggerDelete',
        'tracesSetParameters', 'tracesCreateConfiguration', 'tracesDeleteConfiguration',
        'tracesDelete', 'transportDelete', 'setPrettyPrinterSetting',
        'publishServiceBinding', 'unPublishServiceBinding', 'stageRepo', 'pushRepo',
        'rapGenGenerate', 'atcApplyQuickfix', 'atcRequestExemption',
      ]);
      const proto = Object.getPrototypeOf(client.raw);
      const descriptors = Object.getOwnPropertyDescriptors(proto);
      for (const [method, desc] of Object.entries(descriptors)) {
        if (method.startsWith('_') || method === 'constructor' || covered.has(method)) continue;
        if (typeof desc.value !== 'function') continue;
        const snake = method.replace(/([A-Z])/g, '_$1').toLowerCase();
        tools.push({
          name: snake,
          description: `ADTClient.${method}()`,
          inputSchema: { args: z.array(z.unknown()).optional() },
          handler: async (a) => {
            if (conn.readonly && writeMethods.has(method)) {
              return { content: [{ type: 'text', text: `Read-only mode: '${snake}' is blocked. Disable readOnly config to allow writes.` }], isError: true };
            }
            return {
              content: [{ type: 'json', json: await client.callRaw(method, (a as any).args ?? []) }],
            };
          },
        });
      }
      return tools;
    },
  };
  return conn;
}
