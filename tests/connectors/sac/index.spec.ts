import { describe, it, expect, vi } from 'vitest';
import { createSacConnector } from '../../../src/connectors/sac/index.js';

const EXPECTED = ['calendar', 'content-transport', 'content', 'data-export', 'data-import',
  'monitoring', 'multi-actions', 'schedule-publication', 'smart-query', 'translation', 'user-management'];

describe('SAC connector', () => {
  it('exposes all 11 SAC tools', async () => {
    const conn = createSacConnector();
    await conn.init({ url: 'https://sac.example.com', token: 'fake' });
    const names = conn.tools().map(t => t.name).sort();
    expect(names).toEqual([...EXPECTED].sort());
  });

  it('smart-query handler returns content via the (mockable) SacClient', async () => {
    const conn = createSacConnector();
    await conn.init({ url: 'https://sac.example.com', token: 'fake' });
    const t = conn.tools().find(t => t.name === 'smart-query')!;
    // smart-query routes 'sales by region' (no aggregation) to the relational OData endpoint
    // via client.sacGet. Stub the instance method so no network is hit.
    const spy = vi.spyOn(conn.client!, 'sacGet').mockResolvedValue({
      rows: [{ region: 'North', sales: 100 }, { region: 'South', sales: 250 }],
    });
    const res = await t.handler({ query: 'sales by region' });
    expect(res.content.length).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
