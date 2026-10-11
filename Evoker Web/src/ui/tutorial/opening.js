'use strict';
/**
 * The opening of a new game, as the client's ui.controls.ctrl_intro chains it:
 *  1. intro_part1 (20 s keyframe animation: the peaceful village, the spell, the burned village, the Worm Shaman,
 *     the cards) with music_introvideo_part1 and the "Skip intro" label bottom-right; our captions show the intro
 *     lore of the loca table over its first three panels;
 *  2. the scripted fight (ui.controls.ctrl_intro_fight + assets/scripts/script_intro_fight.json): first the Worm
 *     Shaman's card in the boss frame (bossfight_preview at speed 1.2), then the board: his three cards against
 *     "You" with the Envoy alone; metallic_transition, the Attack! bar with its sparkle and, after 2 s, the hand;
 *     then two scripted rounds the player cannot win (no Defeat banner);
 *  3. intro_part2 (6 s: the burning tower in its ring of runes, white flash) with music_introvideo_part2.
 * Then the caller opens the quest map. "Skip intro" is shown during part 1 only and ends part 1, like the client
 * (ctrl_intro; Benito 1.7.0 @ 0:08.9 skips, and the preview and the fight still follow - tutorial-v2.md §0).
 * Escape does nothing during the opening (the phone client had no such key; it is swallowed so it cannot navigate).
 */
import { h, wait } from '../dom.js';
import { renderCard } from '../components/card.js';
import { hpBar } from '../components/bars.js';
import { attackBar } from '../components/buttons.js';
import { loadAnim, playAnim } from '../anim-player.js';
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

/**
 * The intro fight board (ctrl_intro_fight_layout: boss deck on top, player deck below, the Attack! bar between)
 * and its scripted playback.
 * @param {object} ctx
 * @returns {{el: HTMLElement, attack: any, play: (cancelled: () => boolean) => Promise<void>}}
 */
export function renderFight(ctx) {
  const F = INTRO_FIGHT;
  const enemyViews = introCardViews(ctx, 'enemy');
  const playerViews = introCardViews(ctx, 'player');
  const cards = {};
  const row = (views, side) => h('div.tf-row', { class: `tf-${side}` }, views.map((v, i) => {
    const slot = h('div.tf-slot', { dataset: { slot: String(i + 1) } });
    if (v) {
      const card = renderCard(v, { size: 'battle', side: side === 'enemy' ? 'top' : 'bottom', hpBar: true });
      slot.appendChild(card);
      cards[`${side === 'enemy' ? 'e' : 'p'}${i + 1}`] = { el: slot, maxHp: v.maxHp || 1 };
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
  const fx = h('div.tf-fx');
  const el = h('div.tut-fight', null,
    h('div.tf-bg'),
    enemyBand, h('div.tf-hpwrap.enemy', null, enemyHp),
    row(enemyViews, 'enemy'),
    attack,
    row(playerViews, 'player'),
    h('div.tf-hpwrap.player', null, playerHp), playerBand,
    fx);
  const roundEl = enemyBand.querySelector('.tf-round');

  const pos = (key) => {
    if (key === 'p') return { x: 360, y: 1090 };
    if (key === 'e') return { x: 360, y: 190 };
    const c = cards[key];
    if (!c || !c.el.isConnected) return { x: 360, y: 640 };
    let x = 0, y = 0, n = c.el;
    while (n && n !== el) { x += n.offsetLeft; y += n.offsetTop; n = /** @type {HTMLElement} */ (n.offsetParent); }
    return { x: x + c.el.offsetWidth / 2, y: y + c.el.offsetHeight / 2 };
  };
  const sound = (id) => {
    const list = INTRO_SOUNDS[id];
    if (list) ctx.sfx(list[Math.floor(Math.random() * list.length)]);
  };
  const flashCard = (key, cls, ms) => {
    const c = cards[key];
    if (!c) return;
    c.el.classList.add(cls);
    setTimeout(() => c.el.classList.remove(cls), ms);
  };

  /** Apply one script event. */
  function apply(e) {
    const [, kind, a, b] = e;
    switch (kind) {
      case 'sound': sound(a); break;
      case 'attacker': flashCard(a, 'tf-attacking', 400); break;
      case 'target': flashCard(a, 'tf-hit', 600); break;
      case 'shake': flashCard(a, 'tf-shake', 120); break;
      case 'target_hpbar': {
        const band = a === 'p' ? el.querySelector('.tf-hpwrap.player') : el.querySelector('.tf-hpwrap.enemy');
        if (band) { band.classList.add('tf-hit'); setTimeout(() => band.classList.remove('tf-hit'), 400); }
        break;
      }
      case 'missile': {
        const from = pos(a);
        const to = pos(b);
        const orb = h('img.tf-missile', { src: '/assets/orig/ui/energy_sphere.png', alt: '', draggable: 'false', style: { left: `${from.x}px`, top: `${from.y}px` } });
        fx.appendChild(orb);
        requestAnimationFrame(() => { orb.style.transform = `translate(${to.x - from.x}px, ${to.y - from.y}px)`; });
        setTimeout(() => orb.remove(), 520);
        break;
      }
      case 'hp': {
        if (a === 'p') playerHp.update(b, F.playerMaxHp);
        else if (a === 'e') enemyHp.update(b, F.enemyMaxHp);
        else {
          const c = cards[a];
          const fill = c && c.el.querySelector('.card-hpbar .bar-fill');
          if (fill) fill.style.width = `${Math.max(0, Math.min(100, (100 * b) / c.maxHp))}%`;
          const num = c && c.el.querySelector('.stat.hp .num, .card-stat.hp .num, [data-stat="hp"] .num');
          if (num) num.textContent = String(Math.max(0, b));
        }
        break;
      }
      case 'text': {
        const p = pos(a);
        const t = h('div.tf-damage', { style: { left: `${p.x}px`, top: `${p.y - (a.length === 1 ? 50 : 20)}px` } }, b);
        fx.appendChild(t);
        setTimeout(() => t.remove(), 900);
        break;
      }
      case 'death_target': flashCard(a, 'tf-dying', 1400); break;
      case 'fade': { const c = cards[a]; if (c) c.el.classList.add('tf-dead'); break; }
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

  return { el, attack, play };
}
