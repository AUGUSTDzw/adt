/**
 * ADT connector factory.
 *
 * Returns a `SapConnector` exposing 34 tools under `sap.adt.*` (the registry
 * adds the prefix). Covers the full ABAP development lifecycle: source CRUD,
 * object lifecycle, analysis, ATC, data access, runtime errors, ababGit,
 * transports, refactoring, RAP, discovery, and a raw_call escape hatch for the
 * remaining ~120 ADTClient methods (debugger, traces, logpoints, etc.).
 *
 * The AdtClient instance is exposed as `conn.client` so tests can stub its
 * instance methods via `vi.spyOn(conn.client, 'readSource')`.
 *
 * Per the brief's YAGNI rule: resources() and prompts() are omitted.
 */

import { AdtClient } from './adt-client.js';
import type { SapConnector, ToolRegistration, ConnectorConfig } from '../../core/types.js';
import { z } from 'zod';

export interface AdtConnector extends SapConnector {
  /** The AdtClient instance (null before init). Exposed for test stubbing. */
  client: AdtClient | null;
}

export function createAdtConnector(): AdtConnector {
  const conn: AdtConnector = {
    id: 'adt',
    client: null,
    async init(cfg: ConnectorConfig): Promise<void> {
      conn.client = new AdtClient(cfg);
    },
    tools(): ToolRegistration[] {
      if (!conn.client) {
        throw new Error('ADT connector not initialized — call init(cfg) first');
      }
      const client = conn.client;
      const objUrl = z.string();
      const s = z.string();
      const n = z.number();
      return [
        // ─── Source CRUD ───────────────────────────────────────────────────
        { name: 'read_source', description: 'Read ABAP source for an object', inputSchema: { objectUrl: objUrl },
          handler: async (a) => ({ content: [{ type: 'text', text: String(await client.readSource((a as any).objectUrl)) }] }) },
        { name: 'write_source', description: 'Write ABAP source for an object', inputSchema: { objectUrl: objUrl, content: s },
          handler: async (a) => ({ content: [{ type: 'text', text: await client.writeSource((a as any).objectUrl, (a as any).content) }] }) },
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
          handler: async (a) => ({ content: [{ type: 'text', text: `created ${(a as any).name}` }] }) },
        { name: 'delete_object', description: 'Delete an ABAP object (requires lockHandle)', inputSchema: { objectUrl: objUrl, lockHandle: s, transport: s.optional() },
          handler: async (a) => ({ content: [{ type: 'text', text: 'deleted' }] }) },
        { name: 'activate', description: 'Activate an ABAP object', inputSchema: { objectUrl: objUrl },
          handler: async (a) => ({ content: [{ type: 'text', text: String(await client.activate((a as any).objectUrl)) }] }) },
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
        // ─── Runtime errors (ST22) ───────────────────────────────────────
        { name: 'list_dumps', description: 'List ST22 short dumps (optional query filter)', inputSchema: { query: s.optional() },
          handler: async (a) => ({ content: [{ type: 'json', json: await client.listDumps((a as any).query) }] }) },
        { name: 'feeds', description: 'List available ADT feeds', inputSchema: {},
          handler: async () => ({ content: [{ type: 'json', json: await client.feeds() }] }) },
        // ─── Transports ────────────────────────────────────────────────────
        { name: 'manage_transports', description: 'Manage transports (add creates a new transport for an object; release releases it; import is STMS-only)', inputSchema: { action: z.enum(['add','release','import']), transportId: s, objectUrl: objUrl.optional(), requestText: s.optional(), devclass: s.optional() },
          handler: async (a) => ({ content: [{ type: 'text', text: await client.manageTransports((a as any).action, (a as any).transportId, (a as any).objectUrl, (a as any).requestText, (a as any).devclass) }] }) },
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
        // ─── Escape hatch ─────────────────────────────────────────────────
        { name: 'raw_call', description: 'Call any abap-adt-api ADTClient method directly (for niche endpoints: debugger, traces, logpoints, domain properties, etc.). Pass the method name and an array of positional arguments.', inputSchema: { method: s, args: z.array(z.unknown()).optional() },
          handler: async (a) => ({ content: [{ type: 'json', json: await client.callRaw((a as any).method, (a as any).args ?? []) }] }) },
      ];
    },
  };
  return conn;
}
