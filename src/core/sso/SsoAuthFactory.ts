/**
 * SsoAuthFactory — builds a token fetcher (or static headers) for every SSO
 * flavour supported by `@mcp-abap-adt/auth-providers`, plus the two bespoke
 * ones implemented here (MYSAPSSO2 `sso2`, SPNEGO/Kerberos `spnego`).
 *
 * The result is consumed by `abap-adt-api`'s ADTClient:
 *  - `fetcher` → passed as the `BearerFetcher` (password slot); the lib calls
 *    it on login and sets `auth: { bearer }`.
 *  - `headers` → passed as `ClientOptions.headers` (e.g. `Cookie: MYSAPSSO2=…`
 *    for `sso2`, `Authorization: Negotiate …` for `spnego`).
 *  - `refresh` → re-generates header-based credentials on expiry.
 */

import {
  ClientCredentialsProvider,
  OidcBrowserProvider,
  OidcDeviceFlowProvider,
  OidcPasswordProvider,
  OidcTokenExchangeProvider,
  Saml2BearerProvider,
  Saml2PureProvider,
  UaaPasscodeProvider,
  createSignedAssertionValidator,
  defaultReplayStore,
  externalCodeStrategy,
  manualPasscodeStrategy,
  manualPasteStrategy,
  manualSamlResponseStrategy,
  oidcCallbackStrategy,
  refreshThenLogin,
  samlCallbackStrategy,
  type ShippedValidatorOptions,
} from '@mcp-abap-adt/auth-providers';
import type { ITokenProvider, IAuthorizationStrategy, IAssertionReplayStore } from '@mcp-abap-adt/interfaces-auth';
import type { OidcCallbackResult } from '@mcp-abap-adt/auth-providers';
import type { SsoAuthConfig, SsoAuthType, LoginStrategy } from './types.js';
import { generateLogonTicket, decodeLogonTicket, formatDecodedTicket } from './sap-logon-ticket.js';
import { acquireSpnegoToken, type SpnegoConfig } from './spnego.js';

export interface SsoAuthResult {
  /** Bearer token fetcher — the lib's password slot. */
  fetcher: () => Promise<string>;
  /** Static headers (sso2 → Cookie). */
  headers?: Record<string, string>;
  /** Asynchronously-prepared headers (spnego → Authorization: Negotiate). */
  prepare?: () => Promise<Record<string, string>>;
  /** Regenerate header credentials on expiry. */
  refresh?: () => Promise<void>;
  /** Recommended renewal interval (ms) for header-based SSO (sso2/spnego). */
  refreshIntervalMs?: number;
  /** Underlying auth provider (for lifecycle/debug). */
  provider?: ITokenProvider;
  /** The SSO flavour. */
  type: SsoAuthConfig['type'];
}

/** Resolve a value that may be a file path or inline PEM. */
function resolvePem(pathOrPem: string): string {
  const trimmed = pathOrPem.trim();
  if (trimmed.startsWith('-----BEGIN')) return trimmed;
  // Lazy require to keep node:fs out of the browser bundle path.
  return readFile(pathOrPem);
}

import { readFileSync } from 'node:fs';
function readFile(path: string): string {
  return readFileSync(path, 'utf8');
}

function buildBrowserStrategy<T>(
  type: SsoAuthConfig['type'],
  cfg: SsoAuthConfig,
  strategy: LoginStrategy,
): IAuthorizationStrategy<T> {
  const port = cfg.authBrokerPort ?? 61001;
  switch (strategy) {
    case 'manual': {
      if (type === 'saml2_pure' || type === 'saml2_bearer') {
        return manualSamlResponseStrategy({
          redirectUri: cfg.tokenEndpoint ?? `http://localhost:${port}/callback`,
          signal: AbortSignal.timeout(300_000),
        }) as unknown as IAuthorizationStrategy<T>;
      }
      if (type === 'passcode') {
        return manualPasscodeStrategy({ signal: AbortSignal.timeout(300_000) }) as unknown as IAuthorizationStrategy<T>;
      }
      return manualPasteStrategy({
        redirectUri: cfg.tokenEndpoint ?? `http://localhost:${port}/callback`,
        signal: AbortSignal.timeout(300_000),
      }) as unknown as IAuthorizationStrategy<T>;
    }
    case 'external': {
      return externalCodeStrategy({
        redirectUri: cfg.tokenEndpoint ?? `http://localhost:${port}/callback`,
        provide: async () => {
          const code = cfg.accessToken;
          if (!code) throw new Error('external strategy requires accessToken (the authorization code)');
          return code;
        },
        signal: AbortSignal.timeout(300_000),
      }) as unknown as IAuthorizationStrategy<T>;
    }
    case 'browser':
    default: {
      if (type === 'saml2_pure' || type === 'saml2_bearer') {
        return samlCallbackStrategy({ port, signal: AbortSignal.timeout(300_000) }) as unknown as IAuthorizationStrategy<T>;
      }
      return oidcCallbackStrategy({ port, signal: AbortSignal.timeout(300_000) }) as unknown as IAuthorizationStrategy<T>;
    }
  }
}

/** Resolved SAML trust: compatible with both `SamlTrust` (inBrowser) and `ShippedValidatorOptions`. */
interface ResolvedSamlTrust {
  idpCertificates: string[];
  clockSkewMs?: number;
  replayStore: IAssertionReplayStore;
}

function buildSamlTrust(cfg: SsoAuthConfig): ResolvedSamlTrust {
  if (!cfg.samlTrust) {
    throw new Error('SAML auth requires samlTrust (path to the IdP CA bundle PEM)');
  }
  return { idpCertificates: [resolvePem(cfg.samlTrust)], replayStore: defaultReplayStore };
}

function buildProvider(cfg: SsoAuthConfig): ITokenProvider {
  const renewal = refreshThenLogin();
  const strategy = cfg.strategy ?? 'browser';

  switch (cfg.type) {
    case 'client_credentials': {
      const uaaUrl = cfg.uaaUrl ?? cfg.issuerUrl ?? cfg.tokenEndpoint;
      if (!uaaUrl) throw new Error('client_credentials requires uaaUrl or issuerUrl');
      if (!cfg.clientId) throw new Error('client_credentials requires clientId');
      return new ClientCredentialsProvider({
        uaaUrl,
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecret,
        renewal,
      });
    }

    case 'oidc_browser': {
      if (!cfg.clientId) throw new Error('oidc_browser requires clientId');
      if (strategy === 'browser') {
        return OidcBrowserProvider.inBrowser({
          issuerUrl: cfg.issuerUrl,
          clientId: cfg.clientId,
          clientSecret: cfg.clientSecret,
          scopes: cfg.scopes,
          authorizationEndpoint: cfg.authorizationEndpoint,
          tokenEndpoint: cfg.tokenEndpoint,
          accessToken: cfg.accessToken,
          refreshToken: cfg.refreshToken,
          expiresAt: cfg.expiresAt,
          renewal,
        });
      }
      return new OidcBrowserProvider({
        issuerUrl: cfg.issuerUrl,
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecret,
        scopes: cfg.scopes,
        authorizationEndpoint: cfg.authorizationEndpoint,
        tokenEndpoint: cfg.tokenEndpoint,
        accessToken: cfg.accessToken,
        refreshToken: cfg.refreshToken,
        expiresAt: cfg.expiresAt,
        renewal,
        authorization: buildBrowserStrategy<OidcCallbackResult>('oidc_browser', cfg, strategy),
      });
    }

    case 'oidc_device': {
      if (!cfg.clientId) throw new Error('oidc_device requires clientId');
      return OidcDeviceFlowProvider.toConsole({
        issuerUrl: cfg.issuerUrl,
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecret,
        scopes: cfg.scopes,
        deviceAuthorizationEndpoint: cfg.deviceAuthorizationEndpoint,
        tokenEndpoint: cfg.tokenEndpoint,
        accessToken: cfg.accessToken,
        refreshToken: cfg.refreshToken,
        expiresAt: cfg.expiresAt,
        renewal,
      });
    }

    case 'oidc_password': {
      if (!cfg.clientId) throw new Error('oidc_password requires clientId');
      if (!cfg.username || !cfg.password) throw new Error('oidc_password requires username and password');
      return new OidcPasswordProvider({
        issuerUrl: cfg.issuerUrl,
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecret,
        username: cfg.username,
        password: cfg.password,
        scopes: cfg.scopes,
        tokenEndpoint: cfg.tokenEndpoint,
        accessToken: cfg.accessToken,
        refreshToken: cfg.refreshToken,
        expiresAt: cfg.expiresAt,
        renewal,
      });
    }

    case 'oidc_token_exchange': {
      if (!cfg.clientId) throw new Error('oidc_token_exchange requires clientId');
      if (!cfg.subjectToken || !cfg.subjectTokenType) {
        throw new Error('oidc_token_exchange requires subjectToken and subjectTokenType');
      }
      return new OidcTokenExchangeProvider({
        issuerUrl: cfg.issuerUrl,
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecret,
        subjectToken: cfg.subjectToken,
        subjectTokenType: cfg.subjectTokenType,
        scope: cfg.scopes?.join(' '),
        audience: cfg.audience,
        actorToken: cfg.actorToken,
        actorTokenType: cfg.actorTokenType,
        tokenEndpoint: cfg.tokenEndpoint,
        accessToken: cfg.accessToken,
        refreshToken: cfg.refreshToken,
        expiresAt: cfg.expiresAt,
        renewal,
      });
    }

    case 'saml2_bearer': {
      if (!cfg.clientId) throw new Error('saml2_bearer requires clientId');
      const trust = buildSamlTrust(cfg);
      const common = {
        idpSsoUrl: cfg.authorizationEndpoint ?? cfg.issuerUrl ?? '',
        spEntityId: cfg.clientId,
        acsUrl: cfg.tokenEndpoint,
        idpEntityId: cfg.issuerUrl,
        logger: undefined,
        renewal,
      };
      if (!common.idpSsoUrl) throw new Error('saml2_bearer requires idpSsoUrl (authorizationEndpoint)');
      if (strategy === 'browser') {
        return Saml2BearerProvider.inBrowser(common, trust);
      }
      return new Saml2BearerProvider({
        ...common,
        authorization: buildBrowserStrategy<string>('saml2_bearer', cfg, strategy),
        assertionValidator: createSignedAssertionValidator(trust),
        tokenUrl: cfg.tokenEndpoint,
        uaaUrl: cfg.uaaUrl,
        clientSecret: cfg.clientSecret,
      });
    }

    case 'saml2_pure': {
      const trust = buildSamlTrust(cfg);
      const common = {
        idpSsoUrl: cfg.authorizationEndpoint ?? cfg.issuerUrl ?? '',
        spEntityId: cfg.clientId ?? '',
        acsUrl: cfg.tokenEndpoint,
        idpEntityId: cfg.issuerUrl,
        cookieProvider: async (samlResponse: string) => samlResponse,
        logger: undefined,
        renewal,
      };
      if (!common.idpSsoUrl) throw new Error('saml2_pure requires idpSsoUrl (authorizationEndpoint)');
      if (strategy === 'browser') {
        return Saml2PureProvider.inBrowser(common, trust);
      }
      return new Saml2PureProvider({
        ...common,
        authorization: buildBrowserStrategy<string>('saml2_pure', cfg, strategy),
        assertionValidator: createSignedAssertionValidator(trust),
      });
    }

    case 'passcode': {
      const uaaUrl = cfg.uaaUrl ?? cfg.issuerUrl;
      if (!uaaUrl) throw new Error('passcode requires uaaUrl');
      if (!cfg.clientId) throw new Error('passcode requires clientId');
      return UaaPasscodeProvider.fromTerminal({
        uaaUrl,
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecret,
        accessToken: cfg.accessToken,
        refreshToken: cfg.refreshToken,
        expiresAt: cfg.expiresAt,
        renewal,
      });
    }

    default:
      throw new Error(`Unsupported SSO type: ${cfg.type}`);
  }
}

/**
 * Creates the SSO auth result for a config. Throws on invalid config.
 */
export function createSsoAuth(cfg: SsoAuthConfig): SsoAuthResult {
  // ── MYSAPSSO2: static Cookie header, regenerated on expiry ────────────────
  if (cfg.type === 'sso2') {
    if (!cfg.pseCert || !cfg.pseKey) {
      throw new Error('sso2 requires pseCert and pseKey (system PSE certificate + DSA private key)');
    }
    const ssoUser = cfg.ssoUser ?? cfg.username;
    if (!ssoUser) throw new Error('sso2 requires ssoUser (or username)');
    if (!cfg.ssoClient) throw new Error('sso2 requires ssoClient');
    if (!cfg.ssoSystem) throw new Error('sso2 requires ssoSystem');
    const durationHours = cfg.ssoDurationHours ?? 8;
    const codepage = cfg.ssoCodepage ?? '4103';

    const certPem = resolvePem(cfg.pseCert);
    const keyPem = resolvePem(cfg.pseKey);

    const makeCookie = (): string =>
      generateLogonTicket({
        username: ssoUser,
        client: cfg.ssoClient!,
        system: cfg.ssoSystem!,
        durationHours,
        codepage,
        certPem,
        keyPem,
      });

    // Mutable header object: refresh() updates the Cookie in place so any
    // caller holding the reference sees the new ticket without re-creation.
    const headers: Record<string, string> = {};
    const applyCookie = (): void => {
      headers.Cookie = `MYSAPSSO2=${makeCookie()}`;
    };
    applyCookie();
    return {
      type: 'sso2',
      fetcher: async () => '', // not used — cookie is in headers
      headers,
      refresh: async () => {
        applyCookie();
      },
      // Renew 1h before the ticket expires (clamped to >= 1 min).
      refreshIntervalMs: Math.max((durationHours - 1) * 3600_000, 60_000),
    };
  }

  // ── SPNEGO / Kerberos: Negotiate header prepared async ────────────────────
  if (cfg.type === 'spnego') {
    const spnegoCfg: SpnegoConfig = {
      service: cfg.kerberosService,
      realm: cfg.kerberosRealm,
      keytab: cfg.kerberosKeytab,
      principal: cfg.kerberosPrincipal,
    };
    return {
      type: 'spnego',
      fetcher: async () => '', // not used — Authorization header
      prepare: async () => {
        const token = await acquireSpnegoToken(spnegoCfg);
        return { Authorization: `Negotiate ${token}` };
      },
      // Kerberos service tickets are typically valid ~10h; renew at 8h.
      refreshIntervalMs: 8 * 3600_000,
    };
  }

  // ── Token providers: Bearer fetcher ───────────────────────────────────────
  // `token` (pre-provisioned) needs no provider: a fixed fetcher.
  if (cfg.type === 'token') {
    if (!cfg.accessToken) throw new Error('token SSO requires accessToken');
    return {
      type: 'token',
      fetcher: async () => cfg.accessToken!,
    };
  }

  const provider = buildProvider(cfg);
  return {
    type: cfg.type,
    provider,
    fetcher: async () => {
      const result = await provider.getTokens();
      return result.authorizationToken;
    },
  };
}

/**
 * SsoAuthChain — ordered list of SSO candidates with automatic fallback.
 *
 * `SAP_ADT_SSO_TYPE` accepts a comma-separated list (e.g.
 * `spnego,sso2,client_credentials`). The chain tries each in order on
 * `init()`; the first candidate whose credentials validate becomes active.
 * When the active candidate fails to renew at runtime, `switchToNext()`
 * advances to the next candidate and the caller rebuilds its client.
 *
 * Header-based candidates (spnego/sso2) are validated eagerly (spnego
 * acquires a token, sso2 already has headers). Token providers
 * (client_credentials/oidc_*) are accepted lazily — they probe the network
 * only on the first fetcher call — so they never block chain init.
 */
export interface SsoAuthChain {
  readonly candidates: SsoAuthType[];
  /** The active auth result (null until a candidate succeeds). */
  current: SsoAuthResult | null;
  /** Try every candidate in order; sets `current` to the first that works. */
  init(): Promise<void>;
  /** Advance past the current candidate. Returns false if exhausted. */
  switchToNext(): Promise<boolean>;
}

export function createSsoAuthChain(types: SsoAuthType[], cfg: SsoAuthConfig): SsoAuthChain {
  if (types.length === 0) throw new Error('SSO chain requires at least one candidate type');
  const state: { idx: number; current: SsoAuthResult | null } = { idx: -1, current: null };

  async function tryAt(i: number): Promise<boolean> {
    const type = types[i];
    if (!type) return false;
    try {
      const result = createSsoAuth({ ...cfg, type });
      if (result.prepare) await result.prepare(); // validate header-based now
      state.idx = i;
      state.current = result;
      return true;
    } catch {
      return false;
    }
  }

  return {
    candidates: types,
    get current() { return state.current; },
    set current(v: SsoAuthResult | null) { state.current = v; },
    async init() {
      for (let i = 0; i < types.length; i++) {
        if (await tryAt(i)) return;
      }
      throw new Error(
        `All SSO candidates failed: ${types.join(', ')}. ` +
          'Check TGT/keytab, PSE key, or OAuth client credentials.',
      );
    },
    async switchToNext() {
      for (let i = state.idx + 1; i < types.length; i++) {
        if (await tryAt(i)) return true;
      }
      return false;
    },
  };
}

/** Convenience: decode a MYSAPSSO2 cookie for diagnostics. */
export function decodeSso2(cookie: string): Record<string, string> {
  return formatDecodedTicket(decodeLogonTicket(cookie));
}


