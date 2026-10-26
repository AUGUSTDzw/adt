import { describe, it, expect, vi } from 'vitest';
import { createAdtConnector } from '../../../src/connectors/adt/index.js';

describe('ADT connector', () => {
  it('registers the seven ADT tools', async () => {
    const conn = createAdtConnector();
    await conn.init({ baseUrl: 'https://s4.example.com', authMode: 'basic', user: 'U', pass: 'P' });
    expect(conn.tools().map(t => t.name).sort()).toEqual(
      ['activate','manage_transports','read_source','run_atc','run_unit_tests','search_objects','write_source']
    );
  });

  it('read_source delegates to AdtClient.readSource (mockable)', async () => {
    const conn = createAdtConnector();
    await conn.init({ baseUrl: 'https://s4.example.com', authMode: 'basic', user: 'U', pass: 'P' });
    // Stub the AdtClient's instance method so the handler returns content without hitting SAP.
    // Mirrors the SAC connector's mockability hook (conn.client exposed for vi.spyOn).
    const spy = vi.spyOn(conn.client!, 'readSource').mockResolvedValue('REPORT zdemo.');
    const t = conn.tools().find(t => t.name === 'read_source')!;
    const res = await t.handler({ objectUrl: '/sap/bc/adt/programs/programs/zdemo/source/main' });
    expect(res.content.length).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
