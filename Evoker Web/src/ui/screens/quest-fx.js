'use strict';
/**
 * The effects of the quest screen (quest.js), built once per render: the HUD gold that counts up with the taps
 * (bursts / end gold held back for the wave's coin shower), the tap's X-slash with "PERFECT" and the gold number,
 * reward bursts, the goldreward coin shower and the card drop on the scene. Timings: quest-model.js TAP_FX,
 * TAP_GOLD_COUNT, GOLD_SHOWER, CARD_DROP.
 */
import { h, fmt, wait, spriteUrl } from '../dom.js';
import { loadAnim, playAnim } from '../anim-player.js';
import { tutorial } from '../tutorial/manager.js';
import {
  burstInfo, rewardSprite, goldSteps, tapFeedback, PERFECT, TAP_FX, GOLD_SHOWER, TAP_GOLD_COUNT, CARD_DROP,
} from './quest-model.js';

/**
 * The HUD gold of the quest screen: it counts up with every tap (TAP_GOLD_COUNT); burst / end gold already in the
 * save is held and counted up by the coin shower (GOLD_SHOWER). Wraps `hud.update` so that store refreshes show
 * the counted value.
 * @param {object} ctx
 * @param {HTMLElement & {update: (patch: object) => void}} hud  the chrome's HUD
 * @returns {{hold: (gold: number) => void, held: () => number, tap: () => void, release: () => Promise<void>}}
 */
export function createGoldCounter(ctx, hud) {
  const realGold = () => { const st = ctx.store.get(); return st && st.player ? st.player.gold : 0; };
  let shownGold = realGold();
  /** burst / end gold already in the save but not yet shown (released by the coin shower) */
  let heldGold = 0;
  let countTimer = null;
  const update = hud.update;
  hud.update = (patch) => update(patch && 'gold' in patch ? { ...patch, gold: shownGold } : patch);
  const showGold = (v) => { shownGold = v; hud.update({ gold: v }); };
  return {
    hold: (gold) => { heldGold += Math.max(0, Number(gold) || 0); },
    held: () => heldGold,
    /** After a tap: count the HUD up to the saved gold minus what the coin shower still holds (TAP_GOLD_COUNT). */
    tap() {
      if (countTimer) { clearInterval(countTimer); countTimer = null; }
      const steps = goldSteps(shownGold, realGold() - heldGold, TAP_GOLD_COUNT.steps);
      if (!steps.length) return;
      showGold(steps.shift());
      if (!steps.length) return;
      countTimer = setInterval(() => {
        if (!steps.length || !ctx.root.isConnected) { clearInterval(countTimer); countTimer = null; return; }
        showGold(steps.shift());
      }, TAP_GOLD_COUNT.stepMs);
    },
    /** Step the HUD gold up to the saved value (GOLD_SHOWER). */
    async release() {
      if (countTimer) { clearInterval(countTimer); countTimer = null; }
      heldGold = 0;
      for (const v of goldSteps(shownGold, realGold())) {
        showGold(v);
        await wait(GOLD_SHOWER.stepMs);
      }
    },
  };
}

/**
 * The effects on the quest scene.
 * @param {{ctx: object, body: HTMLElement, landscape: HTMLElement, arena: HTMLElement, tray: HTMLElement,
 *   gold: ReturnType<typeof createGoldCounter>}} o
 *   body: the screen body (the card drop's layer), landscape: the scene, arena: the minions' layer, tray: the
 *   bottom band with the minideck
 */
export function createQuestFx({ ctx, body, landscape, arena, tray, gold }) {
  let tapNumbers = 0;

  /** Stage px of an element's centre inside the landscape. */
  function centreIn(el) {
    let x = 0, y = 0, node = el;
    while (node && node !== landscape) { x += node.offsetLeft; y += node.offsetTop; node = node.offsetParent; }
    return { x: x + el.offsetWidth / 2, y: y + el.offsetHeight * 0.45 };
  }

  /**
   * The tap: an orange X-slash (two hud_explosion03 streaks crossing over the hud_explosion01 sparks) at the
   * minion, gold "PERFECT" above it, the tap's gold as a small white number at the top right of the scene.
   * @param {{x: number, y: number}} at  landscape px
   * @param {object} info  tapMinion result
   */
  function tapFx(at, info) {
    const fb = tapFeedback(info);
    const slash = h('div.quest-slash', { style: { left: at.x + 'px', top: at.y + 'px', '--dur': `${TAP_FX.slashMs}ms` } },
      h('img.qs-spark', { src: spriteUrl('hud_explosion01'), alt: '', draggable: 'false' }),
      h('img.qs-a', { src: spriteUrl('hud_explosion03'), alt: '', draggable: 'false' }),
      h('img.qs-b', { src: spriteUrl('hud_explosion03'), alt: '', draggable: 'false' }));
    landscape.appendChild(slash);
    setTimeout(() => slash.remove(), TAP_FX.slashMs + 60);
    if (fb.perfect) {
      const label = h('div.quest-perfect', { style: { left: at.x + 'px', top: (at.y - 120) + 'px', '--dur': `${TAP_FX.perfectMs}ms` } }, PERFECT);
      landscape.appendChild(label);
      setTimeout(() => label.remove(), TAP_FX.perfectMs + 60);
    }
    const text = [fb.tapText, fb.burstText].filter(Boolean).join(' ').replace(/\+/g, '');
    if (text) {
      const k = tapNumbers++ % 3;
      const num = h('div.quest-tapnum', { class: fb.burstText && 'burst', style: { right: (24 + k * 64) + 'px', '--dur': `${TAP_FX.numberMs}ms` } }, text);
      landscape.appendChild(num);
      setTimeout(() => { num.remove(); tapNumbers = Math.max(0, tapNumbers - 1); }, TAP_FX.numberMs + 60);
    }
  }

  /** Show a reward burst in the landscape (wave rewards other than a card). */
  function burst(reward) {
    const info = burstInfo(reward);
    const el = h('div.quest-burst', { class: reward.type },
      h('img.quest-burst-glow', { src: spriteUrl('reward_glow_yellow'), alt: '', draggable: 'false' }),
      h('img.quest-burst-sprite', { src: rewardSprite(reward), alt: '', draggable: 'false' }),
      h('div.quest-burst-text', null, info.title));
    landscape.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }

  /** The wave-end coin shower (goldreward) while the HUD gold counts up to the saved value (held bursts / end gold). */
  async function coinShower() {
    if (gold.held() <= 0) { gold.tap(); return; }
    ctx.sfx('rewardGold');
    loadAnim('goldreward').then((anim) => {
      if (!anim || !landscape.isConnected) return;
      const p = playAnim(landscape, anim, { className: 'quest-coinfx shower' });
      p.done.then(() => p.el.remove());
    });
    await wait(Math.round(GOLD_SHOWER.ms * 0.25));
    await gold.release();
  }

  /** Stage-px box of an element relative to the screen body. */
  function boxIn(el) {
    const scale = ctx.ui.stage.getScale() || 1;
    const a = el.getBoundingClientRect();
    const b = body.getBoundingClientRect();
    return { x: (a.left - b.left) / scale, y: (a.top - b.top) / scale, w: a.width / scale, h: a.height / scale };
  }

  /**
   * The card drop on the scene (CARD_DROP): a glint where the last minion stood, a white flash at the centre
   * that turns into the glowing, rarity-framed card, a hold with nothing to tap, then the card flies into
   * the minideck. Resolves when it has landed.
   * @param {object} reward  card reward
   * @param {{x: number, y: number}|null} at  landscape px of the last minion
   */
  async function cardDrop(reward, at) {
    const def = ctx.deps.db.get(reward.cardId);
    if (!def) return;
    try { await dropCard(def, reward, at); } finally { arena.classList.remove('dropping'); }
  }

  /**
   * The drop itself (cardDrop).
   * @param {object} def
   * @param {object} reward
   * @param {{x: number, y: number}|null} at
   */
  async function dropCard(def, reward, at) {
    const view = ctx.view.defView(def, reward.stage || 0, reward.level || 1);
    const layer = h('div.quest-drop', { dataset: { cardId: def.id } });
    body.appendChild(layer);
    // the scene empties for the drop (the minions fade out and come back after it)
    arena.classList.add('dropping');
    const land = boxIn(landscape);
    const glintAt = at ? { x: land.x + at.x, y: land.y + at.y } : { x: land.x + land.w / 2, y: land.y + land.h * 0.6 };
    layer.appendChild(h('img.qd-glint', { src: spriteUrl('lens_flare'), alt: '', draggable: 'false', style: { left: glintAt.x + 'px', top: glintAt.y + 'px', '--dur': `${CARD_DROP.glint}ms` } }));
    await wait(CARD_DROP.glint);
    if (!layer.isConnected) return;
    ctx.sfx('rewardCard');
    const cx = land.x + land.w / 2;
    const cy = land.y + land.h * 0.48;
    const label = reward.converted ? `${def.name} (sold: collection full)` : `New card: ${def.name}`;
    const card = h('div.qd-card', { class: `rarity-${view.rarity}`, role: 'img', 'aria-label': label, style: { left: cx + 'px', top: cy + 'px', '--flash': `${CARD_DROP.flash}ms`, '--reveal': `${CARD_DROP.reveal}ms` } },
      h('div.qd-rays'),
      h('div.qd-face', null, h('img', { src: view.artUrl || view.artFallbackUrl || '', alt: '', draggable: 'false' })),
      h('div.qd-white'));
    layer.appendChild(card);
    if (reward.soul) tutorial.say('soulCard');
    if (reward.converted) ctx.ui.toast(`${def.name} - your collection is full, it was sold for ${fmt(reward.gold)} gold.`, { icon: 'coin' });
    await wait(CARD_DROP.flash + CARD_DROP.reveal + CARD_DROP.hold);
    if (!layer.isConnected) return;
    // fly into the minideck (the first filled slot; the middle of the bar otherwise)
    const target = tray.querySelector('.qmd-slot.filled') || tray.querySelector('.quest-minideck') || tray;
    const t = boxIn(target);
    card.style.setProperty('--dx', `${Math.round(t.x + t.w / 2 - cx)}px`);
    card.style.setProperty('--dy', `${Math.round(t.y + t.h / 2 - cy)}px`);
    card.style.setProperty('--fly', `${CARD_DROP.fly}ms`);
    card.classList.add('fly');
    await wait(CARD_DROP.fly);
    layer.remove();
  }

  return { centreIn, tapFx, burst, coinShower, cardDrop };
}
