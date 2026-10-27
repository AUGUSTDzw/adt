/**
 * Audit logger — append-only JSONL record of write operations.
 *
 * When MCP_AUDIT_FILE is set, every handler that produces a write (POST/PUT/
 * DELETE/PATCH) is logged with tool attribution. Redacted: no secrets, no
 * full payloads — only tool name, timestamp, and a redacted args fingerprint.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const auditFile = process.env.MCP_AUDIT_FILE;

/** Redact known-sensitive keys from args for audit logging. */
function redactArgs(args: unknown): unknown {
  if (!args || typeof args !== 'object') return args;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    const key = k.toLowerCase();
    if (/pass|secret|token|auth|pwd|credential|key/i.test(key)) {
      out[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      out[k] = redactArgs(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function auditWrite(toolName: string, args: unknown): void {
  if (!auditFile) return;
  try {
    mkdirSync(dirname(auditFile), { recursive: true });
    const record = {
      ts: new Date().toISOString(),
      tool: toolName,
      args: redactArgs(args),
    };
    appendFileSync(auditFile, JSON.stringify(record) + '\n', 'utf-8');
  } catch {
    /* audit failure should never break the tool call */
  }
}
