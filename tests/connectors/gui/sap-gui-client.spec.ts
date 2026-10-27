import { describe, it, expect, beforeEach } from 'vitest';
import { SapGuiClient } from '../../../src/connectors/gui/sap-gui-client.js';
import { GuiDiscovery } from '../../../src/connectors/gui/discovery.js';
import { buildGuiTree, mockCom, type GuiTree } from './fakes.js';

describe('SapGuiClient', () => {
  let tree: GuiTree;
  let client: SapGuiClient;

  beforeEach(() => {
    tree = buildGuiTree();
    client = new SapGuiClient(mockCom({ SAPGUI: tree.engine }));
  });

  it('lists connections from the SAP Logon engine', async () => {
    const conns = await client.listConnections();
    expect(conns).toHaveLength(1);
    expect(conns[0].description).toBe('DEV');
    expect(conns[0].host).toBe('saplogon');
    expect(conns[0].sessions[0].system).toBe('DEV');
    expect(conns[0].sessions[0].user).toBe('TESTUSER');
  });

  it('connects to an existing session without credentials (免密 SSO)', async () => {
    const info = await client.connectExisting();
    expect(client.isConnected).toBe(true);
    expect(info.system_name).toBe('DEV');
    expect(info.user).toBe('TESTUSER');
    expect(info.sap_gui_version).toContain('8.10');
  });

  it('reports an out-of-range connection index', async () => {
    await expect(client.connectExisting(5)).rejects.toThrow(/out of range/i);
  });

  it('throws when not connected and a session is required', async () => {
    await expect(client.getSessionInfo()).rejects.toThrow(/Not connected/i);
  });

  it('reads session info', async () => {
    await client.connectExisting();
    const info = await client.getSessionInfo();
    expect(info.system_name).toBe('DEV');
    expect(info.transaction).toBe('SE16');
    expect(info.scripting_read_only).toBe(false);
  });

  it('reads screen info with the status bar', async () => {
    await client.connectExisting();
    (tree.elements.sbar as { Text: string }).Text = 'Message saved';
    (tree.elements.sbar as { MessageType: string }).MessageType = 'S';
    const screen = await client.getScreenInfo();
    expect(screen.title).toBe('Data Browser');
    expect(screen.message).toBe('Message saved');
    expect(screen.message_type).toBe('S');
  });

  it('finds an element and reads its text', async () => {
    await client.connectExisting();
    const el = await client.findElement('wnd[0]/usr/txtFIELD');
    expect(el.type).toBe('GuiCTextField');
    expect(el.changeable).toBe(true);
    await client.setText('wnd[0]/usr/txtFIELD', 'hello');
    expect(await client.getText('wnd[0]/usr/txtFIELD')).toBe('hello');
  });

  it('rejects an invalid element ID', async () => {
    await client.connectExisting();
    await expect(client.findElement('bogus')).rejects.toThrow(/Invalid SAP element ID/i);
  });

  it('sends a virtual key', async () => {
    await client.connectExisting();
    const screen = await client.sendVKey(0);
    expect((tree.window as { __lastVKey?: number }).__lastVKey).toBe(0);
    expect(screen.transaction).toBe('SE16');
  });

  it('executes a transaction via StartTransaction', async () => {
    await client.connectExisting();
    await client.executeTransaction('VA01');
    expect((tree.session as { __started?: string }).__started).toBe('VA01');
  });

  it('enumerates screen elements', async () => {
    await client.connectExisting();
    const els = await client.listElements('wnd[0]/usr', 2);
    const ids = els.map((e) => e.id);
    expect(ids).toContain('wnd[0]/usr/txtFIELD');
    expect(ids).toContain('wnd[0]/usr/btnGO');
  });

  it('takes a screenshot to a file', async () => {
    await client.connectExisting();
    const { join } = require('node:path');
    const { tmpdir } = require('node:os');
    const { writeFileSync } = require('node:fs');
    const p = join(tmpdir(), `sap_test_${Date.now()}.png`);
    // Minimal valid PNG header so pngSize() reads dimensions.
    const buf = Buffer.alloc(24);
    buf.writeUInt32BE(0x89504e47, 0);
    buf.writeUInt32BE(800, 16);
    buf.writeUInt32BE(600, 20);
    writeFileSync(p, buf);
    try {
      const result = await client.takeScreenshot(p);
      expect(result.filepath).toBe(p);
      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
      expect((tree.window as { __hardcopy?: string }).__hardcopy).toBe(p);
    } finally {
      try { require('node:fs').unlinkSync(p); } catch { /* cleanup */ }
    }
  });

  it('discovers SAPGUISERVER-<pid> engines', async () => {
    const serverEngine = buildGuiTree();
    const com = mockCom({
      SAPGUI: tree.engine,
      'SAPGUISERVER-1A2B': serverEngine.engine,
    });
    const c = new SapGuiClient(com, new GuiDiscovery(com, () => [0x1a2b]));
    const conns = await c.listConnections();
    expect(conns.length).toBe(2);
    expect(conns[1].rot_entry).toBe('SAPGUISERVER-1A2B');
  });
});
