import { describe, it, expect } from 'vitest';
import { EnvServiceKeyStore } from '../../../../src/connectors/adt/auth/EnvServiceKeyStore.js';

describe('EnvServiceKeyStore', () => {
  describe('with complete JWT config', () => {
    const config = {
      baseUrl: 'https://s4.example.com',
      authMode: 'jwt',
      client: '100',
      language: 'en',
      uaaUrl: 'https://uaa.example.com',
      uaaClientId: 'client123',
      uaaClientSecret: 'secret456',
    };

    it('getServiceKey returns connection config', async () => {
      const store = new EnvServiceKeyStore(config);
      const result = await store.getServiceKey('mcp');
      expect(result).not.toBeNull();
      expect(result?.serviceUrl).toBe('https://s4.example.com');
      expect(result?.authType).toBe('jwt');
    });

    it('getAuthorizationConfig returns UAA credentials', async () => {
      const store = new EnvServiceKeyStore(config);
      const result = await store.getAuthorizationConfig('mcp');
      expect(result).toEqual({
        uaaUrl: 'https://uaa.example.com',
        uaaClientId: 'client123',
        uaaClientSecret: 'secret456',
      });
    });

    it('getConnectionConfig returns service URL and client info', async () => {
      const store = new EnvServiceKeyStore(config);
      const result = await store.getConnectionConfig('mcp');
      expect(result).toMatchObject({
        serviceUrl: 'https://s4.example.com',
        authType: 'jwt',
        grantType: 'authorization_code',
        sapClient: '100',
        language: 'en',
      });
    });

    it('getClientCertificate returns null', async () => {
      const store = new EnvServiceKeyStore(config);
      expect(await store.getClientCertificate?.('mcp')).toBeNull();
    });
  });

  describe('with clientId/clientSecret fallback', () => {
    const config = {
      baseUrl: 'https://s4.example.com',
      authMode: 'jwt',
      uaaUrl: 'https://uaa.example.com',
      clientId: 'client123',
      clientSecret: 'secret456',
      tokenUrl: 'https://uaa.example.com/oauth/token',
    };

    it('uses clientId as uaaClientId', async () => {
      const store = new EnvServiceKeyStore(config);
      const result = await store.getAuthorizationConfig('mcp');
      expect(result?.uaaClientId).toBe('client123');
    });

    it('uses clientSecret as uaaClientSecret', async () => {
      const store = new EnvServiceKeyStore(config);
      const result = await store.getAuthorizationConfig('mcp');
      expect(result?.uaaClientSecret).toBe('secret456');
    });
  });

  describe('with missing UAA config', () => {
    it('returns null for getAuthorizationConfig when no UAA URL', async () => {
      const store = new EnvServiceKeyStore({ baseUrl: 'https://s4.example.com' });
      expect(await store.getAuthorizationConfig('mcp')).toBeNull();
    });

    it('returns null for getAuthorizationConfig when no clientId', async () => {
      const store = new EnvServiceKeyStore({
        baseUrl: 'https://s4.example.com',
        uaaUrl: 'https://uaa.example.com',
      });
      expect(await store.getAuthorizationConfig('mcp')).toBeNull();
    });

    it('returns null for getAuthorizationConfig when no clientSecret', async () => {
      const store = new EnvServiceKeyStore({
        baseUrl: 'https://s4.example.com',
        uaaUrl: 'https://uaa.example.com',
        uaaClientId: 'client123',
      });
      expect(await store.getAuthorizationConfig('mcp')).toBeNull();
    });
  });

  describe('with missing baseUrl', () => {
    it('returns null for getConnectionConfig', async () => {
      const store = new EnvServiceKeyStore({ authMode: 'jwt' });
      expect(await store.getConnectionConfig('mcp')).toBeNull();
    });

    it('returns null for getServiceKey', async () => {
      const store = new EnvServiceKeyStore({ authMode: 'jwt' });
      expect(await store.getServiceKey('mcp')).toBeNull();
    });
  });

  describe('with different auth modes', () => {
    it('defaults grantType to authorization_code', async () => {
      const store = new EnvServiceKeyStore({
        baseUrl: 'https://s4.example.com',
        authMode: 'jwt',
      });
      const result = await store.getConnectionConfig('mcp');
      expect(result?.grantType).toBe('authorization_code');
    });

    it('uses configured grantType', async () => {
      const store = new EnvServiceKeyStore({
        baseUrl: 'https://s4.example.com',
        authMode: 'jwt',
        grantType: 'client_credentials',
      });
      const result = await store.getConnectionConfig('mcp');
      expect(result?.grantType).toBe('client_credentials');
    });
  });
});
