import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('abap-adt-api', () => ({
  ADTClient: vi.fn().mockImplementation(() => ({
    getObjectSource: vi.fn(),
    setObjectSource: vi.fn(),
    lock: vi.fn(),
    unLock: vi.fn(),
    searchObject: vi.fn(),
    activate: vi.fn(),
    unitTestRun: vi.fn(),
    createAtcRun: vi.fn(),
    transportRelease: vi.fn(),
    createTransport: vi.fn(),
    stateful: 'stateful',
    h: { request: vi.fn() },
  })),
  session_types: { stateful: 'stateful' },
}));

vi.mock('@mcp-abap-adt/auth-broker', () => ({
  AuthBroker: vi.fn().mockImplementation(() => ({
    getToken: vi.fn().mockResolvedValue('fake-token-123'),
  })),
}));

vi.mock('@mcp-abap-adt/auth-providers', () => ({
  refreshThenLogin: vi.fn().mockReturnValue({}),
}));

vi.mock('../../../../src/connectors/adt/auth/InMemorySessionStore.js', () => ({
  InMemorySessionStore: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../../../src/connectors/adt/auth/EnvServiceKeyStore.js', () => ({
  EnvServiceKeyStore: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../../../src/connectors/adt/auth/BrowserAuthStrategy.js', () => ({
  BrowserAuthStrategy: vi.fn().mockImplementation(() => ({
    authorize: vi.fn(),
    dispose: vi.fn(),
  })),
}));

import { AdtClient } from '../../../src/connectors/adt/adt-client.js';
import { ADTClient } from 'abap-adt-api';
import { AuthBroker } from '@mcp-abap-adt/auth-broker';

describe('AdtClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor validation', () => {
    it('throws when baseUrl is missing', () => {
      expect(() => new AdtClient({ authMode: 'basic' })).toThrow('AdtClient requires baseUrl');
    });

    it('throws for basic auth without user', () => {
      expect(() => new AdtClient({
        baseUrl: 'https://s4.example.com',
        authMode: 'basic',
      })).toThrow('basic auth requires user and pass');
    });

    it('throws for basic auth without pass', () => {
      expect(() => new AdtClient({
        baseUrl: 'https://s4.example.com',
        authMode: 'basic',
        user: 'U',
      })).toThrow('basic auth requires user and pass');
    });

    it('throws for xsuaa auth without clientId', () => {
      expect(() => new AdtClient({
        baseUrl: 'https://s4.example.com',
        authMode: 'xsuaa',
        clientSecret: 'P',
        tokenUrl: 'https://uaa.example.com/oauth/token',
      })).toThrow('xsuaa auth requires clientId, clientSecret and tokenUrl');
    });

    it('throws for xsuaa auth without clientSecret', () => {
      expect(() => new AdtClient({
        baseUrl: 'https://s4.example.com',
        authMode: 'xsuaa',
        clientId: 'C',
        tokenUrl: 'https://uaa.example.com/oauth/token',
      })).toThrow('xsuaa auth requires clientId, clientSecret and tokenUrl');
    });

    it('throws for xsuaa auth without tokenUrl', () => {
      expect(() => new AdtClient({
        baseUrl: 'https://s4.example.com',
        authMode: 'xsuaa',
        clientId: 'C',
        clientSecret: 'P',
      })).toThrow('xsuaa auth requires clientId, clientSecret and tokenUrl');
    });
  });

  describe('basic auth mode', () => {
    it('creates ADTClient with user and pass', () => {
      new AdtClient({
        baseUrl: 'https://s4.example.com',
        authMode: 'basic',
        user: 'USER',
        pass: 'PASS',
        client: '100',
        language: 'en',
      });
      expect(ADTClient).toHaveBeenCalledWith(
        'https://s4.example.com',
        'USER',
        'PASS',
        '100',
        'en',
      );
    });

    it('initializes ADTClient immediately (not lazy)', () => {
      const client = new AdtClient({
        baseUrl: 'https://s4.example.com',
        authMode: 'basic',
        user: 'U',
        pass: 'P',
      });
      expect(client.raw).toBeDefined();
    });
  });

  describe('xsuaa auth mode', () => {
    it('does not create ADTClient immediately (lazy)', () => {
      const client = new AdtClient({
        baseUrl: 'https://s4.example.com',
        authMode: 'xsuaa',
        clientId: 'C',
        clientSecret: 'S',
        tokenUrl: 'https://uaa.example.com/oauth/token',
      });
      // ADTClient is not created until init() is called
      expect(() => client.raw).toThrow('ADTClient not initialized');
    });

    it('init() creates ADTClient with token fetcher', async () => {
      const client = new AdtClient({
        baseUrl: 'https://s4.example.com',
        authMode: 'xsuaa',
        clientId: 'C',
        clientSecret: 'S',
        tokenUrl: 'https://uaa.example.com/oauth/token',
      });
      await client.init();
      expect(client.raw).toBeDefined();
    });
  });

  describe('jwt auth mode with pre-provided token', () => {
    it('creates ADTClient with token fetcher returning provided token', async () => {
      const client = new AdtClient({
        baseUrl: 'https://s4.example.com',
        authMode: 'jwt',
        token: 'pre-provided-token-123',
      });
      await client.init();
      expect(client.raw).toBeDefined();
    });

    it('does not create AuthBroker when token is provided', () => {
      new AdtClient({
        baseUrl: 'https://s4.example.com',
        authMode: 'jwt',
        token: 'pre-provided-token',
      });
      expect(AuthBroker).not.toHaveBeenCalled();
    });
  });

  describe('jwt auth mode without token (browser SSO)', () => {
    it('creates AuthBroker when no token provided', () => {
      new AdtClient({
        baseUrl: 'https://s4.example.com',
        authMode: 'jwt',
      });
      expect(AuthBroker).toHaveBeenCalled();
    });

    it('AuthBroker is configured with sessionStore and serviceKeyStore', () => {
      new AdtClient({
        baseUrl: 'https://s4.example.com',
        authMode: 'jwt',
      });
      const call = vi.mocked(AuthBroker).mock.calls[0][0];
      expect(call.sessionStore).toBeDefined();
      expect(call.serviceKeyStore).toBeDefined();
      expect(call.authorization).toBeDefined();
      expect(call.renewal).toBeDefined();
      expect(call.onWriteFailure).toBe('continue');
    });

    it('init() calls AuthBroker.getToken for browser login', async () => {
      const getTokenSpy = vi.fn().mockResolvedValue('browser-token-123');
      vi.mocked(AuthBroker).mockImplementation(() => ({ getToken: getTokenSpy }) as any);

      const client = new AdtClient({
        baseUrl: 'https://s4.example.com',
        authMode: 'jwt',
      });
      await client.init();
      expect(getTokenSpy).toHaveBeenCalledWith('mcp');
      expect(client.raw).toBeDefined();
    });
  });

  describe('config key normalization', () => {
    it('accepts camelCase keys', () => {
      expect(() => new AdtClient({
        baseUrl: 'https://s4.example.com',
        authMode: 'basic',
        user: 'U',
        pass: 'P',
      })).not.toThrow();
    });

    it('accepts lowercase keys (from env loader)', () => {
      expect(() => new AdtClient({
        baseurl: 'https://s4.example.com',
        authmode: 'basic',
        user: 'U',
        pass: 'P',
      })).not.toThrow();
    });

    it('accepts xsuaa lowercase keys', () => {
      expect(() => new AdtClient({
        baseurl: 'https://s4.example.com',
        authmode: 'xsuaa',
        clientid: 'C',
        clientsecret: 'S',
        tokenurl: 'https://uaa.example.com/oauth/token',
      })).not.toThrow();
    });
  });

  describe('destination config', () => {
    it('uses default destination "mcp"', async () => {
      const getTokenSpy = vi.fn().mockResolvedValue('token');
      vi.mocked(AuthBroker).mockImplementation(() => ({ getToken: getTokenSpy }) as any);

      const client = new AdtClient({
        baseUrl: 'https://s4.example.com',
        authMode: 'jwt',
      });
      await client.init();
      expect(getTokenSpy).toHaveBeenCalledWith('mcp');
    });

    it('uses custom destination when provided', async () => {
      const getTokenSpy = vi.fn().mockResolvedValue('token');
      vi.mocked(AuthBroker).mockImplementation(() => ({ getToken: getTokenSpy }) as any);

      const client = new AdtClient({
        baseUrl: 'https://s4.example.com',
        authMode: 'jwt',
        destination: 'PROD',
      });
      await client.init();
      expect(getTokenSpy).toHaveBeenCalledWith('PROD');
    });
  });

  describe('raw HTTP helpers', () => {
    it('rawGet throws when ADTClient not initialized', async () => {
      const client = new AdtClient({
        baseUrl: 'https://s4.example.com',
        authMode: 'jwt',
      });
      // Don't call init(), so ADTClient is not created
      await expect(client.rawGet('/path')).rejects.toThrow('ADTClient not initialized');
    });

    it('rawPost throws when ADTClient not initialized', async () => {
      const client = new AdtClient({
        baseUrl: 'https://s4.example.com',
        authMode: 'jwt',
      });
      await expect(client.rawPost('/path')).rejects.toThrow('ADTClient not initialized');
    });
  });
});
