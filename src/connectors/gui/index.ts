/**
 * SAP GUI connector factory — exposes the `sap.gui.*` namespace.
 *
 * Attaches to already-logged-on SAP GUI sessions via Windows COM (免密 SSO),
 * plus reading/writing screen elements, popup handling, and screenshots. The
 * connector degrades gracefully: on non-Windows platforms, or without winax
 * and without PowerShell, the tools are still registered but return a clear
 * error. The COM backend is chosen automatically (winax fast path, PowerShell
 * bridge when winax cannot be built).
 */

import type { SapConnector, ToolRegistration, ConnectorConfig, ToolResult } from '../../core/types.js';
import { z } from 'zod';
import { getCom, comUnavailableReason, isComAvailable, invoke } from './com-bridge.js';
import { SapGuiClient, parseVKey, vKeyName } from './sap-gui-client.js';
import { PopupHandler } from './popup.js';
import { logger } from '../../core/utils/logger.js';

function errorResult(message: string): ToolResult {
  return { content: [{ type: 'json', json: { error: message } }], isError: true };
}

export function createGuiConnector(): SapConnector {
  let client: SapGuiClient | null = null;
  let popup: PopupHandler | null = null;
  let unavailable: string | null = null;
  let env: { user?: string; password?: string; client?: string; language?: string } = {};

  return {
    id: 'gui',
    async init(cfg: ConnectorConfig) {
      env = {
        user: cfg.user as string | undefined,
        password: cfg.password as string | undefined,
        client: cfg.client as string | undefined,
        language: cfg.language as string | undefined,
      };
      if (!isComAvailable()) {
        unavailable = comUnavailableReason() ?? 'no COM backend available';
        logger.warn({ connector: 'gui', reason: unavailable }, 'sap.gui connector degraded (COM unavailable)');
        return;
      }
      const com = getCom()!;
      client = new SapGuiClient(com);
      popup = new PopupHandler(() => {
        if (!client?.isConnected) {
          throw new Error('Not connected to SAP. Call sap.gui.connect_existing or sap.gui.connect first.');
        }
        return client.boundSession!;
      });
      logger.info({ connector: 'gui', backend: com.backend }, 'sap.gui connector initialized');
    },

    tools(): ToolRegistration[] {
      const com = async <T>(fn: () => Promise<T>): Promise<ToolResult> => {
        if (unavailable) return errorResult(`sap.gui is unavailable: ${unavailable}`);
        try {
          return { content: [{ type: 'json', json: await fn() }] };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: [{ type: 'json', json: { error: message } }], isError: true };
        }
      };
      const needClient = (): SapGuiClient => {
        if (!client) throw new Error('sap.gui connector not initialized.');
        return client;
      };
      const needPopup = (): PopupHandler => {
        if (!popup) throw new Error('sap.gui connector not initialized.');
        return popup;
      };

      return [
        // ------------------------------------------------------------------
        // Connection
        // ------------------------------------------------------------------
        {
          name: 'list_connections',
          description: 'List open SAP GUI connections and sessions (SAP Logon + SAP GUI server processes)',
          inputSchema: {},
          handler: async () => com(async () => ({ connections: await needClient().listConnections() })),
        },
        {
          name: 'connect_existing',
          description: 'Attach to an already-logged-on SAP session (免密 SSO, no credentials needed). Use system="DEV" or "DEV/100" to pick by name, or connection_index/session_index',
          inputSchema: {
            system: z.string().optional(),
            connection_index: z.number().int().nonnegative().default(0),
            session_index: z.number().int().nonnegative().default(0),
          },
          handler: async (a) => com(async () => {
            const args = a as { system?: string; connection_index: number; session_index: number };
            const c = needClient();
            if (args.system) {
              const found = await c.listConnections();
              const [sid, cli] = args.system.toUpperCase().split('/');
              const matches: { connection_index: number; session_index: number }[] = [];
              found.forEach((conn) => {
                conn.sessions.forEach((sess) => {
                  if (sess.system.toUpperCase() === sid && (!cli || sess.client === cli)) {
                    matches.push({ connection_index: conn.index, session_index: sess.index });
                  }
                });
              });
              if (matches.length === 0) throw new Error(`No open session on ${args.system}.`);
              if (matches.length > 1) {
                throw new Error(`${matches.length} sessions are open on ${args.system}: ${matches.map((m) => `connection_index=${m.connection_index}, session_index=${m.session_index}`).join('; ')}.`);
              }
              return c.connectExisting(matches[0].connection_index, matches[0].session_index);
            }
            return c.connectExisting(args.connection_index, args.session_index);
          }),
        },
        {
          name: 'connect',
          description: 'Open a new SAP connection by its SAP Logon description. Credentials come from .env (SAP_GUI_USER/PASSWORD/CLIENT/LANGUAGE), never from the tool call',
          inputSchema: { system: z.string() },
          handler: async (a) => com(async () => {
            const args = a as { system: string };
            return needClient().connect(args.system, env);
          }),
        },
        {
          name: 'disconnect',
          description: 'Detach from the current SAP GUI session (sessions opened by sap.gui.connect are closed; attached sessions are left open)',
          inputSchema: {},
          handler: async () => com(async () => {
            await needClient().disconnect();
            return { disconnected: true };
          }),
        },
        {
          name: 'get_session_info',
          description: 'Get the current SAP session info: system, client, user, transaction, screen, SAP GUI version, scripting_read_only',
          inputSchema: {},
          handler: async () => com(async () => needClient().getSessionInfo()),
        },

        // ------------------------------------------------------------------
        // Reading
        // ------------------------------------------------------------------
        {
          name: 'get_screen_info',
          description: 'Get the current screen info: status bar message, title, transaction, active window',
          inputSchema: {},
          handler: async () => com(async () => needClient().getScreenInfo()),
        },
        {
          name: 'find_element',
          description: 'Find an SAP GUI element by ID and return its type, text, changeable state',
          inputSchema: { id: z.string() },
          handler: async (a) => com(async () => needClient().findElement((a as { id: string }).id)),
        },
        {
          name: 'get_text',
          description: 'Read the text of an SAP GUI element',
          inputSchema: { id: z.string() },
          handler: async (a) => com(async () => {
            const id = (a as { id: string }).id;
            return { id, text: await needClient().getText(id) };
          }),
        },
        {
          name: 'list_elements',
          description: 'Enumerate screen elements (discovery). Returns element IDs for automating a transaction',
          inputSchema: {
            container_id: z.string().default('wnd[0]/usr'),
            max_depth: z.number().int().min(1).max(6).default(3),
            type_filter: z.string().optional(),
            changeable_only: z.boolean().default(false),
          },
          handler: async (a) => com(async () => {
            const args = a as { container_id: string; max_depth: number; type_filter?: string; changeable_only: boolean };
            const elements = await needClient().listElements(args.container_id, args.max_depth, args.type_filter ?? '', args.changeable_only);
            return { container: args.container_id, elements };
          }),
        },
        {
          name: 'get_popup',
          description: 'Read the topmost popup dialog (title, texts, buttons, classification) or { popup_exists: false }',
          inputSchema: {},
          handler: async () => com(async () => needPopup().readPopup()),
        },
        {
          name: 'take_screenshot',
          description: 'Screenshot the current SAP window as PNG. With filepath, saves to file; without, returns base64 data',
          inputSchema: { filepath: z.string().optional() },
          handler: async (a) => com(async () => needClient().takeScreenshot((a as { filepath?: string }).filepath)),
        },

        // ------------------------------------------------------------------
        // Writing
        // ------------------------------------------------------------------
        {
          name: 'set_text',
          description: 'Set the text of an SAP GUI element (input field, command field, etc.)',
          inputSchema: { id: z.string(), value: z.string() },
          write: true,
          handler: async (a) => com(async () => {
            const args = a as { id: string; value: string };
            return needClient().setText(args.id, args.value);
          }),
        },
        {
          name: 'send_key',
          description: 'Send a virtual key (Enter, F1-F12, Shift+F1-F9, Ctrl+F/G/P) to the current window',
          inputSchema: {
            key: z.enum(['Enter', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'Shift+F1', 'Shift+F2', 'Shift+F3', 'Shift+F4', 'Shift+F5', 'Shift+F6', 'Shift+F7', 'Shift+F8', 'Shift+F9', 'Ctrl+F', 'Ctrl+G', 'Ctrl+P']),
            window: z.string().default('wnd[0]'),
          },
          write: true,
          handler: async (a) => com(async () => {
            const args = a as { key: string; window: string };
            const code = parseVKey(args.key);
            if (code === null) throw new Error(`Unknown key '${args.key}'.`);
            const screen = await needClient().sendVKey(code, args.window);
            return { vkey: code, key_name: vKeyName(code), screen };
          }),
        },
        {
          name: 'execute_transaction',
          description: 'Execute (start) an SAP transaction code, e.g. MM03, VA01, SE16. Use /n prefix to leave the current transaction',
          inputSchema: { tcode: z.string() },
          write: true,
          handler: async (a) => com(async () => {
            const args = a as { tcode: string };
            const screen = await needClient().executeTransaction(args.tcode);
            return { transaction: args.tcode.replace(/^\/[nN]/, ''), screen };
          }),
        },
        {
          name: 'handle_popup',
          description: 'Read and optionally act on the current popup: action=read|confirm|cancel|press|auto. press needs button_text',
          inputSchema: {
            action: z.enum(['read', 'confirm', 'cancel', 'press', 'auto']).default('read'),
            button_text: z.string().optional(),
          },
          write: true,
          handler: async (a) => com(async () => {
            const args = a as { action: 'read' | 'confirm' | 'cancel' | 'press' | 'auto'; button_text?: string };
            const plan = await needPopup().planPopupAction(args.action, args.button_text ?? '');
            if (plan.popup.error) return plan.popup;
            return needPopup().applyPopupPlan(plan);
          }),
        },
        {
          name: 'press_button',
          description: 'Press a button by its element ID (e.g. wnd[1]/usr/btnBUTTON_1)',
          inputSchema: { button_id: z.string() },
          write: true,
          handler: async (a) => com(async () => {
            const args = a as { button_id: string };
            const session = needClient().boundSession!;
            const button = await invoke<import('./com-bridge.js').ComHandle>(session, 'findById', args.button_id);
            await invoke(button, 'press');
            return { pressed: args.button_id, popup_after: await needPopup().readPopup() };
          }),
        },
      ];
    },

    async shutdown() {
      try {
        await client?.disconnect();
      } catch {
        // Already detached.
      }
    },
  };
}
