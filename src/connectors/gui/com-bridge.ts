/**
 * COM bridge — thin, testable wrapper around the optional `winax` dependency.
 *
 * winax is a native Node addon exposing Windows COM automation (ActiveX). It
 * is Windows-only and optional: this bridge lazy-loads it, provides a stable
 * interface for the rest of the gui connector, and turns raw COM errors into
 * friendly messages. Everything is synchronous (winax is), so COM calls are
 * naturally serialized on the STA main thread.
 */

import { createRequire } from 'node:module';

/** Minimal shape of a winax COM dispatch object. */
export interface ComObject {
  // COM objects are dynamic: properties and methods are resolved at runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
  __id?: string;
  __value?: unknown;
  valueOf?(): unknown;
}

/** Minimal shape of a winax dispatch wrapper (a property-bearing object). */
export interface ComApi {
  Object: new (id: string, options?: ComObjectOptions) => ComObject;
  Variant: new (value?: unknown, type?: string) => ComObject;
  release: (...objects: unknown[]) => void;
}

export interface ComObjectOptions {
  /** Allow resolving a name in the ROT (Running Object Table) via CoGetObject. */
  getobject?: boolean;
  /** Allow activating an existing object instance (GetActiveObject). */
  activate?: boolean;
  /** Allow using type information for conflict resolution. */
  type?: boolean;
}

let cached: ComApi | null = null;
let cachedError: string | null = null;

const isWindows = typeof process !== 'undefined' && process.platform === 'win32';

/** True when winax loaded successfully (and only on Windows). */
export function isComAvailable(): boolean {
  return getCom() !== null;
}

/** Load (once) and return the winax API, or null when unavailable. */
export function getCom(): ComApi | null {
  if (cachedError !== null) return null;
  if (cached !== null) return cached;
  if (!isWindows) {
    cachedError = 'The sap.gui connector requires Windows (COM automation is not available on this platform).';
    return null;
  }
  try {
    // winax is a CommonJS native addon: require() is the reliable way to load
    // it from an ESM module.
    const require = createRequire(import.meta.url);
    const mod = require('winax');
    cached = mod as ComApi;
    return cached;
  } catch (err) {
    cachedError = `winax is not installed (${String(err).split('\n')[0].slice(0, 120)}). Install with: npm install winax`;
    return null;
  }
}

/** A human-readable reason for COM being unavailable, or null when available. */
export function comUnavailableReason(): string | null {
  return isComAvailable() ? null : (cachedError ?? 'winax is not available');
}

/**
 * Extract the primitive value behind a winax dispatch object. winax returns
 * wrapper objects for COM values; the real value sits in `__value` (or is
 * produced by valueOf()). Recurses for nested wrappers.
 */
export function unwrap(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  const com = value as ComObject;
  if ('__value' in com) {
    const v = com.__value;
    if (v === undefined || v === null) return v;
    if (typeof v === 'object') return unwrap(v);
    return v;
  }
  if (typeof com.valueOf === 'function') {
    try {
      const v = com.valueOf();
      if (v !== value) {
        if (v === null || typeof v !== 'object') return v;
        return unwrap(v);
      }
    } catch {
      // valueOf raised: fall through to the raw object
    }
  }
  return value;
}

/** Read a COM property that may not exist; returns default on failure. */
export function prop<T = unknown>(obj: unknown, name: string, fallback: T): T {
  if (obj === null || obj === undefined) return fallback;
  try {
    const value = (obj as ComObject)[name];
    return value === undefined ? fallback : (unwrap(value) as T);
  } catch {
    return fallback;
  }
}

/** True when a COM property exists and reads without throwing. */
export function hasProp(obj: unknown, name: string): boolean {
  if (obj === null || obj === undefined) return false;
  try {
    return (obj as ComObject)[name] !== undefined;
  } catch {
    return false;
  }
}

/** Call a COM method, unwrapping its result. */
export function invoke<T = unknown>(obj: unknown, method: string, ...args: unknown[]): T {
  const fn = (obj as ComObject | undefined)?.[method];
  if (typeof fn !== 'function') {
    throw new Error(`COM method '${method}' not available`);
  }
  return unwrap((fn as (...a: unknown[]) => unknown).apply(obj, args)) as T;
}

/**
 * Enumerate a COM collection (GuiComponentCollection, etc.) into an array.
 * Reads `.Count` and `.Item(index)` (0-based, like SAP GUI collections).
 */
export function enumCollection<T = unknown>(collection: unknown): T[] {
  if (collection === null || collection === undefined) return [];
  const count = Number(prop(collection, 'Count', 0));
  const out: T[] = [];
  for (let i = 0; i < count; i++) {
    try {
      out.push(invoke<T>(collection, 'Item', i));
    } catch {
      // One dead child must not hide its siblings.
      out.push(null as unknown as T);
    }
  }
  return out;
}

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
