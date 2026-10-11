'use strict';
/**
 * Battle playback: turns the engine's event log (architecture.md §4) into timed DOM animations built from
 * the original client's sprites (assets/orig/ui, docs/design/apk-assets.md) and sound names (assets/orig/sfx).
 *
 *  - src/ui/battle/timeline.js  pure: the event log grouped into timed steps (fromEvents), the tribe-bonus
 *                                moment, the lethal-blow step the finale replaces
 *  - src/ui/battle/model.js     pure: the board model (finalState = the board after every event)
 *  - src/ui/battle/assets.js    additive sprites, sound names and the seeded variant picker
 *  - src/ui/battle/fx.js        board geometry and the effect primitives (sprites, floats, flashes, shatter)
 *  - playBattle(rootEls, events, opts)  DOM player (effect table below). Speed 1x/2x (1x = the original
 *    pacing, STEP_MS); skip() jumps to the final state instantly. `opts.sfx(name)` (optional) receives the
 *    original sound names; the _01/_02/_03 variants are cycled by a counter seeded with the battle seed so a
 *    replay sounds the same every time.
 *
 * Effect -> sprite / sound (after the client's comp_fight_v3 choreography and the server timeline sample):
 *   fight start     tribe bonus: glowing tribe emblem in the side's frame,    fight_bonus
 *                   "TRIBE BONUS" crossfading over the HP number counting up
 *   round start     "ROUND n" appears (round 1) or rolls to the next number   fight_nextround
 *   attack wind-up  fx_glow03 flash + white glow on the attacker              anim_attack_attacker_{blood|arcane|stronghit|sword}_NN (tribe)
 *   projectile      beam.png drawn small: a golden bullet flying 500 ms       anim_attack_missile_{shadow|flash|shot|fire}_NN (tribe)
 *   impact          attack_explosion + hud_explosion01 + impact_wave +        anim_attack_target_{blood|arcane|stronghit|fire}_NN (tribe)
 *                   hud_explosion02 sparks, card shake, red flash; "-N" in
 *                   red bold on the card 100 ms later (pop, hold, grow 2x)
 *   player hit      red glowing strip across the whole HP bar, red sparks,    anim_attack_target_hpbar_NN
 *                   "-N" over the bar; the HP number reddens as it drops
 *   blocked         defended_icon + invulnerable_effec_04 flash               fight_invulnerability
 *   reflected       shockwave01 on the reflecting card, bounced beam          fight_shot_reflectN
 *   ability damage  spell circle on the source, flash1 bolt,                  anim_attack_missile_flash_NN / anim_attack_target_flash_NN
 *                   hud_explosion03 slash + blast2 at the target
 *   poison          green dust                                                anim_attack_target_poison_NN
 *   direct kill     hud_explosion03 slash + attacked_icon                     anim_attack_target_claws_NN
 *   heal            fx_glow02 circle on the healer, green white_glow +        fight_card_heal_N / fight_card_heal_affect_N
 *                   rising invulnerable_effec_02 sparkles, number
 *   buff / debuff   card_arrow{red|01|blue} rising or sinking + fx_glow03     fight_raiseattack / fight_curse
 *   dazed           stun_effect08 red streaks over the card                   fight_curse (+ fight_curse_affect)
 *   suspended       fx_glow01 + Spell_Circle2 blue rings spinning             fight_curse
 *   stunned         both of the above
 *   indestructible  golden glow around the card (glowingcard halo + newcardglow  fight_invulnerability
 *                   rays behind it, a golden wash over the art, twinkling parks
 *                   sparkles and rising invulnerable_effec_02 streaks; user's
 *                   reference screenshot of a 2016 arena fight)
 *   death           the card shatters into two darkened halves, hud_explosion03 fight_card_death_N
 *                   slash, golden sparks + dust; fx_alldieskull01 when a side loses its last card
 *   lethal blow     a fight the engine ends on a player's HP plays every step of its last round in order, exactly
 *                   as logged - the engine finishes the round after the HP crosses zero, so the attacks after the
 *                   killing blow are drawn too and the bars go negative on the hits themselves (the overkill of
 *                   the rest of the round). Then the finale (FINALE): the board holds, a white starburst, and the
 *                   result banner. The cards left on both rows stay. (User's choices 2026-10-10: the original
 *                   wiped every card the moment the HP crossed zero and stamped the banner in at once; an earlier
 *                   version here replaced the killing step with the finale, so the blow was never seen.)
 *   revive          big_glow + lens_flare + fx_glow03                         fight_resurrect
 *
 * The player only consumes events: it never computes a fight result itself, so playback is deterministic.
 * Only transform/opacity animate (css/battle-fx.css).
 */
import { h, spriteUrl } from './dom.js';
import { setCardStatus, updateCardHp, updateCardAttack, plainNumber, TRIBE_SPRITES } from './components/card.js';
import { roundFactor, stepDuration, fromEvents, lethalStep, FINALE } from './battle/timeline.js';
import { initialModel, reduceEvent, finalState } from './battle/model.js';
import { SOUNDS, tribeSounds, createPicker } from './battle/assets.js';
import { createFx, CARD_FX_CLASSES } from './battle/fx.js';

/**
 * Player HP number colour (comp_progress_bar): light grey (229,229,229) down to 2/3 of the maximum, then
 * blending into red (255,0,20) at 1/6. Blend f = clamp((ratio - 0.5) * 1.5 + 0.5, 0, 1); f = 1 is grey.
 * @param {number} ratio  hp / maxHp
 * @returns {string} css rgb()
 */
export function hpLabelColor(ratio) {
  const r = Number.isFinite(ratio) ? ratio : 1;
  const f = Math.max(0, Math.min(1, (r - 0.5) * 1.5 + 0.5));
  const mix = (grey, red) => Math.round(red + (grey - red) * f);
  return `rgb(${mix(229, 255)}, ${mix(229, 0)}, ${mix(229, 20)})`;
}

/** Status icon of the card component per engine status (indestructible has no icon: the golden aura shows it). */
const STATUS_CLASS = { dazed: 'daze', stunned: 'stun', suspended: 'suspend' };
const SIDES = ['attacker', 'defender'];

/* ------------------------------------------------------------ DOM player */

/**
 * Show a player's HP on its bar; the number blends from grey to red as the bar empties (hpLabelColor).
 * @param {(HTMLElement & {update?: Function})|null} bar  hpBar component
 * @param {number} hp
 * @param {number} maxHp
 */
function setPlayerBar(bar, hp, maxHp) {
  if (!bar) return;
  const cur = Number(hp) || 0;
  if (bar.update) bar.update(cur, maxHp);
  const label = bar.querySelector ? bar.querySelector('.bar-label') : null;
  if (label) label.style.color = hpLabelColor(maxHp > 0 ? Math.max(0, cur) / maxHp : 1);
}

/**
 * @typedef {object} PlayOptions
 * @property {number} [speed=1]
 * @property {(name: string) => void} [sfx]  plays an original sound by name (file stem of assets/orig/sfx)
 * @property {(round: number) => void} [onRound]
 * @property {(summary: object, info: {skipped: boolean}) => void} [onEnd]
 * @property {(step: object) => void} [onStep]
 */

/**
 * Play an event log on the battle screen.
 * @param {import('./battle/fx.js').PlayerRoots} roots  the board elements (typedef in battle/fx.js)
 * @param {object[]} events
 * @param {PlayOptions} [opts]
 * @returns {{done: Promise<object>, skip: () => void, setSpeed: (n: number) => void, getSpeed: () => number, finished: () => boolean, destroy: () => void}}
 */
export function playBattle(roots, events, opts = {}) {
  const speed = { value: Number(opts.speed) > 0 ? Number(opts.speed) : 1 };
  const model = initialModel(events);
  const steps = fromEvents(events, 1);
  /** The board after every event: the skip target, the finale's end values and the summary. */
  const final = finalState(events);
  /** Index of the lethal-blow step (the finale replaces it), -1 when the fight does not end on one. */
  const lethal = lethalStep(events, steps, final);
  const top = roots.top || 'defender';
  const start = (events || []).find((e) => e.t === 'battleStart');
  const pick = createPicker(start && start.seed);
  let cancelled = false;
  let finished = false;
  let skipped = false;
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const timers = new Set();
  const waiters = new Set();
  const fxLayer = h('div.fx-layer');
  roots.fx.appendChild(fxLayer);

  /* ---- sound ---- */
  const sfx = typeof opts.sfx === 'function'
    ? (name) => { if (!name || cancelled) return; try { opts.sfx(name); } catch (err) { console.warn('sfx failed', err); } }
    : () => {};
  const play = (list) => sfx(pick(list));

  /* ---- timing ---- */
  function delay(ms) {
    return new Promise((resolve) => {
      if (cancelled) { resolve(); return; }
      const id = setTimeout(() => { timers.delete(id); waiters.delete(resolve); resolve(); }, ms);
      timers.add(id);
      waiters.add(resolve);
    });
  }
  function flush() {
    for (const id of timers) clearTimeout(id);
    timers.clear();
    for (const r of waiters) r();
    waiters.clear();
  }
  /** Fire-and-forget timer (class removal etc.), cancelled on skip. */
  function later(ms, fn) {
    const id = setTimeout(() => { timers.delete(id); if (!cancelled) fn(); }, ms);
    timers.add(id);
  }
  let roundTime = 1;
  const scaled = (ms) => Math.max(1, Math.round(ms * roundTime / speed.value));

  const {
    center, wrapOf, cardOf, slotOf, playerBar, barTrough, isPlayer, targetCenter, aimPoint, rowCenter,
    sprite, cardFx, clearCardFx, invulnAura, beam, bullet, floatNum, buffArrows, flashCard, flashBar, hitBurst, playerBurst, shatter,
  } = createFx({ roots, fxLayer, top, scaled, later, pick });

  function updateCard(side, slot) {
    const m = model[side].cards[slot];
    const wrap = wrapOf(side, slot);
    if (!m || !wrap) return;
    updateCardHp(wrap, m.hp, m.maxHp);
    updateCardAttack(wrap, m.attack);
  }
  function updatePlayer(side) {
    setPlayerBar(playerBar(side), model[side].player.hp, model[side].player.maxHp);
  }
  const tribeOf = (side, slot) => { const c = model[side] && Number.isInteger(slot) ? model[side].cards[slot] : null; return c ? c.tribe : 'neutral'; };
  const sideWiped = (side) => model[side].cards.every((c) => !c || c.dead);

  /**
   * Apply one damage event with its effect.
   * @param {object} ev
   * @param {{once: (key: string, list: string[]) => void, set?: object}} o  per-step sound de-duplication and the attacker's tribe set
   */
  function applyDamageHit(ev, o) {
    reduceEvent(model, ev);
    if (isPlayer(ev.slot)) {
      updatePlayer(ev.side);
      if (ev.amount > 0) { floatNum(ev.side, null, `-${plainNumber(ev.amount)}`, 'damage'); flashBar(ev.side); playerBurst(ev.side); o.once('player', SOUNDS.playerHit); }
      return;
    }
    // measured before the writes below: one layout per hit
    const c = targetCenter(ev.side, ev.slot);
    updateCard(ev.side, ev.slot);
    if (ev.blocked) {
      floatNum(ev.side, ev.slot, 'blocked', 'blocked', c);
      flashCard(ev.side, ev.slot, ['glow-sphere'], scaled(500));
      sprite('defended_icon', { x: c.x, y: c.y - 10 }, { w: 91, h: 79, anim: 'pop', dur: 650 });
      sprite('invulnerable_effec_04', c, { w: 240, anim: 'flash', dur: 450 });
      o.once('blocked', SOUNDS.invulnerable);
      return;
    }
    switch (ev.cause) {
      case 'reflect': {
        // bounced back: the reflecting card (source) flares, the beam returns to the hit card
        const from = ev.source && Number.isInteger(ev.source.slot) ? targetCenter(ev.source.side, ev.source.slot) : null;
        if (from) { sprite('shockwave01', from, { w: 230, anim: 'burst', dur: 550 }); beam(from, c, 'beam', { dur: 300, w: 80 }); }
        sprite('hud_explosion01', c, { w: 200, anim: 'pop', dur: 420, delay: 120 });
        o.once('reflect', SOUNDS.reflect);
        break;
      }
      case 'attack':
        hitBurst(c);
        o.once('impact', (o.set || tribeSounds('neutral')).impact);
        break;
      case 'kill':
        sprite('hud_explosion03', c, { w: 300, anim: 'pop', dur: 600, rot: 20 });
        sprite('attacked_icon', c, { w: 91, h: 79, anim: 'pop', dur: 700, delay: 80 });
        o.once('kill', SOUNDS.kill);
        break;
      case 'poison':
        sprite('dust', c, { w: 230, tint: '#5ad13a', anim: 'burst', dur: 700 });
        o.once('poison', SOUNDS.poison);
        break;
      default:
        sprite('hud_explosion03', c, { w: 260, anim: 'pop', dur: 480, rot: -25 });
        sprite('blast2', c, { w: 150, h: 110, anim: 'burst', dur: 450 });
        o.once('ability', SOUNDS.abilityImpact);
    }
    flashCard(ev.side, ev.slot, ['shake', 'flash-red'], scaled(450));
    floatNum(ev.side, ev.slot, `-${plainNumber(ev.amount)}`, 'damage', c);
  }
  function applyHeal(ev, o) {
    reduceEvent(model, ev);
    if (ev.amount <= 0) return;
    if (isPlayer(ev.slot)) {
      updatePlayer(ev.side);
      floatNum(ev.side, null, `+${plainNumber(ev.amount)}`, 'heal');
      sprite('white_glow', center(playerBar(ev.side)), { w: 560, h: 170, tint: '#3fd23f', anim: 'flash', dur: 600 });
      o.once('healAffect', SOUNDS.healAffect);
      return;
    }
    const c = targetCenter(ev.side, ev.slot);
    updateCard(ev.side, ev.slot);
    sprite('white_glow', c, { w: 240, tint: '#56e04a', anim: 'burst', dur: 800 });
    sprite('invulnerable_effec_02', c, { w: 150, anim: 'rise', rot: 180, dur: 900, tint: '#9dff8a' });
    flashCard(ev.side, ev.slot, ['glow-heal'], scaled(700));
    floatNum(ev.side, ev.slot, `+${plainNumber(ev.amount)}`, 'heal', c);
    o.once('healAffect', SOUNDS.healAffect);
  }
  function applyStatusFx(side, slot, status) {
    const c = targetCenter(side, slot);
    if (status === 'dazed' || status === 'stunned') {
      cardFx(side, slot, 'stun_effect08', { tint: '#ff3b30', alpha: .8, anim: 'pulse', key: 'daze' });
      sprite('fx_glow04', c, { w: 220, anim: 'flash', tint: '#ff5040', dur: 500 });
    }
    if (status === 'suspended' || status === 'stunned') {
      cardFx(side, slot, 'fx_glow01', { w: '104px', h: '104px', anim: 'spin', key: 'suspend', alpha: .9 });
      cardFx(side, slot, 'Spell_Circle2', { w: '66px', h: '66px', anim: 'spin-rev', tint: '#9ae8ff', key: 'suspend2' });
      sprite('fx_glow01', c, { w: 200, anim: 'flash', dur: 600 });
    }
    if (status === 'indestructible') {
      invulnAura(side, slot);
      sprite('invulnerable_effec_04', c, { w: 260, anim: 'flash', dur: 520 });
      sprite('glowingcard', c, { w: 150, h: 200, anim: 'flash', dur: 420, alpha: .45 });
    }
  }
  function clearStatuses() {
    for (const side of SIDES) for (let i = 0; i < 5; i++) { const w = wrapOf(side, i); if (w) { setCardStatus(w, null); clearCardFx(side, i); } }
  }
  /**
   * "ROUND n" in the title bar: absent before round 1, then the number rolls (the old label slides up and out,
   * the new one in from below).
   */
  function rollRound(n) {
    const label = roots.round;
    if (!label) return;
    const text = `ROUND ${n}`;
    const first = !label.classList.contains('shown');
    label.classList.add('shown');
    if (first || !label.textContent) { label.textContent = text; return; }
    const old = label.textContent;
    while (label.firstChild) label.removeChild(label.firstChild);
    const ms = Math.max(1, Math.round(250 / speed.value));
    label.append(h('span.round-roll', { style: { animationDuration: `${ms}ms` } }, h('span.round-old', null, old), h('span.round-new', null, text)));
    later(ms + 30, () => { if (label.querySelector('.round-roll')) label.textContent = text; });
  }

  /**
   * The tribe-bonus moment before round 1: the bonus side's frame shows its glowing tribe icon, "TRIBE BONUS"
   * crossfades over the HP number while it counts up by exactly 20 % (fight_bonus).
   * @param {{side: string, from: number, to: number, tribe: string}[]} list
   * @param {number} dur  step duration (ms, already scaled)
   */
  async function tribeBonus(list, dur) {
    const lead = Math.round(dur * 0.1);
    const countMs = Math.round(dur * 0.75);
    play(SOUNDS.bonus);
    for (const b of list) {
      const bar = playerBar(b.side);
      setPlayerBar(bar, b.from, b.from);
      if (bar && bar.classList) bar.classList.add('bonus');
      const c = center(barTrough(b.side));
      const text = h('div.fx-bonus-text', { style: { '--x': `${Math.round(c.x)}px`, '--y': `${Math.round(c.y)}px`, '--dur': `${dur}ms` } }, 'TRIBE BONUS');
      fxLayer.appendChild(text);
      later(dur + 60, () => text.remove());
      const frame = roots.frames && roots.frames[b.side];
      if (frame) {
        const fc = center(frame);
        sprite('fx_glow03', fc, { w: 200, anim: 'hold', dur: dur + 200, tint: '#ffe36a' });
        const icon = h('div.fx-tribe-icon', { style: { '--x': `${Math.round(fc.x)}px`, '--y': `${Math.round(fc.y)}px`, '--img': `url("${spriteUrl(TRIBE_SPRITES[b.tribe] || TRIBE_SPRITES.neutral)}")`, '--dur': `${dur + 200}ms` } });
        fxLayer.appendChild(icon);
        later(dur + 260, () => icon.remove());
      }
    }
    let t0 = 0;
    await new Promise((resolve) => {
      const tick = () => {
        if (cancelled) { resolve(); return; }
        if (!t0) t0 = Date.now();
        const k = Math.min(1, (Date.now() - t0) / Math.max(1, countMs));
        for (const b of list) { const v = Math.round(b.from + (b.to - b.from) * k); setPlayerBar(playerBar(b.side), v, v); }
        if (k >= 1) { resolve(); return; }
        later(40, tick);
      };
      later(lead, tick);
    });
    if (cancelled) return;
    for (const b of list) { updatePlayer(b.side); const bar = playerBar(b.side); if (bar && bar.classList) bar.classList.remove('bonus'); }
    await delay(Math.max(1, dur - countMs - lead));
  }

  function onceFactory() {
    const seen = new Set();
    return (key, list) => { if (seen.has(key)) return; seen.add(key); play(list); };
  }

  /* ---- steps ---- */
  async function playStep(step) {
    const dur = stepDuration(step, speed.value);
    if (opts.onStep) opts.onStep(step);
    const once = onceFactory();
    switch (step.type) {
      case 'start':
        for (const ev of step.events) reduceEvent(model, ev);
        for (const side of SIDES) { updatePlayer(side); for (let i = 0; i < 5; i++) updateCard(side, i); }
        if (step.bonus && step.bonus.length) { await tribeBonus(step.bonus, dur); return; }
        await delay(dur);
        return;
      case 'round': {
        reduceEvent(model, step.events[0]);
        for (const side of SIDES) for (let i = 0; i < 5; i++) updateCard(side, i);
        roundTime = roundFactor(step.round);
        clearStatuses();
        rollRound(step.round);
        if (opts.onRound) opts.onRound(step.round);
        play(SOUNDS.nextRound);
        await delay(dur);
        return;
      }
      case 'status': {
        const wrap = wrapOf(step.side, step.slot);
        if (wrap && step.on) {
          if (STATUS_CLASS[step.status]) setCardStatus(wrap, STATUS_CLASS[step.status]);
          applyStatusFx(step.side, step.slot, step.status);
        } else if (wrap) { setCardStatus(wrap, null); clearCardFx(step.side, step.slot); }
        if (step.source && Number.isInteger(step.source.slot) && !(step.source.side === step.side && step.source.slot === step.slot)) {
          flashCard(step.source.side, step.source.slot, ['glow-buff'], dur);
          sprite('spell', targetCenter(step.source.side, step.source.slot), { w: 150, anim: 'pop', dur: 500 });
        }
        if (step.on) {
          if (step.status === 'indestructible') play(SOUNDS.invulnerable);
          else { play(SOUNDS.curse); later(scaled(150), () => play(SOUNDS.curseAffect)); }
        }
        await delay(dur);
        return;
      }
      case 'buff': {
        for (const ev of step.events) reduceEvent(model, ev);
        const onCard = !isPlayer(step.slot);
        const c = onCard ? targetCenter(step.side, step.slot) : null;
        if (step.stat === 'attack' || step.stat === 'attackMult') {
          const up = step.stat === 'attack' ? step.delta >= 0 : step.delta >= 1;
          if (onCard) {
            updateCard(step.side, step.slot);
            flashCard(step.side, step.slot, [up ? 'glow-buff' : 'glow-debuff'], dur);
            buffArrows(c, up ? 'card_arrowred01' : 'card_arrowblue01', up);
            sprite('fx_glow03', c, { w: 220, anim: 'flash', tint: up ? '#ffcc33' : '#a64ddb', dur: 500 });
          }
          const label = step.stat === 'attack' ? `${step.delta >= 0 ? '+' : ''}${plainNumber(step.delta)}` : `×${Number(step.delta).toFixed(step.delta % 1 ? 2 : 0)}`;
          // a lowered attack is no damage: the violet attack-debuff number (sword icon), not the red hit
          floatNum(step.side, step.slot, label, up ? ['buff', 'atk'] : ['debuff', 'atk'], c);
          play(up ? SOUNDS.raiseAttack : SOUNDS.curse);
        } else if (step.stat === 'maxHp') {
          if (!onCard) {
            // the per-round re-application of a player's max-HP raise nets to 0: nothing to show
            updatePlayer(step.side);
            if (step.delta) {
              floatNum(step.side, null, `${step.delta > 0 ? '+' : ''}${plainNumber(step.delta)}`, step.delta > 0 ? 'heal' : ['debuff', 'maxhp']);
              play(SOUNDS.heal);
            }
            await delay(dur);
            return;
          }
          updateCard(step.side, step.slot);
          flashCard(step.side, step.slot, ['glow-heal'], dur);
          buffArrows(c, 'card_arrow01', step.delta >= 0);
          sprite('fx_glow03', c, { w: 220, anim: 'flash', tint: '#3fd23f', dur: 500 });
          floatNum(step.side, step.slot, `${step.delta >= 0 ? '+' : ''}${plainNumber(step.delta)}`, step.delta >= 0 ? 'heal' : ['debuff', 'maxhp'], c);
          play(SOUNDS.heal);
        }
        await delay(dur);
        return;
      }
      case 'attack': {
        reduceEvent(model, step.events[0]);
        const atkCard = model[step.side] && model[step.side].cards[step.slot];
        if (atkCard && Number.isFinite(step.attack) && !step.events[0].bonus && atkCard.attack !== step.attack) { atkCard.attack = step.attack; updateCard(step.side, step.slot); }
        const from = targetCenter(step.side, step.slot);
        const set = tribeSounds(tribeOf(step.side, step.slot));
        flashCard(step.side, step.slot, ['glow-attack'], dur);
        sprite('fx_glow03', from, { w: 170, anim: 'flash', dur: 320 });
        play(set.windup);
        if (!step.targets.length && !step.hits.length) { await delay(dur); return; }
        // server sample: wind-up 0-400, missile 200-700, impact (burst, shake, HP tween) at 700, "-N" at 800
        const windup = Math.round(dur * 200 / 1500);
        const flight = Math.round(dur * 500 / 1500);
        await delay(windup);
        if (cancelled) return;
        for (const t of step.targets) bullet(from, aimPoint(step.side, step.slot, t), { ms: flight });
        if (step.targets.length) play(set.missile);
        await delay(flight);
        if (cancelled) return;
        for (const hit of step.hits) applyDamageHit(hit, { once, set });
        await delay(Math.max(1, dur - windup - flight));
        return;
      }
      case 'damage': {
        if (step.source && Number.isInteger(step.source.slot)) {
          flashCard(step.source.side, step.source.slot, ['glow-attack'], dur);
          const from = targetCenter(step.source.side, step.source.slot);
          sprite('spell', from, { w: 150, anim: 'pop', dur: 500 });
          const beamMs = Math.round(dur * 0.35);
          if (step.cause === 'ability' || step.cause === 'death') {
            for (const hit of step.hits) beam(from, targetCenter(hit.side, hit.slot), 'flash1', { w: 90, dur: beamMs + 120 });
            play(SOUNDS.bolt);
          }
          await delay(beamMs);
          if (cancelled) return;
          for (const hit of step.hits) applyDamageHit(hit, { once });
          await delay(dur - beamMs);
          return;
        }
        for (const hit of step.hits) applyDamageHit(hit, { once });
        await delay(dur);
        return;
      }
      case 'heal': {
        if (step.source && Number.isInteger(step.source.slot)) {
          flashCard(step.source.side, step.source.slot, ['glow-heal'], dur);
          sprite('fx_glow02', targetCenter(step.source.side, step.source.slot), { w: 210, anim: 'flash', tint: '#7dff6a', dur: 600 });
        }
        play(SOUNDS.heal);
        for (const ev of step.heals) applyHeal(ev, { once });
        await delay(dur);
        return;
      }
      case 'death': {
        for (const ev of step.deaths) {
          reduceEvent(model, ev);
          const wrap = wrapOf(ev.side, ev.slot);
          const card = cardOf(ev.side, ev.slot);
          const c = targetCenter(ev.side, ev.slot);
          if (card) {
            setCardStatus(card, null);
            clearCardFx(ev.side, ev.slot);
            card.classList.remove(...CARD_FX_CLASSES);
            if (shatter(ev.side, ev.slot, dur)) card.classList.add('shattered');
            else { card.classList.add('dissolve'); card.style.animationDuration = `${dur}ms`; }
          }
          if (wrap && wrap !== card) wrap.classList.add('dying');
          sprite('hud_explosion03', c, { w: 280, anim: 'pop', dur: 450, rot: 25 });
          sprite('sparks', c, { w: 240, anim: 'rise', dur: 900, delay: 80, tint: '#ffc040' });
          sprite('dust', { x: c.x, y: c.y + 20 }, { w: 260, anim: 'burst', dur: 900, delay: 120, tint: '#ffb060' });
          if (sideWiped(ev.side)) sprite('fx_alldieskull01', rowCenter(ev.side), { w: 292, h: 249, anim: 'pop', dur: 950, delay: 200 });
        }
        play(SOUNDS.death);
        await delay(dur);
        if (cancelled) return;
        for (const ev of step.deaths) detachCard(ev.side, ev.slot);
        return;
      }
      case 'revive': {
        reduceEvent(model, step.events[0]);
        const wrap = wrapOf(step.side, step.slot);
        const slot = slotOf(step.side, step.slot);
        if (wrap && slot && !wrap.isConnected) slot.appendChild(wrap);
        const card = cardOf(step.side, step.slot);
        if (card) { card.classList.remove('dissolve', 'shattered'); card.style.animationDuration = ''; clearCardFx(step.side, step.slot); card.classList.add('revive'); later(dur + 100, () => card.classList.remove('revive')); }
        if (wrap && wrap !== card) wrap.classList.remove('dying');
        updateCard(step.side, step.slot);
        const c = targetCenter(step.side, step.slot);
        sprite('big_glow', c, { w: 340, anim: 'burst', dur: 900 });
        sprite('lens_flare', c, { w: 170, anim: 'pop', dur: 800, delay: 100 });
        sprite('fx_glow03', c, { w: 260, anim: 'flash', dur: 600, delay: 200 });
        floatNum(step.side, step.slot, 'Revived!', 'heal', c);
        play(SOUNDS.revive);
        await delay(dur);
        return;
      }
      case 'roundEnd':
        reduceEvent(model, step.events[0]);
        for (const side of SIDES) updatePlayer(side);
        await delay(dur);
        return;
      case 'end':
        reduceEvent(model, step.events[0]);
        for (const side of SIDES) updatePlayer(side);
        await delay(dur);
        return;
      default:
        for (const ev of step.events) reduceEvent(model, ev);
        if (step.event && step.event.t === 'swap' && Number.isInteger(step.event.slot)) { updateCard(step.event.side, step.event.slot); floatNum(step.event.side, step.event.slot, 'swap!', 'buff'); }
        if (step.event && step.event.t === 'gamble') floatNum(step.event.side, step.event.slot, step.event.failed ? 'Spell failed' : 'Spell!', step.event.failed ? 'damage' : 'buff');
        await delay(dur);
    }
  }

  function detachCard(side, slot) {
    const wrap = wrapOf(side, slot);
    const card = cardOf(side, slot);
    if (card) { card.classList.remove('dissolve', 'shattered'); card.style.animationDuration = ''; clearCardFx(side, slot); }
    if (wrap && wrap !== card) wrap.classList.remove('dying');
    if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
  }

  /**
   * Jump the DOM to the final board (skip): the cards alive at the end stay, as when the fight plays out.
   */
  function applyFinal() {
    const wipe = false;
    for (const side of SIDES) {
      for (let i = 0; i < 5; i++) {
        const m = final[side].cards[i];
        const wrap = wrapOf(side, i);
        if (!m || !wrap) continue;
        const card = cardOf(side, i);
        if (card) { card.classList.remove(...CARD_FX_CLASSES); card.style.animationDuration = ''; }
        clearCardFx(side, i);
        if (m.dead || wipe) { detachCard(side, i); continue; }
        const slot = slotOf(side, i);
        if (slot && !wrap.isConnected) slot.appendChild(wrap);
        if (wrap !== card) wrap.classList.remove('dying');
        setCardStatus(wrap, null);
        updateCardHp(wrap, m.hp, m.maxHp);
        updateCardAttack(wrap, m.attack);
      }
      const bar = playerBar(side);
      setPlayerBar(bar, final[side].player.hp, final[side].player.maxHp);
      if (bar && bar.classList) bar.classList.remove('hit', 'bonus');
    }
    if (roots.round && final.rounds) { roots.round.textContent = `ROUND ${final.rounds}`; roots.round.classList.add('shown'); }
    while (fxLayer.firstChild) fxLayer.removeChild(fxLayer.firstChild);
  }

  function end() {
    if (finished) return;
    finished = true;
    later(1600, () => fxLayer.remove());
    if (opts.onEnd) opts.onEnd(final, { skipped });
    resolveDone(final);
  }

  /**
   * The finale of a fight that ended on a player's HP (FINALE): the board holds a moment, the loose effects are
   * cleared, a white starburst flashes, then the result (end -> onEnd -> banner). The numbers are already final:
   * every hit of the last round was drawn.
   */
  async function playFinale() {
    await delay(scaled(FINALE.lead + FINALE.hold));
    if (cancelled) return;
    while (fxLayer.firstChild) fxLayer.removeChild(fxLayer.firstChild);
    for (const side of SIDES) setPlayerBar(playerBar(side), final[side].player.hp, final[side].player.maxHp);
    sprite('invulnerable_effec_04', { x: 360, y: 640 }, { w: 640, anim: 'flash', dur: 500 });
    sprite('white_glow', { x: 360, y: 640 }, { w: 560, h: 540, anim: 'flash', dur: 420 });
    await delay(scaled(FINALE.burst));
  }

  async function run() {
    for (let i = 0; i < steps.length; i++) {
      if (cancelled) break;
      await playStep(steps[i]);
    }
    if (cancelled) return;
    if (lethal >= 0) await playFinale();   // the whole last round was drawn; now the starburst, then the banner
    if (!cancelled) end();
  }

  const api = {
    done,
    skip() {
      if (finished) return;
      cancelled = true;
      skipped = true;
      flush();
      applyFinal();
      end();
    },
    setSpeed(n) { speed.value = Number(n) > 0 ? Number(n) : 1; },
    getSpeed: () => speed.value,
    finished: () => finished,
    /** Stop without applying anything (screen left). */
    destroy() {
      cancelled = true;
      flush();
      for (const id of timers) clearTimeout(id);
      timers.clear();
      fxLayer.remove();
      finished = true;
    },
  };
  run().catch((err) => { console.error(err); api.skip(); });
  return api;
}
