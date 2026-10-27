import { describe, it, expect, afterEach, vi } from 'vitest';
import { createGuiConnector } from '../../../src/connectors/gui/index.js';
import { buildGuiTree, mockCom } from './fakes.js';

describe('createGuiConnector', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers tools under the gui namespace', async () => {
    const conn = createGuiConnector();
    const com = mockCom({ SAPGUI: buildGuiTree().engine });
    vi.spyOn(await import('../../../src/connectors/gui/com-bridge.js'), 'isComAvailable').mockReturnValue(true);
    vi.spyOn(await import('../../../src/connectors/gui/com-bridge.js'), 'getCom').mockReturnValue(com);
    await conn.init({});
    const tools = conn.tools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([
      'list_connections', 'connect_existing', 'connect', 'disconnect', 'get_session_info',
      'get_screen_info', 'find_element', 'get_text', 'list_elements', 'get_popup', 'take_screenshot',
      'set_text', 'send_key', 'execute_transaction', 'handle_popup', 'press_button',
    ]));
    // Write tools are explicitly marked so they bypass the cache and hit audit.
    const writeNames = tools.filter((t) => t.write).map((t) => t.name);
    expect(writeNames).toEqual(expect.arrayContaining([
      'set_text', 'send_key', 'execute_transaction', 'handle_popup', 'press_button',
    ]));
    expect(writeNames).not.toContain('list_connections');
    expect(writeNames).not.toContain('get_screen_info');
  });

  it('degrades gracefully when COM is unavailable', async () => {
    const conn = createGuiConnector();
    vi.spyOn(await import('../../../src/connectors/gui/com-bridge.js'), 'isComAvailable').mockReturnValue(false);
    vi.spyOn(await import('../../../src/connectors/gui/com-bridge.js'), 'comUnavailableReason').mockReturnValue('winax is not installed');
    await conn.init({});
    const tools = conn.tools();
    const res = await tools.find((t) => t.name === 'list_connections')!.handler({});
    expect(res.isError).toBe(true);
    const json = (res.content[0] as { json: { error: string } }).json;
    expect(json.error).toMatch(/unavailable.*winax/);
  });

  it('reports a connection error for connect_existing when nothing is open', async () => {
    const conn = createGuiConnector();
    // No engines in the ROT.
    const com = mockCom({});
    vi.spyOn(await import('../../../src/connectors/gui/com-bridge.js'), 'isComAvailable').mockReturnValue(true);
    vi.spyOn(await import('../../../src/connectors/gui/com-bridge.js'), 'getCom').mockReturnValue(com);
    await conn.init({});
    const tools = conn.tools();
    const res = await tools.find((t) => t.name === 'connect_existing')!.handler({ connection_index: 0, session_index: 0 });
    expect(res.isError).toBe(true);
    const json = (res.content[0] as { json: { error: string } }).json;
    expect(json.error).toMatch(/SAP GUI/i);
  });
});
