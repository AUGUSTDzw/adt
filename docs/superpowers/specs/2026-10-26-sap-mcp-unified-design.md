# Design Spec: sap-mcp-unified

**Date:** 2026-10-26
**Status:** Approved (pending spec review)
**Author:** brainstorming session

## 1. Goal

Build a single TypeScript/Node.js MCP (Model Context Protocol) server that exposes one
entry point to multiple SAP products. The server merges capabilities discovered across
existing GitHub "SAP MCP" projects into one unified, connector-based process that an
LLM client (Claude Desktop, Cursor, VS Code) can talk to.

The original request: *retrieve all SAP-MCP-related projects from GitHub, save them to a
`reference/` directory, analyze them, then fuse them into a new project.* This spec
covers the analyzed design and the shape of the resulting unified project.

## 2. Scope (v1)

| # | Connector | Namespace | Source reference | Effort |
|---|-----------|-----------|------------------|--------|
| 1 | SAP RFC / BAPI | `sap.rfc.*` | `thupalo/sap-rfc-mcp-server` (Python, 14★) | **Port** Python→TS via `node-rfc` |
| 2 | SAP Analytics Cloud | `sap.sac.*` | `JumenEngels/sap_analytics_cloud_mcp` (TS, 16★) | Adapt (already TS) |
| 3 | ABAP Development Tools | `sap.adt.*` | `mario-andreschak/mcp-abap-abap-adt-api` (TS, 206★) + `fr0ster/mcp-abap-adt` (TS, 99★) | Adapt (wraps `abap-adt-api` npm lib) |

Out of scope for v1 (future connectors, drop-in): SAP HANA, SAP CAP, SAP LeanIX,
SAP Digital Manufacturing, BTP architecture diagrams. The architecture must allow these
to be added later without touching core.

## 3. Architecture — Connector / Plugin Registry

A small **core** framework handles MCP transport, config loading, the connector
registry, tool namespacing, and shared utilities. Each SAP product is a **connector**
implementing a common interface and registered at startup. Core does not know any
specific SAP product.

```
sap-mcp-unified/
├─ src/
│  ├─ core/
│  │  ├─ server.ts          # McpServer bootstrap; stdio + Streamable HTTP transports
│  │  ├─ config.ts          # env-driven config loader (sections per connector)
│  │  ├─ registry.ts        # SapConnector registry + tool namespacing
│  │  ├─ types.ts           # SapConnector interface + shared types
│  │  └─ utils/
│  │     ├─ logger.ts
│  │     ├─ audit-log.ts        # log tool calls (borrow hana-mcp-server audit-logger)
│  │     ├─ sensitive-redact.ts # strip credentials from output (borrow hana pattern)
│  │     ├─ formatters.ts
│  │     └─ validators.ts
│  ├─ connectors/
│  │  ├─ rfc/
│  │  │  ├─ sap-client.ts       # node-rfc wrapper  (← sap_client.py)
│  │  │  ├─ metadata-manager.ts # function metadata + cache (← metadata_manager.py + metadata_cache.py)
│  │  │  ├─ table-reader.ts     # RFC table read     (← rfc_table_reader.py)
│  │  │  ├─ secure-config.ts   # credential handling (← secure_config.py + sap_security_manager.py)
│  │  │  └─ tools.ts            # registers sap.rfc.* tools
│  │  ├─ sac/
│  │  │  ├─ sac-client.ts       # (← src/auth/sac-client.ts)
│  │  │  ├─ tools/              # (← src/tools/* : data-export, data-import, content, calendar,
│  │  │  │                      #   smart-query, schedule-publication, multi-actions, monitoring,
│  │  │  │                      #   translation, user-management, content-transport)
│  │  │  ├─ resources.ts        # (← src/resources/index.ts)
│  │  │  └─ prompts.ts          # (← src/prompts/index.ts)
│  │  └─ adt/
│  │     ├─ adt-client.ts       # wraps abap-adt-api npm lib; auth shapes from fr0ster/mcp-abap-adt
│  │     │                      #   (JWT / XSUAA / service-key / basic)
│  │     └─ tools/              # source CRUD, search, transports, unit tests, ATC, activation
│  └─ index.ts              # build registry → start server with chosen transport
├─ reference/               # dev-only; cloned repos + analysis (NOT shipped)
│  ├─ ANALYSIS.md
│  ├─ sap-rfc-mcp-server/        # thupalo
│  ├─ sap_analytics_cloud_mcp/   # JumenEngels
│  ├─ hana-mcp-server/           # HatriGt (patterns reference)
│  ├─ mcp-abap-abap-adt-api/     # mario-andreschak
│  └─ mcp-abap-adt/              # fr0ster
├─ tests/
│  ├─ connectors/{rfc,sac,adt}/*.spec.ts   # mocked SAP clients
│  └─ core/registry.spec.ts
├─ package.json
├─ tsconfig.json
├─ .env.example
└─ README.md
```

### SapConnector interface (contract)

```ts
interface SapConnector {
  id: 'rfc' | 'sac' | 'adt' | string;      // tool namespace segment
  init(config: ConnectorConfig): Promise<void>; // establish client / verify creds
  tools(): ToolRegistration[];              // each tool name auto-prefixed sap.<id>.
  resources?(): ResourceRegistration[];
  prompts?(): PromptRegistration[];
  shutdown?(): Promise<void>;
}
```

The registry reads `SAP_ENABLED_CONNECTORS` (default: all configured), calls `init`,
collects `tools()/resources()/prompts()`, and registers them on one `McpServer` with
the `sap.<id>.<tool>` naming. A disabled or misconfigured connector logs a warning and
is skipped — it never blocks the others.

## 4. v1 Connectors (detail)

### 4.1 RFC (`sap.rfc.*`) — port from Python
Source: `thupalo/sap-rfc-mcp-server` (Python, pyrfc). Port to TS using `node-rfc`
(the SAP NWRFC SDK binding for Node). Mapping:

| Python source | TS target | Notes |
|---|---|---|
| `sap_client.py` | `connectors/rfc/sap-client.ts` | pyrfc → node-rfc (`@sap/npm-sapnwrfc`) |
| `metadata_manager.py` + `metadata_cache.py` | `metadata-manager.ts` | TTL cache for function metadata |
| `rfc_table_reader.py` | `table-reader.ts` | RFC_TABLE_READ / generic table read |
| `secure_config.py` + `sap_security_manager.py` | `secure-config.ts` + `core/utils/sensitive-redact.ts` | no plaintext creds in logs |
| `config.py` | folded into `core/config.ts` (RFC section) | `SAP_RFC_*` env vars |
| `server.py` (stdio) + `http_server.py` | replaced by `core/server.ts` | unified transport |

Tools: `sap.rfc.call_function`, `sap.rfc.read_table`, `sap.rfc.get_function_metadata`,
`sap.rfc.search_functions`. Metadata caching preserved (the Python ref's key feature).

### 4.2 SAC (`sap.sac.*`) — adapt existing TS
Source: `JumenEngels/sap_analytics_cloud_mcp`. Already TypeScript, already uses the
official MCP SDK. Reuse `src/auth/sac-client.ts` and `src/tools/*` almost verbatim —
the only adaptation is registering through the registry instead of directly on
`McpServer`, and reading config from `core/config.ts` (`SAP_SAC_*`). The repo's
`AgentClient/` folder is a standalone demo client (multi-LLM provider) and is dropped.

Tools (from ref): data-export, data-import, content, content-transport, calendar,
smart-query, schedule-publication, multi-actions, monitoring, translation,
user-management. Plus its `resources/` and `prompts/` if applicable.

### 4.3 ADT (`sap.adt.*`) — wrap npm lib
Sources: `mario-andreschak/mcp-abap-abap-adt-api` (wraps the `abap-adt-api` npm
package, MIT) for the tool surface; `fr0ster/mcp-abap-adt` (full CRUD + JWT/XSUUA /
service-key auth, Apache-2.0) for the auth shapes. Approach: a thin `adt-client.ts`
uses `abap-adt-api` for the ADT REST operations (read/write source, search, transports,
unit tests, ATC, activation). We implement auth-token acquisition *ourselves* in
`adt-client.ts` (basic for on-prem ECC/S4; JWT/XSUUA + service-key for BTP ABAP
Environment), informed by fr0ster's patterns, then hand the token to `abap-adt-api`.
We do **not** vendor fr0ster's whole codebase — only its auth approach.

Tools: `sap.adt.read_source`, `sap.adt.write_source`, `sap.adt.search_objects`,
`sap.adt.activate`, `sap.adt.run_unit_tests`, `sap.adt.run_atc`, `sap.adt.manage_transports`.

## 5. Config & auth

- Single `.env` (see `.env.example`), loaded by `core/config.ts`. Per-connector
  sections via prefixed env vars: `SAP_RFC_*`, `SAP_SAC_*`, `SAP_ADT_*`.
- `SAP_ENABLED_CONNECTORS=rfc,sac,adt` selects which connectors load (default: all that
  are configured).
- `SAP_TRANSPORT=stdio|http` selects transport; HTTP mode reads `SAP_HTTP_PORT`,
  optional `SAP_HTTP_AUTH_TOKEN`.
- Credentials never logged — `core/utils/sensitive-redact.ts` strips known-secret
  keys from any tool output before returning to the LLM. Patterns borrowed from
  hana-mcp-server's `sensitive-redact.js` and the Python ref's `secure_config.py`.

## 6. Transports

- **stdio** (default) — for Claude Desktop / Cursor / VS Code local use.
- **Streamable HTTP** — for remote or CI; mirrors hana-mcp-server's `server/http-*.js`.
  Single binary, `--transport` flag (or `SAP_TRANSPORT`).

## 7. Testing

- Per-connector unit tests with mocked SAP clients (node-rfc, abap-adt-api, and
  sac-client all stubbed — no live SAP system needed for a green build). Borrow the
  `*-mocked.js` test patterns from hana-mcp-server.
- `core/registry.spec.ts` — verifies namespacing, disabled-connector skip behavior.
- Stretch (requires real SAP): an opt-in integration test profile behind an env flag.

## 8. `reference/` deliverable

Clone the 5 repos into `reference/` and write `reference/ANALYSIS.md` containing:

1. **Per-repo summary** — purpose, language, stars, license, transport, auth.
2. **Tool surface comparison table** — what tools each exposes.
3. **Auth comparison** — basic / RFC / JWT-XSUUA / service-key / OAuth.
4. **Reusable code mapping** — reference file → our target file (the tables in §4).
5. **Lessons / gotchas** — node-rfc native module install, SAP NWRFC SDK prerequisite,
   ADT REST quirks, SAC token refresh, etc.
6. **Why we picked these 5** — and a note on repos excluded as false positives
   (e.g. `Sapo-MCP` = Sapo.vn, not SAP) or out-of-scope (HANA/CAP/LeanIX/DM/BTP-diagram).

## 9. Dependencies (expected)

- `@modelcontextprotocol/sdk` — MCP server SDK (matches SAC + ADT refs).
- `node-rfc` (a.k.a. `@sap/npm-sapnwrfc`) — SAP RFC binding; requires SAP NWRFC SDK
  native lib at runtime (documented prerequisite; tests mock it).
- `abap-adt-api` — ADT REST client (per mario-andreschak).
- `zod` — schema validation for tool inputs/outputs (idiomatic with the MCP SDK).
- `dotenv`, `pino` (or similar) for config + structured logging.

## 10. Non-goals / risks

- Not building a UI. hana-mcp-server's React `hana-mcp-ui` and the SAC repo's
  `AgentClient` are both out of scope.
- node-rfc is a native module — Windows/Linux/macOS install + SAP NWRFC SDK is a known
  friction point; documented in README, mocked in tests, and RFC connector is
  gracefully skippable if the native binding is absent.
- No live SAP credentials will be committed; `.env.example` carries placeholders only.
- v1 ships RFC + SAC + ADT only. Adding HANA/CAP/LeanIX is a later iteration that must
  not require core changes (validated by the registry contract).

## 11. Out-of-scope repos (recorded for completeness)

Excluded from v1 after analysis: `HatriGt/hana-mcp-server` (kept as patterns ref only),
`gavdilabs/cap-mcp-plugin` (CAP), `SAP/leanix-ai-plugins` (LeanIX),
`blumenkuebel/sap-dm-pod2-mcp-server` (Digital Manufacturing), `etosin/arc-draw`
(BTP diagramming), `nguyennguyenit/Sapo-MCP` (false positive — Sapo.vn POS, not SAP),
`abap-ai/mcp` (ABAP-language SDK, different paradigm).
