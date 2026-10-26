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

export class AdtClient {
  private readonly adt: ADTClient;
  private readonly authMode: 'basic' | 'xsuaa';

  constructor(cfg: Record<string, unknown>) {
    const baseUrl = String(cfg.baseUrl ?? '');
    const authMode = String(cfg.authMode ?? 'basic') as 'basic' | 'xsuaa';
    this.authMode = authMode;
    const client = cfg.client ? String(cfg.client) : undefined;
    const language = cfg.language ? String(cfg.language) : undefined;

    if (!baseUrl) throw new Error('AdtClient requires baseUrl');

    if (authMode === 'xsuaa') {
      const clientId = String(cfg.clientId ?? '');
      const clientSecret = String(cfg.clientSecret ?? '');
      const tokenUrl = String(cfg.tokenUrl ?? '');
      if (!clientId || !clientSecret || !tokenUrl) {
        throw new Error('xsuaa auth requires clientId, clientSecret and tokenUrl');
      }
      // The lib calls this fetcher on login and sets `auth: { bearer }`.
      const fetcher = async (): Promise<string> => {
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
      this.adt = new ADTClient(baseUrl, clientId, fetcher, client, language);
    } else {
      const user = String(cfg.user ?? '');
      const pass = String(cfg.pass ?? '');
      if (!user || !pass) throw new Error('basic auth requires user and pass');
      // The lib sets HTTP Basic auth from (username, password) internally.
      this.adt = new ADTClient(baseUrl, user, pass, client, language);
    }
  }

  /** Underlying abap-adt-api client (exposed for advanced use / debugging). */
  get raw(): ADTClient { return this.adt; }

  async readSource(objectUrl: string): Promise<string> {
    return this.adt.getObjectSource(objectUrl);
  }

  async writeSource(objectUrl: string, content: string): Promise<string> {
    // setObjectSource requires a lockHandle; acquire a lock, write, then release.
    this.adt.stateful = session_types.stateful;
    const lock = await this.adt.lock(objectUrl);
    try {
      await this.adt.setObjectSource(objectUrl, content, lock.LOCK_HANDLE);
      return 'ok';
    } finally {
      await this.adt.unLock(objectUrl, lock.LOCK_HANDLE);
    }
  }

  async search(query: string): Promise<unknown> {
    return this.adt.searchObject(query);
  }

  async activate(objectUrl: string): Promise<unknown> {
    // 2nd overload: activate(objectName, objectUrl, mainInclude?, preauditRequested?)
    return this.adt.activate(objectUrl, objectUrl);
  }

  async runUnitTests(objectUrl: string): Promise<unknown> {
    return this.adt.unitTestRun(objectUrl);
  }

  /** Run ABAP Test Cockpit via createAtcRun(variant, mainUrl, maxResults?). */
  async runAtc(objectUrl: string, variant = 'default'): Promise<unknown> {
    return this.adt.createAtcRun(variant, objectUrl);
  }

  async manageTransports(
    action: 'add' | 'release' | 'import',
    transportId: string,
    objectUrl?: string,
    requestText?: string,
    devclass?: string,
  ): Promise<string> {
    if (action === 'release') {
      const report = await this.adt.transportRelease(transportId);
      return `released ${transportId} (${report.length} entries)`;
    }
    if (action === 'add') {
      if (!objectUrl || !devclass) {
        throw new Error(
          "manageTransports('add') requires objectUrl and devclass (target package)",
        );
      }
      const tr = await this.adt.createTransport(
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
}
