import { describe, it, expect } from 'vitest';
import { createSsoAuthChain } from '../../../src/core/sso/SsoAuthFactory.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const certPem = readFileSync(join(__dirname, '../../fixtures/sso/test_dsa_cert.pem'), 'utf8');
const keyPem = readFileSync(join(__dirname, '../../fixtures/sso/test_dsa_key.pem'), 'utf8');

/** Shared config: sso2 fields + a seed accessToken for the `token` candidate. */
const cfg = {
  type: 'sso2' as const,
  username: 'SAP*',
  ssoClient: '001',
  ssoSystem: 'NPL',
  pseCert: certPem,
  pseKey: keyPem,
  accessToken: 'jwt-seed',
};

describe('SsoAuthChain', () => {
  it('uses the first valid candidate', async () => {
    const chain = createSsoAuthChain(['sso2'], cfg);
    await chain.init();
    expect(chain.current?.type).toBe('sso2');
  });

  it('falls back past a failing candidate (saml2_pure without samlTrust)', async () => {
    // saml2_pure throws at createSsoAuth (no samlTrust) → skipped → sso2 wins
    const chain = createSsoAuthChain(['saml2_pure', 'sso2'], cfg);
    await chain.init();
    expect(chain.current?.type).toBe('sso2');
  });

  it('throws when every candidate fails', async () => {
    const chain = createSsoAuthChain(['saml2_pure'], cfg);
    await expect(chain.init()).rejects.toThrow(/All SSO candidates failed/);
    expect(chain.current).toBeNull();
  });

  it('switchToNext advances to the next candidate (token accepted lazily)', async () => {
    const chain = createSsoAuthChain(['saml2_pure', 'sso2', 'token'], cfg);
    await chain.init();
    expect(chain.current?.type).toBe('sso2');
    const switched = await chain.switchToNext();
    expect(switched).toBe(true);
    expect(chain.current?.type).toBe('token');
    expect(chain.candidates).toEqual(['saml2_pure', 'sso2', 'token']);
  });

  it('switchToNext returns false when exhausted', async () => {
    const chain = createSsoAuthChain(['sso2'], cfg);
    await chain.init();
    expect(await chain.switchToNext()).toBe(false);
  });

  it('throws for an empty candidate list', () => {
    expect(() => createSsoAuthChain([], cfg)).toThrow(/at least one candidate/);
  });
});
