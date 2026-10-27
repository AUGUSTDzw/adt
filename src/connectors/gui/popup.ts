/**
 * Popup state machine — read, classify, and act on SAP modal dialogs.
 *
 * SAP popups appear as wnd[1], wnd[2], ... above the main window. A popup is
 * read into a classified structure (title, texts, buttons, inputs), then the
 * caller plans an action (confirm / cancel / press / auto) and applies it.
 * The plan carries a `save_risk` flag so a caller can ask the user before
 * pressing a button that may save.
 */

import { type ComObject, enumCollection, prop, invoke } from './com-bridge.js';

export interface PopupButton {
  id: string;
  text: string;
  tooltip: string;
}

export interface PopupElement {
  id: string;
  type: string;
  name: string;
  text: string;
  changeable: boolean;
  selected?: boolean;
}

export interface PopupInfo {
  popup_exists: boolean;
  window_id?: string;
  title?: string;
  texts?: string[];
  buttons?: PopupButton[];
  interactive_elements?: PopupElement[];
  has_inputs?: boolean;
  classification?: string;
  recommended_action?: string;
  safe_auto_action?: string;
  action?: string;
  button_pressed?: string;
  error?: string;
  auto_decision?: string;
  popup_closed?: boolean;
}

export interface PopupPlan {
  popup: PopupInfo;
  action: string;
  button: PopupButton | null;
  fallback_vkey: number | null;
  save_risk: boolean;
  done: boolean;
}

const CONFIRM_PATTERNS = ['ok', 'yes', 'continue', 'confirm', 'execute', 'save'];
const CANCEL_PATTERNS = ['cancel', 'no', 'abort', 'close', 'back'];
const ERROR_PATTERNS = ['error', 'failed', 'cannot', 'not possible', 'not found', 'does not exist', 'required', 'invalid'];
const INFO_PATTERNS = ['information', 'info', 'success', 'completed', 'saved', 'created', 'displayed'];
const CONFIRMATION_PATTERNS = ['do you want', 'are you sure', 'save changes', 'discard', 'overwrite', 'delete', 'confirm', 'continue?', 'proceed'];
const SAVE_PATTERNS = ['save', 'sichern', 'speichern', 'enregistrer', 'guardar', 'salvar', 'salvare', 'opslaan'];
const INTERACTIVE_TYPES = new Set([
  'GuiTextField', 'GuiCTextField', 'GuiPasswordField', 'GuiComboBox', 'GuiCheckBox', 'GuiRadioButton',
]);

export class PopupHandler {
  constructor(private getSession: () => ComObject) {}

  /** Read the topmost popup above wnd[0], or { popup_exists: false }. */
  readPopup(): PopupInfo {
    const session = this.getSession();
    let popupId: string | null = null;
    let popup: ComObject | null = null;
    for (let i = 1; i < 10; i++) {
      const id = `wnd[${i}]`;
      try {
        const wnd = session.findById(id);
        popup = wnd;
        popupId = id;
      } catch {
        break;
      }
    }
    if (!popup || !popupId) return { popup_exists: false };

    const result: PopupInfo = { popup_exists: true, window_id: popupId };
    try {
      result.title = String(prop(popup, 'Text', '') ?? '').trim();
    } catch {
      result.title = '';
    }

    const texts: string[] = [];
    const buttons: PopupButton[] = [];
    const interactive: PopupElement[] = [];
    this.walkPopup(popupId, 0, texts, buttons, interactive);

    if (texts.length) result.texts = texts;
    if (buttons.length) result.buttons = buttons;
    if (interactive.length) {
      result.interactive_elements = interactive;
      result.has_inputs = true;
    } else {
      result.has_inputs = false;
    }
    return this.classify(result);
  }

  private walkPopup(id: string, depth: number, texts: string[], buttons: PopupButton[], interactive: PopupElement[]): void {
    if (depth > 4) return;
    let container: ComObject;
    try {
      container = this.getSession().findById(id);
    } catch {
      return;
    }
    const children = enumCollection<ComObject>(prop(container, 'Children', null));
    for (const child of children) {
      if (!child) continue;
      const childId = String(prop(child, 'Id', '') ?? '');
      if (!childId) continue;
      const type = String(prop(child, 'Type', '') ?? '');
      const text = String(prop(child, 'Text', '') ?? '');
      const changeable = Boolean(prop(child, 'Changeable', false));
      if (type === 'GuiButton') {
        buttons.push({
          id: this.normalizeId(childId),
          text: text.trim(),
          tooltip: String(prop(child, 'Tooltip', '') ?? '').trim(),
        });
      } else if (type === 'GuiLabel' || type === 'GuiTitlebar' || type === 'GuiStatusbar' || type === 'GuiSimpleText') {
        if (text.trim()) texts.push(text.trim());
      } else if (INTERACTIVE_TYPES.has(type)) {
        const el: PopupElement = {
          id: this.normalizeId(childId),
          type,
          name: String(prop(child, 'Name', '') ?? ''),
          text,
          changeable,
        };
        if (type === 'GuiCheckBox' || type === 'GuiRadioButton') {
          el.selected = Boolean(prop(child, 'Selected', false));
        }
        interactive.push(el);
      }
      this.walkPopup(childId, depth + 1, texts, buttons, interactive);
    }
  }

  private normalizeId(id: string): string {
    const match = id.match(/(wnd\[\d+\].*)$/);
    return match ? match[1] : id;
  }

  private classify(popup: PopupInfo): PopupInfo {
    const blob = (popup.texts ?? []).join(' ').toLowerCase();
    const buttons = popup.buttons ?? [];
    const hasConfirm = buttons.some((b) => this.matchButton([b], CONFIRM_PATTERNS));
    const hasCancel = buttons.some((b) => this.matchButton([b], CANCEL_PATTERNS));

    let classification = 'unknown';
    if (ERROR_PATTERNS.some((p) => blob.includes(p))) classification = 'error';
    else if (blob.includes('warning')) classification = 'warning';
    else if (popup.has_inputs || INTERACTIVE_TYPES.size > 0 && (popup.interactive_elements?.length ?? 0) > 0) classification = 'input_required';
    else if (CONFIRMATION_PATTERNS.some((p) => blob.includes(p)) || (blob.includes('?') && (hasConfirm || hasCancel))) classification = 'confirmation';
    else if (hasConfirm && hasCancel) classification = 'confirmation';
    else if (INFO_PATTERNS.some((p) => blob.includes(p)) || (hasConfirm && !hasCancel) || (hasCancel && !hasConfirm)) classification = 'information';

    popup.classification = classification;
    popup.recommended_action = 'read';
    let safe: string | null = null;
    if (classification === 'information' && !popup.has_inputs) {
      if (hasConfirm && !hasCancel) { popup.recommended_action = 'confirm'; safe = 'confirm'; }
      else if (hasCancel && !hasConfirm) { popup.recommended_action = 'cancel'; safe = 'cancel'; }
    }
    if (safe) popup.safe_auto_action = safe;
    return popup;
  }

  /** Decide what an action would press (presses nothing). */
  planPopupAction(action: 'read' | 'confirm' | 'cancel' | 'press' | 'auto', buttonText = ''): PopupPlan {
    const popup = this.readPopup();
    const plan: PopupPlan = { popup, action, button: null, fallback_vkey: null, save_risk: false, done: true };
    if (!popup.popup_exists) {
      plan.popup = { popup_exists: false, action: 'none' };
      return plan;
    }

    if (action === 'read') {
      popup.action = 'read';
      return plan;
    }

    if (action === 'auto') {
      const decision = popup.safe_auto_action ?? 'read';
      if (decision === 'confirm' && this.saveRisk(popup, this.matchButton(popup.buttons ?? [], CONFIRM_PATTERNS))) {
        popup.action = 'read';
        popup.auto_decision = 'read';
        return plan;
      }
      if (decision === 'read') {
        popup.action = 'read';
        popup.auto_decision = 'read';
        return plan;
      }
      action = decision as 'confirm' | 'cancel';
      plan.action = action;
    }

    const allButtons = popup.buttons ?? [];
    let btn: PopupButton | null = null;
    let fallback: number | null = null;
    if (action === 'confirm') {
      btn = this.matchButton(allButtons, CONFIRM_PATTERNS);
      fallback = 0;
    } else if (action === 'cancel') {
      btn = allButtons.find((b) => this.isCancelButton(b)) ?? null;
      fallback = 12;
    } else if (action === 'press') {
      const needle = buttonText.trim().toLowerCase();
      btn = allButtons.find((b) => b.text.toLowerCase().includes(needle) || b.tooltip.toLowerCase().includes(needle)) ?? null;
      if (!btn) {
        popup.action = 'error';
        popup.error = `No button matching '${buttonText}'. Available: ${allButtons.map((b) => b.text || b.tooltip).join(', ')}`;
        return plan;
      }
    } else {
      throw new Error(`Invalid action '${action}'. Use read, confirm, cancel, press, or auto.`);
    }

    plan.button = btn;
    plan.fallback_vkey = fallback;
    plan.save_risk = this.saveRisk(popup, btn);
    plan.done = false;
    return plan;
  }

  /** Press what the plan chose; returns the updated popup state. */
  applyPopupPlan(plan: PopupPlan): PopupInfo {
    const popup = plan.popup;
    if (plan.done) return popup;
    const session = this.getSession();
    const windowId = popup.window_id ?? 'wnd[1]';
    if (plan.button) {
      try {
        const btn = session.findById(plan.button.id);
        invoke(btn, 'press');
      } catch (err) {
        popup.action = 'error';
        popup.error = `Failed to press button: ${String(err).slice(0, 200)}`;
        return popup;
      }
      popup.action = plan.action === 'press' ? 'pressed' : `${plan.action}ed`;
      popup.button_pressed = plan.button.text || plan.button.tooltip;
    } else if (plan.fallback_vkey !== null) {
      try {
        const window = session.findById(windowId);
        invoke(window, 'sendVKey', plan.fallback_vkey);
      } catch (err) {
        popup.action = 'error';
        popup.error = `Failed to send key: ${String(err).slice(0, 200)}`;
        return popup;
      }
      popup.action = `${plan.action}ed`;
      popup.button_pressed = plan.fallback_vkey === 0 ? 'Enter (fallback)' : 'F12 (fallback)';
    }
    popup.popup_closed = !this.readPopup().popup_exists;
    return popup;
  }

  private saveRisk(popup: PopupInfo, btn: PopupButton | null): boolean {
    if (btn && this.matchButton([btn], SAVE_PATTERNS)) return true;
    const blob = (popup.texts ?? []).join(' ');
    if (!SAVE_PATTERNS.some((p) => blob.toLowerCase().includes(p))) return false;
    return btn === null || (popup.buttons?.length ?? 0) > 1;
  }

  private matchButton(buttons: PopupButton[], patterns: string[]): PopupButton | null {
    for (const btn of buttons) {
      const text = btn.text.toLowerCase();
      const tooltip = btn.tooltip.toLowerCase();
      if (patterns.some((p) => text.includes(p) || tooltip.includes(p))) return btn;
    }
    return null;
  }

  private isCancelButton(btn: PopupButton): boolean {
    return /^(cancel|abort|close|back|abbrechen|annuler|cancelar|annulla|annuleren)$/i.test(btn.text.trim())
      || /^(cancel|abort|close|back|abbrechen|annuler|cancelar|annulla|annuleren)$/i.test(btn.tooltip.trim());
  }
}
