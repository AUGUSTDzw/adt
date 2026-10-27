import { describe, it, expect, beforeEach } from 'vitest';
import { InMemorySessionStore } from '../../../../src/connectors/adt/auth/InMemorySessionStore.js';

describe('InMemorySessionStore', () => {
  let store: InMemorySessionStore;

  beforeEach(() => {
    store = new InMemorySessionStore();
  });

  describe('loadSession', () => {
    it('returns null when no session exists', async () => {
      expect(await store.loadSession('mcp')).toBeNull();
    });

    it('returns saved session', async () => {
      const config = { uaaUrl: 'https://uaa.example.com', uaaClientId: 'client123' };
      await store.saveSession('mcp', config);
      expect(await store.loadSession('mcp')).toEqual(config);
    });

    it('returns null for different destination', async () => {
      await store.saveSession('mcp', { uaaUrl: 'https://uaa.example.com' });
      expect(await store.loadSession('other')).toBeNull();
    });
  });

  describe('saveSession', () => {
    it('saves session config', async () => {
      const config = { serviceUrl: 'https://s4.example.com', sapClient: '100' };
      await store.saveSession('mcp', config);
      expect(await store.loadSession('mcp')).toEqual(config);
    });

    it('overwrites existing session', async () => {
      await store.saveSession('mcp', { serviceUrl: 'https://old.example.com' });
      await store.saveSession('mcp', { serviceUrl: 'https://new.example.com' });
      expect(await store.loadSession('mcp')).toEqual({ serviceUrl: 'https://new.example.com' });
    });
  });

  describe('deleteSession', () => {
    it('deletes existing session', async () => {
      await store.saveSession('mcp', { uaaUrl: 'https://uaa.example.com' });
      await store.deleteSession('mcp');
      expect(await store.loadSession('mcp')).toBeNull();
    });

    it('does not throw when deleting non-existent session', async () => {
      await expect(store.deleteSession('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('getAuthorizationConfig', () => {
    it('returns null when no session', async () => {
      expect(await store.getAuthorizationConfig('mcp')).toBeNull();
    });

    it('returns authorization config from session', async () => {
      await store.saveSession('mcp', {
        uaaUrl: 'https://uaa.example.com',
        uaaClientId: 'client123',
        uaaClientSecret: 'secret456',
      });
      const result = await store.getAuthorizationConfig('mcp');
      expect(result).toEqual({
        uaaUrl: 'https://uaa.example.com',
        uaaClientId: 'client123',
        uaaClientSecret: 'secret456',
        refreshToken: undefined,
      });
    });

    it('includes refreshToken when present', async () => {
      await store.saveSession('mcp', {
        uaaUrl: 'https://uaa.example.com',
        uaaClientId: 'client123',
        uaaClientSecret: 'secret456',
        refreshToken: 'refresh789',
      });
      const result = await store.getAuthorizationConfig('mcp');
      expect(result?.refreshToken).toBe('refresh789');
    });
  });

  describe('getConnectionConfig', () => {
    it('returns null when no session', async () => {
      expect(await store.getConnectionConfig('mcp')).toBeNull();
    });

    it('returns connection config from session', async () => {
      const config = {
        serviceUrl: 'https://s4.example.com',
        sapClient: '100',
        language: 'en',
      };
      await store.saveSession('mcp', config);
      expect(await store.getConnectionConfig('mcp')).toEqual(config);
    });
  });

  describe('setAuthorizationConfig', () => {
    it('creates new session when none exists', async () => {
      await store.setAuthorizationConfig('mcp', {
        uaaUrl: 'https://uaa.example.com',
        uaaClientId: 'client123',
        uaaClientSecret: 'secret456',
      });
      expect(await store.loadSession('mcp')).toEqual({
        uaaUrl: 'https://uaa.example.com',
        uaaClientId: 'client123',
        uaaClientSecret: 'secret456',
      });
    });

    it('merges with existing session', async () => {
      await store.saveSession('mcp', { serviceUrl: 'https://s4.example.com' });
      await store.setAuthorizationConfig('mcp', {
        uaaUrl: 'https://uaa.example.com',
        uaaClientId: 'client123',
        uaaClientSecret: 'secret456',
      });
      const result = await store.loadSession('mcp');
      expect(result).toEqual({
        serviceUrl: 'https://s4.example.com',
        uaaUrl: 'https://uaa.example.com',
        uaaClientId: 'client123',
        uaaClientSecret: 'secret456',
      });
    });
  });

  describe('setConnectionConfig', () => {
    it('creates new session when none exists', async () => {
      await store.setConnectionConfig('mcp', {
        serviceUrl: 'https://s4.example.com',
        sapClient: '100',
      });
      expect(await store.loadSession('mcp')).toEqual({
        serviceUrl: 'https://s4.example.com',
        sapClient: '100',
      });
    });

    it('merges with existing session', async () => {
      await store.saveSession('mcp', {
        uaaUrl: 'https://uaa.example.com',
        uaaClientId: 'client123',
      });
      await store.setConnectionConfig('mcp', {
        serviceUrl: 'https://s4.example.com',
      });
      const result = await store.loadSession('mcp');
      expect(result).toEqual({
        uaaUrl: 'https://uaa.example.com',
        uaaClientId: 'client123',
        serviceUrl: 'https://s4.example.com',
      });
    });
  });
});
