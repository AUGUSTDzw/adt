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
 * winax resolves these names with CoGetObject (the `getobject: true` option),
 * which parses the name and binds the ROT moniker. Engines are cached; a dead
 * engine is dropped and re-resolved on the next call.
 */

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { type ComApi, type ComObject, enumCollection, prop } from './com-bridge.js';

export interface EngineHost {
  host: 'saplogon' | 'sapguiserver';
  rotName: string;
  engine: ComObject;
}

export interface DiscoveredConnection {
  host: 'saplogon' | 'sapguiserver';
  rotName: string;
  engine: ComObject;
  connection: ComObject;
}

/** List PIDs of SAP GUI-related processes (injectable for tests). */
export type PidLister = () => number[];

const require = createRequire(import.meta.url);

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
  private engines = new Map<string, ComObject>();

  constructor(
    private com: ComApi,
    private listPids: PidLister = defaultListSapGuiPids,
  ) {}

  /** Resolve a ROT entry to its scripting engine, or null on failure. */
  resolveEngine(rotName: string): ComObject | null {
    const cached = this.engines.get(rotName);
    if (cached) {
      try {
        prop(cached, 'Children', null);
        return cached;
      } catch {
        this.engines.delete(rotName);
      }
    }
    try {
      const gui = new this.com.Object(rotName, { getobject: true });
      const engine = prop<ComObject | null>(gui, 'GetScriptingEngine', null);
      if (engine) this.engines.set(rotName, engine);
      return engine;
    } catch {
      return null;
    }
  }

  /** Yield every reachable engine: SAP Logon first, then server processes. */
  *iterateEngines(): Iterable<EngineHost> {
    const saplogon = this.resolveEngine('SAPGUI');
    if (saplogon) yield { host: 'saplogon', rotName: 'SAPGUI', engine: saplogon };

    const pids = this.listPids();
    for (const pid of pids) {
      const rotName = `SAPGUISERVER-${pid.toString(16).toUpperCase()}`;
      const engine = this.resolveEngine(rotName);
      if (engine) yield { host: 'sapguiserver', rotName, engine };
    }
  }

  /** All connections across all engines, in global index order. */
  discoverConnections(): DiscoveredConnection[] {
    const found: DiscoveredConnection[] = [];
    for (const { host, rotName, engine } of this.iterateEngines()) {
      for (const connection of enumCollection<ComObject>(prop(engine, 'Children', null))) {
        if (connection) found.push({ host, rotName, engine, connection });
      }
    }
    return found;
  }

  /** SAP Logon scripting engine (needed for OpenConnection), or null. */
  getSapLogonEngine(): ComObject | null {
    return this.resolveEngine('SAPGUI');
  }
}

export function guiNotAvailableMessage(): string {
  return NOT_AVAILABLE_MESSAGE;
}
