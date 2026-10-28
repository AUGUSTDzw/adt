/**
 * COM bridge — a long-lived `cscript` VBScript daemon that speaks JSON-RPC
 * over stdio and performs COM automation on behalf of the gui connector. This
 * is the zero-native-dependency fallback when `winax` cannot be built (no
 * build tools): Windows ships cscript/WScript, so the sap.gui connector still
 * works.
 *
 * The daemon keeps a registry of COM objects (id → object) so a session bound
 * in one tool call stays alive for the next. Every request is answered with
 * one JSON line; COM object values are encoded as `{ "$com": <id> }` refs and
 * decoded back on the cscript side.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { ComApi, ComHandle, ComObjectOptions } from './com-bridge.js';

// VBScript JSON-RPC daemon (tests/sapgui_vbs_daemon.vbs). Resolved relative to
// this module so it works from both source (ts) and built (dist) trees.
const DAEMON_SCRIPT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../tests/sapgui_vbs_daemon.vbs',
);

const RPC_TIMEOUT_MS = 60_000;

interface RpcResponse {
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export function createPowershellCom(): ComApi {
  return new PowershellComApi();
}

class PowershellComApi implements ComApi {
  readonly backend = 'powershell' as const;
  private child: ChildProcessWithoutNullStreams | null = null;
  private rl: Interface | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private closed = false;

  async getObject(name: string, options: ComObjectOptions = {}): Promise<ComHandle> {
    const ref = (await this.rpc('getObject', { name, options })) as Record<string, unknown>;
    return new PowershellHandle(this, ref);
  }

  /** Wrap a decoded RPC value: `{$com: id}` refs become handles. */
  wrapValue(value: unknown): unknown {
    if (value && typeof value === 'object' && '$com' in (value as Record<string, unknown>)) {
      return new PowershellHandle(this, value as Record<string, unknown>);
    }
    if (Array.isArray(value)) return value.map((v) => this.wrapValue(v));
    return value;
  }

  release(handle: ComHandle): void {
    const raw = handle.raw as Record<string, unknown> | null;
    if (raw && typeof raw === 'object') {
      void this.rpc('release', { ref: raw }).catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const { reject } of this.pending.values()) reject(new Error('COM bridge closed'));
    this.pending.clear();
    this.rl?.close();
    this.child?.kill();
    this.child = null;
    this.rl = null;
  }

  private ensureDaemon(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed) return this.child;
    // The VBScript daemon (cscript) implements the same JSON-RPC wire protocol
    // as the former PowerShell daemon but avoids PowerShell COM quirks.
    const child = spawn('cscript', ['//nologo', DAEMON_SCRIPT_PATH], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => this.onLine(line));
    child.on('error', (err) => this.onFatal(err));
    child.on('exit', () => this.onFatal(new Error('VBScript COM daemon exited')));
    child.stderr.on('data', (chunk: Buffer) => {
      // Diagnostics only; errors are reported per-request.
      process.stderr.write(`[sap.gui vbs] ${chunk.toString().trimEnd()}\n`);
    });
    this.child = child;
    this.rl = rl;
    return child;
  }

  private onLine(line: string): void {
    let resp: RpcResponse;
    try {
      resp = JSON.parse(line) as RpcResponse;
    } catch {
      return;
    }
    const p = this.pending.get(resp.id);
    if (!p) return;
    this.pending.delete(resp.id);
    clearTimeout(p.timer);
    if (resp.ok) p.resolve(resp.value);
    else p.reject(new Error(resp.error ?? 'COM operation failed'));
  }

  private onFatal(err: Error): void {
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
    this.child = null;
    this.rl = null;
  }

  /** Send one JSON-RPC request and await its response (internal). */
  rpc(op: string, payload: Record<string, unknown>): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('COM bridge closed'));
    const child = this.ensureDaemon();
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`COM ${op} timed out after ${RPC_TIMEOUT_MS}ms`));
      }, RPC_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      const msg = JSON.stringify({ id, op, ...payload });
      child.stdin.write(msg + '\n', (err) => {
        if (err) {
          const p = this.pending.get(id);
          if (p) {
            clearTimeout(p.timer);
            this.pending.delete(id);
            p.reject(err);
          }
        }
      });
    });
  }
}

class PowershellHandle implements ComHandle {
  constructor(
    private api: PowershellComApi,
    readonly raw: Record<string, unknown>,
  ) {}

  async getProp(name: string): Promise<unknown> {
    return this.api.wrapValue(await this.api.rpc('getProp', { ref: this.raw, name }));
  }

  async setProp(name: string, value: unknown): Promise<void> {
    await this.api.rpc('setProp', { ref: this.raw, name, value: PowershellHandle.encodeArg(value) });
  }

  async call(method: string, ...args: unknown[]): Promise<unknown> {
    return this.api.wrapValue(
      await this.api.rpc('call', { ref: this.raw, method, args: args.map(PowershellHandle.encodeArg) }),
    );
  }

  /** A ComHandle argument becomes its `{$com: id}` ref for the wire. */
  static encodeArg(value: unknown): unknown {
    if (value instanceof PowershellHandle) return value.raw;
    if (Array.isArray(value)) return value.map(PowershellHandle.encodeArg);
    return value;
  }
}
