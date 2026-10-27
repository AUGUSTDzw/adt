import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createPowershellCom } from '../../../src/connectors/gui/powershell-com.js';
import { type ComApi, type ComHandle, prop, invoke } from '../../../src/connectors/gui/com-bridge.js';

/** True when pwsh can actually run (Windows + PowerShell 7 present). */
function hasPwsh(): boolean {
  try {
    execFileSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!hasPwsh())('PowerShell COM bridge (real pwsh)', () => {
  let com: ComApi;

  beforeAll(() => {
    com = createPowershellCom();
  });

  afterAll(async () => {
    await com.close();
  });

  it('creates a COM object and calls a method', async () => {
    const wsh = await com.getObject('WScript.Shell');
    const result = await invoke<string>(wsh, 'ExpandEnvironmentStrings', '%TEMP%');
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toContain('%');
  });

  it('reads a property', async () => {
    const wsh = await com.getObject('WScript.Shell');
    const dir = await prop<string>(wsh, 'CurrentDirectory', '');
    expect(dir.length).toBeGreaterThan(0);
  });

  it('sets a property and reads it back', async () => {
    const wsh = await com.getObject('WScript.Shell');
    const before = await prop<string>(wsh, 'CurrentDirectory', '');
    await wsh.setProp('CurrentDirectory', before);
    expect(await prop<string>(wsh, 'CurrentDirectory', '')).toBe(before);
  });

  it('calls a method with a string argument', async () => {
    const doc = await com.getObject('MSXML2.DOMDocument.6.0');
    await invoke(doc, 'loadXML', '<r><a/><b/><c/></r>');
    const root = await prop<ComHandle | null>(doc, 'documentElement', null);
    expect(await prop<string>(root, 'nodeName', '')).toBe('r');
  });

  it('reads a 0-based indexer collection (MSXML childNodes)', async () => {
    const doc = await com.getObject('MSXML2.DOMDocument.6.0');
    await invoke(doc, 'loadXML', '<r><a/><b/><c/></r>');
    const root = await prop<ComHandle | null>(doc, 'documentElement', null);
    const nodes = await prop<ComHandle | null>(root, 'childNodes', null);
    const count = Number(await prop(nodes, 'length', 0));
    expect(count).toBe(3);
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      const item = await invoke<ComHandle>(nodes!, 'Item', i);
      names.push(await prop<string>(item, 'nodeName', ''));
    }
    expect(names).toEqual(['a', 'b', 'c']);
  });

  it('holds a nested COM object reference across calls', async () => {
    const doc = await com.getObject('MSXML2.DOMDocument.6.0');
    await invoke(doc, 'loadXML', '<r><a/></r>');
    const root = await prop<ComHandle | null>(doc, 'documentElement', null);
    const nodes = await prop<ComHandle | null>(root, 'childNodes', null);
    const first = await invoke<ComHandle>(nodes!, 'Item', 0);
    expect(await prop<string>(first, 'nodeName', '')).toBe('a');
  });
});
