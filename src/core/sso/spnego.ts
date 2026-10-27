/**
 * SPNEGO / Kerberos authentication for ADT HTTP.
 *
 * Uses the optional `kerberos` native module when installed (npm i kerberos).
 * A Kerberos AP-REQ token is wrapped in a GSS-API SPNEGO mechanism token, the
 * format the `Authorization: Negotiate <token>` header expects.
 *
 * The module is a lazy optional dependency: `acquireSpnegoToken` throws a
 * clear error telling the user to install `kerberos` (and have `kinit` /
 * Windows integrated auth working) when it is absent.
 */

import { ensureKerberosTgt } from './kerberos-init.js';

export interface SpnegoConfig {
  /** Service principal, e.g. `HTTP/host.example.com`. Derived from `baseUrl` when omitted. */
  service?: string;
  /** Kerberos realm (optional; appended to the service when absent). */
  realm?: string;
  /** Keytab file path — when set with `principal`, a TGT is acquired automatically. */
  keytab?: string;
  /** Principal to acquire a TGT for (keytab mode). */
  principal?: string;
}

interface KerberosClient {
  step(challenge: string): Promise<Buffer>;
}

interface KerberosModule {
  initializeClient(service: string, options: Record<string, unknown>): Promise<KerberosClient>;
}

let kerberosCache: KerberosModule | null | undefined;

function loadKerberos(): KerberosModule | null {
  if (kerberosCache !== undefined) return kerberosCache;
  try {
    // Dynamic require — optional dependency.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('kerberos') as KerberosModule;
    kerberosCache = mod;
  } catch {
    kerberosCache = null;
  }
  return kerberosCache;
}

function der(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
}

function derLen(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v >>>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

/**
 * Wraps a raw Kerberos AP-REQ in a GSS-API SPNEGO NegTokenInit, the format
 * the `Authorization: Negotiate <token>` header expects.
 *
 * SPNEGO NegTokenInit ::= [APPLICATION 0] SEQUENCE {
 *   mechTypes [0] SEQUENCE OF OID,      -- kerberos: 1.3.6.1.5.5.2
 *   mechToken [2] OCTET STRING          -- the AP-REQ
 * }
 */
export function wrapSpnego(apReq: Buffer): Buffer {
  const OID_SPNEGO = Buffer.from([0x2b, 0x06, 0x01, 0x05, 0x05, 0x02]); // 1.3.6.1.5.5.2
  const mechTypes = der(0xa0, der(0x30, der(0x06, OID_SPNEGO)));
  const mechToken = der(0xa2, der(0x04, apReq));
  const negTokenInit = der(0xa0, der(0x30, Buffer.concat([mechTypes, mechToken])));
  return der(0x60, negTokenInit); // [APPLICATION 0]
}

/**
 * Acquires and returns the SPNEGO token (base64) for a service principal.
 * Throws a descriptive error when `kerberos` is not installed.
 */
export async function acquireSpnegoToken(config: SpnegoConfig = {}): Promise<string> {
  // Bootstrap/renew a TGT from a keytab when configured; otherwise rely on
  // an existing TGT (Windows LSA / prior kinit).
  await ensureKerberosTgt(config);
  const kerberos = loadKerberos();
  if (!kerberos) {
    throw new Error(
      'SPNEGO/Kerberos auth requires the optional "kerberos" native module. ' +
        'Install it with `npm install kerberos` and ensure a Kerberos ticket ' +
        'is available (kinit / Windows integrated auth).',
    );
  }
  const service = config.service ?? 'HTTP';
  const servicePrincipal = config.realm ? `${service}@${config.realm}` : service;
  const client = await kerberos.initializeClient(servicePrincipal, {});
  const token = await client.step('');
  const spnego = wrapSpnego(Buffer.isBuffer(token) ? token : Buffer.from(token));
  return spnego.toString('base64');
}
