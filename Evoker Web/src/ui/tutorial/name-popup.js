'use strict';
/**
 * The name prompt of the first Arena visit (ui.components.popups.comp_name_popup): no header, the arena guard
 * (pvpguard.png) at the left, the heralds text, an input pre-filled with the current (automatic "user-<digits>")
 * name, an OK button and the close X. OK stores the name (game.usermanager changeUserName; at most 18
 * characters, an empty name keeps the old one); X leaves the name as it is and the prompt comes back next visit.
 */
import { h } from '../dom.js';
import { needsName, setPlayerName, NAME_MAX } from './progress.js';

/**
 * The prompt as the player reads it: the English value of the client's loca key "Before you enter the arena,
 * Evoker, please tell me how the heralds shall name you:" (exploration/apk/lua/assets.loca.en.txt).
 */
export const NAME_PROMPT_TEXT = 'Before you enter the arena, Evoker, please tell me by which name the heralds shall refer to you:';
/** The popup's portrait. */
export const NAME_PORTRAIT = '/assets/orig/ui/pvpguard.png';

/**
 * Open the name popup.
 * @param {object} ctx  ScreenContext (ui.dialog, store)
 * @returns {Promise<string|null>} the stored name, or null when closed with X
 */
export async function askPlayerName(ctx) {
  const state = ctx.store.get();
  const input = /** @type {HTMLInputElement} */ (h('input.name-input.tut-name-input', {
    type: 'text', maxlength: String(NAME_MAX), value: state ? state.player.name : '', autocomplete: 'off',
    spellcheck: 'false', 'aria-label': 'Your name',
  }));
  const dlg = ctx.ui.dialog.open({
    className: 'tut-name-dialog',
    closable: true,
    body: h('div.tut-name-popup', null,
      h('img.tut-name-guard', { src: NAME_PORTRAIT, alt: '', draggable: 'false' }),
      h('p.tut-name-text', null, NAME_PROMPT_TEXT),
      input),
    buttons: [{ label: 'OK', value: true, autofocus: true }],
  });
  setTimeout(() => { try { input.focus(); input.select(); } catch (err) { /* detached */ } }, 60);
  const ok = await dlg;
  if (!ok) return null;
  ctx.store.update((s) => setPlayerName(s, input.value));
  const s = ctx.store.get();
  return s ? s.player.name : null;
}

/**
 * Ask for the name when this save has not chosen one yet (first Arena entry). Safe to call on every visit.
 * @param {object} ctx
 * @returns {Promise<string|null>}
 */
export async function maybeAskName(ctx) {
  return needsName(ctx.store.get()) ? askPlayerName(ctx) : null;
}
