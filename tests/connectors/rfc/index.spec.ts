import { describe, it, expect } from 'vitest';
import { createRfcConnector } from '../../../src/connectors/rfc/index.js';

describe('RFC connector', () => {
  it('lists the eight RFC tool names', () => {
    const conn = createRfcConnector();
    expect(conn.tools().map((t) => t.name).sort()).toEqual(
      [
        'call_function',
        'get_function_metadata',
        'get_table_structure',
        'read_table',
        'read_table_complete',
        'rfc_system_info',
        'search_functions',
        'test_table_access',
      ].sort(),
    );
  });

  it('init throws a clear error when node-rfc native module is missing', async () => {
    const conn = createRfcConnector();
    // On a machine without SAP NWRFC SDK, import('node-rfc') rejects.
    // We assert init rejects with a message containing "NWRFC" or "node-rfc", not a crash.
    await expect(
      conn.init({ ashost: 'x', sysnr: '00', client: '100', user: 'U', passwd: 'P' }),
    ).rejects.toThrow(/NWRFC|node-rfc/);
  });
});
