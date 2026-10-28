/**
 * SSO authentication types for the unified SAP MCP server.
 *
 * Supports every SSO flavour found in the reference projects:
 *  - OIDC / OAuth2 (browser code+PKCE, device code, password, token exchange)
 *  - SAML 2.0 (bearer / pure)
 *  - UAA / XSUAA passcode
 *  - client_credentials (XSUAA service keys)
 *  - MYSAPSSO2 logon ticket (`sso2`)
 *  - SPNEGO / Kerberos (`spnego`)
 *  - pre-provisioned tokens (`token`)
 *
 * The factory (`SsoAuthFactory`) turns a `SsoAuthConfig` into a `BearerFetcher`
 * (and optionally static request headers) that `abap-adt-api`'s ADTClient can
 * consume. Token lifecycle (expiry + refresh + re-login) is delegated to the
 * `@mcp-abap-adt/auth-providers` token providers.
 */

export type SsoAuthType =
  | 'client_credentials'
  | 'saml2_pure'
  | 'token'
  | 'sso2' // MYSAPSSO2 logon ticket
  | 'spnego'; // Kerberos

/** How an interactive login hands the authorization to the user. */
export type LoginStrategy =
  | 'browser' // open system browser, callback on localhost
  | 'device' // device_code flow
  | 'manual' // paste code / SAML response into terminal
  | 'external'; // external flow, no local callback

export interface SsoAuthConfig {
  /** The SSO flavour. */
  type: SsoAuthType;

  // ── OAuth2 / OIDC common ────────────────────────────────────────────────
  /** Authorization server issuer URL (for OIDC discovery). */
  issuerUrl?: string;
  /** Override the authorization endpoint when discovery is unavailable. */
  authorizationEndpoint?: string;
  /** Override the token endpoint when discovery is unavailable. */
  tokenEndpoint?: string;
  /** Device authorization endpoint (device_code flow). */
  deviceAuthorizationEndpoint?: string;
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];

  // ── password grant ───────────────────────────────────────────────────────
  username?: string;
  password?: string;

  // ── token exchange ───────────────────────────────────────────────────────
  subjectToken?: string;
  subjectTokenType?: string;
  audience?: string;
  actorToken?: string;
  actorTokenType?: string;

  // ── SAML 2.0 ─────────────────────────────────────────────────────────────
  /** Path to a CA bundle PEM used to verify the IdP's SAML assertions. */
  samlTrust?: string;

  // ── UAA / XSUAA passcode ─────────────────────────────────────────────────
  /** UAA / XSUAA base URL (e.g. `https://<sub>.authentication.<region>.ondemand.com`). */
  uaaUrl?: string;

  // ── MYSAPSSO2 logon ticket ───────────────────────────────────────────────
  /** System PSE certificate (PEM string or file path) used to sign the ticket. */
  pseCert?: string;
  /** System PSE private key (PEM string or file path) used to sign the ticket. */
  pseKey?: string;
  /** Logon user. Defaults to `username`. */
  ssoUser?: string;
  /** SAP client (MANDT). */
  ssoClient?: string;
  /** System SID / create name. Defaults to `system`. */
  ssoSystem?: string;
  /** Ticket validity in hours. Default 8. */
  ssoDurationHours?: number;
  /** Codepage: `4103` UTF-16LE (default) or `4102` UTF-16BE. */
  ssoCodepage?: '4103' | '4102';

  // ── pre-provisioned tokens ───────────────────────────────────────────────
  accessToken?: string;
  refreshToken?: string;
  /** Epoch ms when `accessToken` expires (for opaque tokens without `exp`). */
  expiresAt?: number;

  // ── interaction ──────────────────────────────────────────────────────────
  /** How the user authorizes: browser, device, manual, external. */
  strategy?: LoginStrategy;
  /** Local callback port for browser login. Default 61001. */
  authBrokerPort?: number;
  /** The broker destination name. Default `mcp`. */
  destination?: string;

  // ── SPNEGO / Kerberos ────────────────────────────────────────────────────
  /** Kerberos realm (optional; used to canonicalize the service principal). */
  kerberosRealm?: string;
  /** Service principal, e.g. `HTTP/host.example.com`. Default derived from baseUrl. */
  kerberosService?: string;
  /**
   * Keytab file path. When set with `kerberosPrincipal`, the connector runs
   * `kinit -kt <keytab> <principal>` automatically (throttled to 7h) — no
   * manual `kinit` needed. Omit on Windows domain service accounts (LSA TGT).
   */
  kerberosKeytab?: string;
  /** Principal to acquire a TGT for (keytab mode), e.g. `SAPSERVICE/mcp@REALM`. */
  kerberosPrincipal?: string;
}
