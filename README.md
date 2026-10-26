# sap-mcp-unified

English | [简体中文](./README.zh-CN.md)

A single [Model Context Protocol](https://modelcontextprotocol.io/) server that
exposes SAP systems to LLM clients. Three connectors share one process and one
MCP transport, with every tool namespaced as `sap.<connector>.<tool>`:

| Connector | Namespace   | Capabilities                                                  |
| --------- | ----------- | ------------------------------------------------------------- |
| RFC       | `sap.rfc.*` | Call BAPIs/function modules, read tables, inspect metadata   |
| SAC       | `sap.sac.*` | SAP Analytics Cloud stories, models, data export/import, etc. |
| ADT       | `sap.adt.*` | ABAP source, object lifecycle, ATC, data access, dumps, abapGit, transports, refactoring, RAP, raw_call |

## Prerequisites

- **Node.js >= 20**
- For the **RFC connector only**: the [SAP NetWeaver RFC SDK](https://support.sap.com/en/product/connectors/nw-rfc-sdk.html) must be installed and the `node-rfc` native module built against it. `node-rfc` is listed in `optionalDependencies` — `npm install` fetches it but the native build is skipped on machines without the SDK (npm treats the failed optional build as non-fatal, so the install never hangs). On a machine with the SAP NWRFC SDK installed and the build approved (`npm install-scripts approve node-rfc`), the RFC connector becomes available automatically. Without it, the RFC connector is **gracefully skipped** at startup (logged as a warning); SAC and ADT keep working. See `src/connectors/rfc/sap-client.ts` for the dynamic-import guard.

## Install

```bash
npm install
```

## Configure

Copy `.env.example` to `.env` and fill in the credentials for the connectors you
want to enable:

```bash
cp .env.example .env
```

Key variables:

- `SAP_ENABLED_CONNECTORS` — comma-separated subset of `rfc,sac,adt` (empty = no connectors, server still starts).
- `SAP_TRANSPORT` — `stdio` (default) or `http`.
- `SAP_HTTP_PORT`, `SAP_HTTP_AUTH_TOKEN` — HTTP transport options (bearer token is optional; if set, clients must send `Authorization: Bearer <token>`).
- `SAP_<ID>_*` — per-connector settings (e.g. `SAP_RFC_ASHOST`, `SAP_SAC_URL`, `SAP_ADT_BASEURL`).

## Run

```bash
# stdio (default — for MCP clients that spawn the server)
npm run dev

# HTTP transport
SAP_TRANSPORT=http SAP_HTTP_PORT=8080 npm run dev
```

Build for production:

```bash
npm run build
npm start
```

## Tool inventory

All tools are registered under the `sap.<id>.<name>` namespace by the registry. A
connector that fails to initialise (e.g. RFC without the NWRFC SDK, or SAC with a
bad token) is **skipped** — it never blocks the other connectors.

### RFC — `sap.rfc.*`

Requires the SAP NWRFC SDK + `node-rfc` native module (see Prerequisites).
Ported from the Python `sap-rfc-mcp-server` reference.

| Tool              | Parameters                                                        | Description                                  |
| ------------------ | ----------------------------------------------------------------- | -------------------------------------------- |
| `call_function`   | `function`, `imports?`, `tables?`                                | Call an SAP RFC function module / BAPI       |
| `read_table`      | `table`, `fields?`, `where?`, `maxRows?`                          | Read rows from an SAP table (RFC_READ_TABLE) |
| `get_function_metadata` | `function`                                                  | Parameter metadata for an RFC function module |
| `search_functions` | `pattern`                                                        | Search RFC function modules by name pattern   |

### SAC — `sap.sac.*`

SAP Analytics Cloud. Each tool dispatches on an `operation` field (except
`smart_query`, which takes direct query params). List operations accept standard
OData params (`$top`, `$skip`, `$filter`, `$orderby`, `$select`, `$expand`,
`$count`); mutating operations require `allowalteration: true` as a safety guard.

- **`calendar`** (3 ops) — `get_event`, `update_event`, `copy_event`
- **`content`** (10 ops) — `stories_list`, `stories_copy`, `stories_rename`, `stories_delete`, `metadata_get`, `resources_list`, `resources_get`, `filerepository_list`, `repositories_list`, `widget_get_data`
- **`content-transport`** (7 ops) — `create_export_job`, `get_job_status`, `create_import_job`, `delete_content`, `get_content_item`, `get_permissions`, `move_item`
- **`data-export`** (22 ops) — `list_namespaces`, `get_namespace`, `list_providers`, `list_subscriptions`, `get_subscription`, `list_provider_subscriptions`, `create_subscription`, `delete_subscription`, `admin_metadata`, `get_provider_metadata`, `get_provider_entities`, `get_fact_data`, `get_fact_data_aggregation`, `get_fact_data_difference`, `get_master_data`, `get_dimension_master`, `get_dimension_master_hierarchy`, `get_audit_data`, `get_currency_table`, `get_conversion_rates`, `get_public_dimension_data`, `get_data`
- **`data-import`** (19 ops) — `list_models`, `get_model`, `get_model_metadata`, `create_job`, `list_jobs`, `upload_data`, `validate_job`, `run_job`, `get_job_status`, `get_invalid_rows`, `delete_job`, `oneclick`, `list_public_dimensions`, `get_public_dimension`, `get_public_dimension_metadata`, `create_public_dimension_job`, `list_currency_conversions`, `get_currency_conversion`, `get_currency_conversion_metadata`
- **`monitoring`** (2 ops) — `audit_export`, `monitoring_get`
- **`multi-actions`** (2 ops) — `execute`, `get_status`
- **`schedule-publication`** (4 ops) — `get_template`, `create`, `update`, `delete`
- **`smart-query`** — direct params (`modelId`, `viewId`, `query`, `execute`, …); no `operation` dispatch
- **`translation`** (4 ops) — `list_artifacts`, `get_artifact`, `download_xliff`, `download_xliff_bulk`
- **`user-management`** (10 ops) — `users_list`, `users_get`, `users_create`, `users_update`, `users_patch`, `users_delete`, `teams_list`, `teams_create`, `teams_patch`, `users_bulk`

### ADT — `sap.adt.*`

ABAP Development Tools, wrapping `abap-adt-api` v8.5.0. Basic auth (user/pass)
and XSUAA (client_credentials bearer) are both supported. 34 tools covering the
full development lifecycle, plus a `raw_call` escape hatch for the remaining
~120 ADTClient methods (debugger, traces, logpoints, etc.).

| Tool                   | Parameters                                                                | Description                                                                          |
| ---------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `read_source`          | `objectUrl`                                                              | Read ABAP source for an object                                                       |
| `write_source`         | `objectUrl`, `content`                                                   | Write ABAP source (acquires/releases a lock)                                         |
| `syntax_check`         | `objectUrl`, `mainUrl?`, `content?`, `mainProgram?`                      | Check ABAP syntax                                                                    |
| `pretty_print`         | `source`                                                                 | Format ABAP source via SAP pretty printer                                            |
| `revisions`            | `objectUrl`                                                              | List version history of an object                                                    |
| `search_objects`       | `query`                                                                 | Search ABAP repository objects                                                       |
| `create_object`        | `objtype`, `name`, `parentName`, `description`, `parentPath`, `responsible?`, `transport?` | Create a new ABAP object                                                 |
| `delete_object`        | `objectUrl`, `lockHandle`, `transport?`                                 | Delete an ABAP object                                                                |
| `activate`             | `objectUrl`                                                              | Activate an ABAP object                                                              |
| `object_structure`     | `objectUrl`                                                              | Get structure/metadata of an object                                                  |
| `inactive_objects`     | —                                                                       | List all inactive objects                                                            |
| `validate_new_object`  | `options`                                                               | Validate object creation parameters                                                   |
| `where_used`           | `objectUrl`, `line?`, `column?`                                         | Where-used list for an object                                                        |
| `find_definition`      | `objectUrl`, `source`, `line`, `startCol`, `endCol`                     | Find definition location of a symbol                                                  |
| `run_class`            | `className`                                                             | Run an ABAP console class (IF_OO_ADT_CLASSRUN)                                        |
| `run_unit_tests`       | `objectUrl`                                                              | Run ABAP Unit tests                                                                  |
| `run_atc`              | `objectUrl`, `variant?`                                                  | Run ABAP Test Cockpit (`variant` defaults to `default`)                             |
| `atc_worklists`        | —                                                                       | List ATC worklists                                                                   |
| `atc_fix_proposals`    | `objectUrl`, `source`, `line`, `column`                                 | Get ATC quickfix proposals                                                           |
| `table_contents`       | `ddicEntityName`, `rowNumber?`, `sqlQuery?`                              | Read table/CDS data via ADT Data Preview (no RFC SDK)                                |
| `run_query`            | `sqlQuery`, `rowNumber?`                                                | Run OpenSQL SELECT via ADT Data Preview                                              |
| `ddic_element`         | `path` (string or string[])                                             | Get DDIC element metadata                                                             |
| `package_search_help`  | `type`, `name?`                                                          | F4-style value help for packages                                                     |
| `list_dumps`           | `query?`                                                                | List ST22 short dumps                                                                |
| `feeds`                | —                                                                       | List available ADT feeds                                                             |
| `manage_transports`    | `action` (`add`/`release`/`import`), `transportId`, `objectUrl?`, `requestText?`, `devclass?` | `add` creates a transport; `release` releases it; `import` is STMS-only |
| `transport_details`    | `transportNumber`                                                       | Get transport request details                                                        |
| `user_transports`      | `user`                                                                  | List transports for a user                                                           |
| `git_repos`            | —                                                                       | List abapGit repositories                                                            |
| `git_pull`             | `repoId`, `branch?`, `transport?`, `user?`, `password?`                 | Pull an abapGit repository                                                           |
| `rename_preview`       | `objectUrl`, `line`, `startCol`, `endCol`                               | Preview a rename refactoring                                                         |
| `extract_method_preview` | `objectUrl`, `line`, `startCol`, `endCol`                            | Preview an extract-method refactoring                                                |
| `rap_gen_preview`      | `content`                                                               | Preview RAP generation from a spec                                                   |
| `raw_call`             | `method`, `args?`                                                       | Escape hatch — call any ADTClient method (debugger, traces, logpoints, etc.)         |

## Adding a connector

1. Implement the `SapConnector` interface from `src/core/types.ts` (`id`, `init`, `tools`, optional `resources`/`prompts`/`shutdown`).
2. Create a factory `create<My>Connector()` under `src/connectors/<id>/index.ts`.
3. Register it in `src/index.ts` (gated on `config.enabled`).
4. Add its `SAP_<ID>_*` env vars to `.env.example`.

The registry takes care of namespacing (`sap.<id>.<tool>`), failure-skipping, and wiring tools/resources/prompts into the MCP server.

## Architecture

```
src/
  index.ts                 # entrypoint: loadConfig -> Registry -> startServer
  core/
    types.ts              # SapConnector, ToolRegistration, ToolResult, ...
    config.ts             # loadConfig(): env -> AppConfig (grouped per connector)
    registry.ts           # Registry: namespacing, initAll (failure-skipping)
    server.ts             # buildMcpServer + startServer (stdio | http)
    utils/
      logger.ts           # pino logger
      sensitive-redact.ts # redact() applied to every tool result
  connectors/
    rfc/                  # SAP RFC (node-rfc, ported from Python ref)
    sac/                  # SAP Analytics Cloud (OData REST)
    adt/                  # ABAP Development Tools (abap-adt-api)
  types/
    node-rfc.d.ts         # ambient shim (typecheck without the native module)
```

See the design spec and implementation plan under `docs/superpowers/`, and the
reference-repo analysis at `reference/ANALYSIS.md`.

## License

MIT
