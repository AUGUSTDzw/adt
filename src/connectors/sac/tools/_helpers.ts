/**
 * Shared helpers for SAC MCP tool modules (adapted from reference
 * src/tools/_helpers.ts).
 *
 * Adaptation: dropped getConfig() (env-based config) — the SacClient
 * instance is now injected into each tool factory. Kept the pure
 * helpers: toolSuccess, toolError, buildODataQuery.
 */

import type { ToolResult } from '../../../core/types.js';

/** Wrap an API result in the MCP success envelope. */
export function toolSuccess(data: unknown, metadata?: unknown): ToolResult {
  const response = metadata ? { data, metadata } : data;
  return {
    content: [
      {
        type: 'text',
        text: typeof response === 'string' ? response : JSON.stringify(response, null, 2),
      },
    ],
  };
}

/** Wrap an error in the MCP error envelope. */
export function toolError(err: unknown): ToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

/**
 * Build a query-string from a param map, dropping undefined values.
 * Returns "" (empty) when no params are defined, or "?key=val&…" otherwise.
 */
export function buildODataQuery(
  params: Record<string, string | number | boolean | undefined>,
): string {
  const entries = Object.entries(params).filter(
    (e): e is [string, string | number | boolean] =>
      e[1] !== undefined && e[0] !== 'allowalteration',
  );
  if (entries.length === 0) return '';
  const qs = entries
    .map(([k, v]) => {
      const key = k.startsWith('$') ? k : encodeURIComponent(k);
      return `${key}=${encodeURIComponent(String(v))}`;
    })
    .join('&');
  return `?${qs}`;
}

/** Standard "confirm write" guard used by mutating operations. */
export function requireAlteration(allowalteration: unknown): ToolResult | null {
  if (!allowalteration) {
    return toolError(
      "Security Requirement: This operation changes data. Please confirm by calling again with 'allowalteration=true'.",
    );
  }
  return null;
}
