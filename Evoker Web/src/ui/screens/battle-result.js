'use strict';
/**
 * Post-battle flow of the battle screen, ported from the 1.7.4 client (DECISIONS D5):
 *
 *  1. Banner (ui.effects.fx_wonlost): hud_victory / hud_defeat / hud_drawd zooms 3x -> 1x over 900 ms over the
 *     frozen battlefield, a blurred copy flashes out (x4, 1.2 s), the banner fades over 2.1 s; fx_glow03/04
 *     expand from 660 ms for 3 s (from a dot on a victory, from 3x otherwise). The flow goes on at 3.66 s.
 *  2. Loot (ui.components.reward_comp; quests: victory only, PvP: any gold): the keyframe animation at speed 1.2
 *     (goldreward / gemreward / manapotion / staminapotion / cardreward with the card in its template slot),
 *     quest_reward_* sounds; gold and gems fly to the purse as a number; a card is then shown full size until
 *     tapped and, when new to its set, the "Card added to set: X n/8" plate slides in. A card piece (reOM
 *     @ 1:07-1:11, round3/gameplay-feel.md §4) appears in the animation as the dark card with the white puzzle
 *     cut-out (card art under card_piece_overlay_thumb), then the full card with its puzzle overlay (owned
 *     pieces lit, missing ones dark) for PIECE_CARD_MS or until tapped.
 *  3. Card XP (ui.screens.bosscardresult / pvpcardresult with comp_pvpresult_card_entry): the deck's cards in
 *     a zigzag (cards left, right, left, ...), each with the violet XP bar labelled "Level n" ("Level n (MAX)");
 *     one card per second fades in (500 ms, ui_card_xpgain) and its bar slides to the new XP (150 ms). A card
 *     that levelled up opens the card level-up popup (comp_levelup_card) and the sequence waits for it. A tap
 *     shows every remaining bar at once (stopping at a level-up). Then Continue (quests, hud_bigbutton04) or
 *     Proceed (PvP, hud_bigbutton03) fades in on the seperator_big stripe at the bottom.
 *  4. Continue -> the player level-up dialogs through one hook, showPlayerLevelUps(ctx, levels), then onDone.
 *
 * The card level-up popup (comp_levelup_card): the card art at 85 % of the screen behind a black 75 % dim,
 * "Level up!" fades then zooms in, then the rows Level / Attack / HP / Skill ("from -> to", 500 ms each) and
 * the pulsing "Tap to continue" hint; ui_card_level_up; any tap fades it out (500 ms).
 *
 * The pure part (timings, loot, XP entries, level-up rows) lives in battle-result-model.js.
 */
import { h, fmt, sprite, wait } from '../dom.js';
import { renderCard } from '../components/card.js';
import { loadAnim, playAnim } from '../anim-player.js';
import { setProgressFor } from '../../game/shop.js';
import {
  BANNER, BANNER_MS, XP_STAGGER_MS, XP_FADE_MS, XP_BAR_MS, REWARD_SPEED, REWARD_TAP_AFTER_MS, SETPLATE_MS, PIECE_CARD_MS,
  LEVELUP_STEP_MS, CX, CY, rewardAnimName, rewardIcon, tokenName, rewardSounds, lootList, xpEntries, levelText, entryLayout,
  levelUpRows, pieceProgress,
} from './battle-result-model.js';

/**
 * THE PLAYER LEVEL-UP HOOK: shows the player level-up dialog for every level reached, in order, after the card
 * XP screen, through `ctx.ui.showPlayerLevelUp(level, {index, count})` (the comp_levelup dialog of
 * src/ui/components/popup-levelup.js; `index`/`count` let a multi-level jump offer each level's points in its own
 * dialog). Without that hook (tests) nothing is shown.
 * @param {object} ctx  screen context
 * @param {number[]} levels  levels reached (src/game/player.js addPlayerXp levelUps)
 * @returns {Promise<void>}
 */
export async function showPlayerLevelUps(ctx, levels) {
  const ui = (ctx && ctx.ui) || {};
  const list = levels || [];
  for (let i = 0; i < list.length; i++) {
    const lvl = list[i];
    try {
      if (typeof ui.showPlayerLevelUp === 'function') await ui.showPlayerLevelUp(lvl, { index: i, count: list.length });
    } catch (err) { console.error(err); }
  }
}

/* ------------------------------------------------------------------ DOM */

/**
 * The fx_wonlost banner.
 * @param {'victory'|'defeat'|'draw'} kind
 * @returns {HTMLElement}
 */
function renderBanner(kind) {
  const title = kind === 'victory' ? 'Victory' : kind === 'defeat' ? 'Defeat' : 'Draw';
  return h('div.wonlost', { class: kind, role: 'img', 'aria-label': title, style: { '--zoom': `${BANNER.zoom}ms`, '--glow-start': `${BANNER.glowStart}ms`, '--glow': `${BANNER.glow}ms`, '--blur': `${BANNER.blur}ms`, '--fade': `${BANNER.fade}ms` } },
    h('div.wonlost-glow.g4'), h('div.wonlost-glow.g3'),
    h('div.wonlost-img.center'), h('div.wonlost-img.blur'),
    h('span.wonlost-title', null, title));
}

/**
 * The XP bar of a result entry (violet hud_progressbarviolet03 on the 3-slice track, xp star at its left end).
 * @param {{level: number, max: boolean, ratio: number}} bar
 * @returns {HTMLElement & {set: (bar: object, ms?: number) => void}}
 */
function renderXpBar(bar) {
  const fill = h('div.xp-fill');
  const label = h('div.xp-label');
  const el = /** @type {any} */ (h('div.result-xpbar', null, h('div.xp-track', null, fill, label), sprite('hud_experienceicon01', { class: 'xp-icon' })));
  el.set = (b, ms = 0) => {
    fill.style.transitionDuration = `${ms}ms`;
    fill.style.transform = `scaleX(${Math.max(0.0001, b.ratio).toFixed(4)})`;
    label.textContent = levelText(b);
  };
  el.set(bar, 0);
  return el;
}

/**
 * Card level-up popup (comp_levelup_card + ctrl_cardlevelup). Resolves after the tap and the fade.
 * @param {HTMLElement} parent
 * @param {{artUrl?: string, name?: string, rarity?: string, rows: {kind: string, from: number, to: number}[], sfx?: (n: string) => void, fast?: boolean}} o
 * @returns {Promise<void> & {el: HTMLElement}}
 */
function showCardLevelUp(parent, o) {
  const icons = { level: 'hud_experienceicon01', attack: 'hud_fighticon02', hp: 'hud_healthicon01', skill: 'hud_specialskill01' };
  const step = o.fast ? 1 : LEVELUP_STEP_MS;
  const rows = (o.rows || []).map((r, i) => h('div.clu-row', { class: r.kind, style: { animationDelay: `${(2 + i) * step}ms`, animationDuration: `${step}ms` } },
    h('div.clu-from', null, sprite(icons[r.kind] || icons.level, { class: 'clu-icon' }), h('span.num', null, fmt(r.from))),
    sprite('levelup_arrow_icon', { class: 'clu-arrow' }),
    h('div.clu-to', null, sprite(icons[r.kind] || icons.level, { class: 'clu-icon big' }), h('span.num', null, fmt(r.to)))));
  const tapDelay = (2 + rows.length) * step;
  const el = h('div.card-levelup', { role: 'dialog', 'aria-modal': 'true', 'aria-label': `${o.name || 'Card'}: Level up!`, tabIndex: 0, style: { '--step': `${step}ms` } },
    h('div.clu-card', { class: o.rarity && `rarity-${o.rarity}` }, o.artUrl ? h('img', { src: o.artUrl, alt: o.name || '', draggable: 'false' }) : null),
    h('div.clu-title', null, 'Level up!'),
    h('div.clu-rows', null, rows),
    h('div.clu-tap', { style: { animationDelay: `${tapDelay}ms` } }, 'Tap to continue'),
    sprite('hud_tapfeedback01', { class: 'clu-finger-bg', style: { animationDelay: `${tapDelay}ms` } }),
    sprite('hud_tapindicator01', { class: 'clu-finger', style: { animationDelay: `${tapDelay}ms` } }));
  let resolveFn;
  const promise = /** @type {any} */ (new Promise((r) => { resolveFn = r; }));
  let closing = false;
  const close = (ev) => {
    if (ev) { ev.stopPropagation(); ev.preventDefault(); }
    if (closing) return;
    closing = true;
    if (o.sfx) o.sfx('ui_button_card_close');
    window.removeEventListener('keydown', onKey, true);
    el.classList.add('closing');
    setTimeout(() => { el.remove(); resolveFn(); }, o.fast ? 1 : 500);
  };
  const onKey = (ev) => { if (['Enter', ' ', 'Escape'].includes(ev.key)) close(ev); };
  el.addEventListener('click', close);
  window.addEventListener('keydown', onKey, true);
  parent.appendChild(el);
  if (o.sfx) o.sfx('ui_card_level_up');
  setTimeout(() => { try { el.focus({ preventScroll: true }); } catch (err) { /* ignore */ } }, 30);
  promise.el = el;
  return promise;
}

/**
 * Run the whole post-battle flow inside the battle screen root.
 * @param {object} o
 * @param {HTMLElement} o.root          battle screen root (positioned, 720x1280)
 * @param {object} o.ctx                screen context
 * @param {object} o.p                  battle params (info, before, cardXp, cardLevelUps, levelUps, mode, ...)
 * @param {'victory'|'defeat'|'draw'} o.kind
 * @param {(name: string) => void} [o.sfx]
 * @param {boolean} [o.pvp]
 * @param {() => void} o.onFinish       called after Continue and the player level-ups
 * @returns {{el: HTMLElement, destroy: () => void}}
 */
export function runPostBattle(o) {
  const { root, ctx, p, kind } = o;
  const sfx = o.sfx || (() => {});
  const { deps, db, view: views } = ctx;
  let destroyed = false;
  let phase = 'banner';
  let onTap = null;
  const timers = new Set();
  const later = (ms, fn) => { const id = setTimeout(() => { timers.delete(id); if (!destroyed) fn(); }, ms); timers.add(id); return id; };
  const sleep = (ms) => new Promise((r) => later(ms, r));

  // tools and the smoke run look for `.battle-result[data-result]`
  const overlay = h('div.battle-result', { class: kind, dataset: { result: kind, phase }, role: 'dialog', 'aria-modal': 'true', 'aria-label': kind === 'victory' ? 'Victory!' : kind === 'defeat' ? 'Defeat' : 'Draw', tabIndex: 0 });
  root.appendChild(overlay);
  overlay.addEventListener('click', () => { if (onTap) onTap(); });
  const setPhase = (ph) => { phase = ph; overlay.dataset.phase = ph; };

  /* ---- 1. banner ---- */
  async function banner() {
    const el = renderBanner(kind);
    overlay.appendChild(el);
    await new Promise((resolve) => {
      const id = later(BANNER_MS, resolve);
      onTap = () => { clearTimeout(id); timers.delete(id); resolve(); };
    });
    onTap = null;
    el.classList.add('done');
    later(400, () => el.remove());
  }

  /* ---- result screen scaffold ---- */
  const screen = h('div.result-screen', { class: o.pvp && 'pvp' });
  // the quest's landscape (PvP: the arena painting), 10 % overscan, under a 50 % black
  screen.appendChild(h('div.result-bg', { class: o.pvp ? 'arena' : 'quest' }));
  const entriesBox = h('div.result-entries');
  const stripe = h('div.result-stripe');
  const continueBtn = h('button.result-continue', { type: 'button', class: o.pvp && 'proceed', disabled: true }, o.pvp ? 'Proceed' : 'Continue');
  stripe.appendChild(continueBtn);
  screen.append(h('div.result-dim'), entriesBox, stripe);

  /* ---- 2. loot ---- */
  async function loot(reward) {
    const name = rewardAnimName(reward);
    const anim = name ? await loadAnim(name) : null;
    if (destroyed || !anim) return;
    setPhase('loot');
    const snd = rewardSounds(reward);
    const layer = h('div.result-loot');
    screen.appendChild(layer);
    let cardEl = null;
    const def = reward.cardId && db ? db.get(reward.cardId) : null;
    const view = def ? views.defView(def, reward.stage || 0, reward.level || 1) : null;
    if ((reward.type === 'card' || reward.type === 'piece') && view) {
      const art = h('img', { src: view.artUrl || view.artFallbackUrl || '', alt: view.name, draggable: 'false' });
      cardEl = reward.type === 'piece'
        ? h('div.reward-card.piece', { class: `rarity-${view.rarity}` }, art, sprite('card_piece_overlay_thumb', { class: 'reward-piece-overlay' }))
        : h('div.reward-card', { class: `rarity-${view.rarity}` }, art, h('span.reward-new', null, 'NEW'));
    }
    if (snd.show) sfx(snd.show);
    // "Card added to set: X n/8" slides in at the top while the reward animation runs (bz2_0050.5)
    const plate = setPlate(reward);
    if (plate) screen.appendChild(plate);
    const iconName = rewardIcon(reward);
    let icon = iconName ? sprite(iconName, { class: 'reward-object' }) : null;
    if (!icon && reward.type === 'token') {
      // portal tokens: the shop's triangle (sand = low, violet = high) with the token's glow and sparkles
      icon = h('div.reward-object.reward-token-tri', { class: reward.token === 'portalHigh' ? 'high' : 'low' }, h('span.tri'));
    }
    if (icon) layer.appendChild(icon);
    if (reward.type === 'token') {
      const count = Number(reward.count) > 1 ? `${reward.count} x ` : '';
      layer.appendChild(h('div.reward-caption', null, `${count}${tokenName(reward, deps)}`));
    }
    const run = playAnim(layer, anim, { speed: REWARD_SPEED, templates: { result: cardEl }, x: CX, y: CY });
    const t0 = Date.now();
    onTap = () => { if (Date.now() - t0 >= REWARD_TAP_AFTER_MS) run.stop(); };
    await run.done;
    onTap = null;
    if (destroyed) return;
    if (snd.taken) sfx(snd.taken);
    if (icon) icon.classList.add('taken');
    if (reward.type === 'gold' || reward.type === 'gems' || (reward.type === 'card' && reward.converted)) {
      const amount = reward.type === 'gems' ? reward.gems : reward.gold;
      if (amount > 0) {
        const fly = h('div.reward-fly', { class: [reward.type, reward.bonus && 'bonus'] }, `+${fmt(amount)}`);
        layer.appendChild(fly);
        await sleep(800);
      }
    } else if (view && (reward.type === 'card' || reward.type === 'piece')) {
      await fullCard(view, reward);
    }
    layer.classList.add('taken');
    await sleep(300);
    layer.remove();
  }

  /**
   * The reward card full size (comp_cardfullscreen_v3, onlyZoomButton) until tapped; set plate when new. A card
   * piece shows the card with its puzzle overlay (pieceOverlay) for PIECE_CARD_MS or until tapped.
   */
  async function fullCard(view, reward) {
    setPhase('card');
    const pieces = reward.type === 'piece' ? pieceOverlay(reward) : null;
    const box = h('div.result-fullcard', { class: pieces && 'piece', role: 'button', tabIndex: 0, 'aria-label': `${view.name}: tap to continue` },
      renderCard(view, pieces ? { size: 'detail', showStats: false, pieces } : { size: 'detail', showStats: false }),
      pieces ? null : h('div.result-fullcard-tap', null, 'Tap to continue'));
    screen.appendChild(box);
    // the fight result has shown the card: callers skip their own celebration (arena's "Card complete!")
    if (p.info && typeof p.info === 'object') p.info.rewardShown = true;
    await new Promise((resolve) => {
      onTap = resolve;
      box.addEventListener('click', (ev) => { ev.stopPropagation(); resolve(); });
      if (pieces) later(PIECE_CARD_MS, resolve);
    });
    onTap = null;
    box.classList.add('closing');
    await sleep(250);
    box.remove();
  }

  /** The hunt's pieces after a piece reward ({owned, total}), or null once the card is complete. */
  function pieceOverlay(reward) {
    if (reward.completed) return null;
    return pieceProgress(ctx.store.get(), reward);
  }

  /** "Card added to set: X n/8" (new_card_notify_comp) for a card new to its collection set. */
  function setPlate(reward) {
    if (reward.type !== 'card' || reward.converted) return null;
    const state = ctx.store.get();
    if (!state || state.cards.filter((c) => c.cardId === reward.cardId).length !== 1) return null;
    let sa = null;
    try { sa = setProgressFor(state, deps, reward.cardId); } catch (err) { sa = null; }
    if (!sa || !(sa.total > 0)) return null;
    const pct = (n) => `${Math.max(0, Math.min(100, (n / sa.total) * 100))}%`;
    // the bar fills from the count before this card to the new count once the plate is in (animateProgress)
    const fill = h('div.result-setplate-fill', { style: { width: pct(sa.owned - 1) } });
    const count = h('span.num', null, `${Math.max(0, sa.owned - 1)}/${sa.total}`);
    const plate = h('div.result-setplate', null,
      h('div.result-setplate-label', null, 'Card added to set:'),
      h('div.result-setplate-name', null, sa.name),
      h('div.result-setplate-bar', null, fill, count));
    later(SETPLATE_MS.in, () => { fill.style.width = pct(sa.owned); count.textContent = `${sa.owned}/${sa.total}`; });
    later(SETPLATE_MS.in + SETPLATE_MS.hold + SETPLATE_MS.out + 100, () => plate.remove());
    return plate;
  }

  /* ---- 3. card XP ---- */
  async function cardXp() {
    const state = ctx.store.get();
    const before = Array.isArray(p.before) ? p.before : [];
    const entries = xpEntries(before, state, deps, p.cardLevelUps || (p.info && p.info.cardLevelUps) || []);
    if (!entries.length) return;
    setPhase('xp');
    const rows = entries.slice(0, 5).map((e, i) => {
      const pos = entryLayout(i);
      const inst = state && state.cards ? state.cards.find((c) => c.uid === e.uid) : null;
      const def = db.get(e.cardId);
      const view = inst ? views.cardView({ ...inst, level: e.from.level }, def) : views.defView(def, e.stage, e.from.level);
      const bar = renderXpBar(e.from);
      const el = h('div.result-entry', { class: pos.side, dataset: { uid: e.uid }, style: { left: `${pos.x}px`, top: `${pos.y}px` } },
        h('div.result-entry-card', null, renderCard(view, { size: 'battle', side: 'bottom' })), bar);
      entriesBox.appendChild(el);
      return { e, el, bar, inst, def, done: false };
    });
    let skip = false;
    onTap = () => { skip = true; };
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!skip) {
        if (i > 0) await sleepUnless(XP_STAGGER_MS - XP_FADE_MS, () => skip);
        sfx(['ui_card_xpgain1', 'ui_card_xpgain2', 'ui_card_xpgain4'][i % 3]);
        r.el.classList.add('shown');
        await sleepUnless(XP_FADE_MS, () => skip);
      } else r.el.classList.add('shown', 'instant');
      if (destroyed) return;
      r.bar.set(r.e.to, skip ? 0 : XP_BAR_MS);
      r.done = true;
      if (r.e.levelled) {
        onTap = null;
        await sleep(skip ? 50 : XP_BAR_MS + 50);
        const view = views.defView(r.def, r.e.stage, r.e.to.level);
        await showCardLevelUp(overlay, {
          artUrl: view.artUrl || view.artFallbackUrl, name: r.e.name, rarity: view.rarity,
          rows: levelUpRows(deps, r.inst || { cardId: r.e.cardId, stage: r.e.stage }, r.e.from.level, r.e.to.level), sfx,
        });
        if (destroyed) return;
        skip = false;
        onTap = () => { skip = true; };
      }
    }
    onTap = null;
  }
  /** Sleep that ends early once `cond()` turns true (polled). */
  async function sleepUnless(ms, cond) {
    const end = Date.now() + ms;
    while (!destroyed && !cond() && Date.now() < end) await sleep(Math.min(50, Math.max(1, end - Date.now())));
  }

  /* ---- 4. continue ---- */
  async function showContinue() {
    setPhase('continue');
    continueBtn.disabled = false;
    stripe.classList.add('shown');
    try { continueBtn.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
    await new Promise((resolve) => {
      const go = (ev) => { if (ev) ev.stopPropagation(); sfx('ui_button_start'); resolve(); };
      continueBtn.addEventListener('click', go, { once: true });
    });
  }

  async function flow() {
    await banner();
    if (destroyed) return;
    // quests reward only a victory (the fight info carries no reward otherwise); PvP shows its gold either way
    const rewards = kind === 'victory' || o.pvp ? lootList(p) : [];
    const hasXp = Array.isArray(p.before) && p.before.length;
    if (!rewards.length && !hasXp) { finish(); return; }
    overlay.appendChild(screen);
    await wait(30);
    screen.classList.add('shown');
    for (const reward of rewards) {
      await loot(reward);
      if (destroyed) return;
    }
    if (hasXp) await cardXp();
    if (destroyed) return;
    await showContinue();
    if (destroyed) return;
    finish();
  }

  let finished = false;
  async function finish() {
    if (finished || destroyed) return;
    finished = true;
    setPhase('levelup');
    await showPlayerLevelUps(ctx, p.levelUps || (p.info && p.info.levelUps) || []);
    if (!destroyed) o.onFinish();
  }

  flow().catch((err) => { console.error(err); finish(); });
  return {
    el: overlay,
    destroy() { destroyed = true; for (const id of timers) clearTimeout(id); timers.clear(); },
  };
}
