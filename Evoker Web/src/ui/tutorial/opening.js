'use strict';
/**
 * The opening of a new game, as the client's ui.controls.ctrl_intro chains it:
 *  1. intro_part1 (20 s keyframe animation: the peaceful village, the spell, the burned village, the Worm Shaman,
 *     the cards) with music_introvideo_part1 and the "Skip intro" label bottom-right; our captions show the intro
 *     lore of the loca table over its first three panels;
 *  2. the scripted fight (ui.controls.ctrl_intro_fight + assets/scripts/script_intro_fight.json): first the Worm
 *     Shaman's card in the boss frame (bossfight_preview at speed 1.2), then the board: his three cards against
 *     "You" with the Envoy alone; metallic_transition, the Attack! bar with its sparkle and, after 2 s, the hand;
 *     then two scripted rounds the player cannot win (no Defeat banner), drawn with the real fight's effects
 *     (src/ui/battle/fx.js, the same primitives as battle-player.js; user's request 2026-10-12);
 *  3. intro_part2 (6 s: the burning tower in its ring of runes, white flash) with music_introvideo_part2.
 * Then the caller opens the quest map. "Skip intro" is shown during part 1 only and ends part 1, like the client
 * (ctrl_intro; Benito 1.7.0 @ 0:08.9 skips, and the preview and the fight still follow - tutorial-v2.md §0).
 * Escape does nothing during the opening (the phone client had no such key; it is swallowed so it cannot navigate).
 */
import { h, wait } from '../dom.js';
import { renderCard, updateCardHp } from '../components/card.js';
import { hpBar } from '../components/bars.js';
import { attackBar } from '../components/buttons.js';
import { loadAnim, playAnim } from '../anim-player.js';
import { createFx, CARD_FX_CLASSES } from '../battle/fx.js';
import { createPicker } from '../battle/assets.js';
import { INTRO_FIGHT, INTRO_SOUNDS } from './intro-fight-script.js';
import { renderHand } from './overlay.js';

/** ctrl_intro_fight: the boss preview (bossfight_preview.json) plays at this speed with the Worm Shaman's card. */
export const PREVIEW_SPEED = 1.2;
/** The card of the preview (metadata "wurmschamane"). */
export const PREVIEW_CARD = 'worm-shaman';

/** The intro lore (exploration/apk/lua/assets.loca.en.txt values of the keys "Once, Demons ...", "But the eldest
 * Gods ...", "But dark omens ..."). */
export const INTRO_LORE = Object.freeze([
  'Once, demons and dragons ruled this world.',
  'But the eldest Gods intervened and forced them to swear an oath for 1,000 years of peace a thousand times over.',
  'But dark omens have foretold that the time when the oath will be broken is drawing near.',
]);
/** When each lore caption shows during intro_part1 (ms): the village, the burned village, the shaman panel. */
export const LORE_TIMES = Object.freeze([[300, 5000], [5400, 11000], [11400, 17200]]);
export const SKIP_INTRO = 'Skip intro';
/** Typewriter speed of the captions, ms per character. */
export const CAPTION_TYPE_MS = 32;
/** ctrl_intro_fight: the hand joins the Attack! sparkle after this long (view_shp_highlights delays 0 / 2000). */
export const ATTACK_HAND_DELAY = 2000;
/** comp_fight_v3 fadeInHud, then the gap before round 1, ms. */
export const FIGHT_HUD_MS = 1000;
export const ROUND_GAP_MS = 900;

/**
 * Card views of the intro fight (the script's card values: Throat-Cutter 300/100, Flinger 300/200, Lurking
 * Goblin 200/100, Envoy 100/100).
 * @param {object} ctx
 * @param {'enemy'|'player'} side
 * @returns {Array<object|null>}
 */
export function introCardViews(ctx, side) {
  const list = side === 'enemy' ? INTRO_FIGHT.enemyCards : INTRO_FIGHT.playerCards;
  const values = { 'throat-cutter': [300, 100], flinger: [300, 200], 'lurking-goblin': [200, 100], envoy: [100, 100] };
  return list.map((c, i) => {
    if (!c) return null;
    const def = ctx.deps.db.get(c.cardId);
    if (!def) return null;
    const view = ctx.view.defView(def, 0, c.level || 1, { uid: `${side}-${i + 1}` });
    const v = values[c.cardId];
    return v ? { ...view, attack: v[0], hp: v[1], maxHp: v[1] } : view;
  });
}

/**
 * Run the opening over `root` (the title screen element).
 * @param {object} ctx
 * @param {HTMLElement} root
 * @returns {Promise<{skipped: boolean}>}
 */
export function runOpening(ctx, root) {
  const { music, sfx } = ctx;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stageBox = h('div.tut-opening-stage');
  const skip = h('button.tut-skip.intro-skip', { type: 'button' }, SKIP_INTRO);
  const overlay = h('div.tut-opening', { role: 'dialog', 'aria-label': 'Intro' }, stageBox, skip);
  root.classList.add('intro-running');
  root.appendChild(overlay);

  let skipped = false;
  /** "Skip intro" ends part 1 only */
  let partSkipped = false;
  let endPart = () => {};
  let stopCurrent = () => {};
  /** @type {(v?: any) => void} */
  let wake = () => {};
  const skipPromise = new Promise((r) => { wake = r; });
  const onKey = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); } };
  const doSkipPart = () => {
    if (skipped || partSkipped || overlay.dataset.phase !== 'part1') return;
    partSkipped = true;
    sfx('music_introvideo_skip');
    try { stopCurrent(); } catch (err) { /* ignore */ }
    endPart();
  };
  skip.addEventListener('click', (ev) => { ev.stopPropagation(); doSkipPart(); });
  overlay.addEventListener('click', (ev) => ev.stopPropagation());
  window.addEventListener('keydown', onKey, true);
  /** Wait for a promise or the skip, whichever comes first. */
  const race = (p) => Promise.race([p, skipPromise]);

  async function part1() {
    overlay.dataset.phase = 'part1';
    music('music_introvideo_part1', { loop: false, fade: 0 });
    const partDone = new Promise((r) => { endPart = r; });
    /** Wait for a promise, the part skip or the whole skip. */
    const racePart = (pr) => Promise.race([pr, partDone, skipPromise]);
    const anim = await racePart(loadAnim('intro_part1'));
    if (skipped || partSkipped) return;
    const caption = h('p.tut-lore', { 'aria-live': 'polite' });
    const box = h('div.tut-anim-box');
    stageBox.replaceChildren(box, caption);
    const timers = [];
    LORE_TIMES.forEach(([from, to], i) => {
      timers.push(setTimeout(() => typeCaption(caption, INTRO_LORE[i]), from));
      timers.push(setTimeout(() => caption.classList.add('fade'), to - 400));
    });
    let play = null;
    if (anim && !reduced) {
      play = playAnim(box, anim);
      stopCurrent = () => { play.stop(); timers.forEach(clearTimeout); };
      await racePart(play.done);
    } else {
      stopCurrent = () => timers.forEach(clearTimeout);
      await racePart(wait(reduced ? 9000 : 0));
    }
    timers.forEach(clearTimeout);
    if (skipped || partSkipped) return;
    sfx('music_introvideo_part1end');
  }

  async function fight() {
    overlay.dataset.phase = 'fight';
    skip.remove();
    music('music_fight_cue1', { fade: 600 });
    const view = renderFight(ctx);
    stageBox.replaceChildren(view.el);
    // the Worm Shaman's card in the boss frame, then the board slides in (ctrl_intro_fight)
    view.el.classList.add('tf-preview');
    const preview = await race(loadAnim('bossfight_preview'));
    if (skipped) return;
    if (preview && !reduced) {
      const box = h('div.tut-anim-box.tf-preview-box');
      view.el.appendChild(box);
      const play = playAnim(box, preview, { speed: PREVIEW_SPEED, templates: { baseCard: previewCard(ctx) } });
      stopCurrent = () => play.stop();
      await race(play.done);
      box.remove();
      if (skipped) return;
    }
    view.el.classList.remove('tf-preview');
    sfx('metallic_transition');
    // Attack! with the sparkle, then the hand (ctrl_intro_fight highlights)
    let pressed;
    const press = new Promise((r) => { pressed = r; });
    let hand = null;
    view.attack.button.addEventListener('click', () => { if (hand) hand.remove(); pressed(); });
    const handTimer = setTimeout(() => {
      if (!view.attack.isConnected || view.attack.classList.contains('tf-gone')) return;
      hand = renderHand();
      hand.classList.add('static');
      view.el.appendChild(hand);
      const b = view.attack.button;
      hand.place(b.offsetLeft + view.attack.offsetLeft + b.offsetWidth / 2, view.attack.offsetTop + b.offsetTop + b.offsetHeight / 2);
    }, ATTACK_HAND_DELAY);
    stopCurrent = () => clearTimeout(handTimer);
    await race(press);
    clearTimeout(handTimer);
    if (skipped) return;
    sfx('ui_button_attack');
    stopCurrent = view.stop;
    await view.play(() => skipped);
  }

  async function part2() {
    overlay.dataset.phase = 'part2';
    music('music_introvideo_part2', { loop: false, fade: 300 });
    const anim = await race(loadAnim('intro_part2'));
    if (skipped) return;
    const box = h('div.tut-anim-box');
    stageBox.replaceChildren(box);
    if (anim && !reduced) {
      const play = playAnim(box, anim);
      stopCurrent = () => play.stop();
      await race(play.done);
    } else {
      await race(wait(reduced ? 2500 : 0));
    }
    if (skipped) return;
    overlay.classList.add('flash');
    await race(wait(500));
  }

  return (async () => {
    try {
      await part1();
      if (!skipped) await fight();
      if (!skipped) await part2();
    } catch (err) {
      console.error(err);
    } finally {
      window.removeEventListener('keydown', onKey, true);
      overlay.classList.add('closing');
      root.classList.remove('intro-running');
      setTimeout(() => overlay.remove(), 400);
    }
    return { skipped };
  })();
}

/**
 * The card face of the boss preview: the Worm Shaman's art.
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function previewCard(ctx) {
  const def = ctx.deps.db.get(PREVIEW_CARD);
  const url = def ? ctx.view.artUrlFor(def, 0) : '/assets/cards/Worm_Shaman.jpg';
  return h('img.tf-preview-card', { src: url, alt: 'Worm Shaman', draggable: 'false' });
}

/**
 * Type a caption in.
 * @param {HTMLElement} el
 * @param {string} text
 */
function typeCaption(el, text) {
  el.classList.remove('fade');
  el.textContent = '';
  let n = 0;
  const t = setInterval(() => {
    n += 1;
    el.textContent = text.slice(0, n);
    if (n >= text.length || !el.isConnected) clearInterval(t);
  }, CAPTION_TYPE_MS);
}

/** The real fight's projectile flight at 1x (battle-player.js: 500 of the 1500 ms attack step). */
export const MISSILE_MS = 500;
/** The real fight's death shatter at 1x (battle-player.js death step). */
export const DEATH_MS = 900;
/** Seed of the effect variant picker (the sprite rotations); any fixed value. */
const INTRO_SEED = 0x1f7;

/**
 * A script target key -> board position for the battle effects (src/ui/battle/fx.js): the Worm Shaman is the
 * defender in the top row, "You" the attacker below; the script's slots are 1-based; p / e alone are the players'
 * HP bars (slot null).
 * @param {string} key  p | e | p<slot> | e<slot>
 * @returns {{side: 'attacker'|'defender', slot: number|null}}
 */
export function introTarget(key) {
  const side = key[0] === 'e' ? 'defender' : 'attacker';
  const n = Number(key.slice(1));
  return { side, slot: key.length > 1 && Number.isInteger(n) ? n - 1 : null };
}

/**
 * The intro fight board (ctrl_intro_fight_layout: boss deck on top, player deck below, the Attack! bar between)
 * and its scripted playback, drawn with the real fight's effects (createFx: the attacker's golden glow, the
 * beam.png bullet, the impact bursts, the red HP strip, the floating numbers, the shatter) so that the opening
 * looks like every other fight (user's request 2026-10-12; the first port flew glowing orbs).
 * @param {object} ctx
 * @returns {{el: HTMLElement, attack: any, play: (cancelled: () => boolean) => Promise<void>, stop: () => void}}
 */
export function renderFight(ctx) {
  const F = INTRO_FIGHT;
  const enemyViews = introCardViews(ctx, 'enemy');
  const playerViews = introCardViews(ctx, 'player');
  /** the .card-wrap per slot and the slot boxes, by fx side (fx.js PlayerRoots) */
  const wraps = { attacker: [null, null, null, null, null], defender: [null, null, null, null, null] };
  const slots = { attacker: [], defender: [] };
  const maxHp = { attacker: [], defender: [] };
  const row = (views, side) => h('div.tf-row', { class: `tf-${side}` }, views.map((v, i) => {
    const key = side === 'enemy' ? 'defender' : 'attacker';
    const slot = h('div.tf-slot', { dataset: { slot: String(i + 1) } });
    slots[key][i] = slot;
    if (v) {
      const card = renderCard(v, { size: 'battle', side: side === 'enemy' ? 'top' : 'bottom', hpBar: true });
      slot.appendChild(card);
      wraps[key][i] = card;
      maxHp[key][i] = v.maxHp || 1;
    }
    return slot;
  }));
  const enemyHp = hpBar({ cur: F.enemyMaxHp, max: F.enemyMaxHp, className: 'tf-hp' });
  const playerHp = hpBar({ cur: F.playerMaxHp, max: F.playerMaxHp, className: 'tf-hp' });
  const enemyBand = h('div.tf-band.enemy', null,
    h('img.tf-portrait', { src: F.enemyPortrait, alt: '', draggable: 'false' }),
    h('div.tf-name', null, F.enemyName),
    h('div.tf-round'));
  const playerBand = h('div.tf-band.player', null,
    h('div.tf-name', null, F.playerName),
    h('img.tf-portrait', { src: F.playerPortrait, alt: '', draggable: 'false' }));
  const attack = attackBar({});
  const fxLayer = h('div.fx-layer');
  const el = h('div.tut-fight', null,
    h('div.tf-bg'),
    enemyBand, h('div.tf-hpwrap.enemy', null, enemyHp),
    row(enemyViews, 'enemy'),
    attack,
    row(playerViews, 'player'),
    h('div.tf-hpwrap.player', null, playerHp), playerBand,
    fxLayer);
  const roundEl = enemyBand.querySelector('.tf-round');

  // the fight's timers (effect clean-up), cancelled by stop()
  const timers = new Set();
  const later = (ms, fn) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
  const stop = () => { for (const id of timers) clearTimeout(id); timers.clear(); };
  const fx = createFx({
    roots: {
      fx: el, cards: wraps, slots, players: { defender: enemyHp, attacker: playerHp }, top: 'defender',
      getScale: ctx.ui && ctx.ui.stage ? ctx.ui.stage.getScale : undefined,
    },
    fxLayer, top: 'defender', scaled: (ms) => ms, later, pick: createPicker(INTRO_SEED),
  });
  const sound = (id) => {
    const list = INTRO_SOUNDS[id];
    if (list) ctx.sfx(list[Math.floor(Math.random() * list.length)]);
  };
  const cardAt = (t) => (t.slot === null ? null : wraps[t.side][t.slot]);

  /** Apply one script event with the real fight's effect for it (battle-player.js attack / damage / death). */
  function apply(e) {
    const [, kind, a, b] = e;
    const t = typeof a === 'string' ? introTarget(a) : null;
    switch (kind) {
      case 'sound': sound(a); break;
      case 'attacker':   // wind-up: the golden glow on the card and the flash
        fx.flashCard(t.side, t.slot, ['glow-attack'], 1500);
        fx.sprite('fx_glow03', fx.targetCenter(t.side, t.slot), { w: 170, anim: 'flash', dur: 320 });
        break;
      case 'missile': {   // the golden bullet of beam.png
        const to = introTarget(b);
        fx.bullet(fx.targetCenter(t.side, t.slot), fx.targetCenter(to.side, to.slot), { ms: MISSILE_MS });
        break;
      }
      case 'target': fx.hitBurst(fx.targetCenter(t.side, t.slot)); break;
      case 'shake': fx.flashCard(t.side, t.slot, ['shake', 'flash-red'], 450); break;
      case 'target_hpbar': fx.flashBar(t.side); fx.playerBurst(t.side); break;
      case 'hp': {
        if (a === 'p') playerHp.update(b, F.playerMaxHp);
        else if (a === 'e') enemyHp.update(b, F.enemyMaxHp);
        else { const wrap = cardAt(t); if (wrap) updateCardHp(wrap, Math.max(0, b), maxHp[t.side][t.slot]); }
        break;
      }
      case 'text': fx.floatNum(t.side, t.slot, b, 'damage'); break;
      case 'death_target': {   // the card shatters into two dark halves with sparks
        const wrap = cardAt(t);
        const card = fx.cardOf(t.side, t.slot);
        const c = fx.targetCenter(t.side, t.slot);
        if (card) {
          fx.clearCardFx(t.side, t.slot);
          card.classList.remove(...CARD_FX_CLASSES);
          if (fx.shatter(t.side, t.slot, DEATH_MS)) card.classList.add('shattered');
          else { card.classList.add('dissolve'); card.style.animationDuration = `${DEATH_MS}ms`; }
        }
        if (wrap && wrap !== card) wrap.classList.add('dying');
        fx.sprite('hud_explosion03', c, { w: 280, anim: 'pop', dur: 450, rot: 25 });
        fx.sprite('sparks', c, { w: 240, anim: 'rise', dur: 900, delay: 80, tint: '#ffc040' });
        fx.sprite('dust', { x: c.x, y: c.y + 20 }, { w: 260, anim: 'burst', dur: 900, delay: 120, tint: '#ffb060' });
        break;
      }
      case 'fade': { const slot = slots[t.side][t.slot]; if (slot) slot.classList.add('tf-dead'); break; }
      default: break;
    }
  }

  async function play(cancelled) {
    attack.classList.add('tf-gone');
    el.classList.add('tf-running');
    await wait(FIGHT_HUD_MS);
    for (let r = 0; r < F.rounds.length; r++) {
      if (cancelled()) return;
      roundEl.textContent = `ROUND ${r + 1}`;
      roundEl.classList.remove('pop');
      void roundEl.offsetWidth;
      roundEl.classList.add('pop');
      await wait(ROUND_GAP_MS);
      const round = F.rounds[r];
      const t0 = performance.now();
      for (const e of round.events) {
        const dt = e[0] - (performance.now() - t0);
        if (dt > 0) await wait(dt);
        if (cancelled()) return;
        apply(e);
      }
      const rest = round.time - (performance.now() - t0);
      if (rest > 0) await wait(Math.min(rest, 1500));
    }
    el.classList.add('tf-lost');
    await wait(1400);
  }

  return { el, attack, play, stop };
}
