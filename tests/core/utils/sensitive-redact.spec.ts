import { describe, it, expect } from 'vitest';
import { redact } from '../../../src/core/utils/sensitive-redact.js';

describe('redact', () => {
  it('replaces values of known-sensitive keys with [REDACTED]', () => {
    const out = redact({ host: 'h', password: 'secret', token: 'abc', nested: { PASSWD: 'x' } });
    expect(out.password).toBe('[REDACTED]');
    expect(out.token).toBe('[REDACTED]');
    expect(out.host).toBe('h');
    expect(out.nested.PASSWD).toBe('[REDACTED]');
  });
  it('redacts inside JSON strings', () => {
    const out = redact('error: password=secret token=abc');
    expect(out).toContain('password=[REDACTED]');
    expect(out).not.toContain('secret');
  });
});
