# sap-mcp-unified

[English](./README.md) | 简体中文

一个统一的 [模型上下文协议（MCP）](https://modelcontextprotocol.io/) 服务器，将 SAP 系统接入大语言模型客户端。三个连接器共享同一进程、同一 MCP 传输层，所有工具统一命名为 `sap.<连接器>.<工具>`：

| 连接器 | 命名空间     | 功能                                                        |
| ------ | ------------ | ----------------------------------------------------------- |
| RFC    | `sap.rfc.*`  | 调用 BAPI/函数模块、读取表数据、查询函数元数据             |
| SAC    | `sap.sac.*`  | SAP Analytics Cloud 故事、模型、数据导入导出等              |
| ADT    | `sap.adt.*`  | 165 个工具：源码、对象、ATC、数据、短转储、abapGit、调试器、追踪、传输、重构、RAP、服务、SAP Notes、作业、CDS、版本、锁 |

## 功能概览

- **统一入口**：一个进程同时暴露 RFC + SAC + ADT 三类 SAP 能力，无需分别部署多个 MCP 服务器。
- **连接器注册表架构**：实现 `SapConnector` 接口即可接入新连接器，注册表自动命名空间化（`sap.<id>.<tool>`）、自动跳过失败的连接器。
- **优雅降级**：RFC 连接器依赖的原生模块 `node-rfc` 未安装时不会崩溃，仅记录告警并跳过，SAC/ADT 照常工作。
- **双传输模式**：支持 stdio（供 MCP 客户端拉起）和 HTTP（带可选 Bearer Token 鉴权）。
- **敏感信息脱敏**：所有工具返回结果自动经过 `redact()` 处理，密码、令牌等不会泄露给 LLM。
- **端口忠实**：RFC 连接器从 Python 参考实现完整移植；SAC 连接器将参考仓库的 ~85 个细粒度工具收敛为 11 个分发式工具；ADT 连接器封装 `abap-adt-api` v8.5.0。

## 前置条件

- **Node.js >= 20**
- **RFC 连接器专属**：需安装 [SAP NetWeaver RFC SDK](https://support.sap.com/en/product/connectors/nw-rfc-sdk.html) 并编译 `node-rfc` 原生模块。`node-rfc` 已列入 `optionalDependencies`——执行 `npm install` 时会拉取包，但在没有 SDK 的机器上原生编译会被跳过（npm 将其视为可跳过的可选依赖，安装不会卡住）。在已安装 SAP NWRFC SDK 且批准构建（`npm install-scripts approve node-rfc`）的机器上，RFC 连接器自动可用。未安装时，RFC 连接器在启动时**优雅跳过**（记录告警），SAC 和 ADT 不受影响。详见 `src/connectors/rfc/sap-client.ts` 中的动态导入守卫。

## 安装

```bash
npm install
```

## 配置

将 `.env.example` 复制为 `.env` 并填入所需连接器的凭据：

```bash
cp .env.example .env
```

关键环境变量：

| 变量                      | 说明                                                                 |
| ------------------------- | -------------------------------------------------------------------- |
| `SAP_ENABLED_CONNECTORS`  | 启用的连接器，逗号分隔，取自 `rfc,sac,adt`（留空 = 不启用任何连接器，服务器仍可启动） |
| `SAP_TRANSPORT`           | 传输模式：`stdio`（默认）或 `http`                                   |
| `SAP_HTTP_PORT`           | HTTP 传输监听端口（默认 8080）                                        |
| `SAP_HTTP_AUTH_TOKEN`     | HTTP 鉴权令牌（可选；设置后客户端须发送 `Authorization: Bearer <token>`） |
| `SAP_LOG_LEVEL`           | 日志级别（`info`/`warn`/`debug` 等）                                  |
| `SAP_<ID>_*`              | 各连接器的专属配置（如 `SAP_RFC_ASHOST`、`SAP_SAC_URL`、`SAP_ADT_BASEURL`） |

各连接器完整环境变量见 `.env.example`。

### RFC 配置

```env
SAP_RFC_ASHOST=sap.example.com   # SAP 应用服务器地址
SAP_RFC_SYSNR=00                 # 系统编号
SAP_RFC_CLIENT=100               # 集团号
SAP_RFC_USER=RFCUSER             # 用户名
SAP_RFC_PASSWD=********          # 密码
SAP_RFC_LANG=EN                  # 登录语言
```

### SAC 配置

```env
SAP_SAC_URL=https://my-tenant.eu1.sapanalytics.cloud
SAP_SAC_TOKEN=********           # Bearer 令牌
```

### ADT 配置

```env
# Basic 认证（本地 ABAP 系统）
SAP_ADT_BASEURL=https://abap.example.com:44300
SAP_ADT_AUTHMODE=basic
SAP_ADT_USER=DEVELOPER
SAP_ADT_PASS=********

# BTP ABAP Environment（XSUAA 认证）
SAP_ADT_AUTHMODE=xsuaa
SAP_ADT_CLIENTID=********
SAP_ADT_CLIENTSECRET=********
SAP_ADT_TOKENURL=https://my-tenant.authentication.eu10.hana.ondemand.com/oauth/token
```

## 运行

```bash
# stdio 模式（默认——供 MCP 客户端拉起）
npm run dev

# HTTP 模式
SAP_TRANSPORT=http SAP_HTTP_PORT=8080 npm run dev
```

生产构建：

```bash
npm run build
npm start
```

### 在 MCP 客户端中使用

Claude Desktop / Cursor / 其他 MCP 客户端的配置示例（stdio）：

```json
{
  "mcpServers": {
    "sap": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "/path/to/sap-mcp-unified",
      "env": {
        "SAP_ENABLED_CONNECTORS": "sac,adt",
        "SAP_SAC_URL": "https://my-tenant.sapanalytics.cloud",
        "SAP_SAC_TOKEN": "...",
        "SAP_ADT_BASEURL": "https://abap.example.com",
        "SAP_ADT_AUTHMODE": "basic",
        "SAP_ADT_USER": "DEVELOPER",
        "SAP_ADT_PASS": "..."
      }
    }
  }
}
```

## 工具清单

所有工具由注册表统一加上 `sap.<id>.<name>` 前缀。初始化失败的连接器会被**跳过**，绝不阻塞其他连接器。

### RFC — `sap.rfc.*`

需要 SAP NWRFC SDK + `node-rfc` 原生模块（见前置条件）。从 Python `sap-rfc-mcp-server` 参考实现移植。

| 工具                     | 参数                                  | 说明                                |
| ------------------------ | ------------------------------------- | ----------------------------------- |
| `call_function`          | `function`, `imports?`, `tables?`     | 调用 SAP RFC 函数模块 / BAPI        |
| `read_table`             | `table`, `fields?`, `where?`, `maxRows?` | 读取 SAP 表数据（RFC_READ_TABLE）   |
| `get_function_metadata`  | `function`                            | 查询 RFC 函数模块的参数元数据       |
| `search_functions`       | `pattern`                             | 按名称模式搜索 RFC 函数模块         |

### SAC — `sap.sac.*`

SAP Analytics Cloud。每个工具通过 `operation` 字段分发（`smart-query` 除外，它接受直接查询参数）。列表类操作接受标准 OData 参数（`$top`、`$skip`、`$filter`、`$orderby`、`$select`、`$expand`、`$count`）；写操作需传入 `allowalteration: true` 作为安全确认。

- **`calendar`**（3 个操作）— `get_event`, `update_event`, `copy_event`
- **`content`**（10 个操作）— `stories_list`, `stories_copy`, `stories_rename`, `stories_delete`, `metadata_get`, `resources_list`, `resources_get`, `filerepository_list`, `repositories_list`, `widget_get_data`
- **`content-transport`**（7 个操作）— `create_export_job`, `get_job_status`, `create_import_job`, `delete_content`, `get_content_item`, `get_permissions`, `move_item`
- **`data-export`**（22 个操作）— `list_namespaces`, `get_namespace`, `list_providers`, `list_subscriptions`, `get_subscription`, `list_provider_subscriptions`, `create_subscription`, `delete_subscription`, `admin_metadata`, `get_provider_metadata`, `get_provider_entities`, `get_fact_data`, `get_fact_data_aggregation`, `get_fact_data_difference`, `get_master_data`, `get_dimension_master`, `get_dimension_master_hierarchy`, `get_audit_data`, `get_currency_table`, `get_conversion_rates`, `get_public_dimension_data`, `get_data`
- **`data-import`**（19 个操作）— `list_models`, `get_model`, `get_model_metadata`, `create_job`, `list_jobs`, `upload_data`, `validate_job`, `run_job`, `get_job_status`, `get_invalid_rows`, `delete_job`, `oneclick`, `list_public_dimensions`, `get_public_dimension`, `get_public_dimension_metadata`, `create_public_dimension_job`, `list_currency_conversions`, `get_currency_conversion`, `get_currency_conversion_metadata`
- **`monitoring`**（2 个操作）— `audit_export`, `monitoring_get`
- **`multi-actions`**（2 个操作）— `execute`, `get_status`
- **`schedule-publication`**（4 个操作）— `get_template`, `create`, `update`, `delete`
- **`smart-query`** — 直接参数（`modelId`, `viewId`, `query`, `execute` 等），无 `operation` 分发
- **`translation`**（4 个操作）— `list_artifacts`, `get_artifact`, `download_xliff`, `download_xliff_bulk`
- **`user-management`**（10 个操作）— `users_list`, `users_get`, `users_create`, `users_update`, `users_patch`, `users_delete`, `teams_list`, `teams_create`, `teams_patch`, `users_bulk`

### ADT — `sap.adt.*`

ABAP Development Tools，封装 `abap-adt-api` v8.5.0。支持 Basic 认证（用户名/密码）和 XSUAA（client_credentials 持有者令牌）。**165 个工具**——49 个手工编写的带类型 schema 的工具（见下表）+ 116 个自动生成的工具，暴露所有剩余的 `ADTClient` 方法（调试器、追踪、日志点、RAP、重构、服务等）。每个自动生成的工具接受位置参数 `args` 并委托给 `ADTClient.<method>()`。

**手工编写工具（49 个）：**

| 工具                    | 参数                                                                   | 说明                                                                                       |
| ----------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `read_source`           | `objectUrl`                                                            | 读取 ABAP 对象源码                                                                         |
| `write_source`          | `objectUrl`, `content`                                                | 写入 ABAP 源码（自动加锁/解锁）                                                            |
| `syntax_check`          | `objectUrl`, `mainUrl?`, `content?`, `mainProgram?`                  | 检查 ABAP 语法                                                                             |
| `pretty_print`          | `source`                                                              | 通过 SAP 格式化器格式化源码                                                                |
| `revisions`             | `objectUrl`                                                           | 列出对象版本历史                                                                           |
| `search_objects`        | `query`                                                              | 搜索 ABAP 仓库对象                                                                         |
| `create_object`         | `objtype`, `name`, `parentName`, `description`, `parentPath`, `responsible?`, `transport?` | 创建新的 ABAP 对象                                                    |
| `delete_object`         | `objectUrl`, `lockHandle`, `transport?`                              | 删除 ABAP 对象                                                                             |
| `activate`              | `objectUrl`                                                           | 激活 ABAP 对象                                                                             |
| `object_structure`      | `objectUrl`                                                           | 获取对象结构/元数据                                                                        |
| `inactive_objects`      | —                                                                    | 列出所有未激活对象                                                                         |
| `validate_new_object`   | `options`                                                            | 创建前验证对象参数                                                                         |
| `where_used`            | `objectUrl`, `line?`, `column?`                                      | 对象使用位置列表                                                                           |
| `find_definition`       | `objectUrl`, `source`, `line`, `startCol`, `endCol`                  | 查找符号定义位置                                                                           |
| `run_class`             | `className`                                                          | 运行 ABAP 控制台类（IF_OO_ADT_CLASSRUN）                                                  |
| `run_unit_tests`        | `objectUrl`                                                           | 对对象运行 ABAP 单元测试                                                                   |
| `run_atc`               | `objectUrl`, `variant?`                                              | 运行 ABAP Test Cockpit（`variant` 默认 `default`）                                         |
| `atc_worklists`         | —                                                                    | 列出 ATC 工作列表                                                                          |
| `atc_fix_proposals`     | `objectUrl`, `source`, `line`, `column`                             | 获取 ATC 快速修复方案                                                                      |
| `table_contents`        | `ddicEntityName`, `rowNumber?`, `sqlQuery?`                         | 通过 ADT Data Preview 读取表/CDS 数据（无需 RFC SDK）                                      |
| `run_query`             | `sqlQuery`, `rowNumber?`                                            | 通过 ADT Data Preview 运行 OpenSQL 查询                                                   |
| `ddic_element`          | `path`（字符串或字符串数组）                                          | 获取 DDIC 元素元数据                                                                       |
| `package_search_help`   | `type`, `name?`                                                     | 包的 F4 值帮助                                                                             |
| `list_dumps`            | `query?`                                                            | 列出 ST22 短转储                                                                          |
| `feeds`                 | —                                                                   | 列出可用的 ADT Feed                                                                       |
| `manage_transports`     | `action`（`add`/`release`/`import`）, `transportId`, `objectUrl?`, `requestText?`, `devclass?` | `add` 创建传输请求；`release` 释放传输；`import` 是 STMS 操作（请用事务 STMS） |
| `transport_details`     | `transportNumber`                                                   | 获取传输请求详情                                                                           |
| `user_transports`       | `user`                                                              | 列出用户的传输                                                                             |
| `git_repos`             | —                                                                   | 列出 abapGit 仓库                                                                         |
| `git_pull`              | `repoId`, `branch?`, `transport?`, `user?`, `password?`             | 拉取 abapGit 仓库                                                                         |
| `rename_preview`        | `objectUrl`, `line`, `startCol`, `endCol`                          | 预览重命名重构                                                                             |
| `extract_method_preview`| `objectUrl`, `line`, `startCol`, `endCol`                          | 预览抽取方法重构                                                                           |
| `rap_gen_preview`       | `content`                                                           | 预览 RAP 生成                                                                             |
| `dump_details`          | `dumpId`, `startLine?`, `maxLines?`                                | 按转储 ID 读取短转储跟踪                                                                   |
| `system_info`           | `refresh?`                                                          | 获取 SAP 系统配置信息                                                                      |
| `source_search`         | `searchString`, `packages?`, `objectTypes?`, `objectName?`, `maxResults?` | 全仓库全文搜索（grep 风格）                                                     |
| `list_locks`            | `client?`, `user?`, `table?`                                        | 列出活动 ABAP 锁（SM12 等效）                                                              |
| `get_note`              | `note`                                                              | 按 ID 获取 SAP Note                                                                        |
| `check_note_status`     | `note`                                                              | 检查 SAP Note 的实施状态                                                                   |
| `implement_note`        | `note`, `transport?`                                               | 将 SAP Note 实施（部署）到传输请求                                                         |
| `schedule_job`          | `jobName`, `program`, `user`, `startTime?`, `endTime?`, `startMode?`, `target?`, `transport?` | 计划 ABAP 后台作业                          |
| `read_spool`            | `spoolId`                                                           | 按 spool ID 读取 spool 请求内容                                                            |
| `cds_dependencies`      | `entity`                                                            | 获取 CDS 视图依赖关系图                                                                    |
| `list_versions`         | `objectUrl`                                                         | 列出 ABAP 对象的所有版本                                                                   |
| `compare_versions`      | `sourceUri`, `from`, `to`                                           | 对比 ABAP 对象的两个版本（活动版 vs 非活动版）                                            |
| `package_tree`          | `packageName`, `maxDepth?`, `maxObjects?`                           | 递归列出包层次结构                                                                         |
| `object_diff`           | `objectUrl`, `fromVersion?`, `toVersion?`                           | 显示 ABAP 对象两个版本之间的统一差异                                                       |
| `resolve_transport`     | `objectUrl`, `createIfMissing?`                                     | 为对象解析最佳传输请求                                                                     |
| `force_unlock`          | `objectUrl`, `dropSession?`                                         | 强制解锁 ABAP 对象                                                                         |

**自动生成工具（119 个）** — 每个剩余的 `ADTClient` 方法一个。命名规则：camelCase 方法名 → snake_case 工具名（例如 `debuggerStep` → `debugger_step`）。每个接受 `{ args?: unknown[] }`（位置参数）。主要分类：

- **调试器**（17 个）：`debugger_step`、`debugger_set_breakpoints`、`debugger_stack_trace`、`debugger_variables`、`debugger_attach`、`debugger_listen`、`debugger_set_variable_value`、`debugger_create_watchpoint` 等
- **追踪**（9 个）：`traces_list`、`traces_hit_list`、`traces_statements`、`traces_create_configuration`、`traces_delete` 等
- **日志点**（7 个）：`create_logpoint`、`delete_logpoint`、`get_log_point_logs`、`get_log_servers` 等
- **重构**（6 个）：`rename_execute`、`rename_preview`、`extract_method_execute`、`extract_method_preview`、`change_package_preview`、`change_package_execute`
- **RAP**（7 个）：`rap_gen_generate`、`rap_gen_get_schema`、`rap_gen_get_content`、`rap_gen_validate_initial`、`rap_gen_validate_content`、`rap_gen_is_available`、`rap_gen_publish_service`
- **服务**（4 个）：`publish_service_binding`、`un_publish_service_binding`、`binding_details`
- **Git**（7 个）：`git_create_repo`、`git_unlink_repo`、`push_repo`、`stage_repo`、`switch_repo_branch`、`remote_repo_info`、`git_external_repo_info`
- **ATC**（9 个）：`atc_customizing`、`atc_check_variant`、`atc_users`、`atc_exempt_proposal`、`atc_request_exemption`、`atc_documentation`、`atc_change_contact`、`atc_contact_uri`
- **传输**（9 个）：`transport_info`、`transport_delete`、`transport_add_user`、`transport_set_owner`、`transport_reference`、`transports_by_config`、`transport_configurations`、`get_transport_configuration`、`set_transports_config`
- **发现**（7 个）：`load_types`、`object_types`、`adt_discovery`、`adt_core_discovery`、`adt_compatibiliy_graph`、`feature_details`、`collection_feature_details`
- **数据/DDIC**（8 个）：`ddic_repository_access`、`annotation_definitions`、`get_data_element_properties`、`set_data_element_properties`、`get_domain_properties`、`set_domain_properties`、`object_structure_elements`、`code_completion`
- **对象**（6 个）：`class_components`、`find_object_path`、`object_registration_info`、`object_enhancements`、`main_programs`、`type_hierarchy`
- **单元测试**（2 个）：`unit_test_evaluation`、`unit_test_occurrence_markers`
- **会话**（3 个）：`login`、`logout`、`drop_session`

## 使用示例

### 调用 RFC 函数

```
工具：sap.rfc.call_function
参数：{ "function": "BAPI_USER_GET_DETAIL", "imports": { "USERNAME": "DEVELOPER" } }
```

### 读取 SAP 表

```
工具：sap.rfc.read_table
参数：{ "table": "USR02", "fields": ["BNAME", "USTYP"], "where": "MANDT = '100'", "maxRows": 50 }
```

### 列出 SAC 故事

```
工具：sap.sac.content
参数：{ "operation": "stories_list", "includeModels": true }
```

### 读取 ABAP 源码

```
工具：sap.adt.read_source
参数：{ "objectUrl": "/sap/bc/adt/programs/programs/zhello/source/main" }
```

### 运行 ATC 检查

```
工具：sap.adt.run_atc
参数：{ "objectUrl": "/sap/bc/adt/programs/programs/zhello", "variant": "default" }
```

## 添加新连接器

1. 在 `src/connectors/<id>/` 下实现 `SapConnector` 接口（`src/core/types.ts`）：`id`、`init`、`tools`，可选 `resources`/`prompts`/`shutdown`。
2. 创建工厂函数 `create<My>Connector()`，放在 `src/connectors/<id>/index.ts`。
3. 在 `src/index.ts` 中注册（以 `config.enabled` 门控）。
4. 将该连接器的 `SAP_<ID>_*` 环境变量加入 `.env.example`。

注册表负责命名空间化（`sap.<id>.<tool>`）、失败跳过、以及将工具/资源/提示词接入 MCP 服务器。

## 架构

```
src/
  index.ts                 # 入口：loadConfig -> Registry -> startServer
  core/
    types.ts              # SapConnector、ToolRegistration、ToolResult 等类型定义
    config.ts             # loadConfig()：环境变量 -> AppConfig（按连接器分组）
    registry.ts           # Registry：命名空间化、initAll（失败跳过）
    server.ts             # buildMcpServer + startServer（stdio | http）
    utils/
      logger.ts           # pino 日志
      sensitive-redact.ts # redact() 应用于每个工具结果
  connectors/
    rfc/                  # SAP RFC（node-rfc，从 Python 参考移植）
    sac/                  # SAP Analytics Cloud（OData REST）
    adt/                  # ABAP Development Tools（abap-adt-api v8.5.0）
  types/
    node-rfc.d.ts         # 环境类型垫片（无原生模块时通过 typecheck）
```

设计文档和实施计划见 `docs/superpowers/`，参考仓库分析见 `reference/ANALYSIS.md`。

## 许可证

MIT
