# sap-mcp-unified

[English](./README.md) | 简体中文

一个统一的 [Model Context Protocol](https://modelcontextprotocol.io/) 服务器，将
SAP 系统暴露给 LLM 客户端。四个连接器共享一个进程和一条 MCP 传输通道，所有工具
按 `sap.<connector>.<tool>` 命名空间注册：

| 连接器 | 命名空间     | 能力                                                           |
| ------ | ------------ | -------------------------------------------------------------- |
| RFC    | `sap.rfc.*`  | 调用 BAPI/函数模块、读取表、查看元数据                          |
| SAC    | `sap.sac.*`  | SAP Analytics Cloud 故事、模型、数据导出/导入等                 |
| ADT    | `sap.adt.*`  | 168 个工具：源码、对象、ATC、数据、dump、abapGit、调试器、追踪、传输、重构、RAP、服务、SAP Note、作业、CDS、版本、锁 |
| GUI    | `sap.gui.*`  | 附着到运行中的 SAP GUI 会话（免密 SSO），读写屏幕元素、弹窗、截图 |

## 前置条件

- **Node.js >= 20**
- **RFC 连接器**：需安装 [SAP NetWeaver RFC SDK](https://support.sap.com/en/product/connectors/nw-rfc-sdk.html) 并针对其编译 `node-rfc` 原生模块。`node-rfc` 列在 `optionalDependencies` 中 —— `npm install` 会拉取它，但在没有 SDK 的机器上原生编译会被跳过（npm 将失败的 optional 构建视为非致命错误，安装不会卡住）。在装有 SAP NWRFC SDK 且构建已批准（`npm install-scripts approve node-rfc`）的机器上，RFC 连接器自动可用。没有它时，RFC 连接器在启动时**优雅跳过**（记录一条警告）；SAC 和 ADT 照常工作。参见 `src/connectors/rfc/sap-client.ts` 的动态导入守卫。
- **GUI 连接器**：需 Windows 和一个运行中的 SAP GUI 会话。`winax` 列在 `optionalDependencies`（仅 Windows 的原生模块；其他平台 `npm install` 会跳过）。当 `winax` 缺失或编译失败（无编译工具）时，连接器回退到 **PowerShell COM 桥** —— 一个长驻 `pwsh -STA` 进程，通过 JSON-RPC 执行 COM 自动化，因此 GUI 连接器无需任何原生编译即可工作。`kerberos`（SPNEGO）使用预编译 N-API 二进制，同样不需要编译工具。

## 安装

```bash
npm install
```

## 配置

将 `.env.example` 复制为 `.env`，填入你要启用的连接器凭证：

```bash
cp .env.example .env
```

关键变量：

- `SAP_ENABLED_CONNECTORS` —— 逗号分隔的 `rfc,sac,adt,gui` 子集（留空 = 无连接器，服务器仍会启动）。
- `SAP_TRANSPORT` —— `stdio`（默认）或 `http`。
- `SAP_HTTP_PORT`、`SAP_HTTP_AUTH_TOKEN` —— HTTP 传输选项（bearer token 可选；设置后客户端必须发送 `Authorization: Bearer <token>`）。
- `SAP_<ID>_*` —— 各连接器配置（如 `SAP_RFC_ASHOST`、`SAP_SAC_URL`、`SAP_ADT_BASEURL`）。

## 运行

```bash
# stdio（默认 —— 适用于通过 spawn 启动服务器的 MCP 客户端）
npm run dev

# HTTP 传输
SAP_TRANSPORT=http SAP_HTTP_PORT=8080 npm run dev
```

生产构建：

```bash
npm run build
npm start
```

## CLI 工具（opencode 等）

当 CLI 工具 spawn 本 MCP 服务器时，SSO 登录方式相同。启动服务器时配置环境变量即可：

### 方式一：预置 token（自动化推荐）

```bash
# 1. 使用 mcp-auth CLI 一次性获取 token
npm install -g @mcp-abap-adt/auth-broker-cli
mcp-auth --service-key ./service-key.json --output ./mcp.env --type abap

# 2. CLI 工具携带 token 启动服务器
export SAP_ENABLED_CONNECTORS=adt
export SAP_ADT_BASEURL=https://<your-abap-system>
export SAP_ADT_AUTHMODE=jwt
export SAP_ADT_TOKEN=$(grep SAP_JWT_TOKEN mcp.env | cut -d= -f2)
npm start
```

### 方式二：浏览器登录（交互式 SSO）

```bash
# CLI 工具携带 OAuth2 配置启动服务器
export SAP_ENABLED_CONNECTORS=adt
export SAP_ADT_BASEURL=https://<your-abap-system>
export SAP_ADT_AUTHMODE=jwt
export SAP_ADT_UAA_URL=https://<your-uaa-url>
export SAP_ADT_UAA_CLIENT_ID=<client-id>
export SAP_ADT_UAA_CLIENT_SECRET=<client-secret>
npm start
```

**流程：** 服务器启动 → 检测到无 token → 打开浏览器进行 SAP 登录 → 通过
localhost:61001 回调接收授权码 → 换取 JWT → 完成认证。

### opencode 配置示例

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

或使用预置 token：

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

**配置参考：**

| 环境变量                  | 说明                    | 是否必填 |
| ------------------------- | ----------------------- | -------- |
| `SAP_ADT_AUTHMODE`        | `jwt` 启用 SSO          | 是       |
| `SAP_ADT_TOKEN`           | 预置 JWT token          | 方式一   |
| `SAP_ADT_UAA_URL`         | UAA 服务器 URL          | 方式二   |
| `SAP_ADT_UAA_CLIENT_ID`   | OAuth2 客户端 ID        | 方式二   |
| `SAP_ADT_UAA_CLIENT_SECRET` | OAuth2 客户端密钥      | 方式二   |
| `SAP_ADT_AUTH_BROKER_PORT` | 回调端口（默认 61001）  | 可选     |

---

## 工具清单

所有工具由 registry 注册到 `sap.<id>.<name>` 命名空间下。初始化失败的连接器
（如 RFC 缺少 NWRFC SDK、SAC token 无效）会被**跳过** —— 不会阻塞其他连接器。

### RFC — `sap.rfc.*`

需要 SAP NWRFC SDK + `node-rfc` 原生模块（见前置条件）。从 Python
`sap-rfc-mcp-server` 参考实现移植。

**SNC（安全网络通信）：** 设置 `SAP_RFC_SNC_MODE=1` 和
`SAP_RFC_SNC_PARTNER_NAME`（如 `p:CN=SID;O=org,C=country`）即可实现基于 TLS 的
免密 SSO。可省略 `USER`/`PASSWD` —— SNC 负责主体认证。可选：
`SAP_RFC_SNC_QOP`、`SAP_RFC_SNC_MYNAME`、`SAP_RFC_SNC_LIB`。

| 工具                     | 参数                                                              | 说明                                         |
| ------------------------ | ----------------------------------------------------------------- | -------------------------------------------- |
| `call_function`          | `function`, `imports?`, `tables?`                                 | 调用 SAP RFC 函数模块 / BAPI                 |
| `read_table`             | `table`, `fields?`, `where?`, `maxRows?`                          | 读取 SAP 表行（RFC_READ_TABLE）              |
| `read_table_complete`    | `table`, `fields?`, `where?`, `maxRows?`                          | 宽表迭代多次调用读取器                       |
| `get_function_metadata`  | `function`                                                        | 获取 RFC 函数模块的参数元数据                |
| `get_table_structure`    | `table`, `language?`                                              | 通过 DDIF_FIELDINFO_GET 获取表结构           |
| `search_functions`       | `pattern`                                                         | 按名称模式搜索 RFC 函数模块                  |
| `rfc_system_info`        | —                                                                 | 获取 SAP 系统信息（RFC_SYSTEM_INFO）         |
| `test_table_access`      | `table`                                                           | 探测表访问：结构、字段数                     |

### SAC — `sap.sac.*`

SAP Analytics Cloud。每个工具通过 `operation` 字段分派（`smart_query` 和 `ping`
除外，它们接受直接参数）。列表操作接受标准 OData 参数（`$top`、`$skip`、
`$filter`、`$orderby`、`$select`、`$expand`、`$count`）；变更操作需要
`allowalteration: true` 作为安全守卫。

- **`ping`**（1 操作）—— 返回 `pong`，用于连接验证

- **`calendar`**（3 操作）—— `get_event`、`update_event`、`copy_event`
- **`content`**（10 操作）—— `stories_list`、`stories_copy`、`stories_rename`、`stories_delete`、`metadata_get`、`resources_list`、`resources_get`、`filerepository_list`、`repositories_list`、`widget_get_data`
- **`content-transport`**（7 操作）—— `create_export_job`、`get_job_status`、`create_import_job`、`delete_content`、`get_content_item`、`get_permissions`、`move_item`
- **`data-export`**（22 操作）—— `list_namespaces`、`get_namespace`、`list_providers`、`list_subscriptions`、`get_subscription`、`list_provider_subscriptions`、`create_subscription`、`delete_subscription`、`admin_metadata`、`get_provider_metadata`、`get_provider_entities`、`get_fact_data`、`get_fact_data_aggregation`、`get_fact_data_difference`、`get_master_data`、`get_dimension_master`、`get_dimension_master_hierarchy`、`get_audit_data`、`get_currency_table`、`get_conversion_rates`、`get_public_dimension_data`、`get_data`
- **`data-import`**（19 操作）—— `list_models`、`get_model`、`get_model_metadata`、`create_job`、`list_jobs`、`upload_data`、`validate_job`、`run_job`、`get_job_status`、`get_invalid_rows`、`delete_job`、`oneclick`、`list_public_dimensions`、`get_public_dimension`、`get_public_dimension_metadata`、`create_public_dimension_job`、`list_currency_conversions`、`get_currency_conversion`、`get_currency_conversion_metadata`
- **`monitoring`**（2 操作）—— `audit_export`、`monitoring_get`
- **`multi-actions`**（2 操作）—— `execute`、`get_status`
- **`schedule-publication`**（4 操作）—— `get_template`、`create`、`update`、`delete`
- **`smart-query`** —— 直接参数（`modelId`、`viewId`、`query`、`execute`…）；不走 `operation` 分派
- **`translation`**（4 操作）—— `list_artifacts`、`get_artifact`、`download_xliff`、`download_xliff_bulk`
- **`user-management`**（10 操作）—— `users_list`、`users_get`、`users_create`、`users_update`、`users_patch`、`users_delete`、`teams_list`、`teams_create`、`teams_patch`、`users_bulk`

### ADT — `sap.adt.*`

ABAP Development Tools，封装 `abap-adt-api` v8.5.0。**168 个工具** —— 52 个
手工编写工具带类型化 schema（见下）+ 116 个自动生成工具，覆盖其余所有
`ADTClient` 方法（调试器、追踪、日志断点、RAP、重构、服务等）。每个自动生成
工具接受位置参数 `args` 并委托给 `ADTClient.<method>()`。

**本次新增：** 源码分页（`firstLine`/`lastLine`/`onlyMethod`）、文件 I/O
（`outputFile`/`sourceFile`）、部分源码守卫、只读模式、正则 grep
（`grep_source`）、包级 ATC（`run_atc_package`）、DDIC 值帮助（`value_help`）。

**认证模式：**

| 模式    | 配置                                                           | 说明                          |
| ------- | ------------------------------------------------------------- | ----------------------------- |
| `basic` | `SAP_ADT_USER`, `SAP_ADT_PASS`                                | HTTP Basic 认证（用户名/密码）|
| `xsuaa` | `SAP_ADT_CLIENT_ID`, `SAP_ADT_CLIENT_SECRET`, `SAP_ADT_TOKEN_URL` | OAuth2 client_credentials（机器对机器） |
| `jwt`   | `SAP_ADT_TOKEN`                                               | 预置 JWT bearer token（SSO）  |
| `sso`   | `SAP_ADT_SSO_TYPE`                                            | 统一 SSO —— 见下文            |

**SSO 模式（`SAP_ADT_AUTHMODE=sso`）** 通过 `SAP_ADT_SSO_TYPE` 支持所有 SSO
类型。接受**逗号分隔列表实现自动回退** —— 候选按顺序在启动时尝试（第一个有效
的胜出）；续期反复失败时，连接器切换到下一个候选并重建客户端。示例：
`SAP_ADT_SSO_TYPE=spnego,sso2,client_credentials`。

| `SAP_ADT_SSO_TYPE`    | 授权机制                        | 所需配置                                                   |
| --------------------- | ------------------------------- | ---------------------------------------------------------- |
| `oidc_browser`        | OIDC 授权码 + PKCE（浏览器）    | `SAP_ADT_CLIENT_ID`, `SAP_ADT_ISSUER_URL`                  |
| `oidc_device`         | OIDC device_code（无头模式）    | `SAP_ADT_CLIENT_ID`, `SAP_ADT_ISSUER_URL`                  |
| `oidc_password`       | OIDC 密码授权                   | `SAP_ADT_CLIENT_ID`, `SAP_ADT_USERNAME`, `SAP_ADT_PASSWORD`|
| `oidc_token_exchange` | OAuth2 token 交换               | `SAP_ADT_CLIENT_ID`, `SAP_ADT_SUBJECT_TOKEN`, `SAP_ADT_SUBJECT_TOKEN_TYPE` |
| `saml2_bearer`        | SAML2 Bearer 断言               | `SAP_ADT_CLIENT_ID`, `SAP_ADT_SAML_TRUST`, `SAP_ADT_AUTHORIZATION_ENDPOINT` |
| `saml2_pure`          | SAML2 纯模式（会话 cookie）     | `SAP_ADT_SAML_TRUST`, `SAP_ADT_AUTHORIZATION_ENDPOINT`     |
| `passcode`            | UAA/XSUAA 一次性密码            | `SAP_ADT_UAA_URL`, `SAP_ADT_CLIENT_ID`                     |
| `client_credentials`  | OAuth2 client_credentials       | `SAP_ADT_UAA_URL`/`ISSUER_URL`, `SAP_ADT_CLIENT_ID`, `SAP_ADT_CLIENT_SECRET` |
| `token`               | 预置 token                      | `SAP_ADT_ACCESS_TOKEN`                                     |
| `sso2`                | MYSAPSSO2 登录票据              | `SAP_ADT_PSE_CERT`, `SAP_ADT_PSE_KEY`, `SAP_ADT_SSO_CLIENT`, `SAP_ADT_SSO_SYSTEM` |
| `spnego`              | Kerberos SPNEGO                 | `SAP_ADT_KERBEROS_SERVICE`；自动 `kinit` 需 `SAP_ADT_KERBEROS_KEYTAB` + `SAP_ADT_KERBEROS_PRINCIPAL` |

`SAP_ADT_STRATEGY=browser|manual|external` 选择浏览器/SAML/密码流程的交互式
登录机制（默认 `browser` —— 在 `SAP_ADT_AUTH_BROKER_PORT` 上开启本地回调）。

**MYSAPSSO2（`sso2`）：** 生成由系统 PSE（DSA 密钥）签名的 SAP 登录票据。
以 PEM 字符串或文件路径提供 PSE 证书和私钥。票据作为 `MYSAPSSO2` cookie 发送，
到期后自动重新生成（`SAP_ADT_SSO_DURATION_HOURS`，默认 8）。

**自动凭证续期：** `sso2` 和 `spnego` 凭证会过期。连接器无人值守自动续期 ——
一个 `unref` 定时器调用 `refresh()`（sso2：重新生成票据）或 `prepare()`
（spnego：重新获取 Negotiate token），并用新 header 重建 ADTClient。续期频率：
- `sso2`：`(SAP_ADT_SSO_DURATION_HOURS - 1)h`（默认 7h）
- `spnego`：每 8h（Kerberos 服务票据约 10h）

**SPNEGO 自动 `kinit`（keytab 模式）：** 设置
`SAP_ADT_KERBEROS_KEYTAB` 和 `SAP_ADT_KERBEROS_PRINCIPAL`，连接器会在启动时
和每 7h 运行 `kinit -kt <keytab> <principal>` —— 无需手动 `kinit`。在
Windows 域服务账户上两者都省略（LSA 自动管理 TGT）。

**无人值守 SSO —— 哪些类型无需用户操作：**

| 类型                   | 启动              | 续期              | 备注                          |
| ---------------------- | ----------------- | ----------------- | ----------------------------- |
| `sso2`                 | 本地签名          | 自动              | PSE 密钥文件                  |
| `spnego`               | 自动 `kinit`/LSA  | 自动              | keytab 或 Windows 域账户      |
| `client_credentials`   | 自动获取 token    | 提供方刷新        | client secret                 |
| `oidc_token_exchange`  | 自动交换          | 提供方刷新        | subject token                 |
| RFC SNC                | SAP 传输层        | SAP 库            | `SAP_RFC_SNC_MODE=1`          |
| GUI `connect_existing` | 附着              | 无                | 需已登录的 GUI                |

交互式流程（`oidc_browser`、`oidc_device`、`saml2_*`、`passcode`）按协议设计
需要人工确认。

**完整 MCP 配置（无人值守 SSO + 自动回退）：**

`SAP_ADT_SSO_TYPE` 是逗号分隔的候选列表 —— 启动时按顺序尝试，续期反复失败时
切换到下一个。配置所有候选的凭证；不可用的会被静默跳过。

先构建（`npm run build`），然后将你的 MCP 客户端指向此配置：

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
        "SAP_ADT_SSO_TYPE": "spnego,sso2,client_credentials",
        "SAP_ADT_CLIENT": "100",

        "SAP_ADT_KERBEROS_SERVICE": "HTTP/sapdev.example.com",
        "SAP_ADT_KERBEROS_REALM": "EXAMPLE.COM",
        "SAP_ADT_KERBEROS_KEYTAB": "/etc/sap/sap.keytab",
        "SAP_ADT_KERBEROS_PRINCIPAL": "SAPSERVICE/mcp@EXAMPLE.COM",

        "SAP_ADT_PSE_CERT": "/etc/sap/pse_cert.pem",
        "SAP_ADT_PSE_KEY": "/etc/sap/pse_key.pem",
        "SAP_ADT_SSO_USER": "MCPUSER",
        "SAP_ADT_SSO_SYSTEM": "DEV",

        "SAP_ADT_UAA_URL": "https://sub.authentication.region.ondemand.com",
        "SAP_ADT_CLIENT_ID": "client-id",
        "SAP_ADT_CLIENT_SECRET": "client-secret",

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

一套配置适配所有环境：Windows 域账户 → SPNEGO 胜出；Linux 带 keytab → 通过
自动 `kinit` 走 SPNEGO；无 Kerberos 但有 PSE → `sso2`；两者都没有 →
`client_credentials`。删掉你没有凭证的候选（配置不完整的会被静默跳过）。

客户端配置文件位置：
- **Claude Desktop**: `%APPDATA%\Claude\claude_desktop_config.json`（合并 `mcpServers`）
- **opencode**: 项目中的 `opencode.json`，或 `~/.config/opencode/opencode.json`

### SSO 凭证获取

**ADT base URL**（`SAP_ADT_BASEURL`）—— ABAP 系统的 ADT REST 端点。

| 来源               | 方法                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| SAP GUI            | 登录 → 系统菜单 → 状态 → 记下 "HTTP server" + "HTTP port"（如 `sapdev.example.com:44300`）。URL = `https://<server>:<port>` |
| 事务 `SMICM`       | 列出已配置的 HTTP 端口（Goto → Services）                                                              |
| BTP ABAP Environment | BTP Cockpit → 服务实例 → 服务密钥 JSON 的 `urls`/`api` 字段                                            |

各候选的值来自不同系统。不可用的会被静默跳过，所以填上你能拿到的，其余留空。

**SPNEGO / Kerberos** —— Active Directory 管理员 + SAP SPNG 事务

| 变量                          | 来源                                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `SAP_ADT_KERBEROS_SERVICE`    | SPN = `HTTP/<SAP 主机 FQDN>`。主机名取自 `SAP_ADT_BASEURL`。通过事务 **SPNG** 确认 SPN 已在 SAP 注册。                                 |
| `SAP_ADT_KERBEROS_REALM`      | Active Directory 域名（大写），如 `EXAMPLE.COM`。本地运行 `whoami /groups` 或询问 AD 管理员。                                          |
| `SAP_ADT_KERBEROS_KEYTAB`     | 由 AD 管理员用 `ktpass` 生成：`ktpass /out sap.keytab /princ HTTP/sapdev.example.com@EXAMPLE.COM /mapuser DOMAIN\svc-sap /pass <pwd> /crypto AES256-SHA1` |
| `SAP_ADT_KERBEROS_PRINCIPAL`  | SPN 映射到的服务账户，如 `svc-sap@EXAMPLE.COM`（`kinit` 用它获取 TGT）。                                                                |

前提：SAP 系统已启用 SPNEGO（事务 **SPNG**），且 SPN 已在 AD 注册
（`setspn -S HTTP/sapdev.example.com DOMAIN\svc-sap`）。在 Windows 域服务
账户上，省略 `KEYTAB`/`PRINCIPAL` —— LSA 自动管理 TGT。

**MYSAPSSO2（`sso2`）** —— SAP STRUST 事务（BASIS 管理员）

| 变量                   | 来源                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `SAP_ADT_PSE_CERT`     | 事务 **STRUST**（或 `STRUSTSSO`）→ System PSE → 导出证书（PEM）。                          |
| `SAP_ADT_PSE_KEY`      | 同一 PSE → 导出 **DSA** 私钥（PEM）。MYSAPSSO2 需要 DSA 密钥。                              |
| `SAP_ADT_SSO_USER`     | 要登录的 SAP 用户（如 `MCPUSER`）。                                                         |
| `SAP_ADT_SSO_SYSTEM`   | SAP 系统 SID（如 `DEV`），profile 参数 `SAPSYSTEMNAME`。                                    |

前提：SAP 已配置 SSO2 登录票据信任（事务 `STRUSTSSO2` —— 导入 ACL/证书）。

**client_credentials（BTP ABAP Environment）** —— BTP Cockpit

| 变量                       | 来源                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `SAP_ADT_UAA_URL`          | BTP Cockpit → 子账户 → Cloud Foundry → **Service Instances** → 你的 xsuaa/abap 实例 → Service Key → JSON 的 `url` 字段。 |
| `SAP_ADT_CLIENT_ID`        | 同一服务密钥 JSON 的 `clientid` 字段。                                                                              |
| `SAP_ADT_CLIENT_SECRET`    | 同一服务密钥 JSON 的 `clientsecret` 字段。                                                                          |

创建服务密钥：BTP Cockpit → Service Instances → Service Keys →
Create → 复制 JSON。

**RFC SNC** —— SAP STRUST / profile（BASIS 管理员）

| 变量                         | 来源                                                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `SAP_RFC_SNC_PARTNER_NAME`   | SAP 系统 SNC 名称。事务 **STRUST** 或 profile 参数 `snc/identity/as`（如 `p:CN=SAPR3,OU=SAP,O=Example,C=US`）。            |
| `SAP_RFC_SNC_LIB`            | SNC 库路径：`libsapsecu.so`/`.dll`（SAPCRYPTOLIB，来自 SAP Software Center）。Linux 上也可用 `gsskrb5`/`SNCgsskrb5`。       |

前提：SAP 系统已启用 SNC（profile `snc/accept_incomplete_cred` 或完整 SNC
配置）；客户端 PSE/keytab 与 partner name 匹配。

**JWT/SSO:** 对于 SAP BTP ABAP Cloud 或需要交互式登录的场景，使用
`SAP_ADT_AUTHMODE=jwt`。两种方式：

**方式一：预置 token（脚本推荐）**
```bash
# 1. 安装 mcp-auth CLI
npm install -g @mcp-abap-adt/auth-broker-cli

# 2. 在 SAP BTP 创建服务密钥
#    - 进入 SAP BTP Cockpit → Subaccounts → Cloud Foundry
#    - 为你的 ABAP 实例创建服务密钥

# 3. 获取 token
mcp-auth --service-key ./service-key.json --output ./mcp.env --type abap

# 4. 配置 MCP 服务器
export SAP_ADT_AUTHMODE=jwt
export SAP_ADT_TOKEN=$(grep SAP_JWT_TOKEN mcp.env | cut -d= -f2)
```

**方式二：浏览器登录（交互式 SSO）**
```bash
# 配置浏览器登录
export SAP_ADT_AUTHMODE=jwt
export SAP_ADT_UAA_URL=https://<your-uaa-url>
export SAP_ADT_UAA_CLIENT_ID=<client-id>
export SAP_ADT_UAA_CLIENT_SECRET=<client-secret>

# 启动服务器 —— 它会打开浏览器进行登录
# 回调服务器监听端口 61001（可通过 SAP_ADT_AUTH_BROKER_PORT 配置）
npm start
```

未提供 token 时，服务器自动：
1. 在端口 61001 启动本地回调服务器
2. 打开浏览器跳转到 SAP 登录页
3. 通过回调接收授权码
4. 换取 JWT token
5. 使用 token 认证 ADT 请求

`@mcp-abap-adt/auth-broker` 包处理 OAuth2 authorization_code 流程。

**手工编写工具（52 个）：**

| 工具                   | 参数                                                                | 说明                                                                          |
| ---------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `read_source`          | `objectUrl`, `firstLine?`, `lastLine?`, `onlyMethod?`, `outputFile?` | 读取 ABAP 源码（分页、方法切片、文件输出）                             |
| `write_source`         | `objectUrl`, `content?`, `sourceFile?`, `skipGuard?`                     | 写入 ABAP 源码（文件输入、部分源码守卫）                                 |
| `syntax_check`         | `objectUrl`, `mainUrl?`, `content?`, `mainProgram?`                      | 检查 ABAP 语法                                                                    |
| `pretty_print`         | `source`                                                                 | 通过 SAP pretty printer 格式化 ABAP 源码                                            |
| `revisions`            | `objectUrl`                                                              | 列出对象的版本历史                                                    |
| `search_objects`       | `query`                                                                 | 搜索 ABAP 仓库对象                                                       |
| `create_object`        | `objtype`, `name`, `parentName`, `description`, `parentPath`, `responsible?`, `transport?` | 创建新的 ABAP 对象                                                 |
| `delete_object`        | `objectUrl`, `lockHandle`, `transport?`                                 | 删除 ABAP 对象                                                                |
| `activate`             | `objectUrl`                                                              | 激活 ABAP 对象                                                              |
| `object_structure`     | `objectUrl`                                                              | 获取对象结构/元数据                                                  |
| `inactive_objects`     | —                                                                       | 列出所有未激活对象                                                            |
| `validate_new_object`  | `options`                                                               | 校验对象创建参数                                                   |
| `where_used`           | `objectUrl`, `line?`, `column?`                                         | 对象的使用处列表                                                        |
| `find_definition`      | `objectUrl`, `source`, `line`, `startCol`, `endCol`                     | 查找符号定义位置                                                  |
| `run_class`            | `className`                                                             | 运行 ABAP 控制台类（IF_OO_ADT_CLASSRUN）                                        |
| `run_unit_tests`       | `objectUrl`                                                              | 运行 ABAP Unit 测试                                                                  |
| `run_atc`              | `objectUrl`, `variant?`                                                  | 运行 ABAP Test Cockpit（`variant` 默认 `default`）                             |
| `run_atc_package`      | `packageName`, `variant?`, `maxObjects?`                                 | 对整个包运行 ATC（worklist 流程）                                       |
| `atc_worklists`        | —                                                                       | 列出 ATC 工作列表                                                                   |
| `atc_fix_proposals`    | `objectUrl`, `source`, `line`, `column`                                 | 获取 ATC quickfix 建议                                                           |
| `table_contents`       | `ddicEntityName`, `rowNumber?`, `sqlQuery?`                              | 通过 ADT Data Preview 读取表/CDS 数据（无需 RFC SDK）                                |
| `run_query`            | `sqlQuery`, `rowNumber?`                                                | 通过 ADT Data Preview 运行 OpenSQL SELECT                                              |
| `ddic_element`         | `path`（string 或 string[]）                                             | 获取 DDIC 元素元数据                                                             |
| `package_search_help`  | `type`, `name?`                                                          | 包的 F4 风格值帮助                                                     |
| `value_help`           | `domain?`, `dataElement?`, `table?`, `field?`, `language?`, `maxRows?`   | 解析 DDIC 值帮助（域固定值 / 检查表）                          |
| `list_dumps`           | `query?`                                                                | 列出 ST22 short dump                                                                |
| `feeds`                | —                                                                       | 列出可用的 ADT feed                                                             |
| `manage_transports`    | `action`（`add`/`release`/`import`）, `transportId`, `objectUrl?`, `requestText?`, `devclass?` | `add` 创建传输；`release` 释放；`import` 仅限 STMS |
| `transport_details`    | `transportNumber`                                                       | 获取传输请求详情                                                        |
| `user_transports`      | `user`                                                                  | 列出某用户的传输                                                            |
| `git_repos`            | —                                                                       | 列出 abapGit 仓库                                                            |
| `git_pull`             | `repoId`, `branch?`, `transport?`, `user?`, `password?`                 | 拉取 abapGit 仓库                                                           |
| `rename_preview`       | `objectUrl`, `line`, `startCol`, `endCol`                               | 预览重命名重构                                                         |
| `extract_method_preview` | `objectUrl`, `line`, `startCol`, `endCol`                            | 预览提取方法重构                                                |
| `rap_gen_preview`      | `content`                                                               | 从规格预览 RAP 生成                                                   |
| `dump_details`         | `dumpId`, `startLine?`, `maxLines?`                                     | 按 dump ID 读取 short dump 追踪                                     |
| `system_info`          | `refresh?`                                                              | 获取 SAP 系统 profile 信息                                                   |
| `source_search`        | `searchString`, `packages?`, `objectTypes?`, `objectName?`, `maxResults?` | ABAP 仓库全文 grep                                            |
| `grep_source`          | `pattern`, `packages?`, `transport?`, `objectUrls?`, `maxObjects?`, `maxMatches?`, `contextLines?` | 跨 ABAP 源码的 JS 正则搜索                                |
| `list_locks`           | `client?`, `user?`, `table?`                                            | 列出活动的 ABAP 锁（等效 SM12）                                             |
| `get_note`             | `note`                                                                  | 按 ID 获取 SAP Note                                                                 |
| `check_note_status`    | `note`                                                                  | 检查 SAP Note 的实施状态                                        |
| `implement_note`       | `note`, `transport?`                                                    | 将 SAP Note 实施（部署）到传输                                       |
| `schedule_job`         | `jobName`, `program`, `user`, `startTime?`, `endTime?`, `startMode?`, `target?`, `transport?` | 调度 ABAP 后台作业          |
| `read_spool`           | `spoolId`                                                               | 按 spool ID 读取 spool 请求内容                                               |
| `cds_dependencies`     | `entity`                                                                | 获取 CDS view 依赖图                                                        |
| `list_versions`        | `objectUrl`                                                             | 列出 ABAP 对象的所有版本                                                  |
| `compare_versions`     | `sourceUri`, `from`, `to`                                               | 比较两个版本的 ABAP 对象（激活 vs 未激活）                         |
| `package_tree`         | `packageName`, `maxDepth?`, `maxObjects?`                               | 递归列出包层级                                                 |
| `object_diff`          | `objectUrl`, `fromVersion?`, `toVersion?`                               | 显示对象两个版本之间的 unified diff                                  |
| `resolve_transport`    | `objectUrl`, `createIfMissing?`                                         | 为对象解析最佳传输                                         |
| `force_unlock`         | `objectUrl`, `dropSession?`                                             | 强制解锁 ABAP 对象                                                  |

**只读模式：** 设置 `SAP_ADT_READONLY=true` 阻止所有写操作
（`write_source`、`activate`、`create_object`、`delete_object`、传输、
Note、作业及自动生成的写方法）。工具返回 `isError: true` 和一条消息，不会到达 SAP。

**审计日志：** 设置 `MCP_AUDIT_FILE=./audit.jsonl` 会为每次写操作追加一条
脱敏 JSONL 记录（工具名、时间戳、脱敏参数）。

**自动生成工具（119 个）** —— 每个对应一个剩余的 `ADTClient` 方法。命名约定：
camelCase 方法 → snake_case 工具（如 `debuggerStep` → `debugger_step`）。每个
接受 `{ args?: unknown[] }`（位置参数）。主要类别：

- **调试器**（17）：`debugger_step`、`debugger_set_breakpoints`、`debugger_stack_trace`、`debugger_variables`、`debugger_attach`、`debugger_listen`、`debugger_set_variable_value`、`debugger_create_watchpoint`…
- **追踪**（9）：`traces_list`、`traces_hit_list`、`traces_statements`、`traces_create_configuration`、`traces_delete`…
- **日志断点**（7）：`create_logpoint`、`delete_logpoint`、`get_log_point_logs`、`get_log_servers`…
- **重构**（6）：`rename_execute`、`rename_preview`、`extract_method_execute`、`extract_method_preview`、`change_package_preview`、`change_package_execute`
- **RAP**（7）：`rap_gen_generate`、`rap_gen_get_schema`、`rap_gen_get_content`、`rap_gen_validate_initial`、`rap_gen_validate_content`、`rap_gen_is_available`、`rap_gen_publish_service`
- **服务**（4）：`publish_service_binding`、`un_publish_service_binding`、`binding_details`
- **Git**（7）：`git_create_repo`、`git_unlink_repo`、`push_repo`、`stage_repo`、`switch_repo_branch`、`remote_repo_info`、`git_external_repo_info`
- **ATC**（9）：`atc_customizing`、`atc_check_variant`、`atc_users`、`atc_exempt_proposal`、`atc_request_exemption`、`atc_documentation`、`atc_change_contact`、`atc_contact_uri`
- **传输**（9）：`transport_info`、`transport_delete`、`transport_add_user`、`transport_set_owner`、`transport_reference`、`transports_by_config`、`transport_configurations`、`get_transport_configuration`、`set_transports_config`
- **发现**（7）：`load_types`、`object_types`、`adt_discovery`、`adt_core_discovery`、`adt_compatibiliy_graph`、`feature_details`、`collection_feature_details`
- **数据/DDIC**（8）：`ddic_repository_access`、`annotation_definitions`、`get_data_element_properties`、`set_data_element_properties`、`get_domain_properties`、`set_domain_properties`、`object_structure_elements`、`code_completion`
- **对象**（6）：`class_components`、`find_object_path`、`object_registration_info`、`object_enhancements`、`main_programs`、`type_hierarchy`
- **Unit 测试**（2）：`unit_test_evaluation`、`unit_test_occurrence_markers`
- **会话**（3）：`login`、`logout`、`drop_session`

## 新增连接器

1. 在 `src/core/types.ts` 中实现 `SapConnector` 接口（`id`、`init`、`tools`，可选 `resources`/`prompts`/`shutdown`）。
2. 在 `src/connectors/<id>/index.ts` 下创建工厂函数 `create<My>Connector()`。
3. 在 `src/index.ts` 中注册（以 `config.enabled` 为门控）。
4. 将其 `SAP_<ID>_*` 环境变量加入 `.env.example`。

Registry 负责命名空间（`sap.<id>.<tool>`）、失败跳过，以及将 tools/resources/prompts
接入 MCP 服务器。

## 架构

```
src/
  index.ts                 # 入口：loadConfig -> Registry -> startServer
  core/
    types.ts              # SapConnector, ToolRegistration, ToolResult, ...
    config.ts             # loadConfig()：env -> AppConfig（按连接器分组）
    registry.ts           # Registry：命名空间、initAll（失败跳过）
    server.ts             # buildMcpServer + startServer（stdio | http）
    utils/
      logger.ts           # pino 日志器
      sensitive-redact.ts # redact() 应用于每个工具结果
  connectors/
    rfc/                  # SAP RFC（node-rfc，从 Python 参考移植）
    sac/                  # SAP Analytics Cloud（OData REST）
    adt/                  # ABAP Development Tools（abap-adt-api）
  types/
    node-rfc.d.ts         # 环境垫片（无原生模块也能 typecheck）
```

设计规格和实现计划见 `docs/superpowers/`，参考仓库分析见
`reference/ANALYSIS.md`。
