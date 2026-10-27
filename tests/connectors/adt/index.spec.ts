import { describe, it, expect, vi } from 'vitest';
import { createAdtConnector } from '../../../src/connectors/adt/index.js';

describe('ADT connector', () => {
  it('registers 168 tools (52 hand-crafted + 116 auto-generated)', async () => {
    const conn = createAdtConnector();
    await conn.init({ baseUrl: 'https://s4.example.com', authMode: 'basic', user: 'U', pass: 'P' });
    const names = conn.tools().map(t => t.name).sort();
    expect(names).toHaveLength(168);
    // original hand-crafted tools
    expect(names).toContain('read_source');
    expect(names).toContain('run_atc');
    expect(names).toContain('where_used');
    expect(names).toContain('list_dumps');
    expect(names).toContain('git_repos');
    // new hand-crafted tools (custom HTTP + composite)
    expect(names).toContain('dump_details');
    expect(names).toContain('system_info');
    expect(names).toContain('source_search');
    expect(names).toContain('list_locks');
    expect(names).toContain('get_note');
    expect(names).toContain('check_note_status');
    expect(names).toContain('implement_note');
    expect(names).toContain('schedule_job');
    expect(names).toContain('read_spool');
    expect(names).toContain('cds_dependencies');
    expect(names).toContain('list_versions');
    expect(names).toContain('compare_versions');
    expect(names).toContain('package_tree');
    expect(names).toContain('object_diff');
    expect(names).toContain('resolve_transport');
    expect(names).toContain('force_unlock');
    // newest additions: grep_source, run_atc_package, value_help
    expect(names).toContain('grep_source');
    expect(names).toContain('run_atc_package');
    expect(names).toContain('value_help');
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

  it('dump_details uses rawGet (custom HTTP endpoint)', async () => {
    const conn = createAdtConnector();
    await conn.init({ baseUrl: 'https://s4.example.com', authMode: 'basic', user: 'U', pass: 'P' });
    const spy = vi.spyOn(conn.client!, 'rawGet').mockResolvedValue('<dump>short dump trace</dump>');
    const t = conn.tools().find(t => t.name === 'dump_details')!;
    const res = await t.handler({ dumpId: 'XYZ' });
    expect(res.content.length).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalledWith('/sap/bc/adt/runtime/dump/XYZ', expect.anything());
    spy.mockRestore();
  });

  it('system_info uses rawGet (custom HTTP endpoint)', async () => {
    const conn = createAdtConnector();
    await conn.init({ baseUrl: 'https://s4.example.com', authMode: 'basic', user: 'U', pass: 'P' });
    const spy = vi.spyOn(conn.client!, 'rawGet').mockResolvedValue('<system>S/4HANA</system>');
    const t = conn.tools().find(t => t.name === 'system_info')!;
    const res = await t.handler({ refresh: true });
    expect(res.content.length).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalledWith('/sap/bc/adt/system/information', expect.anything());
    spy.mockRestore();
  });
});
