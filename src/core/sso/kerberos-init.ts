/**
 * Automatic Kerberos TGT acquisition via `kinit -kt <keytab> <principal>`.
 *
 * On Windows with a domain service account the LSA maintains a TGT
 * automatically and this module is a no-op (no keytab configured). On
 * Linux / non-LSA Windows it removes the need for a human to run `kinit`:
 * the connector bootstraps and renews its own TGT from a keytab.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Renew the TGT well before the typical 10h ticket lifetime. */
const RENEW_INTERVAL_MS = 7 * 3600_000;

let lastInitAt = 0;
let lastInitPrincipal: string | undefined;

export interface KerberosKeytabConfig {
  /** Path to the keytab file (e.g. `/etc/krb5.keytab` or `C:\sap\sap.keytab`). */
  keytab?: string;
  /** Principal to acquire a TGT for (e.g. `SAPSERVICE/mcp@REALM`). */
  principal?: string;
}

/**
 * Ensures a Kerberos TGT is available.
 *
 * - When `keytab` and `principal` are configured, runs
 *   `kinit -kt <keytab> <principal>`. Throttled to once per 7h per principal
 *   so repeated calls within the renewal cycle are free.
 * - When they are absent, relies on an already-acquired TGT (Windows LSA /
 *   prior manual `kinit`) and does nothing.
 *
 * Throws a descriptive error if `kinit` is missing or the keytab is
 * unreadable, so misconfiguration surfaces immediately.
 */
export async function ensureKerberosTgt(cfg: KerberosKeytabConfig): Promise<void> {
  if (!cfg.keytab || !cfg.principal) return;
  const now = Date.now();
  if (cfg.principal === lastInitPrincipal && now - lastInitAt < RENEW_INTERVAL_MS) {
    return; // still within the renewal window
  }
  try {
    await execFileAsync('kinit', ['-kt', cfg.keytab, cfg.principal]);
    lastInitAt = now;
    lastInitPrincipal = cfg.principal;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Automatic kinit failed (keytab=${cfg.keytab}, principal=${cfg.principal}). ` +
        `Ensure 'kinit' is on PATH and the keytab is readable. ` +
        `On Windows with a domain service account, omit kerberosKeytab to use ` +
        `the LSA-managed TGT instead. Underlying error: ${msg}`,
    );
  }
}

/** Reset the throttle (test hook). */
export function __resetKerberosInitCache(): void {
  lastInitAt = 0;
  lastInitPrincipal = undefined;
}
