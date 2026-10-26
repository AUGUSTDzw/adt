import { describe, it, expect, vi } from 'vitest';
import { createAdtConnector } from '../../../src/connectors/adt/index.js';

describe('ADT connector', () => {
  it('registers 152 tools (33 hand-crafted + 119 auto-generated)', async () => {
    const conn = createAdtConnector();
    await conn.init({ baseUrl: 'https://s4.example.com', authMode: 'basic', user: 'U', pass: 'P' });
    const names = conn.tools().map(t => t.name).sort();
    expect(names).toHaveLength(152);
    // hand-crafted tools
    expect(names).toContain('read_source');
    expect(names).toContain('run_atc');
    expect(names).toContain('where_used');
    expect(names).toContain('list_dumps');
    expect(names).toContain('git_repos');
    // auto-generated tools (from ADTClient prototype methods)
    expect(names).toContain('debugger_step');
    expect(names).toContain('debugger_set_breakpoints');
    expect(names).toContain('traces_list');
    expect(names).toContain('git_create_repo');
    expect(names).toContain('rename_execute');
    expect(names).toContain('rap_gen_generate');
    expect(names).toContain('class_components');
    expect(names).toContain('object_structure_elements');
    // raw_call removed — each method now has its own tool
    expect(names).not.toContain('raw_call');
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

  it('auto-generated tool delegates to AdtClient.callRaw (mockable)', async () => {
    const conn = createAdtConnector();
    await conn.init({ baseUrl: 'https://s4.example.com', authMode: 'basic', user: 'U', pass: 'P' });
    const spy = vi.spyOn(conn.client!, 'callRaw').mockResolvedValue({ ok: true });
    const t = conn.tools().find(t => t.name === 'debugger_step')!;
    const res = await t.handler({ args: ['stepOver'] });
    expect(res.content.length).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalledWith('debuggerStep', ['stepOver']);
    spy.mockRestore();
  });
});
