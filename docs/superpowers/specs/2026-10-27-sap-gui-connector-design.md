# sap.gui.* Connector Design

## Summary

Add a `sap.gui` connector to `sap-mcp-unified` that attaches to already-logged-on SAP GUI sessions via Windows COM (`winax`), enabling password-free SSO automation. It reuses the existing login state of SAP Logon / SAP Business Client / embedded SAP GUI sessions — no credentials required for `connect_existing`.

## Motivation

The unified server already integrates RFC, SAC, and ADT connectors. The user explicitly requested a `sap.gui.*` connector that attaches to running SAP GUI sessions (免密 SSO) as one of the seven SSO scenarios. Reference implementation studied: `reference/mcp-sap-gui` (Python, pywin32, 60 tools).

## Architecture

5 files under `src/connectors/gui/`:

| File | Responsibility |
|---|---|
| `com-bridge.ts` | Lazy-load `winax`; `getCom()` / `isComAvailable()`; value extraction (`__value` / `valueOf`); COM error → friendly message; `withCom()` serialization wrapper |
| `discovery.ts` | ROT discovery: `SAPGUI` (SAP Logon) + enumerate `sapguiserver.exe` processes → `SAPGUISERVER-<hexPID>` (resolved via `CoGetObject`); engine cache with invalidation |
| `sap-gui-client.ts` | Client: `connectExisting` / `connect` / `disconnect` / `listConnections` / `getSessionInfo` / `getScreenInfo` / `findElement` / `setText` / `sendVKey` / `executeTransaction` / `listElements` / `takeScreenshot` |
| `popup.ts` | Popup state machine: read popup (title / texts / buttons / inputs), classify (info / warning / confirmation / input_required), `plan` / `apply` |
| `index.ts` | `createGuiConnector()` factory; register tools; Windows-only graceful degradation |

## Tools (sap.gui.*)

**Connection (read-only, no write guard):**
- `list_connections` — list engines / connections / sessions
- `connect_existing` — attach to an already-logged-on session (免密 SSO); optional `system` ('DEV' or 'DEV/100') or `connection_index`/`session_index`
- `connect` — open a logon screen (SSO flow); password from `.env` only
- `disconnect` — detach the bound session
- `get_session_info` — system / client / user / transaction / screen / SAP GUI version / scripting_read_only

**Reading:**
- `get_screen_info` — status bar, title, transaction, active window, cursor
- `find_element` — element info by ID (type, text, changeable, selected)
- `get_text` — element text by ID
- `list_elements` — enumerate screen elements (discovery, max_depth)
- `get_popup` — read the topmost popup (classified)
- `take_screenshot` — window `HardCopy` PNG, base64 or file

**Writing (marked `write: true`):**
- `set_text` — set element text
- `send_key` — VKey (Enter, F1-F12, Shift+F1-F9, Ctrl+F/G/P)
- `execute_transaction` — tcode via `StartTransaction` or okcd + Enter
- `handle_popup` — read / confirm / cancel / press / auto on the popup
- `press_button` — press a button by ID

## Key Design Decisions

1. **ROT discovery**: `new winax.Object("SAPGUI", { getobject: true })` uses `CoGetObject` (verified in `disp.cpp:551`), which resolves ROT moniker names. `SAPGUISERVER-<pid>` built from enumerating `sapguiserver.exe` process PIDs. Engines cached; a dead engine is dropped and re-resolved.
2. **COM threading**: winax calls `CoInitialize(0)` at module load (`main.cpp:53`); the main thread is STA. winax is fully synchronous → calls are naturally serialized. No extra executor needed.
3. **Write guard**: `ToolRegistration` gains optional `write?: boolean`; `server.ts` uses `t.write ?? WRITE_TOOL_PATTERN.test(t.name)` (backward compatible).
4. **Graceful degradation**: non-Windows or missing `winax` → connector registers tools but handlers return a clear "Windows-only" error; `init` logs a warning and marks the connector healthy so clients see the tools.
5. **Credential safety**: `connect` never takes a password parameter; it reads `SAP_GUI_USER` / `SAP_GUI_PASSWORD` / `SAP_GUI_CLIENT` / `SAP_GUI_LANGUAGE` from `.env` (matching the existing `SAP_<ID>_` config grouping).
6. **Write tools must not be cached**: `server.ts` already clears the result cache on write; explicit `write: true` ensures write tools bypass cache and hit the audit hook.

## Testing

Mock `winax`'s `Object`/`Variant`; fakes build an SAP GUI object tree (Engine → Connection → Session → Window → Element). Vitest cases cover: discovery, connect_existing, connect, screen info, find/get/set text, send_key, execute_transaction, popup read/classify/plan/apply, list_elements, screenshot, write guard, graceful degradation. Run `npx tsc --noEmit` + `npx vitest run`.

## Out of Scope

- Transaction policy (blocklist/allowlist) — deferred; `execute_transaction` runs any tcode.
- The 60-tool breadth of `reference/mcp-sap-gui` (tables, trees, shell content) — covered by ADT/RFC connectors where relevant.
- `sap_connect` interactive logon beyond filling the login screen and pressing Enter.
