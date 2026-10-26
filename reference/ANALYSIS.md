# SAP MCP Reference Repos — Analysis Report

Analysis of the 5 cloned reference repositories that inform the `sap-mcp-unified`
project. Generated as part of Task 2 of the implementation plan. Sources read
for each repo: `README.md` + main entry source + tool registration source (see
"Sources consulted" at the end of each row). All facts below are taken from the
cloned trees at `reference/<repo>/` (depth-1 clones, 2026-10-26).

---

## 1. Per-repo summary

| Repo | Purpose | Language | License | Transport | Auth mode(s) |
|------|---------|----------|---------|-----------|--------------|
| `thupalo/sap-rfc-mcp-server` | MCP server for SAP RFC integration: call RFC functions, read SAP tables (with DATA_BUFFER_EXCEEDED protection), cache & search function metadata, export RAG-friendly metadata. Covers SAP R/3 4.5B → S/4HANA. | Python 3.9+ (`pyrfc`, `mcp`, `fastapi`/`uvicorn`) | MIT | **stdio** (`server.py`, MCP SDK) + **HTTP** (`http_server.py`, FastAPI on uvicorn, SSE streaming at `/stream/table/{t}`) | **RFC credentials** (ASHOST/SYSNR/CLIENT/USER/PASSWD/LANG) stored via 4 pluggable backends: env vars, `.env`, OS keyring, encrypted file (`sap_security_manager.py`, `secure_config.py` — "auto" picks strongest available) |
| `JumenEngels/sap_analytics_cloud_mcp` | MCP server exposing the SAP Analytics Cloud REST API as 90 tools across 11 service areas (Content, Data Export, Data Import, Multi Actions, Calendar, Content Transport, User Management, Monitoring, Schedule & Publication, Translation, Smart Query). Manages OAuth bearer + CSRF + session cookies automatically. | TypeScript / Node.js 18+ (`@modelcontextprotocol/sdk`, `zod`, native `fetch`) | MIT | **stdio** only (`src/index.ts` → `StdioServerTransport`) | **OAuth 2.0 Client Credentials** (2-legged): `POST <SAC_TOKEN_URL>?grant_type=client_credentials` with `Authorization: Basic base64(ClientID:Secret)` → bearer; CSRF token via `GET /api/v1/csrf` with `x-csrf-token: fetch`; session cookie jar maintained across calls. Env: `SAC_BASE_URL`, `SAC_TOKEN_URL`, `SAC_CLIENT_ID`, `SAC_CLIENT_SECRET` |
| `HatriGt/hana-mcp-server` | MCP server for SAP HANA & HANA Cloud: schema browsing, parameterised SQL with row/column/cell caps + paging snapshots, structural analysis (constraints/indexes/views/synonyms/privileges/DDL), code objects (procedures/functions/calc views/sequences), data & performance stats, optional business-domain semantics overlay. DML blocked by default. | JavaScript / Node.js 18+ (`@sap/hana-client`, `axios`, `jose`) | MIT | **stdio** (published `npx hana-mcp-server`) + **HTTP** (`npm run start:http`, Streamable JSON-RPC at `/mcp`, health at `/health`) | **DB user+password** (`HANA_HOST/PORT/USER/PASSWORD/SCHEMA`, TLS flags, MDC tenant via `HANA_DATABASE_NAME`); optional **Bearer JWT (XSUAA/OIDC)** on HTTP transport (`MCP_HTTP_AUTH_ENABLED`, `MCP_HTTP_JWT_ISSUER/AUDIENCE/SCOPES`) |
| `mario-andreschak/mcp-abap-abap-adt-api` | MCP server preserving 127 existing SAP ABAP ADT tools and adding `readResultPage` for large results. Object CRUD, locking, activation, transports, queries, debugging, refactoring, Git, ATC, traces, unit tests — all over one SAP session owned by a trusted local stdio client. | TypeScript (Node 22.22.2+ / 24.15.0+) | MIT | **stdio** only (explicitly "not an HTTP listener or MCP OAuth provider") | **Basic** (`SAP_URL`+`SAP_USER`+`SAP_PASSWORD`+`SAP_CLIENT`+`SAP_LANGUAGE`) **or static bearer** (`SAP_BEARER_TOKEN`, rotated by restart — no XSUAA grants). TLS enforced (`NODE_EXTRA_CA_CERTS`; `NODE_TLS_REJECT_UNAUTHORIZED=0` refused). Loopback HTTP allowed; trusted private HTTP needs `SAP_ALLOW_HTTP=1` |
| `fr0ster/mcp-abap-adt` | MCP server for ABAP ADT in ECC/S/4HANA (on-prem) and SAP BTP ABAP Cloud. Full CRUD (not read-only) for RAP and classic ABAP artifacts (classes, interfaces, function groups/modules, programs, DDIC, CDS/views, service bindings/definitions, BDEF, DDLX, domains, data elements, structures, tables, packages, message classes). Impact/where-used, ABAP AST + semantic analysis, debugger (ABAP & AMDP), batch mode, long sessions over Streamable HTTP, ATC, ABAP Unit, runtime profiling, feeds, freestyle SQL. | TypeScript (Node 22 / 24) | **Dual**: `@mcp-abap-adt/lib` + `compact-readonly-entries` + `compact-modify` + `responsible-rules` + `background-runs-memory` = **Apache-2.0**; all server binaries (`core`, `http`, `sse`, `compact*`, the `-ro` variants, `server-runtime`) = **AGPL-3.0-only** | **stdio**, **HTTP (Streamable)**, **SSE** — 3 transports × {full, compact, -ro} → 12 binaries | **Basic** (HTTP or RFC), **SNC** (passwordless, RFC only), **JWT with browser login** (service key: ABAP or XSUAA, `authorization_code` grant); a JWT you already hold goes in the `x-sap-jwt-token` header of `mcp-abap-adt-http` / `-sse`. Destination = service-key filename; CLI `--mcp=<destination>`, `--connection-type=http|rfc` |

---

## 2. Tool-surface comparison

Tool names are taken verbatim from each repo's tool-registration source (see
"Sources consulted" per row). For the ADT repos with large surfaces the names
are grouped by handler directory so a reader can find the file behind each name.

### `thupalo/sap-rfc-mcp-server` — 12 stdio tools + 8 HTTP tools

| Transport | Tools |
|-----------|-------|
| stdio (`server.py`, 12) | `rfc_system_info`, `get_rfc_functions`, `call_rfc_function`, `get_function_metadata`, `search_rfc_functions`, `get_metadata_cache_stats`, `bulk_load_metadata`, `export_metadata_for_rag`, `read_table`, `read_table_complete`, `get_table_structure`, `test_table_access` |
| HTTP (`http_server.py`, 8) | `rfc_system_info`, `get_rfc_functions`, `call_rfc_function`, `stream_rfc_table_data`, `get_function_metadata`, `get_metadata_cache_stats`, `bulk_load_metadata`, `export_metadata_for_rag` |

Note: the HTTP server reuses the same SAP client and metadata manager as the
stdio server; `stream_rfc_table_data` is the HTTP-only addition (returns a
streaming URL at `/stream/table/{table_name}`).

### `JumenEngels/sap_analytics_cloud_mcp` — 90 tools (89 + `ping`)

Registered via `server.tool(name, …)` in `src/tools/*.ts`. Verified count: 90
matches of `server.tool(` across 12 module files.

| Module (file) | Tools |
|---------------|-------|
| `index.ts` (connectivity) | `ping` |
| `content.ts` | `sac_stories_list`, `sac_stories_copy`, `sac_stories_rename`, `sac_stories_delete`, `sac_metadata_get`, `sac_resources_list`, `sac_resources_get`, `sac_filerepository_list`, `sac_repositories_list`, `sac_widget_get_data` |
| `data-export.ts` | `sac_export_list_namespaces`, `sac_export_get_namespace`, `sac_export_list_providers`, `sac_export_list_subscriptions`, `sac_export_get_subscription`, `sac_export_list_provider_subscriptions`, `sac_export_create_subscription`, `sac_export_delete_subscription`, `sac_export_admin_metadata`, `sac_export_get_provider_metadata`, `sac_export_get_provider_entities`, `sac_export_get_fact_data`, `sac_export_get_fact_data_aggregation`, `sac_export_get_fact_data_difference`, `sac_export_get_master_data`, `sac_export_get_dimension_master`, `sac_export_get_dimension_master_hierarchy`, `sac_export_get_audit_data`, `sac_export_get_currency_table`, `sac_export_get_conversion_rates`, `sac_export_get_public_dimension_data`, `sac_export_get_data` |
| `data-import.ts` | `sac_import_list_models`, `sac_import_get_model`, `sac_import_get_model_metadata`, `sac_import_create_job`, `sac_import_list_jobs`, `sac_import_upload_data`, `sac_import_validate_job`, `sac_import_run_job`, `sac_import_get_job_status`, `sac_import_get_invalid_rows`, `sac_import_delete_job`, `sac_import_oneclick`, `sac_import_list_public_dimensions`, `sac_import_get_public_dimension`, `sac_import_get_public_dimension_metadata`, `sac_import_create_public_dimension_job`, `sac_import_list_currency_conversions`, `sac_import_get_currency_conversion`, `sac_import_get_currency_conversion_metadata`, `sac_import_create_currency_conversion_job`, `sac_import_list_unit_conversions`, `sac_import_get_unit_conversion`, `sac_import_get_unit_conversion_metadata`, `sac_import_create_unit_conversion_job` |
| `multi-actions.ts` | `sac_multi_action_execute`, `sac_multi_action_get_status` |
| `calendar.ts` | `sac_calendar_get_event`, `sac_calendar_update_event`, `sac_calendar_copy_event` |
| `content-transport.ts` | `sac_transport_create_export_job`, `sac_transport_get_job_status`, `sac_transport_create_import_job`, `sac_transport_delete_content`, `sac_transport_get_content_item`, `sac_transport_get_permissions`, `sac_transport_move_item` |
| `user-management.ts` | `sac_users_list`, `sac_users_get`, `sac_users_create`, `sac_users_update`, `sac_users_patch`, `sac_users_delete`, `sac_teams_list`, `sac_teams_create`, `sac_teams_patch`, `sac_users_bulk` |
| `monitoring.ts` | `sac_audit_export`, `sac_monitoring_get` |
| `schedule-publication.ts` | `sac_schedule_get_template`, `sac_schedule_create`, `sac_schedule_update`, `sac_schedule_delete` |
| `translation.ts` | `sac_translation_list_artifacts`, `sac_translation_get_artifact`, `sac_translation_download_xliff`, `sac_translation_download_xliff_bulk` |
| `smart-query.ts` | `smart_query` |

### `HatriGt/hana-mcp-server` — 34 tools

Names extracted from `logger.tool('hana_…', …)` calls in `src/tools/*.js`
(verified: 34 unique).

| Area | Tools |
|------|-------|
| Connection & config | `hana_show_config`, `hana_test_connection`, `hana_show_env_vars`, `hana_get_session_info` |
| Schema browsing | `hana_list_schemas`, `hana_list_tables`, `hana_describe_table`, `hana_explain_table`, `hana_search_tables`, `hana_search_columns` |
| SQL execution | `hana_execute_query`, `hana_query_next_page` |
| Structural analysis | `hana_list_constraints`, `hana_list_foreign_keys`, `hana_list_indexes`, `hana_describe_index`, `hana_list_views`, `hana_describe_view`, `hana_list_synonyms`, `hana_list_privileges`, `hana_get_ddl` |
| Code objects | `hana_list_procedures`, `hana_describe_procedure`, `hana_list_functions`, `hana_describe_function`, `hana_list_calculation_views`, `hana_list_sequences` |
| Data & performance | `hana_get_table_stats`, `hana_get_sample_data`, `hana_get_column_stats`, `hana_explain_plan`, `hana_get_dependencies`, `hana_get_partition_info`, `hana_get_expensive_queries` |

DML guard: `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` blocked by default; opted in
individually via `HANA_ALLOW_INSERT` / `HANA_ALLOW_UPDATE` / `HANA_ALLOW_DELETE`.
MCP resources exposed: `hana:///schemas`, `hana:///schemas/{s}/tables/{t}`.

### `mario-andreschak/mcp-abap-abap-adt-api` — 128 tools (126 handler tools + `healthcheck` + `readResultPage`)

Tool names below are taken from `name: "…"` entries in
`src/handlers/*.ts` (126 unique), plus the two locally-registered tools in
`src/server.ts` (`healthcheck`, `readResultPage`). Above 64 KiB a tool result
returns an opaque `resultId` + JSON page + `nextOffset`; `readResultPage`
concatenates pages and JSON-parses to recover the original result.

| Handler file | Tools |
|--------------|-------|
| `AtcHandlers.ts` | `atcCustomizing`, `atcCheckVariant`, `createAtcRun`, `atcWorklists`, `atcUsers`, `atcExemptProposal`, `atcRequestExemption`, `isProposalMessage`, `atcContactUri`, `atcChangeContact` |
| `AuthHandlers.ts` | `login`, `logout`, `dropSession`, `reentranceTicket` |
| `ClassHandlers.ts` | `classIncludes`, `classComponents`, `syntaxCheckCode`, `syntaxCheckCdsUrl`, `codeCompletion`, `findDefinition`, `usageReferences`, `syntaxCheckTypes`, `codeCompletionFull`, `runClass`, `codeCompletionElement`, `usageReferenceSnippets`, `fixProposals`, `fixEdits`, `fragmentMappings`, `abapDocumentation`, `annotationDefinitions` |
| `DdicHandlers.ts` | `ddicElement`, `ddicRepositoryAccess`, `packageSearchHelp` |
| `DebugHandlers.ts` | `debuggerListeners`, `debuggerListen`, `debuggerDeleteListener`, `debuggerSetBreakpoints`, `debuggerDeleteBreakpoints`, `debuggerAttach`, `debuggerSaveSettings`, `debuggerStackTrace`, `debuggerVariables`, `debuggerChildVariables`, `debuggerStep`, `debuggerGoToStack`, `debuggerSetVariableValue` |
| `DiscoveryHandlers.ts` | `featureDetails`, `collectionFeatureDetails`, `findCollectionByUrl`, `loadTypes`, `adtDiscovery`, `adtCoreDiscovery`, `adtCompatibiliyGraph` |
| `FeedHandlers.ts` | `feeds`, `dumps` |
| `GitHandlers.ts` | `gitRepos`, `gitExternalRepoInfo`, `gitCreateRepo`, `gitPullRepo`, `gitUnlinkRepo`, `stageRepo`, `pushRepo`, `checkRepo`, `remoteRepoInfo`, `switchRepoBranch` |
| `NodeHandlers.ts` | `nodeContents`, `mainPrograms` |
| `ObjectDeletionHandlers.ts` | `deleteObject` |
| `ObjectHandlers.ts` | `objectStructure`, `searchObject`, `findObjectPath`, `objectTypes`, `inactiveObjects`, `objectRegistrationInfo`, `validateNewObject`, `createObject` |
| `ObjectLockHandlers.ts` | `lock`, `unLock`, `activateObjects`, `activateByName` |
| `ObjectManagementHandlers.ts` | *(covered by ObjectHandlers row)* |
| `ObjectRegistrationHandlers.ts` | *(covered by ObjectHandlers row)* |
| `ObjectSourceHandlers.ts` | `getObjectSource`, `setObjectSource` |
| `PrettyPrinterHandlers.ts` | `prettyPrinterSetting`, `setPrettyPrinterSetting`, `prettyPrinter` |
| `QueryHandlers.ts` | `tableContents`, `runQuery` |
| `RefactorHandlers.ts` | `extractMethodEvaluate`, `extractMethodPreview`, `extractMethodExecute`, `renameEvaluate`, `renamePreview`, `renameExecute` |
| `RenameHandlers.ts` | *(covered by RefactorHandlers row)* |
| `RevisionHandlers.ts` | `revisions` |
| `ServiceBindingHandlers.ts` | `publishServiceBinding`, `unPublishServiceBinding`, `bindingDetails` |
| `TraceHandlers.ts` | `tracesList`, `tracesListRequests`, `tracesHitList`, `tracesDbAccess`, `tracesStatements`, `tracesSetParameters`, `tracesCreateConfiguration`, `tracesDeleteConfiguration`, `tracesDelete` |
| `TransportHandlers.ts` | `transportInfo`, `createTransport`, `hasTransportConfig`, `transportConfigurations`, `getTransportConfiguration`, `setTransportsConfig`, `createTransportsConfig`, `userTransports`, `transportsByConfig`, `transportDelete`, `transportRelease`, `transportSetOwner`, `transportAddUser`, `systemUsers`, `transportReference` |
| `UnitTestHandlers.ts` | `unitTestRun`, `unitTestEvaluation`, `unitTestOccurrenceMarkers`, `createTestInclude` |
| `server.ts` (local) | `healthcheck`, `readResultPage` |

### `fr0ster/mcp-abap-adt` — 268 tools in the full server (high + low + system + debugger + batch + long-session + leftover-session + transport + unit-test + runtime + background-run)

Tool names below are taken from `name: '…'` entries in
`src/handlers/**/*.ts` (verified: 268 unique across the full server). The
compact binaries (`@mcp-abap-adt/compact*`) collapse these into ~17
single-step operations (`HandlerBatch`, `HandlerCreate`, `HandlerGet`,
`HandlerUpdate`, `HandlerDelete`, `HandlerLock`, `HandlerUnlock`,
`HandlerActivate`, `HandlerCheck`, `HandlerSession`, `HandlerUnitTestRun`,
`HandlerUnitTestStatus`, `HandlerUnitTestResult`, `HandlerProfileSchedule`,
`HandlerProfileRun`, `HandlerProfileList`, `HandlerProfileView`,
`HandlerDeletionCheck`, …). The `-ro` binaries serve only the tools that
change nothing.

| Handler dir | Tools |
|-------------|-------|
| `atc/` | `RunATC`, `GetATCRunStatus`, `GetATCFindings` |
| `background_run/` | `ListBackgroundRuns`, `GetBackgroundRun`, `DiscardBackgroundRun` |
| `batch/` | `BatchBegin`, `BatchEnd`, `BatchAnswers` |
| `behavior_definition/` | `CheckBehaviorDefinition`, `CreateBehaviorDefinition`, `DeleteBehaviorDefinition`, `GetBehaviorDefinition`, `UpdateBehaviorDefinition`, `ActivateBehaviorDefinitionLow`, `CheckBdefLow`, `UpdateBehaviorDefinitionLow` |
| `behavior_implementation/` | `CreateBehaviorImplementation`, `DeleteBehaviorImplementation`, `GetBehaviorImplementation`, `UpdateBehaviorImplementation` |
| `class/` | `CheckClass`, `CreateClass`, `DeleteClass`, `DeleteLocalDefinitions`, `DeleteLocalMacros`, `DeleteLocalTestClass`, `DeleteLocalTypes`, `GetClass`, `GetLocalDefinitions`, `GetLocalMacros`, `GetLocalTestClass`, `GetLocalTypes`, `UpdateClass`, `UpdateLocalDefinitions`, `UpdateLocalMacros`, `UpdateLocalTestClass`, `UpdateLocalTypes`, `ActivateClassLow`, `CheckClassLow`, `UpdateClassLow` |
| `common/` | `ActivateObjects`, `ActivateObjectLow`, `CheckObjectLow`, `LockObjectLow`, `UnlockObjectLow`, `ValidateObjectLow`, `GetObjectVersionDiff`, `GetObjectVersions`, `GetObjectVersionSource` |
| `data_element/` | `CheckDataElement`, `CreateDataElement`, `DeleteDataElement`, `GetDataElement`, `UpdateDataElement`, `ActivateDataElementLow`, `CheckDataElementLow`, `UpdateDataElementLow` |
| `ddl/` | `CheckDdl`, `CreateDdl`, `DeleteDdl`, `GetDdl`, `UpdateDdl`, `ActivateDdlLow`, `CheckDdlLow`, `UpdateDdlLow` |
| `ddlx/` | `CheckMetadataExtension`, `CreateMetadataExtension`, `UpdateMetadataExtension`, `ActivateMetadataExtensionLow`, `CheckMetadataExtensionLow`, `UpdateMetadataExtensionLow`, `DeleteMetadataExtension`, `GetMetadataExtension` |
| `debugger/` | `AmdpDebugCancel`, `AmdpDebugGetTable`, `AmdpDebugSetBreakpoints`, `AmdpDebugStart`, `AmdpDebugStep`, `AmdpDebugStop`, `AmdpDebugWait`, `DebugBatchBegin`, `DebugBatchEnd`, `DebugCreateMemorySnapshot`, `DebugCreateWatchpoint`, `DebugDeleteBreakpoint`, `DebugDeleteWatchpoint`, `DebugGetMemorySizes`, `DebugGetStack`, `DebugGetVariables`, `DebugListBreakpoints`, `DebugListWatchpoints`, `DebugSetBreakpoints`, `DebugSetSettings`, `DebugSetStackPosition`, `DebugSetVariable`, `DebugStartListener`, `DebugStep`, `DebugStepToLine`, `DebugStop`, `DebugTakeOverListener`, `DebugTerminate`, `DebugWait`, `MemorySnapshotDelta`, `MemorySnapshotGet`, `MemorySnapshotList` |
| `domain/` | `CheckDomain`, `CreateDomain`, `DeleteDomain`, `GetDomain`, `UpdateDomain`, `ActivateDomainLow`, `CheckDomainLow`, `UpdateDomainLow` |
| `enhancement/` | `GetEnhancementImpl`, `GetEnhancements`, `GetEnhancementSpot` |
| `function_group/` | `CheckFunctionGroup`, `CheckFunctionModule`, `CreateFunctionGroup`, `CreateFunctionModule`, `UpdateFunctionGroup`, `UpdateFunctionModule`, `ActivateFunctionGroupLow`, `ActivateFunctionModuleLow`, `CheckFunctionGroupLow`, `CheckFunctionModuleLow`, `UpdateFunctionGroupLow`, `UpdateFunctionModuleLow`, `DeleteFunctionGroup`, `GetFunctionGroup` |
| `function_include/` | `CreateFunctionInclude`, `DeleteFunctionInclude`, `UpdateFunctionInclude`, `GetFunctionInclude`, `ListFunctionGroupIncludes` |
| `function_module/` | `ListFunctionModules`, `DeleteFunctionModule`, `GetFunctionModule` |
| `function/` | *(covered by `function_group/` + `function_module/` + `function_include/`)* |
| `include/` | `GetInclude`, `GetIncludesList` |
| `interface/` | `CheckInterface`, `CreateInterface`, `DeleteInterface`, `GetInterface`, `UpdateInterface`, `ActivateInterfaceLow`, `CheckInterfaceLow`, `UpdateInterfaceLow` |
| `leftover_session/` | `ListLeftoverSessions`, `LogoffLeftoverSession` |
| `long_session/` | `SessionOpen`, `SessionClose` |
| `message_class/` | `CreateMessageClass`, `CreateMessageClassMessage`, `DeleteMessageClass`, `DeleteMessageClassMessage`, `GetMessageClass`, `GetMessageClassMessage`, `UpdateMessageClass`, `UpdateMessageClassMessage` |
| `metadata_extension/` | *(covered by `ddlx/`)* |
| `package/` | `CheckPackage`, `CreatePackage`, `DeletePackage`, `GetPackage`, `UpdatePackage`, `CheckPackageLow`, `UpdatePackageLow`, `GetPackageContents`, `GetPackageTree`, `GetNodeStructureLow`, `GetVirtualFoldersLow` |
| `program/` | `CheckProgram`, `CreateProgram`, `DeleteProgram`, `GetProgram`, `UpdateProgram`, `ActivateProgramLow`, `CheckProgramLow`, `UpdateProgramLow` |
| `search/` | `GetObjectsByType`, `GetObjectsList`, `SearchObject`, `SearchSource`, `DescribeByList` |
| `service_binding/` | `CreateServiceBinding`, `DeleteServiceBinding`, `GetServiceBinding`, `ListServiceBindingTypes`, `UpdateServiceBinding`, `ValidateServiceBinding`, `ActivateServiceBindingLow`, `GetServiceBindingPreviewUrl` |
| `service_definition/` | `CreateServiceDefinition`, `DeleteServiceDefinition`, `GetServiceDefinition`, `UpdateServiceDefinition`, `ActivateServiceDefinitionLow` |
| `structure/` | `CheckStructure`, `CreateStructure`, `DeleteStructure`, `GetStructure`, `UpdateStructure`, `ActivateStructureLow`, `CheckStructureLow`, `UpdateStructureLow`, `GetStructuresList` |
| `system/` | `GetAbapAST`, `GetAbapSemanticAnalysis`, `GetAbapSystemSymbols`, `GetAdtTypes`, `GetInactiveObjects`, `GetObjectInfo`, `GetObjectNodeFromCache`, `GetObjectStructure`, `GetSqlQuery`, `GetTransaction`, `GetTypeInfo`, `GetWhereUsed` |
| `table/` | `CheckTable`, `CreateTable`, `DeleteTable`, `GetTable`, `UpdateTable`, `ActivateTableLow`, `CheckTableLow`, `UpdateTableLow`, `GetTableContents` |
| `transport/` | `AddTransportObject`, `CreateTransport`, `CreateTransportTask`, `MoveTransportObjects`, `RemoveTransportObject`, `SortAndCompressTransportTask`, `GetTransport`, `ListTransports`, `ReadTransportActionLog`, `ReadTransportObjects` |
| `unit_test/` | `CreateCdsUnitTest`, `CreateFunctionGroupUnitTest`, `CreateProgramUnitTest`, `CreateUnitTest`, `DeleteCdsUnitTest`, `DeleteUnitTest`, `GetCdsUnitTest`, `GetCdsUnitTestResult`, `GetCdsUnitTestStatus`, `GetUnitTest`, `GetUnitTestResult`, `GetUnitTestStatus`, `RunCdsUnitTest`, `RunFunctionGroupUnitTest`, `RunFunctionModuleUnitTest`, `RunProgramUnitTest`, `RunUnitTest`, `UpdateCdsUnitTest`, `UpdateFunctionGroupUnitTest`, `UpdateProgramUnitTest`, `UpdateUnitTest` |
| `runtime/` (under `system/`) | `RuntimeAnalyzeProfilerTrace`, `RuntimeCreateProfilerTraceParameters`, `RuntimeGetDumpById`, `RuntimeGetGatewayErrorLog`, `RuntimeGetProfilerTraceData`, `RuntimeListFeeds`, `RuntimeListProfilerTraceFiles`, `RuntimeListSystemMessages`, `RuntimeRunClass`, `RuntimeRunProgram` |

---

## 3. Auth comparison

| Repo | Auth modes supported | One-line note |
|------|---------------------|---------------|
| `sap-rfc-mcp-server` | **RFC credentials** (basic, ASHOST+SYSNR+CLIENT+USER+PASSWD+LANG) | Single SAP user/password pair; four interchangeable storage backends (env / `.env` / OS keyring / encrypted file) selected by `sap_security_manager.py`'s "auto" mode; no OAuth, no JWT. |
| `sap_analytics_cloud_mcp` | **OAuth 2.0 Client Credentials** (2-legged) | `POST <tokenUrl>?grant_type=client_credentials` with HTTP Basic `base64(ClientID:Secret)` → bearer access token (cached with 60 s safety margin); CSRF token fetched via `GET /api/v1/csrf` with `x-csrf-token: fetch` and cached 10 min; session cookie jar maintained across calls; write ops auto-retry once on `403` (invalidates CSRF + cookies, re-fetches). |
| `hana-mcp-server` | **DB user+password** (basic HANA) **+ optional Bearer JWT (XSUAA/OIDC)** on HTTP | `HANA_USER`/`HANA_PASSWORD` against HANA SQL port (TLS flags `HANA_SSL`/`HANA_ENCRYPT`/`HANA_VALIDATE_CERT`); MDC tenant via `HANA_DATABASE_NAME`+`HANA_INSTANCE_NUMBER`; on HTTP transport, `MCP_HTTP_AUTH_ENABLED=true` + `MCP_HTTP_JWT_ISSUER/AUDIENCE/SCOPES_REQUIRED` validate `Authorization: Bearer <token>` (SAP BTP: bind XSUAA, assign role collections). |
| `mcp-abap-abap-adt-api` | **Basic** (SAP_USER+SAP_PASSWORD) **or static bearer** (`SAP_BEARER_TOKEN`) | No XSUAA grants, no password-grant flow, no OAuth provider. Bearer is a static token rotated by process restart; `SAP_URL` must be an HTTPS origin (loopback `http` allowed; trusted private HTTP needs `SAP_ALLOW_HTTP=1`); TLS verification cannot be disabled (`NODE_TLS_REJECT_UNAUTHORIZED=0` refused, use `NODE_EXTRA_CA_CERTS`). One operation at a time; recovery requires explicit `login` / `dropSession` / `logout`. |
| `mcp-abap-adt` | **Basic** (HTTP or RFC) **+ SNC** (passwordless, RFC) **+ JWT with browser login** (service key: ABAP or XSUAA, `authorization_code` grant) **+ JWT-in-header** (HTTP/SSE only) | Three stdio authentications via destination = service-key filename (`--mcp=<dest>`); `SAP_CONNECTION_TYPE=http|rfc` required; SNC logs on over RFC only (`SAP_SNC_PARTNERNAME`, no user/password); browser login listens on port 61001 (configurable); a JWT you hold is sent in `x-sap-jwt-token` header to `-http`/`-sse` (stdio serves none). Since 16.0: `certificate`, `kerberos`, `saml`, and any `jwt` grant other than `authorization_code`/`none` are refused at startup. |

---

## 4. Reusable-code mapping

Mapping from the spec §4. For each of our connectors (RFC, SAC, ADT) and the
core utils, the reference source file we will port / adapt / take a pattern
from. "Port" = translate to TS keeping the logic; "Adapt" = take the shape but
rework to our interfaces; "Pattern-only" = read the design, write our own.

| Our target file | Reference source file | What's reused |
|-----------------|------------------------|---------------|
| `connectors/rfc/sap-client.ts` | `sap-rfc-mcp-server/sap_rfc_mcp_server/sap_client.py` | **Port** the `SAPRFCManager` class (lazy connection, `call_rfc_function`, `get_system_info`, `get_rfc_functions`) to TS using `node-rfc` (SAP NW RFC SDK binding for Node) in place of `pyrfc`. Keep the "pyrfc optional, raise if missing" guard pattern for `node-rfc`. |
| `connectors/rfc/metadata-manager.ts` | `sap-rfc-mcp-server/sap_rfc_mcp_server/metadata_manager.py` + `metadata_cache.py` | **Port** the `RFCMetadataManager` (get/search/bulk-load/export-RAG) and the persistent file cache (TTL + compression) to TS. The cache's on-disk JSON layout and the "force_refresh bypasses cache" semantics translate directly. |
| `connectors/rfc/table-reader.ts` | `sap-rfc-mcp-server/sap_rfc_mcp_server/rfc_table_reader.py` | **Port** `RFCTableReader.read_table_safe` (auto field-selection + DATA_BUFFER_EXCEEDED protection) and `read_table_iterative` (split fields across multiple `RFC_READ_TABLE` calls). Both algorithms are SAP-side, language-agnostic. |
| `core/utils/sensitive-redact.ts` (RFC portion) | `sap-rfc-mcp-server/sap_rfc_mcp_server/secure_config.py` + `sap_security_manager.py` | **Pattern-only** — fold the "4 storage backends chosen by auto" pattern into our single `sensitive-redact` + a `SecretStore` interface (env / `.env` / OS keyring / encrypted file). The Python `cryptography`-encrypted-file path is ported to Node `crypto`. |
| `connectors/sac/sac-client.ts` | `sap_analytics_cloud_mcp/src/auth/sac-client.ts` | **Port** the whole client: `configFromEnv`, `getAccessToken` (cache + 60 s margin), `cookieJar` + `collectCookies`, `fetchCsrfToken` + 10 min cache + `invalidateCsrf`, `baseHeaders` / `writeHeaders`, `sacGet` / `sacPost` / `sacPut` / `sacPatch` / `sacDelete` (with `403` → invalidate + retry once). The file is already idiomatic TS using native `fetch` + `Headers.getSetCookie`; the port is near-verbatim. |
| `connectors/sac/index.ts` (tool registrations) | `sap_analytics_cloud_mcp/src/tools/*.ts` (12 modules: `content`, `data-export`, `data-import`, `multi-actions`, `calendar`, `content-transport`, `user-management`, `monitoring`, `schedule-publication`, `translation`, `smart-query`, plus `ping`) | **Adapt** — re-register the 90 tools against our `McpServer` instance, calling through our `sac-client.ts` instead of the reference's `getConfig()`/helpers. Tool schemas (`zod`), descriptions, and the `allowalteration=true` write-protect pattern are reused verbatim; the `_helpers.ts` `buildODataQuery` / `toolSuccess` / `toolError` are ported. |
| `connectors/adt/adt-client.ts` | `mcp-abap-abap-adt-api/src/server.ts` + `src/lib/adt-client.ts` + the `abap-adt-api` npm package (v8.4.3 pinned) | **Adapt** — wrap the `ADTClient` from `abap-adt-api` behind our `AdtClient` interface, copying `mcp-abap-abap-adt-api`'s `CompatibleAdtClient` + `BoundedHttpClient` + `requestContext` patterns (AbortController per call, `SAP_REQUEST_TIMEOUT_MS` 100..120000, `session_types.stateful`, `argumentSecrets` redaction in `safeError`). The `mutations` set + "one operation at a time; busy = 429" + "recovery required after interrupt; explicit `login`/`dropSession`" semantics are reused. |
| `connectors/adt/*` (auth shapes) | `mcp-abap-adt` — service-key / destination pattern + 3 auth chains (basic, SNC, JWT-browser-login) | **Pattern-only** — take the destination = service-key-filename model, the `SAP_CONNECTION_TYPE=http|rfc` switch, the `mcp-auth` browser-login flow (port 61001), and the `x-sap-jwt-token` header convention for our HTTP transport. We do **not** adopt the 12-binary / dual-license split; we expose one server with a single tool surface. |
| `core/utils/logger.ts` | `hana-mcp-server/src/utils/logger.js` | **Pattern-only** — the `logger.tool(name, args)` entry/exit trace, level filter (`LOG_LEVEL`), file/console toggles (`ENABLE_FILE_LOGGING` / `ENABLE_CONSOLE_LOGGING`) and the stdio-friendly "console → stderr" rule. |
| `core/utils/audit-logger.ts` | `hana-mcp-server/src/utils/audit-logger.js` | **Pattern-only** — structured audit record (tool name, args, caller, result, latency) with secret fields redacted before write. |
| `core/utils/sensitive-redact.ts` (HANA portion) | `hana-mcp-server/src/utils/sensitive-redact.js` | **Port** the `redactSecrets(value)` walker (regex on `password|token|authorization` keys + base64 + URL-encode variants) — this is already the shape our `sensitive-redact.ts` will expose. Also feeds `safeError` in the ADT connector (see above). |

---

## 5. Lessons / gotchas

- **`node-rfc` native module + SAP NWRFC SDK prerequisite (RFC connector).**
  The Python reference (`sap-rfc-mcp-server`) leans on `pyrfc`, which requires
  the SAP NetWeaver RFC SDK from SAP Service Marketplace and a C build toolchain
  to install. Our TS port uses `node-rfc`, which ships prebuilt binaries for
  Linux x64 (glibc), Windows x64 and macOS ARM64 — but still requires the SAP
  NWRFC SDK (`sapnwrfc.dll` on Windows, the SDK elsewhere) at run time. CI must
  either cache the SDK or run RFC tests behind a flag; the no-SDK path
  (metadata + table readers) must remain unit-testable with mocked connections.
  `mcp-abap-adt`'s `@mcp-abap-adt/sap-rfc-lite` (prebuilt, no install script,
  `strict-allow-scripts=true`) is the supply-chain pattern to copy: deny install
  scripts by default, audit `npm audit --audit-level=moderate` in CI.
- **ADT REST quirks (ADT connector).** The `mcp-abap-adt` CLAUDE.md and
  `@mcp-abap-adt/adt-clients/docs/usage/ERRATA.md` record ~25 measured SAP
  ambiguities. Three we must account for in our `AdtClient`:
  (a) `200` with `isDeleted="false"` is a *refused* delete, not success;
  (b) `activationExecuted="false"` with `<msg type="E">` is a *failed*
  activation, not a no-op;
  (c) `403` on the LOCK before a service binding's publication is an existing
  editing session — Eclipse ADT ignores it and posts the job, so our
  `analysePublicationLock` strategy should do the same. PAK/058 ("a package can
  be saved only once per ABAP session" — the message says *locked*, but it is
  `CL_PACKAGE`'s in-memory buffer) means our RFC connector's `resetServerContext`
  on a reused conversation must come from `@mcp-abap-adt/sap-rfc-lite` ≥ 0.2.1
  (0.2.0 silently fell back to a new connection per stateless call — ~1.5× slower).
  XML entity declarations must be rejected (XXE); input JSON bounded by bytes,
  nesting, arrays, field contracts.
- **SAC token refresh (SAC connector).** The reference caches the bearer with a
  60 s safety margin before `expires_in` and caches CSRF for 10 min; write ops
  auto-retry once on `403` by invalidating CSRF + clearing the cookie jar and
  re-fetching. We must preserve this exactly — a stale CSRF is the most common
  SAC integration failure. `Headers.getSetCookie()` requires Node 18+, so our
  `engines.node` floor is 18 (matching the reference). The `allowalteration=true`
  argument on every write tool is a cheap dark-pattern guard we should keep.
- **One SAP session, one operation at a time (ADT).** `mcp-abap-abap-adt-api`
  enforces a single in-flight call (`429 SAP session is busy`); cancellation
  closes real sockets but leaves SAP state (locks, partial writes) that the
  caller must inspect before an explicit `login` / `dropSession` / `logout`
  recovery. Our `AdtClient` must surface this as a typed `RecoveryRequiredError`
  and refuse further calls until recovery — not as a generic `Error`.
- **Result paging for large ADT reads.** Above 64 KiB a tool result returns
  `resultId` + JSON page + `nextOffset`; `readResultPage` concatenates and
  JSON-parses. At most four 4 MiB results live for five minutes; mutations and
  session resets clear them. Our `AdtClient` should expose this as a streaming
  async iterator so the MCP tool layer never holds a multi-MiB string.
- **HANA DML guard + paging snapshots.** `hana-mcp-server` blocks
  `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` by default (opt-in per env var) and
  implements query paging via a snapshot store (`HANA_QUERY_SNAPSHOT_TTL_MS`,
  default 5 min) — `hana_execute_query` returns the first page + a `snapshotId`
  that `hana_query_next_page` continues. If we ever add a HANA connector later
  (not in scope for Tasks 8–10), both patterns are mandatory.
- **Windows-specific issues during clone.** None. All five `git clone --depth 1`
  commands completed on the first try under PowerShell 7 on Windows; no
  re-authentication prompts, no long-path failures. The only Windows caveat is
  the `node-rfc` binary (Windows x64 prebuilt available) and `sapnwrfc.dll`
  from SAP GUI's 64-bit install in `System32` — a run-time, not a clone-time,
  concern.

---

## 6. Why these 5

- **`thupalo/sap-rfc-mcp-server`** — the only one of the five that speaks SAP
  RFC directly (via `pyrfc`); its `sap_client.py`, `metadata_manager.py` +
  `metadata_cache.py`, `rfc_table_reader.py` and `secure_config.py` +
  `sap_security_manager.py` map 1:1 onto the four files our RFC connector needs
  (§4). It is the primary source for the RFC connector (Tasks 8).
- **`JumenEngels/sap_analytics_cloud_mcp`** — the only one that speaks SAP
  Analytics Cloud; its `src/auth/sac-client.ts` is already idiomatic TS using
  native `fetch` + `Headers.getSetCookie`, and its 90 tools in `src/tools/*.ts`
  are the entire SAC REST API surface our SAC connector (Tasks 9) must expose.
  Porting is near-verbatim.
- **`HatriGt/hana-mcp-server`** — not a connector we build (HANA is out of scope
  for Tasks 8–10) but the cleanest source for the three core utils our framework
  runs on: `src/utils/logger.js`, `audit-logger.js`, `sensitive-redact.js`. Also
  the reference for DML-guard + paging-snapshot patterns if a HANA connector is
  added later.
- **`mario-andreschak/mcp-abap-abap-adt-api`** — wraps the `abap-adt-api` npm
  package (which we will also depend on) and shows the production shape of an
  ADT MCP server: `BoundedHttpClient`, `requestContext`, `SourceCache`,
  `ResultPages`, the `mutations` set, the "one operation at a time / recovery
  required" state machine, and `argumentSecrets` redaction. Its 126 handler
  tools + `healthcheck` + `readResultPage` are the pattern our ADT connector's
  tool surface follows (Tasks 10).
- **`fr0ster/mcp-abap-adt`** — the most mature ADT MCP server (268 tools, 3
  transports, 12 binaries, RAP + debugger + batch + long-session). We do not
  port its tool surface wholesale (it is AGPL-3.0 for servers and ships its own
  `@mcp-abap-adt/*` ecosystem); instead we take its auth shapes (basic / SNC /
  JWT-browser-login / service-key destinations) and the `x-sap-jwt-token`
  header convention for our HTTP transport. It is also the source for the ADT
  errata + the `resetServerContext` rule (§5).

### Repos EXCLUDED as false positives or out-of-scope

- **`Sapo-MCP`** — Sapo.vn point-of-sale platform (Vietnam retail), not SAP.
  Name collision only; excluded as a false positive.
- **`abap-ai/mcp`** — an ABAP-language SDK for building MCP servers *inside* an
  SAP system (ABAP writes the server). Different paradigm from our Node-based
  external MCP server; excluded.
- **`cap-mcp-plugin`** — SAP Cloud Application Programming Model (CAP/CDS)
  helper. A future CAP connector is conceivable; not in scope for the RFC/SAC/
  ADT connectors of Tasks 8–10.
- **`SAP/leanix-ai-plugins`** — LeanIX (enterprise-architecture tooling, an
  SAP-companies acquisition). Not a SAP-system connector; future scope.
- **`blumenkuebel/sap-dm-pod2-mcp-server`** — SAP Digital Manufacturing pod
  server. A future DM connector; not in scope for the three we build.
- **`etosin/arc-draw`** — BTP resource diagramming / architecture-drawing tool.
  Not a SAP-system connector; utility, not a reference for any of our connectors.

---

### Sources consulted

- `sap-rfc-mcp-server`: `README.md`, `sap_rfc_mcp_server/server.py`,
  `sap_rfc_mcp_server/http_server.py`, `sap_rfc_mcp_server/sap_client.py`,
  `LICENSE`. Tool counts: 12 stdio (`server.py` `Tool(…)` entries) + 8 HTTP
  (`http_server.py` `Tool(…)` entries).
- `sap_analytics_cloud_mcp`: `README.md`, `src/index.ts`, `src/tools/index.ts`,
  `src/auth/sac-client.ts`, `src/tools/content.ts` (sampled), `LICENSE`. Tool
  count: 90 — verified by counting `server.tool(` occurrences across
  `src/tools/*.ts` (1 in `index.ts` + 89 in modules).
- `hana-mcp-server`: `README.md`, `src/server/index.js`, `src/tools/*.js`
  (`config-tools.js`, `index-tools.js` sampled), `src/utils/` directory listing,
  `LICENSE`. Tool count: 34 — verified by extracting unique `logger.tool('…')`
  names.
- `mcp-abap-abap-adt-api`: `README.md`, `src/index.ts`, `src/server.ts`,
  `src/handlers/` directory listing + `registry.ts`-driven `name: "…"` entries
  across 26 handler files, `LICENSE`. Tool count: 128 — 126 unique
  `name: "…"` entries in `src/handlers/*.ts` + `healthcheck` + `readResultPage`
  registered locally in `src/server.ts`.
- `mcp-abap-adt`: `README.md`, `src/index.ts`, `src/handlers/interfaces.ts`,
  `src/handlers/class/high/handleCreateClass.ts` (sampled for `name:` pattern),
  `LICENSE`. Tool count: 268 — verified by extracting unique `name: '…'` entries
  across `src/handlers/**/*.ts`; the compact binaries collapse these into ~17
  single-step `Handler*` operations.
