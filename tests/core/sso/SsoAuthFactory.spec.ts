import { describe, it, expect } from 'vitest';
import { createSsoAuth, decodeSso2 } from '../../../src/core/sso/SsoAuthFactory.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const certPem = readFileSync(join(__dirname, '../../fixtures/sso/test_dsa_cert.pem'), 'utf8');
const keyPem = readFileSync(join(__dirname, '../../fixtures/sso/test_dsa_key.pem'), 'utf8');

describe('SsoAuthFactory', () => {
  describe('sso2 (MYSAPSSO2)', () => {
    it('returns a Cookie header and refreshes', async () => {
      const auth = createSsoAuth({
        type: 'sso2',
        username: 'SAP*',
        ssoClient: '001',
        ssoSystem: 'NPL',
        pseCert: certPem,
        pseKey: keyPem,
      });
      expect(auth.type).toBe('sso2');
      expect(auth.headers).toBeDefined();
      expect(auth.headers!.Cookie).toMatch(/^MYSAPSSO2=/);
      const cookie = auth.headers!.Cookie.replace('MYSAPSSO2=', '');
      const fields = decodeSso2(cookie);
      expect(fields.user).toBe('SAP*');
      expect(fields.client).toBe('001');
      expect(fields.sid).toBe('NPL');
      await auth.refresh?.();
      expect(auth.headers!.Cookie).toMatch(/^MYSAPSSO2=/);
    });

    it('accepts PEM file paths', () => {
      const auth = createSsoAuth({
        type: 'sso2',
        ssoUser: 'USER',
        ssoClient: '100',
        ssoSystem: 'PRD',
        pseCert: join(__dirname, '../../fixtures/sso/test_dsa_cert.pem'),
        pseKey: join(__dirname, '../../fixtures/sso/test_dsa_key.pem'),
      });
      const cookie = auth.headers!.Cookie.replace('MYSAPSSO2=', '');
      expect(decodeSso2(cookie).user).toBe('USER');
    });

    it('throws without cert/key', () => {
      expect(() => createSsoAuth({ type: 'sso2', username: 'U', ssoClient: '1', ssoSystem: 'S' })).toThrow(
        /pseCert/,
      );
    });
  });

  describe('token (pre-provisioned)', () => {
    it('returns a fixed bearer fetcher', async () => {
      const auth = createSsoAuth({ type: 'token', accessToken: 'jwt-abc' });
      expect(auth.type).toBe('token');
      expect(await auth.fetcher()).toBe('jwt-abc');
    });

    it('throws without accessToken', () => {
      expect(() => createSsoAuth({ type: 'token' })).toThrow(/accessToken/);
    });
  });

  describe('client_credentials', () => {
    it('returns a token fetcher', async () => {
      const auth = createSsoAuth({
        type: 'client_credentials',
        uaaUrl: 'https://example.authentication.ondemand.com',
        clientId: 'client',
        clientSecret: 'secret',
      });
      expect(auth.provider).toBeDefined();
      // fetcher hits the network — just assert it exists
      expect(typeof auth.fetcher).toBe('function');
    });

    it('throws without clientId', () => {
      expect(() => createSsoAuth({ type: 'client_credentials', uaaUrl: 'https://x' })).toThrow(/clientId/);
    });
  });

  describe('validation', () => {
    it('throws for unsupported type', () => {
      expect(() => createSsoAuth({ type: 'basic' })).toThrow();
    });
  });
});

