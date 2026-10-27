import { describe, it, expect, beforeEach } from 'vitest';
import { PopupHandler } from '../../../src/connectors/gui/popup.js';
import { buildGuiTree, fakeObj, fakeCollection, type GuiTree } from './fakes.js';
import type { ComObject } from '../../../src/connectors/gui/com-bridge.js';

describe('PopupHandler', () => {
  let tree: GuiTree;
  let handler: PopupHandler;

  beforeEach(() => {
    tree = buildGuiTree();
    handler = new PopupHandler(() => tree.session as unknown as ComObject);
  });

  function openPopup(overrides: Record<string, unknown> = {}) {
    const popup = fakeObj({
      Id: 'wnd[1]', Type: 'GuiDialog', Text: 'Confirm', Changeable: false,
      Children: fakeCollection([]),
      ...overrides,
    });
    tree.byId.set('wnd[1]', popup);
    // Register every descendant so session.findById resolves it.
    const register = (o: unknown) => {
      const obj = o as { Id?: string; Children?: unknown };
      if (obj?.Id) tree.byId.set(obj.Id, o as never);
      if (obj?.Children && typeof obj.Children === 'object') {
        const coll = obj.Children as { Item: (i: number) => unknown };
        for (let i = 0; i < (coll as { Count: number }).Count; i++) register(coll.Item(i));
      }
    };
    register(popup);
    return popup;
  }

  it('reports no popup when none is open', () => {
    expect(handler.readPopup().popup_exists).toBe(false);
  });

  it('reads and classifies an information popup', () => {
    openPopup({
      Text: 'Information',
      Children: fakeCollection([
        fakeObj({ Id: 'wnd[1]/usr/lblMSG', Type: 'GuiLabel', Text: 'Data saved successfully', Changeable: false }),
        fakeObj({ Id: 'wnd[1]/usr/btnOK', Type: 'GuiButton', Text: 'OK', Tooltip: '', Changeable: true, press: () => undefined }),
      ]),
    });
    const popup = handler.readPopup();
    expect(popup.popup_exists).toBe(true);
    expect(popup.window_id).toBe('wnd[1]');
    expect(popup.texts).toContain('Data saved successfully');
    expect(popup.buttons).toHaveLength(1);
    expect(popup.classification).toBe('information');
    expect(popup.recommended_action).toBe('confirm');
  });

  it('classifies a confirmation popup with save risk', () => {
    openPopup({
      Text: 'Save changes',
      Children: fakeCollection([
        fakeObj({ Id: 'wnd[1]/usr/lblMSG', Type: 'GuiLabel', Text: 'Save the changes first?', Changeable: false }),
        fakeObj({ Id: 'wnd[1]/usr/btnYES', Type: 'GuiButton', Text: 'Yes', Tooltip: '', Changeable: true, press: () => undefined }),
        fakeObj({ Id: 'wnd[1]/usr/btnNO', Type: 'GuiButton', Text: 'No', Tooltip: '', Changeable: true, press: () => undefined }),
      ]),
    });
    const plan = handler.planPopupAction('confirm');
    expect(plan.popup.classification).toBe('confirmation');
    expect(plan.save_risk).toBe(true);
    expect(plan.button?.text).toBe('Yes');
  });

  it('applies a confirm plan by pressing the button', () => {
    const btn = fakeObj({ Id: 'wnd[1]/usr/btnOK', Type: 'GuiButton', Text: 'OK', Tooltip: '', Changeable: true, press: () => { btn.__pressed = true; } });
    openPopup({
      Text: 'Information',
      Children: fakeCollection([
        fakeObj({ Id: 'wnd[1]/usr/lblMSG', Type: 'GuiLabel', Text: 'Done', Changeable: false }),
        btn,
      ]),
    });
    const plan = handler.planPopupAction('confirm');
    const result = handler.applyPopupPlan(plan);
    expect((btn as { __pressed?: boolean }).__pressed).toBe(true);
    expect(result.button_pressed).toBe('OK');
  });

  it('plans cancel with F12 fallback when no cancel button exists', () => {
    openPopup({
      Text: 'Question',
      Children: fakeCollection([
        fakeObj({ Id: 'wnd[1]/usr/lblMSG', Type: 'GuiLabel', Text: 'Continue?', Changeable: false }),
        fakeObj({ Id: 'wnd[1]/usr/btnOK', Type: 'GuiButton', Text: 'OK', Tooltip: '', Changeable: true, press: () => undefined }),
      ]),
    });
    const plan = handler.planPopupAction('cancel');
    expect(plan.button).toBeNull();
    expect(plan.fallback_vkey).toBe(12);
  });

  it('errors on press when the button text is unknown', () => {
    openPopup({
      Text: 'Question',
      Children: fakeCollection([
        fakeObj({ Id: 'wnd[1]/usr/btnOK', Type: 'GuiButton', Text: 'OK', Tooltip: '', Changeable: true, press: () => undefined }),
      ]),
    });
    const plan = handler.planPopupAction('press', 'NotThere');
    expect(plan.popup.error).toMatch(/No button matching/);
  });

  it('auto-action reads a save-shaped popup instead of confirming', () => {
    openPopup({
      Text: 'Save changes',
      Children: fakeCollection([
        fakeObj({ Id: 'wnd[1]/usr/lblMSG', Type: 'GuiLabel', Text: 'Save the changes first?', Changeable: false }),
        fakeObj({ Id: 'wnd[1]/usr/btnYES', Type: 'GuiButton', Text: 'Yes', Tooltip: '', Changeable: true, press: () => undefined }),
        fakeObj({ Id: 'wnd[1]/usr/btnNO', Type: 'GuiButton', Text: 'No', Tooltip: '', Changeable: true, press: () => undefined }),
      ]),
    });
    const plan = handler.planPopupAction('auto');
    expect(plan.popup.action).toBe('read');
  });
});
