/**
 * SAC API client (adapted from reference/sap_analytics_cloud_mcp/src/auth/sac-client.ts)
 *
 * Adaptation:
 *  - Class with instance methods (mockable by tests via vi.spyOn).
 *  - Constructor takes { url, token } — token is supplied externally (ConnectorConfig),
 *    so the OAuth client_credentials flow from the ref is replaced by a direct Bearer
 *    token. A refreshToken() hook is kept for subclasses / future OAuth support.
 *  - Cookie jar, CSRF token cache, and 403-retry behavior are preserved per-instance.
 *  - Uses Node 20+ built-in fetch.
 */

export interface SacClientConfig {
  url: string;
  token: string;
}

export class SacClient {
  private readonly baseUrl: string;
  private token: string;
  private cookieJar = new Map<string, string>();
  private cachedCsrf: string | null = null;
  private csrfExpiresAt = 0;

  constructor(cfg: SacClientConfig) {
    this.baseUrl = cfg.url;
    this.token = cfg.token;
  }

  /** Current bearer token (overridable via refreshToken in subclasses). */
  protected getToken(): string {
    return this.token;
  }

  /** Token-refresh hook — default no-op (token provided externally). Subclasses/tests may override. */
  async refreshToken(): Promise<string> {
    return this.token;
  }

  // ── Session cookie jar ─────────────────────────────────────────────

  private collectCookies(res: Response): void {
    const setCookies = res.headers.getSetCookie?.() ?? [];
    for (const raw of setCookies) {
      const nameValue = raw.split(';')[0];
      const eqIdx = nameValue.indexOf('=');
      if (eqIdx > 0) {
        this.cookieJar.set(nameValue.slice(0, eqIdx), nameValue.slice(eqIdx + 1));
      }
    }
  }

  private cookieHeader(): string {
    return Array.from(this.cookieJar.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  /** Invalidate the cached CSRF token and clear session cookies (force fresh session). */
  invalidateCsrf(): void {
    this.cachedCsrf = null;
    this.csrfExpiresAt = 0;
    this.cookieJar.clear();
  }

  // ── Headers ────────────────────────────────────────────────────────

  private async baseHeaders(): Promise<Record<string, string>> {
    const bearer = this.getToken();
    const cookies = this.cookieHeader();
    return {
      Authorization: `Bearer ${bearer}`,
      'x-sap-sac-custom-auth': 'true',
      ...(cookies ? { Cookie: cookies } : {}),
    };
  }

  private async fetchCsrfToken(): Promise<string> {
    const bearer = this.getToken();
    const cookies = this.cookieHeader();
    const res = await fetch(`${this.baseUrl}/api/v1/csrf`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'x-sap-sac-custom-auth': 'true',
        'x-csrf-token': 'fetch',
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });
    this.collectCookies(res);
    const csrfToken = res.headers.get('x-csrf-token');
    if (!csrfToken) {
      const text = await res.text();
      throw new Error(
        `CSRF fetch failed (${res.status}): no x-csrf-token header. Body: ${text}`,
      );
    }
    return csrfToken;
  }

  private async getCsrf(): Promise<string> {
    if (this.cachedCsrf && Date.now() < this.csrfExpiresAt) {
      return this.cachedCsrf;
    }
    this.cachedCsrf = await this.fetchCsrfToken();
    this.csrfExpiresAt = Date.now() + 10 * 60 * 1000;
    return this.cachedCsrf;
  }

  private async writeHeaders(): Promise<Record<string, string>> {
    const csrfToken = await this.getCsrf();
    const base = await this.baseHeaders();
    return {
      ...base,
      'X-Csrf-Token': csrfToken,
      'Content-Type': 'application/json',
      Origin: new URL(this.baseUrl).origin,
      'X-Requested-With': 'XMLHttpRequest',
    };
  }

  // ── Public HTTP helpers (instance methods — mockable) ─────────────

  async sacGet(path: string, extraHeaders?: Record<string, string>): Promise<unknown> {
    const headers = { ...(await this.baseHeaders()), ...extraHeaders };
    const res = await fetch(`${this.baseUrl}${path}`, { headers });
    this.collectCookies(res);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`SAC API error ${res.status} on GET ${path}: ${text}`);
    }
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('json')) return res.json();
    return res.text();
  }

  async sacPost(
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const attempt = async (): Promise<Response> => {
      const headers = { ...(await this.writeHeaders()), ...extraHeaders };
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      this.collectCookies(res);
      return res;
    };

    let res = await attempt();
    if (res.status === 403) {
      this.invalidateCsrf();
      res = await attempt();
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`SAC API error ${res.status} on POST ${path}: ${text}`);
    }
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('json')) return res.json();
    return res.text();
  }

  async sacPut(
    path: string,
    body: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const attempt = async (): Promise<Response> => {
      const headers = { ...(await this.writeHeaders()), ...extraHeaders };
      const res = await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      });
      this.collectCookies(res);
      return res;
    };

    let res = await attempt();
    if (res.status === 403) {
      this.invalidateCsrf();
      res = await attempt();
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`SAC API error ${res.status} on PUT ${path}: ${text}`);
    }
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('json')) return res.json();
    return res.text();
  }

  async sacPatch(
    path: string,
    body: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const attempt = async (): Promise<Response> => {
      const headers = { ...(await this.writeHeaders()), ...extraHeaders };
      const res = await fetch(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      });
      this.collectCookies(res);
      return res;
    };

    let res = await attempt();
    if (res.status === 403) {
      this.invalidateCsrf();
      res = await attempt();
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`SAC API error ${res.status} on PATCH ${path}: ${text}`);
    }
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('json')) return res.json();
    return res.text();
  }

  async sacDelete(path: string, body?: unknown): Promise<void> {
    const url = `${this.baseUrl}${path}`;
    const attempt = async (): Promise<Response> => {
      const headers = await this.writeHeaders();
      const res = await fetch(url, {
        method: 'DELETE',
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      this.collectCookies(res);
      return res;
    };

    let res = await attempt();
    if (res.status === 403) {
      this.invalidateCsrf();
      res = await attempt();
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`SAC API error ${res.status} on DELETE ${path}: ${text}`);
    }
  }
}
