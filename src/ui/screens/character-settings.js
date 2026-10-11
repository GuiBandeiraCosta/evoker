'use strict';
/**
 * Options view of the character screen (ui.screens.settings options_def): "Options" header with the version and the
 * info button, Music Volume / FX Volume sliders, the battle speed on the preset slider, then sound, simulated raids,
 * reduced motion, export / import save and reset progress.
 */
import { h, sprite } from '../dom.js';
import { button } from '../components/buttons.js';
import { migrate } from '../../game/state.js';
import { newTutorialGame } from '../tutorial/index.js';
import { normalizeSettings, normalizeVolumes, sliderToVolume, volumeToSlider, SPEEDS } from './settings-view.js';
import { parseSaveFile, serializeSave, saveFileName } from './save-file.js';

/**
 * Save a settings change (the four classic fields through normalizeSettings, the volumes through
 * normalizeVolumes; unknown fields are kept).
 * @param {object} ctx
 * @param {object} patch
 */
function setSettings(ctx, patch) {
  ctx.store.update((s) => {
    const merged = { ...s.settings, ...patch };
    return { ...s, settings: { ...merged, ...normalizeSettings(merged), ...normalizeVolumes(merged) } };
  });
  const st = normalizeSettings(ctx.store.get().settings);
  document.documentElement.dataset.reducedMotion = st.reducedMotion ? '1' : '';
  ctx.audio.refresh();
  ctx.rerender();
}

/**
 * Apply a volume while the slider is dragged (not persisted until the change event).
 * @param {object} ctx
 * @param {'musicVolume'|'fxVolume'} key
 * @param {number} value 0..1
 */
function applyVolumeLive(ctx, key, value) {
  const settings = ctx.store.get().settings;
  const st = { ...normalizeSettings(settings), ...normalizeVolumes(settings), [key]: value };
  ctx.audio.setVolumes(st.musicVolume, st.fxVolume, st.sound);
}

/**
 * Volume slider of the options screen (options_def: the label on header_framer_small, slider_comp on
 * slider_bg with slider_button), 0-100.
 * @param {object} ctx
 * @param {{key: 'musicVolume'|'fxVolume', label: string, value: number}} o
 * @returns {HTMLElement}
 */
function sliderRow(ctx, o) {
  const valueEl = h('span.num.slider-value', null, String(volumeToSlider(o.value)));
  const input = /** @type {HTMLInputElement} */ (h('input.volume-slider.opt-slider', {
    type: 'range', min: '0', max: '100', step: '1', value: String(volumeToSlider(o.value)),
    'aria-label': o.label,
    onInput: () => {
      const v = sliderToVolume(input.value);
      valueEl.textContent = String(volumeToSlider(v));
      input.style.setProperty('--fill', `${volumeToSlider(v)}%`);
      applyVolumeLive(ctx, o.key, v);
    },
    onChange: () => {
      const v = sliderToVolume(input.value);
      setSettings(ctx, { [o.key]: v });
      if (o.key === 'fxVolume') ctx.sfx('ui_button_switch');
    },
  }));
  input.style.setProperty('--fill', `${volumeToSlider(o.value)}%`);
  return h('div.setting-row.opt-row', { dataset: { setting: o.key } },
    h('div.opt-label', null, h('span.setting-label', null, o.label), valueEl),
    input);
}

/**
 * Preset slider (the client's push-notification slider with Off / Important / On under it), used here for the
 * battle speed: one stop per preset.
 * @param {object} ctx
 * @param {{key: string, label: string, presets: number[], labels: string[], value: number}} o
 * @returns {HTMLElement}
 */
function presetRow(ctx, o) {
  const index = Math.max(0, o.presets.indexOf(o.value));
  const input = /** @type {HTMLInputElement} */ (h('input.opt-slider.preset-slider', {
    type: 'range', min: '0', max: String(o.presets.length - 1), step: '1', value: String(index),
    'aria-label': o.label,
    onChange: () => setSettings(ctx, { [o.key]: o.presets[Number(input.value) | 0] }),
  }));
  input.style.setProperty('--fill', `${o.presets.length > 1 ? (index / (o.presets.length - 1)) * 100 : 0}%`);
  return h('div.setting-row.opt-row', { dataset: { setting: o.key } },
    h('div.opt-label', null, h('span.setting-label', null, o.label)),
    input,
    h('div.opt-presets', null, o.labels.map((l, i) => h('span', { class: i === index && 'on' }, l))));
}

/**
 * On/Off toggle row.
 * @param {object} ctx
 * @param {{key: string, label: string, hint: string, value: boolean}} o
 * @returns {HTMLElement}
 */
function toggleRow(ctx, o) {
  return h('div.setting-row', { dataset: { setting: o.key } },
    h('div.setting-text', null, h('span.setting-label', null, o.label), h('span.setting-hint.muted', null, o.hint)),
    h('button.toggle', { type: 'button', role: 'switch', 'aria-checked': o.value ? 'true' : 'false', class: o.value && 'on', 'aria-label': o.label, onClick: () => setSettings(ctx, { [o.key]: !o.value }) },
      h('span.toggle-knob'), h('span.toggle-text', null, o.value ? 'On' : 'Off')));
}

/**
 * Download the save as JSON.
 * @param {object} ctx
 */
function exportSave(ctx) {
  const json = serializeSave(ctx.store.get());
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: saveFileName(ctx.now()), style: { display: 'none' } });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
  ctx.ui.toast('Save exported', { icon: 'cards' });
}

/**
 * Pick a JSON file and import it (after validation and a confirm).
 * @param {object} ctx
 * @param {HTMLInputElement} input
 */
async function importSave(ctx, input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  const text = await file.text();
  const res = parseSaveFile(text);
  if (!res.ok) { await ctx.ui.dialog.alert({ title: 'Import failed', message: res.error }); return; }
  const ok = await ctx.ui.dialog.confirm({
    title: 'Import save',
    message: `Replace your current progress with "${res.save.player.name || 'Evoker'}" (level ${res.save.player.level}, ${res.save.cards.length} cards)? This cannot be undone.`,
    okLabel: 'Import', danger: true,
  });
  if (!ok) return;
  ctx.store.set(migrate(res.save, ctx.now()));
  ctx.ui.toast('Save imported', { icon: 'cards' });
  ctx.goTop('character');
}

/**
 * Reset progress with a double confirm.
 * @param {object} ctx
 */
async function resetProgress(ctx) {
  const first = await ctx.ui.dialog.confirm({ title: 'Reset progress', message: 'Delete your whole progress and start over? All cards, gold and gems will be lost.', okLabel: 'Reset', danger: true });
  if (!first) return;
  const second = await ctx.ui.dialog.confirm({ title: 'Are you sure?', message: 'This really cannot be undone. Reset everything now?', okLabel: 'Yes, reset', danger: true });
  if (!second) return;
  const dbg = typeof window !== 'undefined' && window.evoker && window.evoker.debug;
  if (dbg && typeof dbg.reset === 'function') { dbg.reset(); return; }
  const old = ctx.store.get();
  const seed = (ctx.now() ^ (old.seed || 0)) >>> 0;
  // a reset replays the first-session tutorial (the name is asked again on the first Arena visit)
  ctx.store.set(newTutorialGame(seed, ctx.now(), ctx.deps));
  ctx.ui.toast('Progress reset');
  ctx.goTop('quest-map');
}

/** The app version (src/app.js VERSION), '' outside the app. */
const appVersion = () => (typeof window !== 'undefined' && window.evoker && window.evoker.version) || '';

/**
 * About box behind the info button of the options header (the client's privacy button).
 * @param {object} ctx
 */
function showAbout(ctx) {
  const v = appVersion();
  ctx.ui.dialog.alert({
    title: 'Evoker',
    message: `An offline fan recreation of flaregames' Evoker (client 1.7.4)${v ? `, v${v}` : ''}. Your progress is saved in this browser only.`,
  });
}

/**
 * Options (ui.screens.settings: options_def + the social box under it). The client's box holds Music Volume,
 * FX Volume and Push Notifications (Off / Important / On) under the "Options" header with the version and the
 * privacy button; the social box below held Google / Facebook. Here the third slider is the battle speed and
 * the lower box holds the offline game's own settings: sound on/off, simulated raids, reduced motion, export /
 * import of the save and the reset.
 * @param {object} ctx
 * @returns {HTMLElement}
 */
export function settingsView(ctx) {
  const st = { ...normalizeSettings(ctx.store.get().settings), ...normalizeVolumes(ctx.store.get().settings) };
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', class: 'hidden', onChange: () => importSave(ctx, fileInput) });
  const version = appVersion() ? `v ${appVersion()}` : '';
  return h('div.tab-settings', null,
    h('div.opt-header', null,
      h('button.pvp-info.opt-about', { type: 'button', 'aria-label': 'About', title: 'About', onClick: () => showAbout(ctx) }, sprite('info_icon', { class: 'pvp-info-icon' })),
      h('div.opt-title', null, 'Options'),
      h('div.opt-version.settings-version', null, version)),
    h('div.opt-box.settings-group', null,
      sliderRow(ctx, { key: 'musicVolume', label: 'Music Volume', value: st.musicVolume }),
      sliderRow(ctx, { key: 'fxVolume', label: 'FX Volume', value: st.fxVolume }),
      presetRow(ctx, { key: 'speed', label: 'Battle speed', presets: SPEEDS, labels: SPEEDS.map((sp) => `${sp}×`), value: st.speed })),
    h('div.opt-box.opt-more.settings-group', null,
      toggleRow(ctx, { key: 'sound', label: 'Sound', hint: 'Music and sound effects.', value: st.sound }),
      toggleRow(ctx, { key: 'raids', label: 'Simulated raids', hint: 'Other players may steal a card piece per day.', value: st.raids }),
      toggleRow(ctx, { key: 'reducedMotion', label: 'Reduced motion', hint: 'Shorter animations and no flips.', value: st.reducedMotion }),
      h('div.opt-sep'),
      h('div.settings-actions', null,
        button('Export save', { size: 'sm', onClick: () => exportSave(ctx) }),
        button('Import save', { size: 'sm', onClick: () => fileInput.click() }),
        button('Reset progress', { size: 'sm', variant: 'red', onClick: () => resetProgress(ctx) }),
        fileInput)));
}
