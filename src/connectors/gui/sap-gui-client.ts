/**
 * SAP GUI scripting client — attach to running SAP GUI sessions via COM.
 *
 * This is the免密 SSO entry point: `connectExisting` reuses an already-logged-on
 * session without any credentials. COM calls go through the bridge backend
 * (winax fast path, PowerShell slow path) and are serialized by the bridge.
 */

import { createRequire } from 'node:module';
import {
  type ComApi, type ComHandle, enumCollection, prop, invoke, setProp,
} from './com-bridge.js';
import { GuiDiscovery, guiNotAvailableMessage } from './discovery.js';

const require = createRequire(import.meta.url);

/** Virtual key codes accepted by sap_send_key. */
export const VKEYS = {
  ENTER: 0,
  F1: 1, F2: 2, F3: 3, F4: 4, F5: 5, F6: 6, F7: 7, F8: 8, F9: 9, F10: 10, F11: 11, F12: 12,
  SHIFT_F1: 13, SHIFT_F2: 14, SHIFT_F3: 15, SHIFT_F4: 16, SHIFT_F5: 17, SHIFT_F6: 18,
  SHIFT_F7: 19, SHIFT_F8: 20, SHIFT_F9: 21,
  CTRL_F: 71, CTRL_G: 84, CTRL_P: 86,
} as const;

export type VKeyName =
  | 'Enter' | 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7' | 'F8' | 'F9' | 'F10'
  | 'F11' | 'F12' | 'Shift+F1' | 'Shift+F2' | 'Shift+F3' | 'Shift+F4' | 'Shift+F5'
  | 'Shift+F6' | 'Shift+F7' | 'Shift+F8' | 'Shift+F9' | 'Ctrl+F' | 'Ctrl+G' | 'Ctrl+P';

const VKEY_BY_NAME: Record<VKeyName, number> = {
  Enter: VKEYS.ENTER, F1: VKEYS.F1, F2: VKEYS.F2, F3: VKEYS.F3, F4: VKEYS.F4,
  F5: VKEYS.F5, F6: VKEYS.F6, F7: VKEYS.F7, F8: VKEYS.F8, F9: VKEYS.F9,
  F10: VKEYS.F10, F11: VKEYS.F11, F12: VKEYS.F12,
  'Shift+F1': VKEYS.SHIFT_F1, 'Shift+F2': VKEYS.SHIFT_F2, 'Shift+F3': VKEYS.SHIFT_F3,
  'Shift+F4': VKEYS.SHIFT_F4, 'Shift+F5': VKEYS.SHIFT_F5, 'Shift+F6': VKEYS.SHIFT_F6,
  'Shift+F7': VKEYS.SHIFT_F7, 'Shift+F8': VKEYS.SHIFT_F8, 'Shift+F9': VKEYS.SHIFT_F9,
  'Ctrl+F': VKEYS.CTRL_F, 'Ctrl+G': VKEYS.CTRL_G, 'Ctrl+P': VKEYS.CTRL_P,
};

export function parseVKey(name: string): number | null {
  const key = name.trim();
  return VKEY_BY_NAME[key as VKeyName] ?? null;
}

export function vKeyName(code: number): string {
  if (code === 0) return 'Enter';
  if (code >= 1 && code <= 12) return `F${code}`;
  if (code >= 13 && code <= 21) return `Shift+F${code - 12}`;
  return { [VKEYS.CTRL_F]: 'Ctrl+F', [VKEYS.CTRL_G]: 'Ctrl+G', [VKEYS.CTRL_P]: 'Ctrl+P' }[code] ?? String(code);
}

export interface SessionInfo {
  system_name: string;
  system_number: string;
  client: string;
  user: string;
  language: string;
  transaction: string;
  program: string;
  screen_number: string;
  session_number: string;
  sap_gui_version: string;
  scripting_read_only: boolean;
}

export interface ConnectionInfo {
  index: number;
  description: string;
  session_count: number;
  sessions: SessionEntry[];
  host: string;
  rot_entry: string;
  scripting_disabled: boolean;
}

export interface SessionEntry {
  index: number;
  id: string;
  user: string;
  transaction: string;
  system: string;
  client: string;
  title: string;
}

export interface ScreenInfo {
  active_window: string;
  transaction: string;
  program: string;
  screen_number: string;
  title: string;
  message: string | null;
  message_type: string;
  message_id: string;
  message_number: string;
}

export interface ElementInfo {
  id: string;
  type: string;
  name: string;
  text: string;
  changeable: boolean;
  selected?: boolean;
}

const WINDOW_ID_RE = /^wnd\[(\d+)\]$/;
const ELEMENT_ID_RE =
  /^wnd\[(\d+)\](?:\/(?:usr|mbar|sbar|titl|tbar\[\d+\]|shellcont(?:\[\d+\])?)(?:\/[^\s/[\]]+(?:\[[A-Za-z0-9_,]+\])*)*)$/;
// Disconnected / server-unavailable HRESULTs mean a dead session binding.
const DEAD_HRESULTS = new Set([-2147417848, -2147023174]);

export class SapGuiClient {
  private session: ComHandle | null = null;
  private connection: ComHandle | null = null;
  private engine: ComHandle | null = null;
  private ownsSession = false;
  private sapGuiVersion = '';
  private scriptingReadOnly = false;
  private identity: Record<string, string> = {};
  readonly discovery: GuiDiscovery;

  constructor(private com: ComApi, discovery?: GuiDiscovery) {
    this.discovery = discovery ?? new GuiDiscovery(com);
  }

  get isConnected(): boolean {
    return this.session !== null;
  }

  get boundSession(): ComHandle | null {
    return this.session;
  }

  // ------------------------------------------------------------------
  // Connection management
  // ------------------------------------------------------------------

  async listConnections(): Promise<ConnectionInfo[]> {
    const found = await this.discovery.discoverConnections();
    const out: ConnectionInfo[] = [];
    for (let index = 0; index < found.length; index++) {
      const { host, rotName, engine, connection } = found[index];
      const description = String((await prop(connection, 'Description', '')) ?? '');
      const scriptingDisabled = Boolean(await prop(connection, 'DisabledByServer', false));
      const children = await prop<ComHandle | null>(connection, 'Children', null);
      const sessionCount = Number(await prop(children, 'Count', 0));
      const sessions: SessionEntry[] = [];
      for (let i = 0; i < sessionCount; i++) {
        try {
          const sess = await invoke<ComHandle>(children!, 'Item', i);
          const info = (await prop<ComHandle | null>(sess, 'Info', null)) ?? null;
          sessions.push({
            index: i,
            id: String((await prop(sess, 'Id', '')) ?? ''),
            user: String((await prop(info, 'User', '')) ?? ''),
            transaction: String((await prop(info, 'Transaction', '')) ?? ''),
            system: String((await prop(info, 'SystemName', '')) ?? ''),
            client: String((await prop(info, 'Client', '')) ?? ''),
            title: await this.readTitle(sess),
          });
        } catch {
          // One dead session must not hide its siblings.
        }
      }
      void engine;
      out.push({
        index,
        description,
        session_count: sessionCount,
        sessions,
        host,
        rot_entry: rotName,
        scripting_disabled: scriptingDisabled,
      });
    }
    return out;
  }

  async connectExisting(connectionIndex = 0, sessionIndex = 0): Promise<SessionInfo> {
    const found = await this.discovery.discoverConnections();
    if (found.length === 0) {
      throw new Error(guiNotAvailableMessage() + '.');
    }
    const pick = found[connectionIndex];
    if (!pick) {
      throw new Error(
        `Connection index ${connectionIndex} out of range. Found ${found.length} connection(s). ` +
        'List them with sap.gui.list_connections.',
      );
    }
    if (Boolean(await prop(pick.connection, 'DisabledByServer', false))) {
      throw new Error(
        'SAP GUI Scripting is disabled on this server (profile parameter ' +
        'sapgui/user_scripting); no session can be attached.',
      );
    }
    const children = await prop<ComHandle | null>(pick.connection, 'Children', null);
    const sessionCount = Number(await prop(children, 'Count', 0));
    if (sessionCount === 0) {
      throw new Error('This connection has no open sessions.');
    }
    const session = await invoke<ComHandle>(children!, 'Item', sessionIndex);
    this.session = session;
    this.connection = pick.connection;
    this.engine = pick.engine;
    this.ownsSession = false;
    await this.readSessionTraits();
    return this.getSessionInfo();
  }

  async connect(
    systemDescription: string,
    opts: { client?: string; user?: string; password?: string; language?: string } = {},
  ): Promise<SessionInfo> {
    const engine = await this.discovery.getSapLogonEngine();
    if (!engine) {
      throw new Error(guiNotAvailableMessage() + '.');
    }
    this.engine = engine;
    this.connection = await invoke<ComHandle>(engine, 'OpenConnection', systemDescription, true);
    this.ownsSession = true;
    const children = await prop<ComHandle | null>(this.connection, 'Children', null);
    this.session = children ? await invoke<ComHandle>(children, 'Item', 0) : null;
    if (!this.session) throw new Error(`Failed to open connection to '${systemDescription}'.`);

    const hasPassword = opts.password != null;
    if (opts.client) await this.safeSetField('wnd[0]/usr/txtRSYST-MANDT', opts.client);
    if (opts.user) await this.safeSetField('wnd[0]/usr/txtRSYST-BNAME', opts.user);
    if (opts.password) await this.safeSetField('wnd[0]/usr/pwdRSYST-BCODE', opts.password);
    if (opts.language) await this.safeSetField('wnd[0]/usr/txtRSYST-LANGU', opts.language);
    if (hasPassword) await this.sendVKey(VKEYS.ENTER);

    await this.readSessionTraits();
    return this.getSessionInfo();
  }

  async disconnect(): Promise<void> {
    if (this.session && this.ownsSession && this.connection) {
      try {
        await invoke(this.connection, 'CloseSession', await prop(this.session, 'Id', ''));
      } catch {
        // Session may already be closed.
      }
    }
    this.session = null;
    this.connection = null;
    this.engine = null;
    this.ownsSession = false;
    this.sapGuiVersion = '';
    this.scriptingReadOnly = false;
    this.identity = {};
  }

  // ------------------------------------------------------------------
  // Session / screen info
  // ------------------------------------------------------------------

  private async readSessionTraits(): Promise<void> {
    try {
      const major = Number(await prop(this.engine, 'MajorVersion', 0));
      const patch = Number(await prop(this.engine, 'Patchlevel', 0));
      const release = major >= 1000
        ? `${Math.floor(major / 1000)}.${String(Math.floor((major % 1000) / 10)).padStart(2, '0')}`
        : String(major);
      this.sapGuiVersion = `${release} PL${patch}`;
    } catch {
      this.sapGuiVersion = '';
    }
    try {
      const info = await this.sessionInfo();
      this.scriptingReadOnly = Boolean(await prop(info, 'ScriptingModeReadOnly', false));
    } catch {
      this.scriptingReadOnly = false;
    }
    await this.refreshIdentity();
  }

  private async refreshIdentity(): Promise<void> {
    try {
      const info = await this.sessionInfo();
      this.identity = {
        system: String((await prop(info, 'SystemName', '')) ?? ''),
        client: String((await prop(info, 'Client', '')) ?? ''),
        user: String((await prop(info, 'User', '')) ?? ''),
      };
      for (const key of Object.keys(this.identity)) {
        if (!this.identity[key]) delete this.identity[key];
      }
    } catch {
      this.identity = {};
    }
  }

  private async sessionInfo(): Promise<ComHandle | null> {
    const session = this.requireSession();
    return (await prop<ComHandle | null>(session, 'Info', null)) ?? null;
  }

  async getSessionInfo(): Promise<SessionInfo> {
    this.requireSession();
    const info = await this.sessionInfo();
    await this.refreshIdentity();
    return {
      system_name: String((await prop(info, 'SystemName', '')) ?? ''),
      system_number: String((await prop(info, 'SystemNumber', '')) ?? ''),
      client: String((await prop(info, 'Client', '')) ?? ''),
      user: String((await prop(info, 'User', '')) ?? ''),
      language: String((await prop(info, 'Language', '')) ?? ''),
      transaction: String((await prop(info, 'Transaction', '')) ?? ''),
      program: String((await prop(info, 'Program', '')) ?? ''),
      screen_number: String((await prop(info, 'ScreenNumber', '')) ?? ''),
      session_number: String((await prop(info, 'SessionNumber', '')) ?? ''),
      sap_gui_version: this.sapGuiVersion,
      scripting_read_only: this.scriptingReadOnly,
    };
  }

  async getScreenInfo(): Promise<ScreenInfo> {
    this.requireSession();
    const info = await this.sessionInfo();
    let activeWindowId = 'wnd[0]';
    try {
      const active = await prop<ComHandle | null>(this.session, 'ActiveWindow', null);
      if (active) activeWindowId = this.normalizeWindowId(String((await prop(active, 'Id', 'wnd[0]')) ?? 'wnd[0]'));
    } catch {
      // Fall back to wnd[0].
    }
    const title = await this.readTitle(await this.findWindow(activeWindowId));
    const status = await this.getStatusBarInfo(activeWindowId);
    return {
      active_window: activeWindowId,
      transaction: String((await prop(info, 'Transaction', '')) ?? ''),
      program: String((await prop(info, 'Program', '')) ?? ''),
      screen_number: String((await prop(info, 'ScreenNumber', '')) ?? ''),
      title,
      message: status.text,
      message_type: status.message_type,
      message_id: status.message_id,
      message_number: status.message_number,
    };
  }

  private async readTitle(window: ComHandle | null): Promise<string> {
    if (!window) return '';
    try {
      return String((await prop(window, 'Text', '')) ?? '');
    } catch {
      return '';
    }
  }

  private async getStatusBarInfo(windowId: string): Promise<{ text: string | null; message_type: string; message_id: string; message_number: string }> {
    let sbar: ComHandle | null = null;
    for (const wnd of [...new Set([windowId, 'wnd[0]'])]) {
      try {
        sbar = await this.findById(`${wnd}/sbar`);
        break;
      } catch {
        continue;
      }
    }
    if (!sbar) return { text: null, message_type: '', message_id: '', message_number: '' };
    const text = String((await prop(sbar, 'Text', '')) ?? '');
    const strip = (v: unknown) => (typeof v === 'string' ? v.trim() : String(v ?? ''));
    return {
      text,
      message_type: strip(await prop(sbar, 'MessageType', '')),
      message_id: strip(await prop(sbar, 'MessageId', '')),
      message_number: strip(await prop(sbar, 'MessageNumber', '')),
    };
  }

  // ------------------------------------------------------------------
  // Element operations
  // ------------------------------------------------------------------

  async findElement(id: string): Promise<ElementInfo> {
    this.requireSession();
    const normalized = this.validateElementId(id);
    const el = await this.findById(normalized);
    return this.elementInfo(normalized, el);
  }

  async getText(id: string): Promise<string> {
    this.requireSession();
    const normalized = this.validateElementId(id);
    return String((await prop(await this.findById(normalized), 'Text', '')) ?? '');
  }

  async setText(id: string, value: string): Promise<ElementInfo> {
    this.requireSession();
    const normalized = this.validateElementId(id);
    const el = await this.findById(normalized);
    await setProp(el, 'Text', value);
    return this.elementInfo(normalized, await this.findById(normalized));
  }

  async sendVKey(vkey: number, windowId = 'wnd[0]'): Promise<ScreenInfo> {
    this.requireSession();
    const normalized = this.validateWindowId(windowId);
    const window = await this.findWindow(normalized);
    await invoke(window, 'sendVKey', vkey);
    return this.getScreenInfo();
  }

  async executeTransaction(tcode: string): Promise<ScreenInfo> {
    this.requireSession();
    const code = tcode.trim();
    const plain = code.replace(/^\/[nN]/, '');
    if (code === '/n' || code === '/N' || code === '/o' || code === '/O' || code.startsWith('/*')) {
      await this.setCommandField(code);
    } else {
      try {
        await invoke(this.session!, 'StartTransaction', plain);
      } catch {
        await this.setCommandField(`/n${plain}`);
      }
    }
    return this.getScreenInfo();
  }

  private async setCommandField(code: string): Promise<void> {
    const okcd = await this.findById('wnd[0]/tbar[0]/okcd');
    await setProp(okcd, 'Text', code);
    await invoke(await this.findWindow('wnd[0]'), 'sendVKey', VKEYS.ENTER);
  }

  async listElements(
    containerId = 'wnd[0]/usr', maxDepth = 3, typeFilter = '', changeableOnly = false,
  ): Promise<ElementInfo[]> {
    this.requireSession();
    const root = this.validateContainerId(containerId);
    const filter = new Set(typeFilter.split(',').map((s) => s.trim()).filter(Boolean));
    const out: ElementInfo[] = [];
    await this.walkElements(root, maxDepth, 0, filter, changeableOnly, out);
    return out;
  }

  private async walkElements(
    id: string, maxDepth: number, depth: number, filter: Set<string>, changeableOnly: boolean, out: ElementInfo[],
  ): Promise<void> {
    if (depth >= maxDepth) return;
    let container: ComHandle;
    try {
      container = await this.findById(id);
    } catch {
      return;
    }
    const children = await enumCollection<ComHandle>(await prop(container, 'Children', null));
    for (const child of children) {
      if (!child) continue;
      const childId = String((await prop(child, 'Id', '')) ?? '');
      if (!childId) continue;
      const type = String((await prop(child, 'Type', '')) ?? '');
      const changeable = Boolean(await prop(child, 'Changeable', false));
      const matchesFilter = filter.size === 0 || filter.has(type);
      const wanted = matchesFilter && (!changeableOnly || changeable);
      if (wanted) {
        const el: ElementInfo = {
          id: this.normalizeElementId(childId),
          type,
          name: String((await prop(child, 'Name', '')) ?? ''),
          text: String((await prop(child, 'Text', '')) ?? '').slice(0, 200),
          changeable,
        };
        if (type === 'GuiRadioButton' || type === 'GuiCheckBox') {
          el.selected = Boolean(await prop(child, 'Selected', false));
        }
        out.push(el);
      }
      if (type !== 'GuiTableControl') {
        const grandchildren = await prop<ComHandle | null>(child, 'Children', null);
        if (grandchildren) {
          await this.walkElements(childId, maxDepth, depth + 1, filter, changeableOnly, out);
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // Screenshot
  // ------------------------------------------------------------------

  async takeScreenshot(
    filepath?: string,
  ): Promise<{ format: string; window: string; filepath?: string; data?: string; width?: number; height?: number }> {
    this.requireSession();
    const windowId = await this.findTopmostWindow();
    const window = await this.findWindow(windowId);
    const fs = require('node:fs') as typeof import('node:fs');
    if (!filepath) {
      const tmp = `${process.env.TEMP ?? '/tmp'}\\sap_screenshot_${Date.now()}.png`;
      try {
        await invoke(window, 'HardCopy', tmp, 2);
        if (!fs.existsSync(tmp)) throw new Error('SAP GUI did not write the screenshot file.');
        const data = fs.readFileSync(tmp).toString('base64');
        return { format: 'png', window: windowId, data };
      } finally {
        try { fs.unlinkSync(tmp); } catch { /* keep the temp file */ }
      }
    }
    await invoke(window, 'HardCopy', filepath, 2);
    const size = pngSize(fs.readFileSync(filepath));
    const result: { format: string; window: string; filepath: string; width?: number; height?: number } = {
      format: 'png', window: windowId, filepath,
    };
    if (size) { result.width = size.width; result.height = size.height; }
    return result;
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private requireSession(): ComHandle {
    if (!this.session) throw new Error('Not connected to SAP. Call sap.gui.connect_existing or sap.gui.connect first.');
    return this.session;
  }

  private async findById(id: string): Promise<ComHandle> {
    return invoke<ComHandle>(this.session!, 'findById', id);
  }

  private async findWindow(windowId: string): Promise<ComHandle> {
    return this.findById(this.validateWindowId(windowId));
  }

  private async findTopmostWindow(): Promise<string> {
    try {
      const active = await prop<ComHandle | null>(this.session, 'ActiveWindow', null);
      if (active) return this.normalizeWindowId(String((await prop(active, 'Id', 'wnd[0]')) ?? 'wnd[0]'));
    } catch {
      // fall through
    }
    let top = 'wnd[0]';
    for (let i = 1; i < 10; i++) {
      try {
        await this.findById(`wnd[${i}]`);
        top = `wnd[${i}]`;
      } catch {
        break;
      }
    }
    return top;
  }

  private async safeSetField(fieldId: string, value: string): Promise<void> {
    try {
      const el = await this.findById(fieldId);
      await setProp(el, 'Text', value);
    } catch {
      // Field may not exist on this logon screen.
    }
  }

  private async elementInfo(id: string, el: ComHandle): Promise<ElementInfo> {
    const type = String((await prop(el, 'Type', '')) ?? '');
    const info: ElementInfo = {
      id,
      type,
      name: String((await prop(el, 'Name', '')) ?? ''),
      text: String((await prop(el, 'Text', '')) ?? ''),
      changeable: Boolean(await prop(el, 'Changeable', false)),
    };
    if (type === 'GuiRadioButton' || type === 'GuiCheckBox') {
      info.selected = Boolean(await prop(el, 'Selected', false));
    }
    return info;
  }

  normalizeWindowId(id: string): string {
    const match = id.match(/(wnd\[\d+\].*)$/);
    return match ? match[1] : id;
  }

  normalizeElementId(id: string): string {
    const match = id.match(/(wnd\[\d+\].*)$/);
    return match ? match[1] : id;
  }

  validateWindowId(id: string): string {
    const normalized = this.normalizeWindowId(id);
    if (!WINDOW_ID_RE.test(normalized)) {
      throw new Error(`Invalid SAP window ID: ${JSON.stringify(id)}. Expected 'wnd[0]'.`);
    }
    return normalized;
  }

  validateElementId(id: string): string {
    const normalized = this.normalizeElementId(id);
    if (!ELEMENT_ID_RE.test(normalized)) {
      throw new Error(
        `Invalid SAP element ID: ${JSON.stringify(id)}. Expected 'wnd[0]/usr/...', 'wnd[0]/mbar/...', 'wnd[0]/sbar', or 'wnd[0]/tbar[0]/...'.`,
      );
    }
    return normalized;
  }

  private validateContainerId(id: string): string {
    const normalized = this.normalizeElementId(id);
    if (WINDOW_ID_RE.test(normalized)) return normalized;
    return this.validateElementId(id);
  }
}

/** Read (width, height) from a PNG header without an image library. */
function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
