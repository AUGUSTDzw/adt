/**
 * PowerShell COM bridge — a long-lived `pwsh -STA` process that speaks
 * JSON-RPC over stdio and performs COM automation on behalf of the gui
 * connector. This is the zero-native-dependency fallback when `winax` cannot
 * be built (no build tools): Windows ships PowerShell, so the sap.gui
 * connector still works.
 *
 * The daemon keeps a registry of COM objects (id → object) so a session bound
 * in one tool call stays alive for the next. Every request is answered with
 * one JSON line; COM object values are encoded as `{ "$com": <id> }` refs and
 * decoded back on the PowerShell side.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import type { ComApi, ComHandle, ComObjectOptions } from './com-bridge.js';

const DAEMON_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$script:objs = @{}
$script:nextId = 1

# NOTE (PowerShell semantics): a function RETURN value is enumerated when it
# is IEnumerable — a single COM collection becomes Object[] at the call site,
# and Write-Output -NoEnumerate does NOT survive the function boundary. So
# COM objects must never be returned from a function. Encode-Value only
# returns data (primitive / hashtable ref / array of data), and its COM
# argument is bound as a *parameter*, which PowerShell does not enumerate.
# Everywhere else we dereference $script:objs inline.
function Register-ComObject($o) {
  $id = $script:nextId++
  $script:objs[$id] = $o
  return @{ '$com' = $id }
}
function Encode-Value($v) {
  if ($null -eq $v) { return $null }
  # Detect the RCW by type name: the "-is [System.__ComObject]" test can
  # fail for PSObject-wrapped COM values, but FullName never lies.
  if ($v.GetType().FullName -eq 'System.__ComObject') { return Register-ComObject $v }
  if ($v -is [string] -or $v -is [bool] -or $v -is [int] -or $v -is [long] -or $v -is [double] -or $v -is [decimal] -or $v -is [datetime]) { return $v }
  if ($v -is [System.Collections.IEnumerable]) {
    $list = @()
    foreach ($item in $v) { $list += ,(Encode-Value $item) }
    return ,$list
  }
  return $v
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  $req = $null
  try { $req = $line | ConvertFrom-Json -AsHashtable } catch { continue }
  $id = $req.id
  try {
    switch ($req.op) {
      'getObject' {
        $name = [string]$req.name
        $opt = $req.options
        if ($null -ne $opt -and $opt.getobject) {
          $o = [System.Runtime.InteropServices.Marshal]::BindToMoniker($name)
        } elseif ($null -ne $opt -and $opt.activate) {
          $o = [System.Runtime.InteropServices.Marshal]::GetActiveObject($name)
        } else {
          $o = New-Object -ComObject $name
        }
        $out = Encode-Value $o
      }
      'getProp' {
        $o = $script:objs[[int]$req.ref.'$com']
        # PSObject.Properties resolves via IDispatch, case-insensitively.
        # Bind to a variable first: member-expression arguments to a function
        # are enumerated, but variable arguments are not.
        $p = $o.PSObject.Properties[[string]$req.name]
        if ($null -ne $p) { $raw = $p.Value }
        else { $raw = $o.$($req.name) }
        $out = Encode-Value $raw
      }
      'setProp' {
        $o = $script:objs[[int]$req.ref.'$com']
        $val = $req.value
        if ($null -ne $val -and $val -is [hashtable] -and $val.ContainsKey('$com')) {
          $val = $script:objs[[int]$val.'$com']
        }
        $o.$($req.name) = $val
        $out = $null
      }
      'call' {
        $o = $script:objs[[int]$req.ref.'$com']
        $args = [object[]]@()
        if ($null -ne $req.args -and $req.args.Count -gt 0) {
          $decoded = @()
          foreach ($a in $req.args) {
            if ($null -ne $a -and $a -is [hashtable] -and $a.ContainsKey('$com')) {
              $decoded += ,$script:objs[[int]$a.'$com']
            } else {
              $decoded += ,$a
            }
          }
          $args = [object[]]$decoded
        }
        # PSMethod.Invoke handles both plain methods and indexer-style
        # default properties (GuiComponentCollection.Item(i)) via IDispatch.
        $ret = $null
        try {
          $m = $o.PSObject.Methods[[string]$req.method]
          if ($null -ne $m) { $ret = $m.Invoke($args) }
          else { $ret = & $o.$($req.method) @args }
        } catch {
          $ret = $o.GetType().InvokeMember([string]$req.method, [System.Reflection.BindingFlags]::InvokeMethod, $null, $o, $args)
        }
        $out = Encode-Value $ret
      }
      'release' {
        [void]$script:objs.Remove([int]$req.ref.'$com')
        $out = $null
      }
      default { throw "unknown op: $($req.op)" }
    }
    $resp = @{ id = $id; ok = $true; value = $out }
  } catch {
    $resp = @{ id = $id; ok = $false; error = "$($_.Exception.Message)" }
  }
  [Console]::Out.WriteLine(($resp | ConvertTo-Json -Depth 30 -Compress))
}
`;

const RPC_TIMEOUT_MS = 60_000;

interface RpcResponse {
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export function createPowershellCom(): ComApi {
  return new PowershellComApi();
}

class PowershellComApi implements ComApi {
  readonly backend = 'powershell' as const;
  private child: ChildProcessWithoutNullStreams | null = null;
  private rl: Interface | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private closed = false;

  async getObject(name: string, options: ComObjectOptions = {}): Promise<ComHandle> {
    const ref = (await this.rpc('getObject', { name, options })) as Record<string, unknown>;
    return new PowershellHandle(this, ref);
  }

  /** Wrap a decoded RPC value: `{$com: id}` refs become handles. */
  wrapValue(value: unknown): unknown {
    if (value && typeof value === 'object' && '$com' in (value as Record<string, unknown>)) {
      return new PowershellHandle(this, value as Record<string, unknown>);
    }
    if (Array.isArray(value)) return value.map((v) => this.wrapValue(v));
    return value;
  }

  release(handle: ComHandle): void {
    const raw = handle.raw as Record<string, unknown> | null;
    if (raw && typeof raw === 'object') {
      void this.rpc('release', { ref: raw }).catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const { reject } of this.pending.values()) reject(new Error('COM bridge closed'));
    this.pending.clear();
    this.rl?.close();
    this.child?.kill();
    this.child = null;
    this.rl = null;
  }

  private ensureDaemon(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed) return this.child;
    const child = spawn('pwsh', ['-NoProfile', '-NonInteractive', '-STA', '-Command', DAEMON_SCRIPT], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => this.onLine(line));
    child.on('error', (err) => this.onFatal(err));
    child.on('exit', () => this.onFatal(new Error('PowerShell COM daemon exited')));
    child.stderr.on('data', (chunk: Buffer) => {
      // Diagnostics only; errors are reported per-request.
      process.stderr.write(`[sap.gui pwsh] ${chunk.toString().trimEnd()}\n`);
    });
    this.child = child;
    this.rl = rl;
    return child;
  }

  private onLine(line: string): void {
    let resp: RpcResponse;
    try {
      resp = JSON.parse(line) as RpcResponse;
    } catch {
      return;
    }
    const p = this.pending.get(resp.id);
    if (!p) return;
    this.pending.delete(resp.id);
    clearTimeout(p.timer);
    if (resp.ok) p.resolve(resp.value);
    else p.reject(new Error(resp.error ?? 'COM operation failed'));
  }

  private onFatal(err: Error): void {
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
    this.child = null;
    this.rl = null;
  }

  /** Send one JSON-RPC request and await its response (internal). */
  rpc(op: string, payload: Record<string, unknown>): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('COM bridge closed'));
    const child = this.ensureDaemon();
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`COM ${op} timed out after ${RPC_TIMEOUT_MS}ms`));
      }, RPC_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      const msg = JSON.stringify({ id, op, ...payload });
      child.stdin.write(msg + '\n', (err) => {
        if (err) {
          const p = this.pending.get(id);
          if (p) {
            clearTimeout(p.timer);
            this.pending.delete(id);
            p.reject(err);
          }
        }
      });
    });
  }
}

class PowershellHandle implements ComHandle {
  constructor(
    private api: PowershellComApi,
    readonly raw: Record<string, unknown>,
  ) {}

  async getProp(name: string): Promise<unknown> {
    return this.api.wrapValue(await this.api.rpc('getProp', { ref: this.raw, name }));
  }

  async setProp(name: string, value: unknown): Promise<void> {
    await this.api.rpc('setProp', { ref: this.raw, name, value: PowershellHandle.encodeArg(value) });
  }

  async call(method: string, ...args: unknown[]): Promise<unknown> {
    return this.api.wrapValue(
      await this.api.rpc('call', { ref: this.raw, method, args: args.map(PowershellHandle.encodeArg) }),
    );
  }

  /** A ComHandle argument becomes its `{$com: id}` ref for the wire. */
  static encodeArg(value: unknown): unknown {
    if (value instanceof PowershellHandle) return value.raw;
    if (Array.isArray(value)) return value.map(PowershellHandle.encodeArg);
    return value;
  }
}
