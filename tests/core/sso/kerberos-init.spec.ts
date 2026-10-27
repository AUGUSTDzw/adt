import { describe, it, expect, beforeEach, vi } from 'vitest';

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: execFileMock }));

import { ensureKerberosTgt, __resetKerberosInitCache } from '../../../src/core/sso/kerberos-init.js';

beforeEach(() => {
  execFileMock.mockReset();
  __resetKerberosInitCache();
});

describe('ensureKerberosTgt', () => {
  it('is a no-op when keytab/principal are absent', async () => {
    await ensureKerberosTgt({});
    await ensureKerberosTgt({ keytab: '/k' });
    await ensureKerberosTgt({ principal: 'p@R' });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('runs kinit -kt <keytab> <principal>', async () => {
    execFileMock.mockImplementation((_c: string, _a: string[], cb: (e: Error | null, o: string, e2: string) => void) =>
      cb(null, '', ''),
    );
    await ensureKerberosTgt({ keytab: '/etc/krb5.keytab', principal: 'svc/mcp@REALM' });
    expect(execFileMock).toHaveBeenCalledWith(
      'kinit',
      ['-kt', '/etc/krb5.keytab', 'svc/mcp@REALM'],
      expect.any(Function),
    );
  });

  it('throttles repeated calls for the same principal within 7h', async () => {
    execFileMock.mockImplementation((_c: string, _a: string[], cb: (e: Error | null, o: string, e2: string) => void) =>
      cb(null, '', ''),
    );
    await ensureKerberosTgt({ keytab: '/k', principal: 'p@R' });
    await ensureKerberosTgt({ keytab: '/k', principal: 'p@R' });
    await ensureKerberosTgt({ keytab: '/k', principal: 'p@R' });
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it('re-kinit for a different principal', async () => {
    execFileMock.mockImplementation((_c: string, _a: string[], cb: (e: Error | null, o: string, e2: string) => void) =>
      cb(null, '', ''),
    );
    await ensureKerberosTgt({ keytab: '/k', principal: 'a@R' });
    await ensureKerberosTgt({ keytab: '/k', principal: 'b@R' });
    expect(execFileMock).toHaveBeenCalledTimes(2);
  });

  it('throws a descriptive error when kinit fails', async () => {
    execFileMock.mockImplementation((_c: string, _a: string[], cb: (e: Error | null, o: string, e2: string) => void) =>
      cb(new Error('command not found'), '', 'kinit: not found'),
    );
    await expect(
      ensureKerberosTgt({ keytab: '/k', principal: 'p@R' }),
    ).rejects.toThrow(/Automatic kinit failed/);
  });
});
