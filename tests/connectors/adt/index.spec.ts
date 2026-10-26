import { describe, it, expect, vi } from 'vitest';
import { createAdtConnector } from '../../../src/connectors/adt/index.js';

describe('ADT connector', () => {
  it('registers all 34 ADT tools', async () => {
    const conn = createAdtConnector();
    await conn.init({ baseUrl: 'https://s4.example.com', authMode: 'basic', user: 'U', pass: 'P' });
    const names = conn.tools().map(t => t.name).sort();
    expect(names).toHaveLength(34);
    // spot-check a few new ones
    expect(names).toContain('where_used');
    expect(names).toContain('list_dumps');
    expect(names).toContain('table_contents');
    expect(names).toContain('git_repos');
    expect(names).toContain('raw_call');
    // original 7 still present
    expect(names).toContain('read_source');
    expect(names).toContain('run_atc');
  });

  it('read_source delegates to AdtClient.readSource (mockable)', async () => {
    const conn = createAdtConnector();
    await conn.init({ baseUrl: 'https://s4.example.com', authMode: 'basic', user: 'U', pass: 'P' });
    const spy = vi.spyOn(conn.client!, 'readSource').mockResolvedValue('REPORT zdemo.');
    const t = conn.tools().find(t => t.name === 'read_source')!;
    const res = await t.handler({ objectUrl: '/sap/bc/adt/programs/programs/zdemo/source/main' });
    expect(res.content.length).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('raw_call delegates to AdtClient.callRaw (mockable)', async () => {
    const conn = createAdtConnector();
    await conn.init({ baseUrl: 'https://s4.example.com', authMode: 'basic', user: 'U', pass: 'P' });
    const spy = vi.spyOn(conn.client!, 'callRaw').mockResolvedValue({ ok: true });
    const t = conn.tools().find(t => t.name === 'raw_call')!;
    const res = await t.handler({ method: 'dumps', args: [] });
    expect(res.content.length).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalledWith('dumps', []);
    spy.mockRestore();
  });
});
