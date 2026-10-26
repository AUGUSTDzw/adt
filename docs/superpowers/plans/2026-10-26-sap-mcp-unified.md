# sap-mcp-unified Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one TypeScript/Node.js MCP server that exposes SAP RFC, SAP Analytics Cloud, and ABAP Development Tools through a single connector-registry entry point.

**Architecture:** A small `core` framework (server + config + registry + utils) hosts `SapConnector` plugins. v1 connectors: RFC (ported from `thupalo/sap-rfc-mcp-server` Python via `node-rfc`), SAC (adapted from `JumenEngels/sap_analytics_cloud_mcp` TS), ADT (wraps `abap-adt-api` npm lib, auth informed by `fr0ster/mcp-abap-adt`). Reference repos are cloned into `reference/` with an `ANALYSIS.md`.

**Tech Stack:** TypeScript, Node.js 20+, `@modelcontextprotocol/sdk`, `node-rfc`, `abap-adt-api`, `zod`, `dotenv`, `pino`, Vitest.

## Global Constraints

- Node.js >= 20, TypeScript >= 5.4, ESM (`"type": "module"`), Vitest for tests.
- Tool names namespaced `sap.<connectorId>.<tool>`; one `McpServer` instance.
- No SAP credentials in code/logs/git; `.env.example` holds placeholders only.
- Every connector mockable in tests — no live SAP system required for green build.
- `node-rfc` is an optional native module: if missing/broken, the RFC connector is skipped with a warning, never crashes the server.
- Follow existing reference patterns where a file is a port/adaptation (named in each task).
- DRY, YAGNI, TDD, frequent commits. Each task ends green and committed.

---

## File Structure

| Path | Responsibility |
|------|----------------|
| `src/core/types.ts` | `SapConnector` interface, `ConnectorConfig`, registration types |
| `src/core/config.ts` | env-driven config loader; per-connector sections |
| `src/core/registry.ts` | registers connectors, namespaces tools, skips broken ones |
| `src/core/server.ts` | `McpServer` bootstrap; stdio + Streamable HTTP transports |
| `src/core/utils/logger.ts` | pino structured logger |
| `src/core/utils/sensitive-redact.ts` | strip known-secret keys from output |
| `src/core/utils/audit-log.ts` | log tool calls |
| `src/connectors/sac/sac-client.ts` | SAC API client (adapted from ref `src/auth/sac-client.ts`) |
| `src/connectors/sac/index.ts` | SAC connector (tools/resources/prompts) |
| `src/connectors/adt/adt-client.ts` | wraps `abap-adt-api` + auth (informed by fr0ster) |
| `src/connectors/adt/index.ts` | ADT connector (tools) |
| `src/connectors/rfc/sap-client.ts` | node-rfc wrapper (port of ref `sap_client.py`) |
| `src/connectors/rfc/metadata-manager.ts` | function metadata + TTL cache (port) |
| `src/connectors/rfc/table-reader.ts` | RFC table read (port) |
| `src/connectors/rfc/index.ts` | RFC connector (tools) |
| `src/index.ts` | wire registry → server, start transport |
| `reference/**` | cloned ref repos (gitignored from the shipped package) |
| `reference/ANALYSIS.md` | comparison/mapping report |
| `tests/**` | Vitest specs (mirrors src tree) |
| `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `README.md` | project meta |

---

### Task 1: Project bootstrap

**Files:**
- Create: `D:\Workspace\MCP\package.json`
- Create: `D:\Workspace\MCP\tsconfig.json`
- Create: `D:\Workspace\MCP\.gitignore`
- Create: `D:\Workspace\MCP\vitest.config.ts`
- Create: `D:\Workspace\MCP\src\` and `D:\Workspace\MCP\tests\` dirs

- [ ] **Step 1: git init + base dirs**

```bash
cd D:\Workspace\MCP
git init
New-Item -ItemType Directory -Path "src\core\utils","src\connectors\sac","src\connectors\adt","src\connectors\rfc","tests\core","tests\connectors" -Force
```

- [ ] **Step 2: write `package.json`**

```json
{
  "name": "sap-mcp-unified",
  "version": "0.1.0",
  "type": "module",
  "bin": { "sap-mcp": "./dist/index.js" },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "start": "node dist/index.js"
  },
  "engines": { "node": ">=20" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "abap-adt-api": "^2.0.0",
    "dotenv": "^16.4.5",
    "pino": "^9.3.2",
    "zod": "^3.23.8"
  },
  "optionalDependencies": {
    "node-rfc": "^3.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.10",
    "tsx": "^4.16.2",
    "typescript": "^5.5.3",
    "vitest": "^2.0.3"
  }
}
```

- [ ] **Step 3: write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests", "reference"]
}
```

- [ ] **Step 4: write `.gitignore`**

```gitignore
node_modules/
dist/
.env
*.log
reference/*/  # cloned ref repos are dev-only artifacts, not committed source
```

> Note: we *clone* reference repos in Task 2 but gitignore their contents (they're third-party). `reference/ANALYSIS.md` IS committed, so list it as an exception in a later step.

- [ ] **Step 5: write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.spec.ts'] },
});
```

- [ ] **Step 6: install + verify**

Run: `npm install`
Expected: install completes; `node-rfc` optional dep may warn on Windows without SAP NWRFC SDK — that's acceptable for now.

- [ ] **Step 7: commit**

```bash
git add .
git commit -m "chore: bootstrap sap-mcp-unified project"
```

---

### Task 2: Clone reference repos + write ANALYSIS.md

**Files:**
- Create: `reference/sap-rfc-mcp-server/` (clone)
- Create: `reference/sap_analytics_cloud_mcp/` (clone)
- Create: `reference/hana-mcp-server/` (clone)
- Create: `reference/mcp-abap-abap-adt-api/` (clone)
- Create: `reference/mcp-abap-adt/` (clone)
- Create: `reference/ANALYSIS.md`

- [ ] **Step 1: clone the 5 repos**

```bash
cd D:\Workspace\MCP\reference
git clone --depth 1 https://github.com/thupalo/sap-rfc-mcp-server.git
git clone --depth 1 https://github.com/JumenEngels/sap_analytics_cloud_mcp.git
git clone --depth 1 https://github.com/HatriGt/hana-mcp-server.git
git clone --depth 1 https://github.com/mario-andreschak/mcp-abap-abap-adt-api.git
git clone --depth 1 https://github.com/fr0ster/mcp-abap-adt.git
```

- [ ] **Step 2: write `reference/ANALYSIS.md`**

Use the comparison tables from the spec (`docs/superpowers/specs/2026-10-26-sap-mcp-unified-design.md` §4 and §8). Required sections: per-repo summary, tool-surface comparison, auth comparison, reusable-code mapping (ref file → our file), lessons/gotchas, and the excluded-repos note (§11). Each table cell must be filled from the cloned sources (read each repo's README + main entry file to confirm the tool list).

- [ ] **Step 3: allow ANALYSIS.md through gitignore**

Append to `.gitignore`:
```
# keep the analysis, ignore cloned contents
!reference/ANALYSIS.md
```

- [ ] **Step 4: commit**

```bash
cd D:\Workspace\MCP
git add .gitignore reference/ANALYSIS.md
git commit -m "docs: clone SAP MCP references and add analysis report"
```

---

### Task 3: Core types — SapConnector interface

**Files:**
- Create: `src/core/types.ts`
- Test: `tests/core/types.spec.ts`

**Interfaces (produces, used by all later tasks):**
- `ConnectorConfig` — `Record<string, unknown>` per-connector config object.
- `ToolRegistration` — `{ name: string; description: string; inputSchema: ZodRawShape; handler: (args, ctx?) => Promise<ToolResult> }` (mirrors `@modelcontextprotocol/sdk` `McpServer.tool` shape).
- `ResourceRegistration`, `PromptRegistration` — analogous thin shapes.
- `SapConnector` — `{ id: string; init(config: ConnectorConfig): Promise<void>; tools(): ToolRegistration[]; resources?(): ResourceRegistration[]; prompts?(): PromptRegistration[]; shutdown?(): Promise<void> }`.

- [ ] **Step 1: write the failing test**

`tests/core/types.spec.ts`:
```ts
import { describe, it, expectTypeOf } from 'vitest';
import type { SapConnector, ToolRegistration } from '../../src/core/types.js';
import { z } from 'zod';

describe('SapConnector contract', () => {
  it('accepts a connector that returns namespaced tool registrations', () => {
    const conn: SapConnector = {
      id: 'demo',
      async init() {},
      tools(): ToolRegistration[] {
        return [{
          name: 'demo.ping',
          description: 'ping',
          inputSchema: { msg: z.string() },
          handler: async (a) => ({ content: [{ type: 'text', text: String((a as any).msg) }] }),
        }];
      },
    };
    expectTypeOf(conn.id).toEqualTypeOf<string>();
    expectTypeOf(conn.tools().length).toEqualTypeOf<number>();
  });
});
```

- [ ] **Step 2: run test to verify it fails**

Run: `npx vitest run tests/core/types.spec.ts`
Expected: FAIL — `Cannot find module '../../src/core/types.js'`.

- [ ] **Step 3: write `src/core/types.ts`**

```ts
import type { ZodRawShape } from 'zod';

export type ConnectorConfig = Record<string, unknown>;

export interface ToolResult {
  content: Array<{ type: 'text'; text: string } | { type: 'json'; json: unknown }>;
  isError?: boolean;
}

export interface ToolRegistration {
  name: string;                 // WITHOUT the sap.<id>. prefix; registry adds it
  description: string;
  inputSchema: ZodRawShape;
  handler: (args: unknown, ctx?: unknown) => Promise<ToolResult>;
}

export interface ResourceRegistration {
  uri: string;                  // template, e.g. "sap://sac/stories"
  name: string;
  description?: string;
  read: (uri: string) => Promise<ToolResult>;
}

export interface PromptRegistration {
  name: string;
  description?: string;
  args?: ZodRawShape;
  render: (args: unknown) => Promise<ToolResult>;
}

export interface SapConnector {
  id: string;                                  // connector namespace segment
  init(config: ConnectorConfig): Promise<void>;
  tools(): ToolRegistration[];
  resources?(): ResourceRegistration[];
  prompts?(): PromptRegistration[];
  shutdown?(): Promise<void>;
}
```

- [ ] **Step 4: run test to verify it passes**

Run: `npx vitest run tests/core/types.spec.ts`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add src/core/types.ts tests/core/types.spec.ts
git commit -m "feat(core): add SapConnector interface and registration types"
```

---

### Task 4: Core utils — logger + sensitive-redact

**Files:**
- Create: `src/core/utils/logger.ts`
- Create: `src/core/utils/sensitive-redact.ts`
- Test: `tests/core/utils/sensitive-redact.spec.ts`

- [ ] **Step 1: write the failing test for sensitive-redact**

`tests/core/utils/sensitive-redact.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { redact } from '../../../src/core/utils/sensitive-redact.js';

describe('redact', () => {
  it('replaces values of known-sensitive keys with [REDACTED]', () => {
    const out = redact({ host: 'h', password: 'secret', token: 'abc', nested: { PASSWD: 'x' } });
    expect(out.password).toBe('[REDACTED]');
    expect(out.token).toBe('[REDACTED]');
    expect(out.host).toBe('h');
    expect(out.nested.PASSWD).toBe('[REDACTED]');
  });
  it('redacts inside JSON strings', () => {
    const out = redact('error: password=secret token=abc');
    expect(out).toContain('password=[REDACTED]');
    expect(out).not.toContain('secret');
  });
});
```

- [ ] **Step 2: run test to verify it fails**

Run: `npx vitest run tests/core/utils/sensitive-redact.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: write `src/core/utils/sensitive-redact.ts`**

```ts
const SENSITIVE_KEYS = /^(pass|password|passwd|secret|token|apikey|api_key|authorization|userpw|clientsecret)$/i;

export function redact<T>(input: T): T {
  if (typeof input === 'string') {
    return input.replace(/(password|passwd|secret|token|apikey|api_key)=\S+/gi, '$1=[REDACTED]') as T;
  }
  if (input && typeof input === 'object') {
    if (Array.isArray(input)) return input.map(redact) as T;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? '[REDACTED]' : redact(v);
    }
    return out as T;
  }
  return input;
}
```

- [ ] **Step 4: write `src/core/utils/logger.ts`**

```ts
import pino from 'pino';
export const logger = pino({ name: 'sap-mcp', level: process.env.SAP_LOG_LEVEL ?? 'info' });
```

- [ ] **Step 5: run tests, verify pass**

Run: `npx vitest run tests/core/utils/sensitive-redact.spec.ts`
Expected: PASS.

- [ ] **Step 6: commit**

```bash
git add src/core/utils tests/core/utils
git commit -m "feat(core): add logger and sensitive-redact utils"
```

---

### Task 5: Core config loader

**Files:**
- Create: `src/core/config.ts`
- Test: `tests/core/config.spec.ts`

**Produces:** `loadConfig()` returns `{ enabled: string[]; transport: 'stdio'|'http'; httpPort?: number; httpToken?: string; connectors: Record<string, ConnectorConfig> }`. Connector configs are all env vars matching `SAP_<UPPER_ID>_*`, grouped by id.

- [ ] **Step 1: write the failing test**

`tests/core/config.spec.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadConfig } from '../../src/core/config.js';

describe('loadConfig', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = {
      SAP_ENABLED_CONNECTORS: 'rfc,sac',
      SAP_TRANSPORT: 'http',
      SAP_HTTP_PORT: '8080',
      SAP_HTTP_AUTH_TOKEN: 'tok',
      SAP_RFC_ASHOST: 'sap.example.com',
      SAP_RFC_SYSNR: '00',
      SAP_RFC_CLIENT: '100',
      SAP_RFC_USER: 'ALICE',
      SAP_RFC_PASSWD: 'pw',
      SAP_SAC_URL: 'https://sac.example.com',
      SAP_SAC_TOKEN: 'sactok',
    } as NodeJS.ProcessEnv;
  });

  it('groups per-connector env vars and reads transport', () => {
    const cfg = loadConfig();
    expect(cfg.enabled).toEqual(['rfc', 'sac']);
    expect(cfg.transport).toBe('http');
    expect(cfg.httpPort).toBe(8080);
    expect(cfg.connectors.rfc).toMatchObject({ ashost: 'sap.example.com', sysnr: '00', client: '100', user: 'ALICE', passwd: 'pw' });
    expect(cfg.connectors.sac).toMatchObject({ url: 'https://sac.example.com', token: 'sactok' });
  });

  it('defaults transport to stdio', () => {
    delete process.env.SAP_TRANSPORT;
    expect(loadConfig().transport).toBe('stdio');
  });
});
```

- [ ] **Step 2: run test to verify it fails**

Run: `npx vitest run tests/core/config.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: write `src/core/config.ts`**

```ts
import { config as loadDotenv } from 'dotenv';
import type { ConnectorConfig } from './types.js';

loadDotenv();

export interface AppConfig {
  enabled: string[];
  transport: 'stdio' | 'http';
  httpPort?: number;
  httpToken?: string;
  connectors: Record<string, ConnectorConfig>;
}

function lowerCamel(key: string): string {
  return key.toLowerCase().replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function groupConnector(prefix: string): ConnectorConfig {
  const out: ConnectorConfig = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith(prefix)) {
      out[lowerCamel(k.slice(prefix.length))] = v;
    }
  }
  return out;
}

export function loadConfig(): AppConfig {
  const enabled = (process.env.SAP_ENABLED_CONNECTORS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const transport = (process.env.SAP_TRANSPORT ?? 'stdio') as 'stdio' | 'http';
  const connectors: Record<string, ConnectorConfig> = {};
  for (const id of enabled) {
    connectors[id] = groupConnector(`SAP_${id.toUpperCase()}_`);
  }
  return {
    enabled,
    transport,
    httpPort: process.env.SAP_HTTP_PORT ? Number(process.env.SAP_HTTP_PORT) : undefined,
    httpToken: process.env.SAP_HTTP_AUTH_TOKEN,
    connectors,
  };
}
```

- [ ] **Step 4: run test to verify it passes**

Run: `npx vitest run tests/core/config.spec.ts`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add src/core/config.ts tests/core/config.spec.ts
git commit -m "feat(core): add env-driven config loader with per-connector sections"
```

---

### Task 6: Core registry

**Files:**
- Create: `src/core/registry.ts`
- Test: `tests/core/registry.spec.ts`

**Consumes:** `SapConnector` (Task 3), `loadConfig` connectors (Task 5).
**Produces:** `Registry` class: `register(connector)`, `initAll(config)` (calls `init` on enabled, skips failures with a warning), `allTools()` / `allResources()` / `allPrompts()` returning registrations with names prefixed `sap.<id>.<tool>`.

- [ ] **Step 1: write the failing test**

`tests/core/registry.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Registry } from '../../src/core/registry.js';
import type { SapConnector, ToolRegistration } from '../../src/core/types.js';
import { z } from 'zod';

function mkConn(id: string, fail = false): SapConnector {
  return {
    id,
    async init() { if (fail) throw new Error('boom'); },
    tools(): ToolRegistration[] {
      return [{ name: 'ping', description: 'p', inputSchema: { msg: z.string() },
        handler: async (a) => ({ content: [{ type: 'text', text: String((a as any).msg) }] }) }];
    },
  };
}

describe('Registry', () => {
  it('prefixes tool names with sap.<id>.', () => {
    const r = new Registry();
    r.register(mkConn('rfc'));
    const t = r.allTools();
    expect(t[0].name).toBe('sap.rfc.ping');
  });

  it('skips a connector whose init throws, keeps the others', async () => {
    const r = new Registry();
    r.register(mkConn('sac', true));
    r.register(mkConn('rfc'));
    await r.initAll({ sac: {}, rfc: {} });
    const names = r.allTools().map(t => t.name);
    expect(names).toEqual(['sap.rfc.ping']);
  });
});
```

- [ ] **Step 2: run test to verify it fails**

Run: `npx vitest run tests/core/registry.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: write `src/core/registry.ts`**

```ts
import type { SapConnector, ToolRegistration, ResourceRegistration, PromptRegistration, ConnectorConfig } from './types.js';
import { logger } from './utils/logger.js';

export class Registry {
  private connectors = new Map<string, SapConnector>();
  private healthy = new Set<string>();

  register(conn: SapConnector): void {
    this.connectors.set(conn.id, conn);
  }

  async initAll(configs: Record<string, ConnectorConfig>): Promise<void> {
    for (const [id, conn] of this.connectors) {
      try {
        await conn.init(configs[id] ?? {});
        this.healthy.add(id);
        logger.info({ connector: id }, 'connector initialized');
      } catch (err) {
        logger.warn({ connector: id, err: String(err) }, 'connector skipped');
      }
    }
  }

  allTools(): ToolRegistration[] {
    const out: ToolRegistration[] = [];
    for (const id of this.healthy) {
      const conn = this.connectors.get(id)!;
      for (const t of conn.tools()) out.push({ ...t, name: `sap.${id}.${t.name}` });
    }
    return out;
  }

  allResources(): ResourceRegistration[] {
    const out: ResourceRegistration[] = [];
    for (const id of this.healthy) {
      const conn = this.connectors.get(id)!;
      if (conn.resources) for (const r of conn.resources()) out.push(r);
    }
    return out;
  }

  allPrompts(): PromptRegistration[] {
    const out: PromptRegistration[] = [];
    for (const id of this.healthy) {
      const conn = this.connectors.get(id)!;
      if (conn.prompts) for (const p of conn.prompts()) out.push(p);
    }
    return out;
  }
}
```

- [ ] **Step 4: run test to verify it passes**

Run: `npx vitest run tests/core/registry.spec.ts`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add src/core/registry.ts tests/core/registry.spec.ts
git commit -m "feat(core): add connector registry with namespacing and failure-skipping"
```

---

### Task 7: Core server (stdio + HTTP)

**Files:**
- Create: `src/core/server.ts`
- Test: `tests/core/server.spec.ts`

**Consumes:** `Registry` (Task 6), `loadConfig` (Task 5).
**Produces:** `startServer(registry, config)` that builds one `McpServer`, registers all tools/resources/prompts from the registry, and starts the chosen transport. Tool handlers pipe output through `redact`.

- [ ] **Step 1: write the failing test**

`tests/core/server.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildMcpServer } from '../../src/core/server.js';
import { Registry } from '../../src/core/registry.js';
import type { SapConnector } from '../../src/core/types.js';
import { z } from 'zod';

const conn: SapConnector = {
  id: 'demo',
  async init() {},
  tools: () => [{
    name: 'echo', description: 'echo', inputSchema: { msg: z.string() },
    handler: async (a) => ({ content: [{ type: 'text', text: String((a as any).msg) }] }),
  }],
};

describe('buildMcpServer', () => {
  it('registers namespaced tools and redacts secrets in output', async () => {
    const r = new Registry(); r.register(conn); await r.initAll({ demo: {} });
    const srv = buildMcpServer(r);
    const tool = srv.server._registeredTools;  // SDK internals vary; see step 3 note
    expect(r.allTools()[0].name).toBe('sap.demo.echo');
    const res = await r.allTools()[0].handler({ msg: 'password=secret' });
    expect((res.content[0] as any).text).toBe('password=[REDACTED]');
  });
});
```

> Note: the SDK's internal tool map name/shape can vary by version. If `srv.server._registeredTools` is not accessible, drop that specific assertion and rely on calling the handler directly (the second assertion). Keep the test green against the actual installed SDK.

- [ ] **Step 2: run test to verify it fails**

Run: `npx vitest run tests/core/server.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: write `src/core/server.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { InMemoryEventStore } from '@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js';
import type { Registry } from './registry.js';
import type { AppConfig } from './config.js';
import { redact } from './utils/sensitive-redact.js';
import { logger } from './utils/logger.js';

export function buildMcpServer(registry: Registry): McpServer {
  const server = new McpServer({ name: 'sap-mcp-unified', version: '0.1.0' });

  for (const t of registry.allTools()) {
    server.tool(
      t.name,
      t.description,
      t.inputSchema,
      async (args, ctx) => {
        const res = await t.handler(args, ctx);
        return redact(res) as any;
      },
    );
  }
  for (const r of registry.allResources()) {
    server.resource(r.name, r.uri, async (uri) => redact(await r.read(String(uri))) as any);
  }
  for (const p of registry.allPrompts()) {
    server.prompt(p.name, p.args ?? {}, async (args) => redact(await p.render(args)) as any);
  }
  return server;
}

export async function startServer(registry: Registry, config: AppConfig): Promise<void> {
  const server = buildMcpServer(registry);

  if (config.transport === 'http') {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      eventStore: new InMemoryEventStore(),
    });
    await server.connect(transport);
    logger.info({ port: config.httpPort }, 'SAP MCP server listening (HTTP)');
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('SAP MCP server started (stdio)');
  }
}
```

> If `InMemoryEventStore` import path differs in the installed SDK version, adjust to the path exported by the installed `@modelcontextprotocol/sdk` (check `node_modules/@modelcontextprotocol/sdk/examples/`). The handler/redaction logic is the testable part.

- [ ] **Step 4: run test, verify pass**

Run: `npx vitest run tests/core/server.spec.ts`
Expected: PASS (handler redacts; transport not exercised in unit test).

- [ ] **Step 5: commit**

```bash
git add src/core/server.ts tests/core/server.spec.ts
git commit -m "feat(core): add McpServer bootstrap with stdio+HTTP and output redaction"
```

---

### Task 8: SAC connector (canonical adaptation)

This task is the template for connector adaptation. **Source:** `reference/sap_analytics_cloud_mcp/src/auth/sac-client.ts` and `reference/sap_analytics_cloud_mcp/src/tools/*`.

**Files:**
- Create: `src/connectors/sac/sac-client.ts` (adapt from ref `src/auth/sac-client.ts`)
- Create: `src/connectors/sac/index.ts` (adapt tool list from ref `src/tools/index.ts`)
- Test: `tests/connectors/sac/index.spec.ts`

**Adaptation rules (read the reference, preserve behavior):**
1. Open `reference/sap_analytics_cloud_mcp/src/auth/sac-client.ts`. Copy its auth + request logic into `sac-client.ts`, changing only: import path style to ESM; read config from a `ConnectorConfig` object (keys `url`, `token`, …) instead of `process.env` directly; export `class SacClient`.
2. Open each `reference/sap_analytics_cloud_mcp/src/tools/*.ts`. For each exported tool, wrap it as a `ToolRegistration` whose `handler` calls the ref's tool function with the SAC client. Tool `name` = the ref tool's base name (registry prefixes `sap.sac.`).
3. Drop the reference's `AgentClient/` directory entirely (it's a demo LLM client, not server code).

- [ ] **Step 1: write the failing test**

`tests/connectors/sac/index.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { createSacConnector } from '../../../src/connectors/sac/index.js';

describe('SAC connector', () => {
  it('exposes data-export and smart-query tools with namespaced-free names', async () => {
    const conn = createSacConnector();
    await conn.init({ url: 'https://sac.example.com', token: 'fake' });
    const names = conn.tools().map(t => t.name);
    expect(names).toContain('data-export');
    expect(names).toContain('smart-query');
  });

  it('handler delegates to SacClient with redaction applied by the registry/server layer', async () => {
    const conn = createSacConnector();
    await conn.init({ url: 'https://sac.example.com', token: 'fake' });
    const t = conn.tools().find(t => t.name === 'smart-query')!;
    // mock the client method used by smart-query (see sac-client.ts in step 3)
    const res = await t.handler({ query: 'sales by region' });
    expect(res.content.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: run test to verify it fails**

Run: `npx vitest run tests/connectors/sac/index.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: adapt `sac-client.ts`**

Read `reference/sap_analytics_cloud_mcp/src/auth/sac-client.ts`. Produce `src/connectors/sac/sac-client.ts` exporting `class SacClient { constructor(cfg: { url: string; token: string; }); async request(path, body): Promise<unknown> }` preserving the ref's auth/token-refresh behavior. Use `fetch` (Node 20 built-in). The class MUST be constructable from a `ConnectorConfig` so tests can pass a fake token without network.

- [ ] **Step 4: write `src/connectors/sac/index.ts`**

```ts
import type { SapConnector, ToolRegistration, ConnectorConfig } from '../../core/types.js';
import { SacClient } from './sac-client.js';

export function createSacConnector(): SapConnector {
  let client!: SacClient;
  return {
    id: 'sac',
    async init(cfg: ConnectorConfig) {
      client = new SacClient({ url: String(cfg.url), token: String(cfg.token) });
    },
    tools(): ToolRegistration[] {
      // One registration per ref tool in reference/sap_analytics_cloud_mcp/src/tools/*.ts.
      // Each handler calls the corresponding ref function through `client`.
      return [
        // data-export, data-import, content, content-transport, calendar,
        // smart-query, schedule-publication, multi-actions, monitoring,
        // translation, user-management
        // (Implement each as a ToolRegistration below, mirroring the ref file of the same name.)
      ];
    },
  };
}
```

> Fill each `ToolRegistration` by reading the matching `reference/sap_analytics_cloud_mcp/src/tools/<name>.ts`: take its input fields → `inputSchema` (zod), and its body → `handler` that calls `client.request(...)` the same way the ref does. The list of tool names above is the contract; each must be implemented, not left as a comment. (Comments here are the inventory; the implementer replaces them with real registrations.)

- [ ] **Step 5: run test, verify pass**

Run: `npx vitest run tests/connectors/sac/index.spec.ts`
Expected: PASS once all listed tools are implemented and `smart-query` returns content from the (mocked or fake-token) client. If `smart-query` requires a live SAC, stub `SacClient.request` in the test via `vi.spyOn`.

- [ ] **Step 6: commit**

```bash
git add src/connectors/sac tests/connectors/sac
git commit -m "feat(sac): adapt SAP Analytics Cloud connector from reference"
```

---

### Task 9: ADT connector (wraps abap-adt-api)

**Source:** `reference/mcp-abap-abap-adt-api` (wraps `abap-adt-api`) for tool surface; `reference/mcp-abap-adt` for auth shapes.

**Files:**
- Create: `src/connectors/adt/adt-client.ts`
- Create: `src/connectors/adt/index.ts`
- Test: `tests/connectors/adt/index.spec.ts`

**Contract — `adt-client.ts`:**
- `class AdtClient { constructor(cfg: ConnectorConfig) }` where cfg carries `baseUrl`, plus exactly one auth mode: `basic:{user,pass}` OR `xsuaa:{clientId, clientSecret, tokenUrl, tenant}` (BTP). The client acquires/refreshes the token (pattern from `reference/mcp-abap-adt` auth module) and injects it into every `abap-adt-api` call.
- Operations (each maps to an `abap-adt-api` function): `readSource(objectUrl)`, `writeSource(objectUrl, content)`, `search(query)`, `activate(objectUrl)`, `runUnitTests(objectUrl)`, `runAtc(objectUrl)`, `manageTransports(action, transportId)`.

**Contract — tool names (each a `ToolRegistration`):** `read_source`, `write_source`, `search_objects`, `activate`, `run_unit_tests`, `run_atc`, `manage_transports`.

- [ ] **Step 1: write the failing test**

`tests/connectors/adt/index.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { createAdtConnector } from '../../../src/connectors/adt/index.js';

describe('ADT connector', () => {
  it('registers the seven ADT tools', async () => {
    const conn = createAdtConnector();
    await conn.init({ baseUrl: 'https://s4.example.com', authMode: 'basic', user: 'U', pass: 'P' });
    expect(conn.tools().map(t => t.name).sort()).toEqual(
      ['activate','manage_transports','read_source','run_atc','run_unit_tests','search_objects','write_source']
    );
  });

  it('read_source delegates to AdtClient.readSource', async () => {
    const conn = createAdtConnector();
    await conn.init({ baseUrl: 'https://s4.example.com', authMode: 'basic', user: 'U', pass: 'P' });
    const t = conn.tools().find(t => t.name === 'read_source')!;
    vi.spyOn(t, 'handler'); // ensure handler is wired; real call mocked via AdtClient in impl
    const res = await t.handler({ objectUrl: '/sap/bc/adt/programs/programs/zdemo/source/main' });
    expect(res.content.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: run test to verify it fails**

Run: `npx vitest run tests/connectors/adt/index.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: write `src/connectors/adt/adt-client.ts`**

Implement `AdtClient` per the contract above. For `basic` mode, set `Authorization: Basic <btoa(user:pass)>`. For `xsuaa`, POST client credentials to `tokenUrl` to get a bearer token (mirror `reference/mcp-abap-adt` auth). Wrap `abap-adt-api`'s client with this token. If `abap-adt-api` export names differ from the contract, read `reference/mcp-abap-abap-adt-api/src` to map each operation to the correct function and note the mapping in a comment.

- [ ] **Step 4: write `src/connectors/adt/index.ts`**

```ts
import type { SapConnector, ToolRegistration, ConnectorConfig } from '../../core/types.js';
import { z } from 'zod';
import { AdtClient } from './adt-client.js';

export function createAdtConnector(): SapConnector {
  let client!: AdtClient;
  return {
    id: 'adt',
    async init(cfg: ConnectorConfig) { client = new AdtClient(cfg); },
    tools(): ToolRegistration[] {
      const objUrl = z.string();
      return [
        { name: 'read_source', description: 'Read ABAP source for an object', inputSchema: { objectUrl: objUrl },
          handler: async (a) => ({ content: [{ type: 'text', text: String(await client.readSource((a as any).objectUrl)) }] }) },
        { name: 'write_source', description: 'Write ABAP source for an object', inputSchema: { objectUrl: objUrl, content: z.string() },
          handler: async (a) => ({ content: [{ type: 'text', text: await client.writeSource((a as any).objectUrl, (a as any).content) }] }) },
        { name: 'search_objects', description: 'Search ABAP repository objects', inputSchema: { query: z.string() },
          handler: async (a) => ({ content: [{ type: 'json', json: await client.search((a as any).query) }] }) },
        { name: 'activate', description: 'Activate an ABAP object', inputSchema: { objectUrl: objUrl },
          handler: async (a) => ({ content: [{ type: 'text', text: await client.activate((a as any).objectUrl) }] }) },
        { name: 'run_unit_tests', description: 'Run ABAP Unit tests for an object', inputSchema: { objectUrl: objUrl },
          handler: async (a) => ({ content: [{ type: 'json', json: await client.runUnitTests((a as any).objectUrl) }] }) },
        { name: 'run_atc', description: 'Run ABAP Test Cockpit', inputSchema: { objectUrl: objUrl },
          handler: async (a) => ({ content: [{ type: 'json', json: await client.runAtc((a as any).objectUrl) }] }) },
        { name: 'manage_transports', description: 'Manage transports (add/release/import)', inputSchema: { action: z.enum(['add','release','import']), transportId: z.string(), objectUrl: objUrl.optional() },
          handler: async (a) => ({ content: [{ type: 'text', text: await client.manageTransports((a as any).action, (a as any).transportId, (a as any).objectUrl) }] }) },
      ];
    },
  };
}
```

- [ ] **Step 5: run test, verify pass**

Run: `npx vitest run tests/connectors/adt/index.spec.ts`
Expected: PASS (stub `AdtClient` methods via constructor injection or `vi.mock` of `./adt-client.js` to avoid network).

- [ ] **Step 6: commit**

```bash
git add src/connectors/adt tests/connectors/adt
git commit -m "feat(adt): add ADT connector wrapping abap-adt-api with basic+XSUAA auth"
```

---

### Task 10: RFC connector (port from Python)

**Source:** `reference/sap-rfc-mcp-server/sap_rfc_mcp_server/*.py`.

**Files:**
- Create: `src/connectors/rfc/sap-client.ts` (port `sap_client.py`)
- Create: `src/connectors/rfc/metadata-manager.ts` (port `metadata_manager.py` + `metadata_cache.py`)
- Create: `src/connectors/rfc/table-reader.ts` (port `rfc_table_reader.py`)
- Create: `src/connectors/rfc/index.ts`
- Test: `tests/connectors/rfc/index.spec.ts`

**Port rules:** For each `.py` file, translate its public functions to TS methods on a class, pyrfc → `node-rfc` (`import { Connection } from 'node-rfc'`), config dict → `ConnectorConfig`. Preserve the metadata TTL cache and the table-reader's pagination/options behavior. `node-rfc` is `optionalDependencies`; wrap `require('node-rfc')` in a try/catch so `init()` throws a clear "SAP NWRFC SDK not installed" error when absent (the registry then skips RFC and keeps SAC/ADT).

**Contract — tool names:** `call_function`, `read_table`, `get_function_metadata`, `search_functions`.

- [ ] **Step 1: write the failing test (RFC connector loads and lists tools even without native module)**

`tests/connectors/rfc/index.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createRfcConnector } from '../../../src/connectors/rfc/index.js';

describe('RFC connector', () => {
  it('lists the four RFC tool names', () => {
    const conn = createRfcConnector();
    expect(conn.tools().map(t => t.name).sort()).toEqual(
      ['call_function','get_function_metadata','read_table','search_functions']
    );
  });

  it('init throws a clear error when node-rfc native module is missing', async () => {
    const conn = createRfcConnector();
    // On a machine without SAP NWRFC SDK, require('node-rfc') throws.
    // We assert init rejects with a message containing "NWRFC", not a crash.
    await expect(conn.init({ ashost: 'x', sysnr: '00', client: '100', user: 'U', passwd: 'P' }))
      .rejects.toThrow(/NWRFC|node-rfc/);
  });
});
```

- [ ] **Step 2: run test to verify it fails**

Run: `npx vitest run tests/connectors/rfc/index.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: port `sap-client.ts`**

```ts
import type { ConnectorConfig } from '../../core/types.js';
import { logger } from '../../core/utils/logger.js';

let ConnectionCtor: any;
try {
  // optional native dependency
  ConnectionCtor = (await import('node-rfc')).Connection;
} catch (e) {
  logger.warn({ err: String(e) }, 'node-rfc native module unavailable');
}

export class SapRfcClient {
  private conn: any;
  constructor(private cfg: ConnectorConfig) {}
  async connect(): Promise<void> {
    if (!ConnectionCtor) throw new Error('node-rfc (SAP NWRFC SDK) not installed; cannot use RFC connector');
    this.conn = new ConnectionCtor({
      dest: 'sap-mcp',
      ASHOST: this.cfg.ashost, SYSNR: this.cfg.sysnr, CLIENT: this.cfg.client,
      USER: this.cfg.user, PASSWD: this.cfg.passwd, LANG: this.cfg.lang ?? 'EN',
    });
  }
  async call(fn: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.conn) await this.connect();
    return this.conn.call(fn, args);
  }
  async close(): Promise<void> { try { this.conn?.close(); } catch {} }
}
```

> `node-rfc` `Connection` is synchronous-constructing but `call` is sync in the base lib; the Python ref wraps async. Match the installed `node-rfc` API (it exposes promise-based `call`). If the installed version uses callbacks, promisify. Verify against `node_modules/node-rfc` README after `npm install`.

- [ ] **Step 4: port `metadata-manager.ts` + `table-reader.ts`**

Read `reference/sap-rfc-mcp-server/sap_rfc_mcp_server/metadata_manager.py` and `metadata_cache.py`; produce `metadata-manager.ts` exporting `class MetadataManager { constructor(client: SapRfcClient); async getMetadata(fn: string): Promise<unknown>; }` with the same TTL cache (default 300s) the Python ref uses. Read `rfc_table_reader.py`; produce `table-reader.ts` exporting `class TableReader { constructor(client); async read(table, options): Promise<{rows, columns}> }` preserving its field-selection/where-clause/options behavior (RFC_FUNCTION `RFC_READ_TABLE` or `BBP_RFC_READ_TABLE` per the ref's fallback).

- [ ] **Step 5: write `src/connectors/rfc/index.ts`**

```ts
import type { SapConnector, ToolRegistration, ConnectorConfig } from '../../core/types.js';
import { z } from 'zod';
import { SapRfcClient } from './sap-client.js';
import { MetadataManager } from './metadata-manager.js';
import { TableReader } from './table-reader.js';

export function createRfcConnector(): SapConnector {
  let client!: SapRfcClient;
  let meta!: MetadataManager;
  let tables!: TableReader;
  return {
    id: 'rfc',
    async init(cfg: ConnectorConfig) {
      client = new SapRfcClient(cfg); await client.connect();
      meta = new MetadataManager(client);
      tables = new TableReader(client);
    },
    tools(): ToolRegistration[] {
      return [
        { name: 'call_function', description: 'Call an SAP RFC function module / BAPI',
          inputSchema: { function: z.string(), imports: z.record(z.unknown()).optional(), tables: z.record(z.unknown()).optional() },
          handler: async (a) => ({ content: [{ type: 'json', json: await client.call((a as any).function, { ...(a as any).imports, TABLES: (a as any).tables }) }] }) },
        { name: 'read_table', description: 'Read rows from an SAP table via RFC',
          inputSchema: { table: z.string(), fields: z.array(z.string()).optional(), where: z.string().optional(), maxRows: z.number().optional() },
          handler: async (a) => ({ content: [{ type: 'json', json: await tables.read((a as any).table, a as any) }] }) },
        { name: 'get_function_metadata', description: 'Get parameter metadata for an RFC function module',
          inputSchema: { function: z.string() },
          handler: async (a) => ({ content: [{ type: 'json', json: await meta.getMetadata((a as any).function) }] }) },
        { name: 'search_functions', description: 'Search RFC function modules by name pattern',
          inputSchema: { pattern: z.string() },
          handler: async (a) => ({ content: [{ type: 'json', json: await meta.search((a as any).pattern) }] }) },
      ];
    },
    async shutdown() { await client?.close(); },
  };
}
```

> `MetadataManager.search` is a thin wrapper reading `functions` via `RFC_FUNCTION_SEARCH` (the Python ref's approach). If the ref names it differently, align to the ref.

- [ ] **Step 6: run test, verify pass**

Run: `npx vitest run tests/connectors/rfc/index.spec.ts`
Expected: PASS — tool names listed; `init` rejects with `/NWRFC|node-rfc/` when the native module is absent (the expected state in CI without the SAP SDK).

- [ ] **Step 7: commit**

```bash
git add src/connectors/rfc tests/connectors/rfc
git commit -m "feat(rfc): port SAP RFC connector from Python reference via node-rfc"
```

---

### Task 11: Wire everything — index.ts, .env.example, README

**Files:**
- Create: `src/index.ts`
- Create: `.env.example`
- Create: `README.md`

- [ ] **Step 1: write `src/index.ts`**

```ts
import { loadConfig } from './core/config.js';
import { Registry } from './core/registry.js';
import { startServer } from './core/server.js';
import { createSacConnector } from './connectors/sac/index.js';
import { createAdtConnector } from './connectors/adt/index.js';
import { createRfcConnector } from './connectors/rfc/index.js';
import { logger } from './core/utils/logger.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const registry = new Registry();
  registry.register(createRfcConnector());
  registry.register(createSacConnector());
  registry.register(createAdtConnector());
  await registry.initAll(config.connectors);
  await startServer(registry, config);
}

main().catch((err) => { logger.error({ err: String(err) }, 'fatal'); process.exit(1); });
```

- [ ] **Step 2: write `.env.example`**

```env
# Transport
SAP_TRANSPORT=stdio          # stdio | http
SAP_HTTP_PORT=8080
SAP_HTTP_AUTH_TOKEN=
SAP_LOG_LEVEL=info

# Which connectors to enable (comma-separated)
SAP_ENABLED_CONNECTORS=rfc,sac,adt

# RFC (requires SAP NWRFC SDK + node-rfc native module)
SAP_RFC_ASHOST=
SAP_RFC_SYSNR=00
SAP_RFC_CLIENT=100
SAP_RFC_USER=
SAP_RFC_PASSWD=
SAP_RFC_LANG=EN

# SAP Analytics Cloud
SAP_SAC_URL=
SAP_SAC_TOKEN=

# ABAP Development Tools  (authMode: basic | xsuaa)
SAP_ADT_BASEURL=
SAP_ADT_AUTHMODE=basic
SAP_ADT_USER=
SAP_ADT_PASS=
# BTP ABAP Environment (xsuaa):
SAP_ADT_CLIENTID=
SAP_ADT_CLIENTSECRET=
SAP_ADT_TOKENURL=
SAP_ADT_TENANT=
```

- [ ] **Step 3: write `README.md`**

Cover: what it is, prerequisites (Node 20; for RFC: SAP NWRFC SDK + `node-rfc`), install (`npm i`), configure (`.env` from `.env.example`), run (`npm run dev` for stdio, `SAP_TRANSPORT=http npm run dev` for HTTP), the `sap.<conn>.<tool>` tool inventory, how to add a connector (implement `SapConnector`, register in `index.ts`), and a pointer to `reference/ANALYSIS.md` and the spec.

- [ ] **Step 4: full green build**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass.

- [ ] **Step 5: smoke run (stdio)**

Run: `echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' | npx tsx src/index.ts`
Expected: server starts, logs `SAP MCP server started (stdio)`, responds to `initialize` (or exits if no connectors configured — set `SAP_ENABLED_CONNECTORS=` empty to skip connectors). RFC without NWRFC SDK should log a skip warning, not crash.

- [ ] **Step 6: commit**

```bash
git add src/index.ts .env.example README.md
git commit -m "feat: wire connectors into unified server entrypoint + docs"
```

---

## Verification (whole project)

- [ ] `npm run typecheck` — clean.
- [ ] `npm test` — all specs green without a live SAP system (RFC tests expect the native-module-absent path; SAC/ADT handlers mocked).
- [ ] `reference/ANALYSIS.md` exists and every table cell is filled.
- [ ] Tool namespace check: every tool from every enabled connector is `sap.<id>.<name>`.
- [ ] A disabled/misconfigured connector never blocks the others (registry test).
