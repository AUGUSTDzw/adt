import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserAuthStrategy } from '../../../../src/connectors/adt/auth/BrowserAuthStrategy.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

describe('BrowserAuthStrategy', () => {
  let strategy: BrowserAuthStrategy;
  const TEST_PORT = 61999;

  beforeEach(() => {
    strategy = new BrowserAuthStrategy(TEST_PORT);
  });

  afterEach(async () => {
    await strategy.dispose();
  });

  describe('constructor', () => {
    it('creates strategy with custom port', () => {
      const custom = new BrowserAuthStrategy(61998);
      expect(custom).toBeInstanceOf(BrowserAuthStrategy);
    });

    it('creates strategy with default port', () => {
      const def = new BrowserAuthStrategy();
      expect(def).toBeInstanceOf(BrowserAuthStrategy);
    });
  });

  describe('authorize', () => {
    it('returns AuthorizationOutcome with payload and redirectUri', async () => {
      // Create a mock request that resolves immediately with a code
      const mockRequest = {
        buildAuthorizationUrl: vi.fn().mockResolvedValue('https://login.example.com/auth'),
        signal: new AbortController().signal,
      };

      // We can't easily test the full HTTP flow in unit tests,
      // but we can verify the method signature and basic flow
      const authPromise = strategy.authorize(mockRequest as any);

      // Trigger callback via fetch
      await new Promise(resolve => setTimeout(resolve, 50));
      await fetch(`http://localhost:${TEST_PORT}/callback?code=test-code-123`);

      const result = await authPromise;
      expect(result.payload).toBe('test-code-123');
      expect(result.redirectUri).toBe(`http://localhost:${TEST_PORT}/callback`);
    });

    it('rejects when authorization URL build fails', async () => {
      const mockRequest = {
        buildAuthorizationUrl: vi.fn().mockRejectedValue(new Error('Discovery failed')),
        signal: new AbortController().signal,
      };

      await expect(strategy.authorize(mockRequest as any)).rejects.toThrow('Discovery failed');
    });

    it('rejects when callback returns error parameter', async () => {
      const mockRequest = {
        buildAuthorizationUrl: vi.fn().mockResolvedValue('https://login.example.com/auth'),
        signal: new AbortController().signal,
      };

      const authPromise = strategy.authorize(mockRequest as any);
      await new Promise(resolve => setTimeout(resolve, 50));

      await fetch(`http://localhost:${TEST_PORT}/callback?error=access_denied`);

      await expect(authPromise).rejects.toThrow('Authorization failed: access_denied');
    });

    it('rejects when callback has no code parameter', async () => {
      const mockRequest = {
        buildAuthorizationUrl: vi.fn().mockResolvedValue('https://login.example.com/auth'),
        signal: new AbortController().signal,
      };

      const authPromise = strategy.authorize(mockRequest as any);
      await new Promise(resolve => setTimeout(resolve, 50));

      await fetch(`http://localhost:${TEST_PORT}/callback`);

      await expect(authPromise).rejects.toThrow('Missing authorization code');
    });
  });

  describe('abort signal', () => {
    it('rejects when signal is aborted', async () => {
      const controller = new AbortController();
      const mockRequest = {
        buildAuthorizationUrl: vi.fn().mockResolvedValue('https://login.example.com/auth'),
        signal: controller.signal,
      };

      const authPromise = strategy.authorize(mockRequest as any);
      await new Promise(resolve => setTimeout(resolve, 50));

      controller.abort();

      await expect(authPromise).rejects.toThrow('Authorization aborted');
    });
  });

  describe('dispose', () => {
    it('is idempotent (can be called multiple times)', async () => {
      await expect(strategy.dispose()).resolves.toBeUndefined();
      await expect(strategy.dispose()).resolves.toBeUndefined();
    });
  });
});
