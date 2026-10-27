# sap-mcp-unified

English | [简体中文](./README.zh-CN.md)

A single [Model Context Protocol](https://modelcontextprotocol.io/) server that
exposes SAP systems to LLM clients. Four connectors share one process and one
MCP transport, with every tool namespaced as `sap.<connector>.<tool>`:

| Connector | Namespace   | Capabilities                                                  |
| --------- | ----------- | ------------------------------------------------------------- |
| RFC       | `sap.rfc.*` | Call BAPIs/function modules, read tables, inspect metadata   |
| SAC       | `sap.sac.*` | SAP Analytics Cloud stories, models, data export/import, etc. |
| ADT       | `sap.adt.*` | 168 tools: source, objects, ATC, data, dumps, abapGit, debugger, traces, transports, refactoring, RAP, services, SAP Notes, jobs, CDS, versions, locks |
| GUI       | `sap.gui.*` | Attach to running SAP GUI sessions (免密 SSO), read/write screen elements, popups, screenshots |

## Prerequisites

- **Node.js >= 20**
- For the **RFC connector only**: the [SAP NetWeaver RFC SDK](https://support.sap.com/en/product/connectors/nw-rfc-sdk.html) must be installed and the `node-rfc` native module built against it. `node-rfc` is listed in `optionalDependencies` — `npm install` fetches it but the native build is skipped on machines without the SDK (npm treats the failed optional build as non-fatal, so the install never hangs). On a machine with the SAP NWRFC SDK installed and the build approved (`npm install-scripts approve node-rfc`), the RFC connector becomes available automatically. Without it, the RFC connector is **gracefully skipped** at startup (logged as a warning); SAC and ADT keep working. See `src/connectors/rfc/sap-client.ts` for the dynamic-import guard.
- For the **GUI connector only**: Windows and a running SAP GUI session. `winax` is listed in `optionalDependencies` (Windows-only native module; on other platforms `npm install` skips it). When `winax` is absent or fails to build (no build tools), the connector falls back to a **PowerShell COM bridge** — a long-lived `pwsh -STA` process that performs COM automation over JSON-RPC, so the GUI connector still works without any native compilation. `kerberos` (SPNEGO) uses a prebuilt N-API binary and likewise needs no build tools.

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

- `SAP_ENABLED_CONNECTORS` — comma-separated subset of `rfc,sac,adt,gui` (empty = no connectors, server still starts).
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

## CLI Tools (opencode, etc.)

When a CLI tool spawns this MCP server, SSO login works the same way. Configure
the environment variables when starting the server:

### Option 1: Pre-provided token (recommended for automation)

```bash
# 1. Obtain a token once using mcp-auth CLI
npm install -g @mcp-abap-adt/auth-broker-cli
mcp-auth --service-key ./service-key.json --output ./mcp.env --type abap

# 2. CLI tool starts the server with the token
export SAP_ENABLED_CONNECTORS=adt
export SAP_ADT_BASEURL=https://<your-abap-system>
export SAP_ADT_AUTHMODE=jwt
export SAP_ADT_TOKEN=$(grep SAP_JWT_TOKEN mcp.env | cut -d= -f2)
npm start
```

### Option 2: Browser login (interactive SSO)

```bash
# CLI tool starts the server with OAuth2 config
export SAP_ENABLED_CONNECTORS=adt
export SAP_ADT_BASEURL=https://<your-abap-system>
export SAP_ADT_AUTHMODE=jwt
export SAP_ADT_UAA_URL=https://<your-uaa-url>
export SAP_ADT_UAA_CLIENT_ID=<client-id>
export SAP_ADT_UAA_CLIENT_SECRET=<client-secret>
npm start
```

**Flow:** Server starts → detects no token → opens browser for SAP login → receives
authorization code via localhost:61001 callback → exchanges for JWT → authenticates.

### opencode configuration example

```json
{
  "mcpServers": {
    "sap": {
      "command": "npm",
      "args": ["start"],
      "env": {
        "SAP_ENABLED_CONNECTORS": "adt",
        "SAP_ADT_BASEURL": "https://<your-abap-system>",
        "SAP_ADT_AUTHMODE": "jwt",
        "SAP_ADT_UAA_URL": "https://<uaa-url>",
        "SAP_ADT_UAA_CLIENT_ID": "<client-id>",
        "SAP_ADT_UAA_CLIENT_SECRET": "<client-secret>"
      }
    }
  }
}
```

Or with pre-provided token:

```json
{
  "mcpServers": {
    "sap": {
      "command": "npm",
      "args": ["start"],
      "env": {
        "SAP_ENABLED_CONNECTORS": "adt",
        "SAP_ADT_BASEURL": "https://<your-abap-system>",
        "SAP_ADT_AUTHMODE": "jwt",
        "SAP_ADT_TOKEN": "<your-jwt-token>"
      }
    }
  }
}
```

**Configuration reference:**

| Environment variable | Description | Required |
|---------------------|-------------|----------|
| `SAP_ADT_AUTHMODE` | `jwt` enables SSO | Yes |
| `SAP_ADT_TOKEN` | Pre-provided JWT token | Option 1 |
| `SAP_ADT_UAA_URL` | UAA server URL | Option 2 |
| `SAP_ADT_UAA_CLIENT_ID` | OAuth2 client ID | Option 2 |
| `SAP_ADT_UAA_CLIENT_SECRET` | OAuth2 client secret | Option 2 |
| `SAP_ADT_AUTH_BROKER_PORT` | Callback port (default: 61001) | Optional |

---

## Tool inventory

All tools are registered under the `sap.<id>.<name>` namespace by the registry. A
connector that fails to initialise (e.g. RFC without the NWRFC SDK, or SAC with a
bad token) is **skipped** — it never blocks the other connectors.

### RFC — `sap.rfc.*`

Requires the SAP NWRFC SDK + `node-rfc` native module (see Prerequisites).
Ported from the Python `sap-rfc-mcp-server` reference.

**SNC (Secure Network Communications):** set `SAP_RFC_SNC_MODE=1` with
`SAP_RFC_SNC_PARTNER_NAME` (e.g. `p:CN=SID;O=org,C=country`) for passwordless
SSO over TLS. `USER`/`PASSWD` may be omitted — SNC authenticates the principal.
Optional: `SAP_RFC_SNC_QOP`, `SAP_RFC_SNC_MYNAME`, `SAP_RFC_SNC_LIB`.

| Tool              | Parameters                                                        | Description                                  |
| ------------------ | ----------------------------------------------------------------- | -------------------------------------------- |
| `call_function`   | `function`, `imports?`, `tables?`                                | Call an SAP RFC function module / BAPI       |
| `read_table`      | `table`, `fields?`, `where?`, `maxRows?`                          | Read rows from an SAP table (RFC_READ_TABLE) |
| `read_table_complete` | `table`, `fields?`, `where?`, `maxRows?`                      | Iterative multi-call reader for wide tables  |
| `get_function_metadata` | `function`                                                  | Parameter metadata for an RFC function module |
| `get_table_structure` | `table`, `language?`                                          | Get table structure via DDIF_FIELDINFO_GET   |
| `search_functions` | `pattern`                                                        | Search RFC function modules by name pattern   |
| `rfc_system_info`  | —                                                                | Get SAP system info (RFC_SYSTEM_INFO)         |
| `test_table_access` | `table`                                                          | Probe table access: structure, field count    |

### SAC — `sap.sac.*`

SAP Analytics Cloud. Each tool dispatches on an `operation` field (except
`smart_query` and `ping`, which take direct params). List operations accept standard
OData params (`$top`, `$skip`, `$filter`, `$orderby`, `$select`, `$expand`,
`$count`); mutating operations require `allowalteration: true` as a safety guard.

- **`ping`** (1 op) — returns `pong` for connectivity verification

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

ABAP Development Tools, wrapping `abap-adt-api` v8.5.0. **168 tools** — 52
hand-crafted tools with typed schemas (below) + 116 auto-generated tools that
expose every remaining `ADTClient` method (debugger, traces, logpoints, RAP,
refactoring, services, etc.). Each auto-generated tool accepts positional
`args` and delegates to `ADTClient.<method>()`.

**New in this pass:** source pagination (`firstLine`/`lastLine`/`onlyMethod`),
file I/O (`outputFile`/`sourceFile`), partial-source guard, read-only mode,
regex grep (`grep_source`), package-level ATC (`run_atc_package`), DDIC value
help (`value_help`).

**Authentication modes:**

| Mode | Config | Description |
|------|--------|-------------|
| `basic` | `SAP_ADT_USER`, `SAP_ADT_PASS` | HTTP Basic auth (username/password) |
| `xsuaa` | `SAP_ADT_CLIENT_ID`, `SAP_ADT_CLIENT_SECRET`, `SAP_ADT_TOKEN_URL` | OAuth2 client_credentials (machine-to-machine) |
| `jwt` | `SAP_ADT_TOKEN` | Pre-provided JWT bearer token (SSO) |
| `sso` | `SAP_ADT_SSO_TYPE` | Unified SSO — see below |

**SSO mode (`SAP_ADT_AUTHMODE=sso`)** supports every SSO flavour via
`SAP_ADT_SSO_TYPE`:

| `SAP_ADT_SSO_TYPE` | Grant / mechanism | Required config |
|--------------------|-------------------|-----------------|
| `oidc_browser` | OIDC authorization code + PKCE (browser) | `SAP_ADT_CLIENT_ID`, `SAP_ADT_ISSUER_URL` |
| `oidc_device` | OIDC device_code (headless) | `SAP_ADT_CLIENT_ID`, `SAP_ADT_ISSUER_URL` |
| `oidc_password` | OIDC password grant | `SAP_ADT_CLIENT_ID`, `SAP_ADT_USERNAME`, `SAP_ADT_PASSWORD` |
| `oidc_token_exchange` | OAuth2 token exchange | `SAP_ADT_CLIENT_ID`, `SAP_ADT_SUBJECT_TOKEN`, `SAP_ADT_SUBJECT_TOKEN_TYPE` |
| `saml2_bearer` | SAML2 Bearer assertion | `SAP_ADT_CLIENT_ID`, `SAP_ADT_SAML_TRUST`, `SAP_ADT_AUTHORIZATION_ENDPOINT` |
| `saml2_pure` | SAML2 pure (session cookies) | `SAP_ADT_SAML_TRUST`, `SAP_ADT_AUTHORIZATION_ENDPOINT` |
| `passcode` | UAA/XSUAA one-time passcode | `SAP_ADT_UAA_URL`, `SAP_ADT_CLIENT_ID` |
| `client_credentials` | OAuth2 client_credentials | `SAP_ADT_UAA_URL`/`ISSUER_URL`, `SAP_ADT_CLIENT_ID`, `SAP_ADT_CLIENT_SECRET` |
| `token` | Pre-provisioned token | `SAP_ADT_ACCESS_TOKEN` |
| `sso2` | MYSAPSSO2 logon ticket | `SAP_ADT_PSE_CERT`, `SAP_ADT_PSE_KEY`, `SAP_ADT_SSO_CLIENT`, `SAP_ADT_SSO_SYSTEM` |
| `spnego` | Kerberos SPNEGO | `SAP_ADT_KERBEROS_SERVICE`; `SAP_ADT_KERBEROS_KEYTAB` + `SAP_ADT_KERBEROS_PRINCIPAL` for automatic `kinit` |

`SAP_ADT_STRATEGY=browser|manual|external` selects the interactive login
mechanism for browser/SAML/passcode flows (default `browser` — opens a local
callback on `SAP_ADT_AUTH_BROKER_PORT`).

**MYSAPSSO2 (`sso2`):** generates a SAP logon ticket signed by the system PSE
(DSA key). Supply the PSE certificate and private key as PEM strings or file
paths. The ticket is sent as the `MYSAPSSO2` cookie and is auto-regenerated on
expiry (`SAP_ADT_SSO_DURATION_HOURS`, default 8).

**Automatic credential renewal:** `sso2` and `spnego` credentials expire. The
connector renews them unattended — an `unref`'d timer calls `refresh()` (sso2:
regenerates the ticket) or `prepare()` (spnego: re-acquires the Negotiate
token) and rebuilds the ADTClient with the new header. Renewal cadence:
- `sso2`: `(SAP_ADT_SSO_DURATION_HOURS - 1)h` (default 7h)
- `spnego`: every 8h (Kerberos service tickets are ~10h)

**SPNEGO automatic `kinit` (keytab mode):** set `SAP_ADT_KERBEROS_KEYTAB` and
`SAP_ADT_KERBEROS_PRINCIPAL` to have the connector run `kinit -kt <keytab>
<principal>` on startup and every 7h — no manual `kinit` needed. Omit both on
Windows domain service accounts (the LSA manages the TGT).

**Unattended SSO — which types need no user action:**

| Type | Startup | Renewal | Notes |
|------|---------|---------|-------|
| `sso2` | local sign | auto | PSE key file |
| `spnego` | auto `kinit` / LSA | auto | keytab or Windows domain account |
| `client_credentials` | auto token | provider refresh | client secret |
| `oidc_token_exchange` | auto exchange | provider refresh | subject token |
| RFC SNC | SAP transport layer | SAP library | `SAP_RFC_SNC_MODE=1` |
| GUI `connect_existing` | attach | none | requires an already-logged-on GUI |

Interactive flows (`oidc_browser`, `oidc_device`, `saml2_*`, `passcode`) need
human consent by protocol design.

**Full MCP configuration (unattended SPNEGO + RFC SNC + GUI attach):**

Build first (`npm run build`), then point your MCP client at this config:

```json
{
  "mcpServers": {
    "sap": {
      "command": "node",
      "args": ["/path/to/dist/index.js"],
      "env": {
        "SAP_TRANSPORT": "stdio",
        "SAP_ENABLED_CONNECTORS": "adt,rfc,gui",

        "SAP_ADT_BASEURL": "https://sapdev.example.com:44300",
        "SAP_ADT_AUTHMODE": "sso",
        "SAP_ADT_SSO_TYPE": "spnego",
        "SAP_ADT_CLIENT": "100",
        "SAP_ADT_KERBEROS_SERVICE": "HTTP/sapdev.example.com",
        "SAP_ADT_KERBEROS_REALM": "EXAMPLE.COM",
        "SAP_ADT_KERBEROS_KEYTAB": "/etc/sap/sap.keytab",
        "SAP_ADT_KERBEROS_PRINCIPAL": "SAPSERVICE/mcp@EXAMPLE.COM",

        "SAP_RFC_ASHOST": "sapdev.example.com",
        "SAP_RFC_SYSNR": "00",
        "SAP_RFC_CLIENT": "100",
        "SAP_RFC_LANG": "EN",
        "SAP_RFC_SNC_MODE": "1",
        "SAP_RFC_SNC_PARTNER_NAME": "p:CN=SAPR3,OU=SAP,O=Example,C=US",
        "SAP_RFC_SNC_LIB": "/usr/sap/libsapsecu.so",

        "SAP_GUI_CLIENT": "100",
        "SAP_GUI_LANGUAGE": "EN"
      }
    }
  }
}
```

Swap the ADT env block to switch SSO flavour:

- **MYSAPSSO2**: `SAP_ADT_SSO_TYPE=sso2`, `SAP_ADT_PSE_CERT`, `SAP_ADT_PSE_KEY`,
  `SAP_ADT_SSO_USER`, `SAP_ADT_SSO_SYSTEM`.
- **client_credentials (BTP ABAP)**: `SAP_ADT_SSO_TYPE=client_credentials`,
  `SAP_ADT_UAA_URL`, `SAP_ADT_CLIENT_ID`, `SAP_ADT_CLIENT_SECRET`.

Client config locations:
- **Claude Desktop**: `%APPDATA%\Claude\claude_desktop_config.json` (merge `mcpServers`)
- **opencode**: `opencode.json` in the project, or `~/.config/opencode/opencode.json`

**JWT/SSO:** For SAP BTP ABAP Cloud or scenarios requiring interactive login, use
`SAP_ADT_AUTHMODE=jwt`. Two options:

**Option 1: Pre-provided token (recommended for scripts)**
```bash
# 1. Install mcp-auth CLI
npm install -g @mcp-abap-adt/auth-broker-cli

# 2. Create a service key in SAP BTP
#    - Go to SAP BTP Cockpit → Subaccounts → Cloud Foundry
#    - Create a service key for your ABAP instance

# 3. Obtain a token
mcp-auth --service-key ./service-key.json --output ./mcp.env --type abap

# 4. Configure the MCP server
export SAP_ADT_AUTHMODE=jwt
export SAP_ADT_TOKEN=$(grep SAP_JWT_TOKEN mcp.env | cut -d= -f2)
```

**Option 2: Browser login (interactive SSO)**
```bash
# Configure for browser login
export SAP_ADT_AUTHMODE=jwt
export SAP_ADT_UAA_URL=https://<your-uaa-url>
export SAP_ADT_UAA_CLIENT_ID=<client-id>
export SAP_ADT_UAA_CLIENT_SECRET=<client-secret>

# Start the server - it will open a browser for login
# The callback server listens on port 61001 (configurable via SAP_ADT_AUTH_BROKER_PORT)
npm start
```

When no token is provided, the server automatically:
1. Starts a local callback server on port 61001
2. Opens a browser to the SAP login page
3. Receives the authorization code via callback
4. Exchanges it for a JWT token
5. Uses the token to authenticate ADT requests

The `@mcp-abap-adt/auth-broker` package handles the OAuth2 authorization_code flow.

**Hand-crafted tools (52):**

| Tool                   | Parameters                                                                | Description                                                                          |
| ---------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `read_source`          | `objectUrl`, `firstLine?`, `lastLine?`, `onlyMethod?`, `outputFile?`     | Read ABAP source (pagination, method slice, file output)                             |
| `write_source`         | `objectUrl`, `content?`, `sourceFile?`, `skipGuard?`                     | Write ABAP source (file input, partial-source guard)                                 |
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
| `run_atc_package`      | `packageName`, `variant?`, `maxObjects?`                                 | Run ATC over an entire package (worklist flow)                                       |
| `atc_worklists`        | —                                                                       | List ATC worklists                                                                   |
| `atc_fix_proposals`    | `objectUrl`, `source`, `line`, `column`                                 | Get ATC quickfix proposals                                                           |
| `table_contents`       | `ddicEntityName`, `rowNumber?`, `sqlQuery?`                              | Read table/CDS data via ADT Data Preview (no RFC SDK)                                |
| `run_query`            | `sqlQuery`, `rowNumber?`                                                | Run OpenSQL SELECT via ADT Data Preview                                              |
| `ddic_element`         | `path` (string or string[])                                             | Get DDIC element metadata                                                             |
| `package_search_help`  | `type`, `name?`                                                          | F4-style value help for packages                                                     |
| `value_help`           | `domain?`, `dataElement?`, `table?`, `field?`, `language?`, `maxRows?`   | Resolve DDIC value help (domain fixed values / check table)                          |
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
| `dump_details`         | `dumpId`, `startLine?`, `maxLines?`                                     | Read short dump trace by dump ID                                                     |
| `system_info`          | `refresh?`                                                              | Get SAP system profile information                                                   |
| `source_search`        | `searchString`, `packages?`, `objectTypes?`, `objectName?`, `maxResults?` | Full-text grep across ABAP repository                                            |
| `grep_source`          | `pattern`, `packages?`, `transport?`, `objectUrls?`, `maxObjects?`, `maxMatches?`, `contextLines?` | JS regex search across ABAP sources                                |
| `list_locks`           | `client?`, `user?`, `table?`                                            | List active ABAP locks (SM12 equivalent)                                             |
| `get_note`             | `note`                                                                  | Get a SAP Note by ID                                                                 |
| `check_note_status`    | `note`                                                                  | Check the implementation status of a SAP Note                                        |
| `implement_note`       | `note`, `transport?`                                                    | Implement (deploy) a SAP Note into a transport                                       |
| `schedule_job`         | `jobName`, `program`, `user`, `startTime?`, `endTime?`, `startMode?`, `target?`, `transport?` | Schedule an ABAP background job          |
| `read_spool`           | `spoolId`                                                               | Read spool request content by spool ID                                               |
| `cds_dependencies`     | `entity`                                                                | Get CDS view dependency graph                                                        |
| `list_versions`        | `objectUrl`                                                             | List all versions of an ABAP object                                                  |
| `compare_versions`     | `sourceUri`, `from`, `to`                                               | Compare two versions of an ABAP object (active vs inactive)                         |
| `package_tree`         | `packageName`, `maxDepth?`, `maxObjects?`                               | Recursively list a package hierarchy                                                 |
| `object_diff`          | `objectUrl`, `fromVersion?`, `toVersion?`                               | Show unified diff between two versions of an object                                  |
| `resolve_transport`    | `objectUrl`, `createIfMissing?`                                         | Resolve the best transport for an object                                             |
| `force_unlock`         | `objectUrl`, `dropSession?`                                             | Force unlock an ABAP object                                                          |

**Read-only mode:** Set `SAP_ADT_READONLY=true` to block all write operations
(`write_source`, `activate`, `create_object`, `delete_object`, transports,
notes, jobs, and auto-generated write methods). The tool returns `isError: true`
with a message instead of reaching SAP.

**Audit log:** Set `MCP_AUDIT_FILE=./audit.jsonl` to append a redacted JSONL
record of every write operation (tool name, timestamp, redacted args).

**Auto-generated tools (119)** — one per remaining `ADTClient` method. Naming
convention: camelCase method → snake_case tool (e.g. `debuggerStep` →
`debugger_step`). Each accepts `{ args?: unknown[] }` (positional arguments).
Notable categories:

- **Debugger** (17): `debugger_step`, `debugger_set_breakpoints`, `debugger_stack_trace`, `debugger_variables`, `debugger_attach`, `debugger_listen`, `debugger_set_variable_value`, `debugger_create_watchpoint`, …
- **Traces** (9): `traces_list`, `traces_hit_list`, `traces_statements`, `traces_create_configuration`, `traces_delete`, …
- **Logpoints** (7): `create_logpoint`, `delete_logpoint`, `get_log_point_logs`, `get_log_servers`, …
- **Refactoring** (6): `rename_execute`, `rename_preview`, `extract_method_execute`, `extract_method_preview`, `change_package_preview`, `change_package_execute`
- **RAP** (7): `rap_gen_generate`, `rap_gen_get_schema`, `rap_gen_get_content`, `rap_gen_validate_initial`, `rap_gen_validate_content`, `rap_gen_is_available`, `rap_gen_publish_service`
- **Services** (4): `publish_service_binding`, `un_publish_service_binding`, `binding_details`
- **Git** (7): `git_create_repo`, `git_unlink_repo`, `push_repo`, `stage_repo`, `switch_repo_branch`, `remote_repo_info`, `git_external_repo_info`
- **ATC** (9): `atc_customizing`, `atc_check_variant`, `atc_users`, `atc_exempt_proposal`, `atc_request_exemption`, `atc_documentation`, `atc_change_contact`, `atc_contact_uri`
- **Transports** (9): `transport_info`, `transport_delete`, `transport_add_user`, `transport_set_owner`, `transport_reference`, `transports_by_config`, `transport_configurations`, `get_transport_configuration`, `set_transports_config`
- **Discovery** (7): `load_types`, `object_types`, `adt_discovery`, `adt_core_discovery`, `adt_compatibiliy_graph`, `feature_details`, `collection_feature_details`
- **Data/DDIC** (8): `ddic_repository_access`, `annotation_definitions`, `get_data_element_properties`, `set_data_element_properties`, `get_domain_properties`, `set_domain_properties`, `object_structure_elements`, `code_completion`
- **Objects** (6): `class_components`, `find_object_path`, `object_registration_info`, `object_enhancements`, `main_programs`, `type_hierarchy`
- **Unit tests** (2): `unit_test_evaluation`, `unit_test_occurrence_markers`
- **Session** (3): `login`, `logout`, `drop_session`

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
