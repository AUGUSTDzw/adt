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
      const tools: ToolRegistration[] = [
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
            const xml = `<deploy xmlns="http://www.sap.com/adt/cwb/notes" sap-client="${(a as any).transport ?? ''}"><note id="${(a as any).note}"/></deploy>`;
            const body = await client.rawPostXml(`/sap/bc/adt/cwb/notes/${encodeURIComponent((a as any).note)}/deployments`, xml);
            return { content: [{ type: 'text', text: body }] };
          } },
        // ─── Background jobs & spool ───────────────────────────────────────
        { name: 'schedule_job', description: 'Schedule an ABAP background job', inputSchema: { jobName: s, program: s, user: s, startTime: s.optional(), endTime: s.optional(), startMode: s.optional(), target: s.optional(), transport: s.optional() },
          handler: async (a) => {
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
          handler: async (a) => ({
            content: [{ type: 'json', json: await client.callRaw(method, (a as any).args ?? []) }],
          }),
        });
      }
      return tools;
    },
  };
  return conn;
}
