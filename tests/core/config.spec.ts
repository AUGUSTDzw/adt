import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadConfig } from '../../src/core/config.js';

describe('loadConfig', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = {
      SAP_ENABLED_CONNECTORS: 'rfc,sac',
      SAP_TRANSPORT: 'http',
      SAP_HTTP_PORT: '8080',
      SAP_HTTP_AUTH_TOKEN: 'tok',
      SAP_RFC_ASHOST: 'sap.example.com',
      SAP_RFC_SYSNR: '00',
      SAP_RFC_CLIENT: '100',
      SAP_RFC_USER: 'ALICE',
      SAP_RFC_PASSWD: 'pw',
      SAP_SAC_URL: 'https://sac.example.com',
      SAP_SAC_TOKEN: 'sactok',
    } as NodeJS.ProcessEnv;
  });

  it('groups per-connector env vars and reads transport', () => {
    const cfg = loadConfig();
    expect(cfg.enabled).toEqual(['rfc', 'sac']);
    expect(cfg.transport).toBe('http');
    expect(cfg.httpPort).toBe(8080);
    expect(cfg.connectors.rfc).toMatchObject({ ashost: 'sap.example.com', sysnr: '00', client: '100', user: 'ALICE', passwd: 'pw' });
    expect(cfg.connectors.sac).toMatchObject({ url: 'https://sac.example.com', token: 'sactok' });
  });

  it('defaults transport to stdio', () => {
    delete process.env.SAP_TRANSPORT;
    expect(loadConfig().transport).toBe('stdio');
  });
});
