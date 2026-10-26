/**
 * SAP RFC client — port of reference/sap-rfc-mcp-server/sap_rfc_mcp_server/sap_client.py.
 *
 * pyrfc.Connection -> node-rfc.Connection. The native `node-rfc` module is an
 * OPTIONAL dependency: it requires the SAP NetWeaver RFC SDK at install/load
 * time. To satisfy the global "graceful degradation" constraint, the module is
 * loaded lazily inside connect() via a dynamic `await import('node-rfc')`
 * wrapped in try/catch. When absent, connect() rejects with a clear
 * /NWRFC|node-rfc/ message so the registry can skip RFC while SAC/ADT stay up.
 */

import type { ConnectorConfig } from '../../core/types.js';
import { logger } from '../../core/utils/logger.js';

type RfcConnection = {
  call(fmName: string, params?: Record<string, unknown>): Promise<unknown> | unknown;
  close?(): void;
};
type ConnectionCtor = new (connParams: Record<string, unknown>) => RfcConnection;

export class SapRfcClient {
  private conn: RfcConnection | null = null;
  private static ConnectionCtor: ConnectionCtor | null = null;
  private static probed = false;

  constructor(private cfg: ConnectorConfig) {}

  /** Lazily probe for the optional node-rfc native module (once per process). */
  private static async probe(): Promise<ConnectionCtor | null> {
    if (SapRfcClient.probed) return SapRfcClient.ConnectionCtor;
    SapRfcClient.probed = true;
    try {
      const mod = (await import('node-rfc')) as { Connection?: ConnectionCtor };
      SapRfcClient.ConnectionCtor = mod.Connection ?? null;
    } catch (e) {
      logger.warn({ err: String(e) }, 'node-rfc native module unavailable');
    }
    return SapRfcClient.ConnectionCtor;
  }

  async connect(): Promise<void> {
    const Ctor = await SapRfcClient.probe();
    if (!Ctor) {
      throw new Error(
        'node-rfc (SAP NWRFC SDK) not installed; cannot use RFC connector — install SAP NetWeaver RFC SDK and run `npm install node-rfc`',
      );
    }
    const p: Record<string, unknown> = {
      dest: 'sap-mcp',
      ASHOST: this.cfg.ashost,
      SYSNR: this.cfg.sysnr,
      CLIENT: this.cfg.client,
      USER: this.cfg.user,
      PASSWD: this.cfg.passwd,
      LANG: this.cfg.lang ?? 'EN',
    };
    for (const k of Object.keys(p)) if (p[k] === undefined) delete p[k];
    this.conn = new Ctor(p);
  }

  async call(fn: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.conn) await this.connect();
    return this.conn!.call(fn, args);
  }

  async close(): Promise<void> {
    try {
      this.conn?.close?.();
    } catch {
      /* ignore */
    }
    this.conn = null;
  }
}
