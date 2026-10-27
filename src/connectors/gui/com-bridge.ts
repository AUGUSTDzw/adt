/**
 * COM bridge — thin, testable abstraction over the Windows COM automation
 * backend. Two backends implement the same `ComApi`:
 *
 *   - `winax`      — native Node addon (fast path). Optional: needs build tools
 *                    (node-gyp) to compile; used when available.
 *   - `powershell` — a long-lived `pwsh` process speaking JSON-RPC (slow path,
 *                    zero native dependencies). Used when winax is unavailable,
 *                    so the sap.gui connector works without build tools.
 *
 * Every handle operation is async. winax calls are synchronous under the hood
 * but wrapped in promises; PowerShell calls round-trip over the pipe.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** A live COM object reference, backend-agnostic. */
export interface ComHandle {
  /** Opaque backend token (winax dispatch object or PowerShell handle id). */
  readonly raw: unknown;
  /** Read a property; primitives are unwrapped, child COM objects re-wrapped. */
  getProp(name: string): Promise<unknown>;
  setProp(name: string, value: unknown): Promise<void>;
  call(method: string, ...args: unknown[]): Promise<unknown>;
}

export interface ComObjectOptions {
  /** Resolve a name in the ROT (Running Object Table) / a moniker. */
  getobject?: boolean;
  /** Activate an existing object instance (GetActiveObject). */
  activate?: boolean;
  /** Use type information (winax only). */
  type?: boolean;
}

export type ComBackend = 'winax' | 'powershell';

export interface ComApi {
  readonly backend: ComBackend;
  /** Resolve a name (ProgID or ROT moniker) to a COM handle. */
  getObject(name: string, options?: ComObjectOptions): Promise<ComHandle>;
  /** Release a handle. */
  release(handle: ComHandle): void;
  /** Shut the backend down (PowerShell: kill the daemon). */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Async helpers
// ---------------------------------------------------------------------------

/** Read a property that may not exist; returns fallback on failure. */
export async function prop<T>(obj: ComHandle | null | undefined, name: string, fallback: T): Promise<T> {
  if (!obj) return fallback;
  try {
    const value = await obj.getProp(name);
    return value === undefined || value === null ? fallback : (value as T);
  } catch {
    return fallback;
  }
}

/** Call a COM method, unwrapping its result. */
export async function invoke<T = unknown>(obj: ComHandle, method: string, ...args: unknown[]): Promise<T> {
  return (await obj.call(method, ...args)) as T;
}

/** Set a COM property. */
export async function setProp(obj: ComHandle, name: string, value: unknown): Promise<void> {
  await obj.setProp(name, value);
}

/** Enumerate a COM collection via Count + Item(i) (0-based, like SAP GUI). */
export async function enumCollection<T = ComHandle>(collection: ComHandle | null | undefined): Promise<T[]> {
  if (!collection) return [];
  const count = Number(await prop(collection, 'Count', 0));
  const out: T[] = [];
  for (let i = 0; i < count; i++) {
    try {
      out.push((await invoke(collection, 'Item', i)) as T);
    } catch {
      out.push(null as unknown as T); // one dead child must not hide siblings
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Backend detection
// ---------------------------------------------------------------------------

const isWindows = typeof process !== 'undefined' && process.platform === 'win32';

let cached: ComApi | null | undefined;
let cachedReason: string | null = null;

export type { ComApi as ComApiType };

/** True when a COM backend is available (winax or PowerShell). */
export function isComAvailable(): boolean {
  return getCom() !== null;
}

/** Load (once) and return the best COM backend, or null when unavailable. */
export function getCom(): ComApi | null {
  if (cached !== undefined) return cached;
  if (!isWindows) {
    cached = null;
    cachedReason = 'The sap.gui connector requires Windows (COM automation is not available on this platform).';
    return null;
  }
  // Fast path: winax native module.
  try {
    const mod = require('winax');
    cached = new WinaxComApi(mod);
    return cached;
  } catch {
    // Fall through to the PowerShell bridge.
  }
  // Slow path: long-lived pwsh daemon.
  try {
    const { createPowershellCom } = require('./powershell-com.js') as {
      createPowershellCom: () => ComApi;
    };
    cached = createPowershellCom();
    return cached;
  } catch (err) {
    cached = null;
    cachedReason = `No COM backend available (winax not installed and PowerShell bridge failed: ${String(err).slice(0, 120)}). Install winax (needs build tools) or ensure pwsh is available.`;
    return null;
  }
}

/** A human-readable reason for COM being unavailable, or null when available. */
export function comUnavailableReason(): string | null {
  return isComAvailable() ? null : (cachedReason ?? 'no COM backend available');
}

// ---------------------------------------------------------------------------
// winax backend
// ---------------------------------------------------------------------------

interface WinaxObject {
  [key: string]: unknown;
  __id?: string;
  __value?: unknown;
  __methods?: unknown;
  __vars?: unknown;
}

class WinaxHandle implements ComHandle {
  constructor(readonly raw: WinaxObject) {}

  async getProp(name: string): Promise<unknown> {
    return wrapWinaxValue(this.raw[name]);
  }

  async setProp(name: string, value: unknown): Promise<void> {
    this.raw[name] = value;
  }

  async call(method: string, ...args: unknown[]): Promise<unknown> {
    const fn = this.raw[method];
    if (typeof fn !== 'function') throw new Error(`COM method '${method}' not available`);
    return wrapWinaxValue((fn as (...a: unknown[]) => unknown).apply(this.raw, args));
  }
}

function wrapWinaxValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  const v = value as WinaxObject;
  // A dispatch object has type information; a primitive wrapper does not.
  if (v.__id !== undefined || v.__methods !== undefined || v.__vars !== undefined) {
    return new WinaxHandle(v);
  }
  const inner = v.__value;
  if (inner !== undefined) {
    if (typeof inner === 'object' && inner !== null) return wrapWinaxValue(inner);
    return inner;
  }
  return value;
}

class WinaxComApi implements ComApi {
  readonly backend = 'winax' as const;
  constructor(private mod: unknown) {}

  async getObject(name: string, options: ComObjectOptions = {}): Promise<ComHandle> {
    const Ctor = (this.mod as { Object: new (id: string, opt: ComObjectOptions) => WinaxObject }).Object;
    const obj = new Ctor(name, {
      getobject: options.getobject,
      activate: options.activate,
      type: options.type ?? true,
    });
    return new WinaxHandle(obj);
  }

  release(handle: ComHandle): void {
    // winax uses V8 GC; explicit release is a no-op for safety.
  }

  async close(): Promise<void> {
    // Nothing to do for winax.
  }
}

// ---------------------------------------------------------------------------
// Shared error helper
// ---------------------------------------------------------------------------

/** Convert a COM error into a short, client-safe message. */
export function comError(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    const msg = err.message.trim();
    if (msg && !/\[object\]|0x[0-9a-f]{8}/i.test(msg)) return msg.slice(0, 300);
    return fallback;
  }
  if (typeof err === 'string' && err.trim()) return err.trim().slice(0, 300);
  return fallback;
}
