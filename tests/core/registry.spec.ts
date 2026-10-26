import { describe, it, expect } from 'vitest';
import { Registry } from '../../src/core/registry.js';
import type { SapConnector, ToolRegistration } from '../../src/core/types.js';
import { z } from 'zod';

function mkConn(id: string, fail = false): SapConnector {
  return {
    id,
    async init() { if (fail) throw new Error('boom'); },
    tools(): ToolRegistration[] {
      return [{ name: 'ping', description: 'p', inputSchema: { msg: z.string() },
        handler: async (a) => ({ content: [{ type: 'text', text: String((a as any).msg) }] }) }];
    },
  };
}

describe('Registry', () => {
  it('prefixes tool names with sap.<id>.', async () => {
    const r = new Registry();
    r.register(mkConn('rfc'));
    await r.initAll({ rfc: {} });
    const t = r.allTools();
    expect(t[0].name).toBe('sap.rfc.ping');
  });

  it('skips a connector whose init throws, keeps the others', async () => {
    const r = new Registry();
    r.register(mkConn('sac', true));
    r.register(mkConn('rfc'));
    await r.initAll({ sac: {}, rfc: {} });
    const names = r.allTools().map(t => t.name);
    expect(names).toEqual(['sap.rfc.ping']);
  });
});
