import { describe, it, expectTypeOf } from 'vitest';
import type { SapConnector, ToolRegistration } from '../../src/core/types.js';
import { z } from 'zod';

describe('SapConnector contract', () => {
  it('accepts a connector that returns namespaced tool registrations', () => {
    const conn: SapConnector = {
      id: 'demo',
      async init() {},
      tools(): ToolRegistration[] {
        return [{
          name: 'demo.ping',
          description: 'ping',
          inputSchema: { msg: z.string() },
          handler: async (a) => ({ content: [{ type: 'text', text: String((a as any).msg) }] }),
        }];
      },
    };
    expectTypeOf(conn.id).toEqualTypeOf<string>();
    expectTypeOf(conn.tools().length).toEqualTypeOf<number>();
  });
});
