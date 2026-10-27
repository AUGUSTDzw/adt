/**
 * ROT discovery — find running SAP GUI scripting engines via the COM Running
 * Object Table (ROT).
 *
 * SAP GUI registers two kinds of ROT entries:
 *   - "SAPGUI"            — the SAP Logon engine (SAP Logon Pad / SAPGUI).
 *   - "SAPGUISERVER-<pid>"— one per GUI server process, where <pid> is the
 *                           process ID in UPPERCASE hex (SAP GUI 8.x runs
 *                           sessions in sapguiserver.exe; SAP Business Client
 *                           and embedded SAP GUI register the same shape).
 *
 * The backend (winax or the PowerShell bridge) resolves these names with
 * BindToMoniker / CoGetObject. Engines are cached; a dead engine is dropped
 * and re-resolved on the next call.
 */

import { execFileSync } from 'node:child_process';
import { type ComApi, type ComHandle, enumCollection, prop } from './com-bridge.js';

export interface EngineHost {
  host: 'saplogon' | 'sapguiserver';
  rotName: string;
  engine: ComHandle;
}

export interface DiscoveredConnection {
  host: 'saplogon' | 'sapguiserver';
  rotName: string;
  engine: ComHandle;
  connection: ComHandle;
}

/** List PIDs of SAP GUI-related processes (injectable for tests). */
export type PidLister = () => number[];

// Process name patterns that may host a SAP GUI scripting engine.
const SAP_PROCESS_RE = /^(sapgui|sapguiserver|saplogon|sapbusinessclient|sapbc|saplogonpad)$/i;

/** Default PID lister: PowerShell Get-Process filtered to SAP GUI names. */
function defaultListSapGuiPids(): number[] {
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command',
        `Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '${SAP_PROCESS_RE.source}' } | ForEach-Object { $_.Id }'`,
      ],
      { encoding: 'utf8', timeout: 5000, windowsHide: true },
    );
    return out.split(/\s+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

const NOT_AVAILABLE_MESSAGE =
  'Cannot connect to SAP GUI. Ensure SAP Logon Pad, SAP Business Client, or another SAP GUI session is running.';

export class GuiDiscovery {
  private engines = new Map<string, ComHandle>();

  constructor(
    private com: ComApi,
    private listPids: PidLister = defaultListSapGuiPids,
  ) {}

  /** Resolve a ROT entry to its scripting engine, or null on failure. */
  async resolveEngine(rotName: string): Promise<ComHandle | null> {
    const cached = this.engines.get(rotName);
    if (cached) {
      try {
        await prop(cached, 'Children', null);
        return cached;
      } catch {
        this.engines.delete(rotName);
      }
    }
    try {
      const gui = await this.com.getObject(rotName, { getobject: true });
      const engine = await prop<ComHandle | null>(gui, 'GetScriptingEngine', null);
      if (engine) this.engines.set(rotName, engine);
      return engine;
    } catch {
      return null;
    }
  }

  /** Yield every reachable engine: SAP Logon first, then server processes. */
  async *iterateEngines(): AsyncIterable<EngineHost> {
    const saplogon = await this.resolveEngine('SAPGUI');
    if (saplogon) yield { host: 'saplogon', rotName: 'SAPGUI', engine: saplogon };

    const pids = this.listPids();
    for (const pid of pids) {
      const rotName = `SAPGUISERVER-${pid.toString(16).toUpperCase()}`;
      const engine = await this.resolveEngine(rotName);
      if (engine) yield { host: 'sapguiserver', rotName, engine };
    }
  }

  /** All connections across all engines, in global index order. */
  async discoverConnections(): Promise<DiscoveredConnection[]> {
    const found: DiscoveredConnection[] = [];
    for await (const { host, rotName, engine } of this.iterateEngines()) {
      const children = await enumCollection<ComHandle>(await prop(engine, 'Children', null));
      for (const connection of children) {
        if (connection) found.push({ host, rotName, engine, connection });
      }
    }
    return found;
  }

  /** SAP Logon scripting engine (needed for OpenConnection), or null. */
  getSapLogonEngine(): Promise<ComHandle | null> {
    return this.resolveEngine('SAPGUI');
  }
}

export function guiNotAvailableMessage(): string {
  return NOT_AVAILABLE_MESSAGE;
}
