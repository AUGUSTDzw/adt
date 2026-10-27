import type { ComApi, ComHandle, ComObjectOptions } from '../../../src/connectors/gui/com-bridge.js';

/** A fake COM dispatch object: plain properties + methods. */
export type FakeCom = Record<string, unknown> & { __isCom?: boolean };

/** Build a fake COM object (marked so the handle wrapper recognizes children). */
export function fakeObj(initial: Record<string, unknown> = {}): FakeCom {
  return { __isCom: true, ...initial };
}

/** A fake collection { Count, Item(i) }. */
export function fakeCollection(items: unknown[]): FakeCom {
  return fakeObj({
    Count: items.length,
    Item: (i: number) => items[i],
  });
}

/** Wrap a fake value: COM children become handles, primitives pass through. */
function wrapFake(value: unknown): unknown {
  if (value && typeof value === 'object' && (value as FakeCom).__isCom) {
    return new FakeHandle(value as FakeCom);
  }
  return value;
}

export class FakeHandle implements ComHandle {
  constructor(readonly raw: FakeCom) {}

  async getProp(name: string): Promise<unknown> {
    return wrapFake(this.raw[name]);
  }

  async setProp(name: string, value: unknown): Promise<void> {
    this.raw[name] = value;
  }

  async call(method: string, ...args: unknown[]): Promise<unknown> {
    const fn = this.raw[method];
    if (typeof fn !== 'function') throw new Error(`COM method '${method}' not available`);
    return wrapFake((fn as (...a: unknown[]) => unknown).apply(this.raw, args));
  }
}

export interface GuiTree {
  engine: FakeCom;
  connection: FakeCom;
  session: FakeCom;
  window: FakeCom;
  byId: Map<string, FakeCom>;
  elements: Record<string, FakeCom>;
}

/** Build an SAP GUI object tree: Engine → Connection → Session → Window. */
export function buildGuiTree(): GuiTree {
  const byId = new Map<string, FakeCom>();
  const register = (obj: FakeCom) => {
    const id = obj.Id as string;
    if (id) byId.set(id, obj);
    return obj;
  };

  const usr = register(fakeObj({
    Id: 'wnd[0]/usr', Type: 'GuiUserArea', Text: '', Changeable: false,
    Children: fakeCollection([]),
  }));
  const sbar = register(fakeObj({
    Id: 'wnd[0]/sbar', Type: 'GuiStatusbar', Text: '', Changeable: false,
    MessageType: '', MessageId: '', MessageNumber: '',
  }));
  const tbar0 = register(fakeObj({
    Id: 'wnd[0]/tbar[0]', Type: 'GuiToolbar', Text: '', Changeable: false,
    Children: fakeCollection([
      register(fakeObj({ Id: 'wnd[0]/tbar[0]/okcd', Type: 'GuiCTextField', Name: 'okcd', Text: '', Changeable: true })),
    ]),
  }));

  const window = register(fakeObj({
    Id: 'wnd[0]', Type: 'GuiFrameWindow', Text: 'Data Browser', Changeable: false,
    Children: fakeCollection([usr, sbar, tbar0]),
    sendVKey: (v: number) => { window.__lastVKey = v; },
    HardCopy: (path: string) => { window.__hardcopy = path; },
    IsVKeyAllowed: () => true,
  }));

  const info = fakeObj({
    SystemName: 'DEV', SystemNumber: '00', Client: '100', User: 'TESTUSER',
    Language: 'EN', Transaction: 'SE16', Program: 'SAPLSE16', ScreenNumber: '1000',
    SessionNumber: '1', ScriptingModeReadOnly: false,
  });

  const session = register(fakeObj({
    Id: 'session0', Type: 'GuiSession', Busy: false,
    Info: info,
    ActiveWindow: window,
    findById: (id: string) => {
      const el = byId.get(id);
      if (!el) throw new Error(`element not found: ${id}`);
      return el;
    },
    StartTransaction: (tcode: string) => { session.__started = tcode; },
  }));

  const connection = register(fakeObj({
    Id: 'conn0', Description: 'DEV', DisabledByServer: false,
    Children: fakeCollection([session]),
    CloseSession: () => { connection.__closed = true; },
  }));

  const engine = fakeObj({
    MajorVersion: 8100, Patchlevel: 10,
    Children: fakeCollection([connection]),
    OpenConnection: (desc: string, _sync: boolean) => {
      engine.__opened = desc;
      return connection;
    },
  });

  // Default elements on the initial screen.
  const field1 = register(fakeObj({ Id: 'wnd[0]/usr/txtFIELD', Type: 'GuiCTextField', Name: 'txtFIELD', Text: '', Changeable: true }));
  const btn1 = register(fakeObj({ Id: 'wnd[0]/usr/btnGO', Type: 'GuiButton', Name: 'btnGO', Text: 'Go', Tooltip: 'Execute', Changeable: true, press: () => { btn1.__pressed = true; } }));
  usr.Children = fakeCollection([field1, btn1]);
  (usr as unknown as { children: FakeCom[] }).children = [field1, btn1];

  const tree: GuiTree = {
    engine, connection, session, window, byId,
    elements: { usr, sbar, tbar0, field1, btn1 },
  };
  return tree;
}

/** A ComApi mock whose getObject resolves ROT names to engines. */
export function mockCom(engines: Record<string, FakeCom>): ComApi {
  return {
    backend: 'winax',
    async getObject(name: string, _options?: ComObjectOptions): Promise<ComHandle> {
      const engine = engines[name];
      if (!engine) throw new Error(`ROT entry not found: ${name}`);
      // CoGetObject returns the GUI object; GetScriptingEngine is a property.
      return new FakeHandle(fakeObj({ GetScriptingEngine: engine }));
    },
    release: () => undefined,
    async close() {
      // no-op
    },
  };
}
