import { describe, it, expect } from 'vitest';
import { wrapSpnego } from '../../../src/core/sso/spnego.js';

describe('spnego (SPNEGO/Kerberos wrapper)', () => {
  it('wraps an AP-REQ in a SPNEGO NegTokenInit', () => {
    const apReq = Buffer.from([0x60, 0x03, 0x01, 0x02, 0x03]);
    const token = wrapSpnego(apReq);

    // [APPLICATION 0] SEQUENCE wrapping
    expect(token[0]).toBe(0x60);
    // SPNEGO OID 1.3.6.1.5.5.2 embedded (06 06 2b0601050502)
    expect(token.toString('hex')).toContain('06062b0601050502');
    // mechToken [2] wraps an OCTET STRING (a2 <len> 04 <len>)
    expect(token.toString('hex')).toMatch(/a2[0-9a-f]{2}04[0-9a-f]{2}/);
    // AP-REQ bytes preserved at the tail
    expect(token.subarray(token.length - apReq.length).toString('hex')).toBe(apReq.toString('hex'));
  });

  it('produces a deterministic wrapper for a known AP-REQ', () => {
    const apReq = Buffer.from([0x01, 0x02]);
    const t1 = wrapSpnego(apReq);
    const t2 = wrapSpnego(apReq);
    expect(t1.toString('hex')).toBe(t2.toString('hex'));
    // [APPLICATION 0] SEQUENCE { [0] SEQUENCE { [0] SEQUENCE { OID(spnego) }, [2] OCTET STRING(AP-REQ) } }
    expect(t1.toString('hex')).toBe('6016a0143012a00a300806062b0601050502a20404020102');
  });
});

