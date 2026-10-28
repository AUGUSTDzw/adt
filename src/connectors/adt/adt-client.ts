/**
 * ADT API client — wraps `abap-adt-api` (v8.5.0) for ADT REST operations.
 *
 * Auth is handled INTERNALLY by `abap-adt-api`'s `ADTClient`: its constructor
 * takes `(baseUrl, username, password | BearerFetcher, client?, language?, options?)`.
 * - basic mode: pass `user` + `pass` (string) — the lib sets HTTP Basic auth
 *   (`options.auth = { username, password }`). We do NOT hand-build the
 *   `Authorization: Basic` header; the lib does it for us.
 * - xsuaa mode: pass a `BearerFetcher` (the contract's "password" slot accepts a
 *   `() => Promise<string>`). The lib calls it on login and sets
 *   `options.auth = { bearer }`. Our fetcher POSTs client_credentials to the
 *   XSUAA `tokenUrl` and returns `access_token` (mirrors the JWT/XSUUA shape in
 *   `reference/mcp-abap-adt`'s credentialSources / `TokenAuthProvider`).
 * - jwt mode: pass a `BearerFetcher` that returns a pre-provided JWT token.
 *   The token is obtained externally (e.g., via `mcp-auth` CLI or browser login)
 *   and configured via the `SAP_ADT_TOKEN` environment variable. This supports
 *   SAP BTP ABAP Cloud and XSUAA scenarios where tokens are issued by an IdP.
 *
 * abap-adt-api v8.5.0 function-name mapping (contract method → lib function):
 *   readSource(objectUrl)           → ADTClient.getObjectSource(objectSourceUrl)
 *   writeSource(objectUrl, content)  → ADTClient.setObjectSource(url, source, lockHandle, transport?)
 *                                      (acquires a lock first, releases after — the lib requires a lockHandle)
 *   search(query)                   → ADTClient.searchObject(query)
 *   activate(objectUrl)             → ADTClient.activate(objectName, objectUrl, ...) [2nd overload]
 *   runUnitTests(objectUrl)         → ADTClient.unitTestRun(url, flags?)
 *   runAtc(objectUrl, variant?)     → ADTClient.createAtcRun(variant, mainUrl, maxResults?)
 *   manageTransports('release', id) → ADTClient.transportRelease(transportNumber, ignoreLocks?, IgnoreATC?)
 *   manageTransports('add', ...)    → ADTClient.createTransport(objSourceUrl, REQUEST_TEXT, DEVCLASS, transportLayer?)
 *   manageTransports('import', ...) → NOT an ADT REST operation (STMS only). Throws.
 *
 * All seven operations are INSTANCE methods so tests can stub them via
 * `vi.spyOn(conn.client, 'readSource')` (mirrors the SAC connector's mockability hook).
 */

import { ADTClient, session_types } from 'abap-adt-api';
import { AuthBroker } from '@mcp-abap-adt/auth-broker';
import { refreshThenLogin } from '@mcp-abap-adt/auth-providers';
import { InMemorySessionStore } from './auth/InMemorySessionStore.js';
import { EnvServiceKeyStore } from './auth/EnvServiceKeyStore.js';
import { BrowserAuthStrategy } from './auth/BrowserAuthStrategy.js';
import { createSsoAuthChain, type SsoAuthChain, type SsoAuthResult } from '../../core/sso/SsoAuthFactory.js';
import type { SsoAuthConfig, SsoAuthType } from '../../core/sso/types.js';

export class AdtClient {
  private adt: ADTClient | null = null;
  private readonly authMode: 'basic' | 'xsuaa' | 'jwt' | 'sso';
  private readonly authBroker: AuthBroker | null;
  private readonly destination: string;
  private readonly baseUrl: string;
  private readonly client: string | undefined;
  private readonly language: string | undefined;
  private tokenFetcher: (() => Promise<string>) | null;
  private ssoTypes: SsoAuthType[] = [];
  private ssoCfg?: SsoAuthConfig;
  private ssoChain?: SsoAuthChain;
  private ssoFailCount = 0;
  private ssoHeaders: Record<string, string> | null = null;
  private ssoTimer?: ReturnType<typeof setInterval>;

  constructor(cfg: Record<string, unknown>) {
    // Accept both camelCase (test fixtures) and lowercase (env-var loader
    // lowerCamel output) key variants. e.g. baseUrl / baseurl.
    this.baseUrl = String(cfg.baseUrl ?? cfg.baseurl ?? '');
    this.client = cfg.client ? String(cfg.client) : undefined;
    this.language = cfg.language ? String(cfg.language) : undefined;
    this.authMode = String(cfg.authMode ?? cfg.authmode ?? 'basic') as 'basic' | 'xsuaa' | 'jwt' | 'sso';
    this.destination = String(cfg.destination ?? 'mcp');
    this.tokenFetcher = null;
    this.authBroker = null;

    if (!this.baseUrl) {
      throw new Error('AdtClient requires baseUrl');
    }

    if (this.authMode === 'xsuaa') {
      const clientId = String(cfg.clientId ?? cfg.clientid ?? '');
      const clientSecret = String(cfg.clientSecret ?? cfg.clientsecret ?? '');
      const tokenUrl = String(cfg.tokenUrl ?? cfg.tokenurl ?? '');
      if (!clientId || !clientSecret || !tokenUrl) {
        throw new Error('xsuaa auth requires clientId, clientSecret and tokenUrl');
      }
      // The lib calls this fetcher on login and sets `auth: { bearer }`.
      this.tokenFetcher = async (): Promise<string> => {
        const res = await fetch(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`XSUAA token fetch failed (${res.status}): ${text}`);
        }
        const json = (await res.json()) as { access_token?: string };
        if (!json.access_token) throw new Error('XSUAA token response missing access_token');
        return json.access_token;
      };
    } else if (this.authMode === 'jwt') {
      const token = String(cfg.token ?? cfg.jwtToken ?? '');
      const authBrokerPort = Number(cfg.authBrokerPort ?? 61001);

      if (token) {
        // Token provided - use it directly
        this.tokenFetcher = async (): Promise<string> => token;
      } else {
        // No token - use AuthBroker for browser login (initialized lazily)
        const sessionStore = new InMemorySessionStore();
        const serviceKeyStore = new EnvServiceKeyStore(cfg);

        this.authBroker = new AuthBroker({
          sessionStore,
          serviceKeyStore,
          authorization: () => new BrowserAuthStrategy(authBrokerPort),
          renewal: () => refreshThenLogin(),
          onWriteFailure: 'continue',
        });
      }
    } else if (this.authMode === 'sso') {
      const raw = String(cfg.ssoType ?? cfg.ssotype ?? '');
      this.ssoTypes = raw.split(',').map((s) => s.trim()).filter(Boolean) as SsoAuthType[];
      if (this.ssoTypes.length === 0) {
        throw new Error('sso auth requires ssoType (e.g. spnego,sso2 — comma-separated for auto-fallback)');
      }
      this.ssoCfg = this.buildSsoConfig(cfg, this.ssoTypes[0]);
    } else {
      const user = String(cfg.user ?? '');
      const pass = String(cfg.pass ?? '');
      if (!user || !pass) {
        throw new Error('basic auth requires user and pass');
      }
      // Basic auth - initialize ADTClient immediately
      this.adt = new ADTClient(this.baseUrl, user, pass, this.client, this.language);
    }
  }

  /** Maps flat connector config into an SsoAuthConfig for the chosen type. */
  private buildSsoConfig(cfg: Record<string, unknown>, ssoType: SsoAuthType): SsoAuthConfig {
    const str = (k: string): string | undefined => {
      const v = cfg[k] ?? cfg[k.toLowerCase()];
      return v !== undefined && v !== null && v !== '' ? String(v) : undefined;
    };
    const num = (k: string): number | undefined => {
      const v = str(k);
      return v !== undefined ? Number(v) : undefined;
    };
    const arr = (k: string): string[] | undefined => {
      const v = str(k);
      return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    };

    return {
      type: ssoType,
      issuerUrl: str('issuerUrl'),
      authorizationEndpoint: str('authorizationEndpoint'),
      tokenEndpoint: str('tokenEndpoint'),
      deviceAuthorizationEndpoint: str('deviceAuthorizationEndpoint'),
      clientId: str('clientId'),
      clientSecret: str('clientSecret'),
      scopes: arr('scopes'),
      username: str('username'),
      password: str('password'),
      subjectToken: str('subjectToken'),
      subjectTokenType: str('subjectTokenType'),
      audience: str('audience'),
      actorToken: str('actorToken'),
      actorTokenType: str('actorTokenType'),
      samlTrust: str('samlTrust'),
      uaaUrl: str('uaaUrl'),
      pseCert: str('pseCert'),
      pseKey: str('pseKey'),
      ssoUser: str('ssoUser'),
      ssoClient: str('ssoClient') ?? this.client,
      ssoSystem: str('ssoSystem'),
      ssoDurationHours: num('ssoDurationHours'),
      ssoCodepage: (str('ssoCodepage') as '4103' | '4102') ?? '4103',
      accessToken: str('accessToken'),
      refreshToken: str('refreshToken'),
      expiresAt: num('expiresAt'),
      strategy: (str('strategy') as SsoAuthConfig['strategy']) ?? 'browser',
      authBrokerPort: num('authBrokerPort') ?? 61001,
      destination: str('destination') ?? this.destination,
      kerberosRealm: str('kerberosRealm'),
      kerberosService: str('kerberosService'),
      kerberosKeytab: str('kerberosKeytab'),
      kerberosPrincipal: str('kerberosPrincipal'),
    };
  }

  /**
   * Initialize the ADTClient (called once before first use).
   * For JWT auth without a token, this triggers browser login.
   * For SSO, the candidate chain is tried in order — the first valid one wins.
   */
  async init(): Promise<void> {
    if (this.adt) return; // Already initialized

    if (this.authMode === 'jwt' && this.authBroker) {
      // Trigger browser login and get token
      const token = await this.authBroker.getToken(this.destination);
      this.tokenFetcher = async () => token;
    }

    if (this.authMode === 'sso' && this.ssoCfg && this.ssoTypes.length) {
      this.ssoChain = createSsoAuthChain(this.ssoTypes, this.ssoCfg);
      await this.ssoChain.init(); // throws if every candidate fails
      if (!this.ssoChain.current) {
        throw new Error('SSO initialization failed: no candidate succeeded');
      }
      await this.applySsoResult(this.ssoChain.current);
      this.startSsoRenewal();
    }

    this.rebuildAdt();
  }

  /** Apply an SSO result's headers or fetcher onto this client. */
  private async applySsoResult(result: SsoAuthResult): Promise<void> {
    if (result.prepare) {
      this.ssoHeaders = await result.prepare();
    } else if (result.headers) {
      this.ssoHeaders = result.headers;
    } else {
      this.tokenFetcher = result.fetcher;
    }
  }

  /** (Re)create the ADTClient from the current headers/fetcher. */
  private rebuildAdt(): void {
    if (this.ssoHeaders) {
      this.adt = new ADTClient(
        this.baseUrl, 'jwt',
        this.tokenFetcher ?? (async () => ''),
        this.client, this.language,
        { headers: this.ssoHeaders },
      );
    } else if (this.tokenFetcher) {
      this.adt = new ADTClient(this.baseUrl, 'jwt', this.tokenFetcher, this.client, this.language);
    }
  }

  /**
   * Get the underlying ADTClient. Initializes if needed.
   */
  private get adtClient(): ADTClient {
    if (!this.adt) {
      throw new Error('ADTClient not initialized. Call init() first.');
    }
    return this.adt;
  }

  /**
   * Start a timer that renews header-based SSO credentials (sso2 ticket,
   * spnego Negotiate token) before they expire, then rebuilds the ADTClient
   * so the new header takes effect. On repeated renewal failure, falls back
   * to the next SSO candidate in the chain.
   */
  private startSsoRenewal(): void {
    const ms = this.ssoChain?.current?.refreshIntervalMs;
    if (!ms || ms <= 0) return;
    this.ssoTimer = setInterval(() => { void this.reauthSso(); }, ms);
    this.ssoTimer.unref?.();
  }

  /** Consecutive renewal failures before switching to the next candidate. */
  private static readonly SSO_FAIL_THRESHOLD = 2;

  /**
   * Refresh the current SSO credential and rebuild the ADTClient. If the
   * refresh fails repeatedly, advance to the next candidate in the chain.
   */
  private async reauthSso(): Promise<void> {
    if (!this.ssoChain?.current) return;
    const current = this.ssoChain.current;
    try {
      if (current.refresh) await current.refresh();
      if (current.prepare) this.ssoHeaders = await current.prepare();
      this.rebuildAdt();
      this.ssoFailCount = 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[sap-mcp] SSO renewal failed (${current.type}): ${msg}`);
      this.ssoFailCount++;
      if (this.ssoFailCount >= AdtClient.SSO_FAIL_THRESHOLD) {
        this.ssoFailCount = 0;
        const switched = await this.ssoChain.switchToNext();
        if (switched && this.ssoChain.current) {
          try {
            await this.applySsoResult(this.ssoChain.current);
            this.rebuildAdt();
            console.error(`[sap-mcp] SSO switched to ${this.ssoChain.current.type}`);
          } catch (switchErr) {
            console.error(`[sap-mcp] SSO switch failed: ${String(switchErr)}`);
          }
        }
        // exhausted: leave current in place; next tick retries it.
      }
    }
  }

  /** Stop the SSO renewal timer (call on connector shutdown). */
  dispose(): void {
    if (this.ssoTimer) {
      clearInterval(this.ssoTimer);
      this.ssoTimer = undefined;
    }
  }

  /** Underlying abap-adt-api client (exposed for advanced use / debugging). */
  get raw(): ADTClient { return this.adtClient; }

  async readSource(objectUrl: string): Promise<string> {
    return this.adtClient.getObjectSource(objectUrl);
  }

  async writeSource(objectUrl: string, content: string): Promise<string> {
    // setObjectSource requires a lockHandle; acquire a lock, write, then release.
    this.adtClient.stateful = session_types.stateful;
    const lock = await this.adtClient.lock(objectUrl);
    try {
      await this.adtClient.setObjectSource(objectUrl, content, lock.LOCK_HANDLE);
      return 'ok';
    } finally {
      await this.adtClient.unLock(objectUrl, lock.LOCK_HANDLE);
    }
  }

  async search(query: string): Promise<unknown> {
    return this.adtClient.searchObject(query);
  }

  async activate(objectUrl: string): Promise<unknown> {
    // 2nd overload: activate(objectName, objectUrl, mainInclude?, preauditRequested?)
    return this.adtClient.activate(objectUrl, objectUrl);
  }

  async runUnitTests(objectUrl: string): Promise<unknown> {
    return this.adtClient.unitTestRun(objectUrl);
  }

  /** Run ABAP Test Cockpit via createAtcRun(variant, mainUrl, maxResults?). */
  async runAtc(objectUrl: string, variant = 'default'): Promise<unknown> {
    return this.adtClient.createAtcRun(variant, objectUrl);
  }

  async manageTransports(
    action: 'add' | 'release' | 'import',
    transportId: string,
    objectUrl?: string,
    requestText?: string,
    devclass?: string,
  ): Promise<string> {
    if (action === 'release') {
      const report = await this.adtClient.transportRelease(transportId);
      return `released ${transportId} (${report.length} entries)`;
    }
    if (action === 'add') {
      if (!objectUrl || !devclass) {
        throw new Error(
          "manageTransports('add') requires objectUrl and devclass (target package)",
        );
      }
      const tr = await this.adtClient.createTransport(
        objectUrl,
        requestText ?? 'sap-mcp transport',
        devclass,
      );
      return `created transport ${tr} for ${objectUrl}`;
    }
    // 'import' is an STMS operation, not exposed via the ADT REST API.
    throw new Error(
      "manageTransports('import') is an STMS operation, not exposed via ADT REST — use SAP transaction STMS",
    );
  }

  // ─── Source analysis ──────────────────────────────────────────────────────

  async syntaxCheck(objectUrl: string, mainUrl?: string, content?: string, mainProgram?: string): Promise<unknown> {
    if (mainUrl && content) return this.adtClient.syntaxCheck(objectUrl, mainUrl, content, mainProgram);
    return this.adtClient.syntaxCheck(objectUrl);
  }

  async prettyPrint(source: string): Promise<string> {
    return this.adtClient.prettyPrinter(source);
  }

  async revisions(objectUrl: string): Promise<unknown> {
    return this.adtClient.revisions(objectUrl);
  }

  // ─── Object lifecycle ────────────────────────────────────────────────────

  async createObject(objtype: string, name: string, parentName: string, description: string, parentPath: string, responsible?: string, transport?: string): Promise<void> {
    return this.adtClient.createObject(objtype as never, name, parentName, description, parentPath, responsible, transport);
  }

  async deleteObject(objectUrl: string, lockHandle: string, transport?: string): Promise<void> {
    return this.adtClient.deleteObject(objectUrl, lockHandle, transport);
  }

  async objectStructure(objectUrl: string): Promise<unknown> {
    return this.adtClient.objectStructure(objectUrl);
  }

  async inactiveObjects(): Promise<unknown> {
    return this.adtClient.inactiveObjects();
  }

  async validateNewObject(options: Record<string, unknown>): Promise<unknown> {
    return this.adtClient.validateNewObject(options as never);
  }

  // ─── Analysis & navigation ────────────────────────────────────────────────

  async whereUsed(objectUrl: string, line?: number, column?: number): Promise<unknown> {
    return this.adtClient.usageReferences(objectUrl, line, column);
  }

  async findDefinition(objectUrl: string, source: string, line: number, startCol: number, endCol: number): Promise<unknown> {
    return this.adtClient.findDefinition(objectUrl, source, line, startCol, endCol);
  }

  async runClass(className: string): Promise<string> {
    return this.adtClient.runClass(className);
  }

  async nodeContents(parentType: string, parentName?: string, userName?: string): Promise<unknown> {
    return this.adtClient.nodeContents(parentType as never, parentName, userName);
  }

  // ─── ATC (extended) ───────────────────────────────────────────────────────

  async atcWorklists(): Promise<unknown> {
    return (this.adtClient as any).atcWorklists();
  }

  async atcFixProposals(objectUrl: string, source: string, line: number, column: number): Promise<unknown> {
    return this.adtClient.fixProposals(objectUrl, source, line, column);
  }

  // ─── Data access ──────────────────────────────────────────────────────────

  async tableContents(ddicEntityName: string, rowNumber?: number, sqlQuery?: string): Promise<unknown> {
    return this.adtClient.tableContents(ddicEntityName, rowNumber, undefined, sqlQuery);
  }

  async runQuery(sqlQuery: string, rowNumber?: number): Promise<unknown> {
    return this.adtClient.runQuery(sqlQuery, rowNumber);
  }

  async ddicElement(path: string | string[]): Promise<unknown> {
    return this.adtClient.ddicElement(path);
  }

  async packageSearchHelp(type: string, name?: string): Promise<unknown> {
    return this.adtClient.packageSearchHelp(type as never, name);
  }

  // ─── Runtime errors ───────────────────────────────────────────────────────

  async listDumps(query?: string): Promise<unknown> {
    return this.adtClient.dumps(query);
  }

  async feeds(): Promise<unknown> {
    return this.adtClient.feeds();
  }

  // ─── abapGit ──────────────────────────────────────────────────────────────

  async gitRepos(): Promise<unknown> {
    return this.adtClient.gitRepos();
  }

  async gitPull(repoId: string, branch?: string, transport?: string, user?: string, password?: string): Promise<unknown> {
    return this.adtClient.gitPullRepo(repoId, branch, transport, user, password);
  }

  // ─── Transports (extended) ────────────────────────────────────────────────

  async transportDetails(transportNumber: string): Promise<unknown> {
    return this.adtClient.transportDetails(transportNumber);
  }

  async userTransports(user: string): Promise<unknown> {
    return this.adtClient.userTransports(user, true);
  }

  // ─── Refactoring ──────────────────────────────────────────────────────────

  async renameEvaluate(objectUrl: string, line: number, startCol: number, endCol: number): Promise<unknown> {
    return this.adtClient.renameEvaluate(objectUrl, line, startCol, endCol);
  }

  async extractMethodEvaluate(objectUrl: string, line: number, startCol: number, endCol: number): Promise<unknown> {
    return (this.adtClient as any).extractMethodEvaluate(objectUrl, line, startCol, endCol);
  }

  // ─── RAP generation ───────────────────────────────────────────────────────

  async rapGenPreview(content: Record<string, unknown>): Promise<unknown> {
    return (this.adtClient as any).rapGenPreview(content);
  }

  // ─── Escape hatch ─────────────────────────────────────────────────────────
  // Generic dispatch to any ADTClient method — covers the full ~150 method
  // API surface without a hand-written wrapper for each. Used by the `raw_call`
  // tool so the LLM can reach niche endpoints (debugger, traces, logpoints,
  // domain properties, etc.) without expanding the tool registry further.

  async callRaw(method: string, args: unknown[] = []): Promise<unknown> {
    const fn = (this.adtClient as unknown as Record<string, (...a: unknown[]) => unknown>)[method];
    if (typeof fn !== 'function') throw new Error(`ADTClient has no method '${method}'`);
    return fn.apply(this.adtClient, args);
  }

  // ─── Raw ADT HTTP ──────────────────────────────────────────────────────────
  // Endpoints not exposed by abap-adt-api's ADTClient. Uses the internal
  // AdtHTTP instance (this.adtClient.h) which handles auth, cookies, CSRF, and
  // autologin transparently.

  async rawGet(path: string, opts?: { accept?: string; qs?: Record<string, string | number> }): Promise<string> {
    const h = (this.adtClient as any).h;
    if (!h) throw new Error('ADTClient not initialized');
    const config: Record<string, unknown> = {};
    if (opts?.accept) config.headers = { Accept: opts.accept };
    if (opts?.qs) config.qs = opts.qs;
    const res = await h.request(path, config);
    return typeof res.body === 'string' ? res.body : JSON.stringify(res.body ?? '');
  }

  async rawPost(path: string, body?: string, opts?: { contentType?: string; accept?: string; qs?: Record<string, string | number> }): Promise<string> {
    const h = (this.adtClient as any).h;
    if (!h) throw new Error('ADTClient not initialized');
    const headers: Record<string, string> = {};
    if (opts?.contentType) headers['Content-Type'] = opts.contentType;
    if (opts?.accept) headers['Accept'] = opts.accept;
    const config: Record<string, unknown> = { method: 'POST' };
    if (Object.keys(headers).length) config.headers = headers;
    if (body) config.body = body;
    if (opts?.qs) config.qs = opts.qs;
    const res = await h.request(path, config);
    return typeof res.body === 'string' ? res.body : JSON.stringify(res.body ?? '');
  }

  async rawPostXml(path: string, xml: string, accept = 'application/xml'): Promise<string> {
    return this.rawPost(path, xml, { contentType: 'application/xml', accept });
  }
}
