# sap-mcp-unified

A single [Model Context Protocol](https://modelcontextprotocol.io/) server that
exposes SAP systems to LLM clients. Three connectors share one process and one
MCP transport, with every tool namespaced as `sap.<connector>.<tool>`:

| Connector | Namespace   | Capabilities                                                  |
| --------- | ----------- | ------------------------------------------------------------- |
| RFC       | `sap.rfc.*` | Call BAPIs/function modules, read tables, inspect metadata   |
| SAC       | `sap.sac.*` | SAP Analytics Cloud stories, models, data export/import, etc. |
| ADT       | `sap.adt.*` | ABAP source, activation, unit tests, ATC, transports          |

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

All tools are registered under the `sap.<id>.<name>` namespace by the registry.

- **RFC** (`sap.rfc.`): `call_function`, `read_table`, `get_function_metadata`, `search_functions`
- **SAC** (`sap.sac.`): `calendar`, `content_transport`, `content`, `data_export`, `data_import`, `monitoring`, `multi_actions`, `schedule_publication`, `smart_query`, `translation`, `user_management`
- **ADT** (`sap.adt.`): `read_source`, `write_source`, `search_objects`, `activate`, `run_unit_tests`, `run_atc`, `manage_transports`

A connector that fails to initialise (e.g. RFC without the NWRFC SDK, or SAC with a bad token) is **skipped** — it never blocks the other connectors.

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
