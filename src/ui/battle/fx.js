'use strict';
/**
 * Battle playback effects (DOM): where things are on the board (stage px, measured on the live layout) and the
 * effect primitives the player draws with - sprites in the fx layer, overlays inside a card, the golden aura,
 * beams and bullets, floating numbers, card / bar flashes, the hit bursts and the death shatter. Created once
 * per fight by playBattle (src/ui/battle-player.js), which owns the timers, the speed and the board model.
 */
import { h, spriteUrl } from '../dom.js';
import { isAdditive } from './assets.js';

/** Card reaction classes (cleared on death and skip, never copied onto the shatter halves). */
export const CARD_FX_CLASSES = ['shake', 'flash-red', 'glow-attack', 'glow-heal', 'glow-buff', 'glow-debuff', 'glow-sphere', 'revive', 'dissolve'];

/**
 * Floating text layout (stage px): a second number on the same target while the first is still up moves
 * aside / up so every hit stays readable; numbers on a player sit right (then left) of the HP label; every
 * float stays FLOAT_MARGIN inside the stage at its grown size (FLOAT_GROW of the 2x end scale: it has faded
 * by then). A diagonal shot through an empty edge slot ends AIM_BAR_INSET inside the HP bar's ends.
 */
const FLOAT_STACK_DX = 18;
const FLOAT_STACK_DY = 44;
const FLOAT_PLAYER_DX = 200;
const FLOAT_GROW = 1.3;
const FLOAT_MARGIN = 10;
const AIM_BAR_INSET = 24;

/**
 * @typedef {object} PlayerRoots  the board elements a fight is played on (playBattle's `roots`)
 * @property {HTMLElement} fx  positioned container the effects layer and round banner are appended to
 * @property {{attacker: Array<HTMLElement|null>, defender: Array<HTMLElement|null>}} cards  the `.card-wrap` elements by slot
 * @property {{attacker: HTMLElement[], defender: HTMLElement[]}} slots  slot containers (cards are removed on death, re-appended on revive)
 * @property {{attacker: {update: Function}|null, defender: {update: Function}|null}} players  player HP bars (hpBar components)
 * @property {HTMLElement} [round]  "ROUND n" label
 * @property {() => number} [getScale]  stage scale (client px per stage px)
 * @property {'attacker'|'defender'} [top='defender']  which side sits in the top row
 * @property {{attacker?: HTMLElement, defender?: HTMLElement}} [frames]  portrait frames the tribe-bonus emblem glows in
 */

/**
 * The geometry helpers and effect primitives of one fight.
 * @param {object} o
 * @param {PlayerRoots} o.roots
 * @param {HTMLElement} o.fxLayer  the fight's effects layer (in roots.fx)
 * @param {'attacker'|'defender'} o.top  the side in the top row
 * @param {(ms: number) => number} o.scaled  ms at 1x -> ms at the current speed and round
 * @param {(ms: number, fn: () => void) => void} o.later  timer of the fight (cancelled on skip)
 * @param {(list: any[]) => any} o.pick  the fight's seeded variant picker
 */
export function createFx({ roots, fxLayer, top, scaled, later, pick }) {
  /* ---- geometry ---- */
  function scale() {
    if (roots.getScale) return roots.getScale() || 1;
    const r = roots.fx.getBoundingClientRect();
    return roots.fx.offsetWidth ? r.width / roots.fx.offsetWidth : 1;
  }
  function center(el) {
    if (!el || !el.getBoundingClientRect) return { x: 360, y: 640 };
    const s = scale();
    const r = el.getBoundingClientRect();
    const b = roots.fx.getBoundingClientRect();
    return { x: (r.left - b.left) / s + r.width / s / 2, y: (r.top - b.top) / s + r.height / s / 2 };
  }
  const wrapOf = (side, slot) => (roots.cards[side] && roots.cards[side][slot]) || null;
  const cardOf = (side, slot) => { const w = wrapOf(side, slot); return w ? (w.classList.contains('card') ? w : w.querySelector('.card')) || w : null; };
  const slotOf = (side, slot) => (roots.slots && roots.slots[side] && roots.slots[side][slot]) || null;
  const playerBar = (side) => (roots.players && roots.players[side]) || null;
  const isPlayer = (slot) => slot === null || slot === undefined;
  /** Is the element laid out on the board (a dead card's wrapper is detached and measures as a zero box)? */
  const onBoard = (el) => !!el && el.isConnected !== false && !!el.getBoundingClientRect && el.getBoundingClientRect().width > 0;
  /**
   * Centre of a card, or of its slot once the card has left the board (effects of and on dead cards - death
   * triggers, reflects, hits on a card that died earlier in the round - still play on the slot).
   */
  function targetCenter(side, slot) {
    if (isPlayer(slot)) return center(playerBar(side) || slotOf(side, 2));
    const card = cardOf(side, slot);
    return center(onBoard(card) ? card : slotOf(side, slot) || card);
  }
  /** The HP trough of a player's bar (the bar component's .bar), or the bar itself. */
  const barTrough = (side) => { const bar = playerBar(side); return bar && bar.querySelector ? bar.querySelector('.bar') || bar : bar; };
  /**
   * Where floating numbers appear: over the target card (centre; `at` = that centre when already measured);
   * on a player's HP bar to the right of the HP label (the label stays readable), the next one to the left,
   * then stacked above.
   */
  function floatPos(side, slot, k = 0, at = null) {
    if (isPlayer(slot)) {
      const c = center(barTrough(side));
      const trough = barTrough(side);
      const half = trough && trough.offsetWidth ? trough.offsetWidth / 2 : 280;
      const dx = Math.min(FLOAT_PLAYER_DX, Math.max(0, half - 60));
      return { x: c.x + (k % 2 ? -dx : dx), y: c.y - Math.floor(k / 2) * FLOAT_STACK_DY };
    }
    const c = at || targetCenter(side, slot);
    return { x: c.x + (k ? (k % 2 ? -FLOAT_STACK_DX : FLOAT_STACK_DX) : 0), y: c.y - 10 - k * FLOAT_STACK_DY };
  }
  /** Column offset of an attack direction for the attacker's row (the defender's row is mirrored). */
  const DIR_COLUMN = { front: 0, frontLeft: -1, frontRight: 1 };
  /**
   * Where an attack projectile flies. A hit on a card goes to that card. A hit on the player through an empty
   * slot keeps the direction of the card's arrow: it passes over the empty slot and carries on to the height of
   * the player's HP bar, instead of turning towards the bar.
   * @param {string} side  attacking side
   * @param {number} slot  attacking slot
   * @param {{side: string, slot: number|null, dir?: string|null}} t  target of the attack event
   */
  function aimPoint(side, slot, t) {
    if (!isPlayer(t.slot) || !(t.dir in DIR_COLUMN)) return targetCenter(t.side, t.slot);
    const col = slot + (side === 'attacker' ? DIR_COLUMN[t.dir] : -DIR_COLUMN[t.dir]);
    const through = slotOf(t.side, col);
    if (!through) return targetCenter(t.side, t.slot);
    const from = targetCenter(side, slot);
    const via = center(through);
    const bar = center(playerBar(t.side) || through);
    const dy = via.y - from.y;
    const k = dy ? Math.max(1, (bar.y - from.y) / dy) : 1;
    const end = { x: from.x + (via.x - from.x) * k, y: from.y + dy * k };
    // an edge slot's diagonal would leave the stage: the shot ends at the HP bar's end instead (same height)
    const trough = barTrough(t.side);
    if (trough && trough.getBoundingClientRect && trough.offsetWidth) {
      const c = center(trough);
      const half = trough.offsetWidth / 2 - AIM_BAR_INSET;
      if (half > 0) end.x = Math.max(c.x - half, Math.min(c.x + half, end.x));
    } else {
      end.x = Math.max(AIM_BAR_INSET, Math.min(stageWidth() - AIM_BAR_INSET, end.x));
    }
    return end;
  }
  function stageWidth() { return (roots.fx && roots.fx.offsetWidth) || 720; }
  function stageHeight() { return (roots.fx && roots.fx.offsetHeight) || 1280; }
  function rowCenter(side) {
    const slot = slotOf(side, 2);
    return slot ? center(slot) : { x: 360, y: side === top ? 320 : 790 };
  }

  /* ---- fx primitives ---- */
  /**
   * Spawn a sprite effect in the fx layer.
   * @param {string} name  sprite file stem
   * @param {{x: number, y: number}} pos  centre (stage px)
   * @param {{w?: number, h?: number, anim?: string, dur?: number, delay?: number, rot?: number, tint?: string, alpha?: number}} [o]
   */
  function sprite(name, pos, o = {}) {
    const w = o.w || 120;
    const hgt = o.h || w;
    const dur = scaled(o.dur || 600);
    const wait = scaled(o.delay || 0);
    const style = {
      '--img': `url("${spriteUrl(name)}")`, '--x': `${Math.round(pos.x)}px`, '--y': `${Math.round(pos.y)}px`,
      '--w': `${w}px`, '--h': `${hgt}px`, '--rot': `${o.rot || 0}deg`, '--dur': `${dur}ms`, '--delay': `${wait}ms`,
    };
    if (o.tint) style['--tint'] = o.tint;
    if (o.alpha != null) style['--alpha'] = String(o.alpha);
    const el = h('div.fx-sprite', { class: [o.anim || 'burst', isAdditive(name) && 'add', o.tint && 'tint'], style }, h('div.fx-img'));
    fxLayer.appendChild(el);
    later(dur + wait + 80, () => el.remove());
    return el;
  }
  /**
   * Overlay a sprite inside a card (clipped by the card). Persistent unless `ttl` (ms at 1x) is given.
   * @param {string} side @param {number} slot @param {string} name
   * @param {{w?: string, h?: string, anim?: string, dur?: number, ttl?: number, tint?: string, alpha?: number, key?: string}} [o]
   */
  function cardFx(side, slot, name, o = {}) {
    const card = cardOf(side, slot);
    if (!card) return null;
    // one layer per kind: a card suspended + stunned in the same round keeps a single ring / daze layer
    if (o.key) for (const old of Array.from(card.querySelectorAll(`:scope > .fx-${o.key}`))) old.remove();
    const style = { '--img': `url("${spriteUrl(name)}")`, '--dur': `${scaled(o.dur || 450)}ms` };
    if (o.w) style['--w'] = o.w;
    if (o.h) style['--h'] = o.h;
    if (o.tint) style['--tint'] = o.tint;
    if (o.alpha != null) style['--alpha'] = String(o.alpha);
    const el = h('div.fx-cardfx', { class: [o.anim, isAdditive(name) && 'add', o.tint && 'tint', o.key && `fx-${o.key}`], style }, h('div.fx-img'));
    card.appendChild(el);
    if (o.ttl) later(scaled(o.ttl), () => el.remove());
    return el;
  }
  function clearCardFx(side, slot) {
    const card = cardOf(side, slot);
    if (!card) return;
    for (const el of Array.from(card.querySelectorAll('.fx-cardfx'))) el.remove();
    const host = auraHost(side, slot);
    if (host) for (const el of Array.from(host.querySelectorAll(':scope > .fx-aura'))) el.remove();
    card.classList.remove('invuln');
  }
  /** Where a card's aura lives: its .card-wrap (or the slot for a bare card), outside the card's clip. */
  function auraHost(side, slot) {
    const wrap = wrapOf(side, slot);
    const card = cardOf(side, slot);
    if (wrap && wrap !== card) return wrap;
    return card ? card.parentNode : null;
  }
  /**
   * Invulnerable: a golden glow around the card - the glowingcard halo and newcardglow rays behind it, a golden
   * wash over the art, parks sparkles twinkling and invulnerable_effec_02 streaks rising over it. Persistent
   * until the status ends (clearCardFx).
   */
  function invulnAura(side, slot) {
    const card = cardOf(side, slot);
    const host = auraHost(side, slot);
    if (!card || !host) return;
    for (const el of Array.from(host.querySelectorAll(':scope > .fx-aura'))) el.remove();
    const box = { left: `${card.offsetLeft}px`, top: `${card.offsetTop}px`, width: `${card.offsetWidth || 116}px`, height: `${card.offsetHeight || 164}px`, '--dur': `${scaled(450)}ms` };
    const back = h('div.fx-aura.invuln.back', { style: box }, h('div.fx-aura-rays'), h('div.fx-aura-halo'));
    const front = h('div.fx-aura.invuln.front', { class: card.classList.contains('side-top') ? 'side-top' : 'side-bottom', style: box },
      h('div.fx-aura-wash'), h('div.fx-aura-sparkles.s1'), h('div.fx-aura-sparkles.s2'),
      h('div.fx-aura-streaks.l'), h('div.fx-aura-streaks.r'));
    host.insertBefore(back, host.firstChild);
    host.appendChild(front);
    card.classList.add('invuln');
    // a light golden tint only: the art, attack and HP stay readable (the user's 2016 arena screenshot)
    cardFx(side, slot, 'white_glow', { tint: '#ffd75a', alpha: .14, anim: 'pulse', key: 'invuln' });
  }
  /** A beam sprite anchored at `from`, growing towards `to` (beam.png's bright head leads). */
  function beam(from, to, name = 'beam', o = {}) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.max(60, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx) * 180 / Math.PI - 90;
    const dur = scaled(o.dur || 420);
    const el = h('div.fx-sprite.beam', { class: isAdditive(name) && 'add', style: {
      '--img': `url("${spriteUrl(name)}")`, '--x': `${Math.round(from.x)}px`, '--y': `${Math.round(from.y)}px`,
      '--w': `${o.w || 110}px`, '--h': `${Math.round(len)}px`, '--rot': `${angle.toFixed(1)}deg`, '--dur': `${dur}ms`,
    } }, h('div.fx-img'));
    fxLayer.appendChild(el);
    later(dur + 80, () => el.remove());
  }
  /**
   * The original attack projectile: beam.png drawn small (a golden bullet with a short red trail, bright head
   * leading) that travels from `from` to `to` in `o.dur` ms.
   */
  function bullet(from, to, o = {}) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI - 90;
    const dur = o.ms || scaled(o.dur || 450);
    const el = h('div.fx-sprite.bullet', { style: {
      '--img': `url("${spriteUrl('beam')}")`, '--x': `${Math.round(from.x)}px`, '--y': `${Math.round(from.y)}px`,
      '--dx': `${Math.round(dx)}px`, '--dy': `${Math.round(dy)}px`, '--w': `${o.w || 150}px`, '--h': `${o.h || 220}px`,
      '--rot': `${angle.toFixed(1)}deg`, '--dur': `${dur}ms`, '--delay': `${scaled(o.delay || 0)}ms`,
    } }, h('div.fx-img'));
    fxLayer.appendChild(el);
    later(dur + scaled(o.delay || 0) + 60, () => el.remove());
  }
  /** Floating numbers still on screen per target ('side:slot' -> end times), to stack instead of overlapping. */
  const floatsLive = new Map();
  function floatNum(side, slot, text, cls, at = null) {
    // the client's "attack_card" text: pops in 200 ms, holds 200 ms, grows to 2x while fading 500 ms (700 ms),
    // 100 ms after the impact
    const wait = cls === 'damage' || cls === 'heal' || cls === 'debuff' ? scaled(100) : 0;
    const life = scaled(700) + wait;
    const key = `${side}:${isPlayer(slot) ? 'p' : slot}`;
    const now = Date.now();
    const live = (floatsLive.get(key) || []).filter((t) => t > now);
    const pos = floatPos(side, slot, live.length, at);
    live.push(now + life);
    floatsLive.set(key, live);
    const classes = Array.isArray(cls) ? cls : [cls];
    const el = h('div', { class: ['fx-float', ...classes, isPlayer(slot) && 'player'], style: { '--x': `${Math.round(pos.x)}px`, '--y': `${Math.round(pos.y)}px`, animationDuration: `${scaled(700)}ms`, animationDelay: `${wait}ms` } }, text);
    fxLayer.appendChild(el);
    clampFloat(el, pos);
    later(life + 80, () => el.remove());
  }
  /** Keep a floating text inside the stage (it grows to 2x around its centre while it fades). */
  function clampFloat(el, pos) {
    const w = el.offsetWidth;
    const hgt = el.offsetHeight;
    if (!w) return;
    const halfW = w * FLOAT_GROW / 2 + FLOAT_MARGIN;
    const halfH = hgt * FLOAT_GROW / 2 + FLOAT_MARGIN / 2;
    const W = stageWidth();
    const H = stageHeight();
    const x = halfW * 2 >= W ? W / 2 : Math.max(halfW, Math.min(W - halfW, pos.x));
    const y = Math.max(halfH, Math.min(H - halfH, pos.y));
    if (x !== pos.x) el.style.setProperty('--x', `${Math.round(x)}px`);
    if (y !== pos.y) el.style.setProperty('--y', `${Math.round(y)}px`);
  }
  /** Three arrows rising (or sinking) over a card centred at `c`. */
  function buffArrows(c, name, up) {
    for (let i = 0; i < 3; i++) sprite(name, { x: c.x - 34 + i * 34, y: c.y + (up ? 20 : -20) }, { w: 30, h: 36, anim: 'rise', rot: up ? 0 : 180, delay: i * 80, dur: 900 });
  }
  function flashCard(side, slot, classes, ms) {
    const card = cardOf(side, slot);
    if (!card) return;
    for (const c of classes) card.classList.add(c);
    later(ms, () => { for (const c of classes) card.classList.remove(c); });
  }
  function flashBar(side) {
    const bar = playerBar(side);
    if (!bar) return;
    bar.classList.add('hit');
    later(scaled(600), () => bar.classList.remove('hit'));
  }
  /** Impact burst of a plain attack hit on a card. */
  function hitBurst(c) {
    sprite('attack_explosion', c, { w: 270, h: 280, anim: 'burst', dur: 520 });
    sprite('hud_explosion01', c, { w: 230, anim: 'pop', dur: 420, rot: pick([0, 25, 50, 75]) });
    sprite('impact_wave', { x: c.x, y: c.y + 72 }, { w: 200, h: 70, anim: 'ring', dur: 520 });
    sprite('hud_explosion02', c, { w: 230, anim: 'rise', dur: 650, delay: 60 });
  }
  /** A hit on a player: a red glowing strip across the whole HP bar with red sparks rising from it. */
  function playerBurst(side) {
    const trough = barTrough(side);
    const c = center(trough);
    const w = trough && trough.offsetWidth ? trough.offsetWidth + 60 : 600;
    const el = h('div.fx-hpstrip', { style: { '--x': `${Math.round(c.x)}px`, '--y': `${Math.round(c.y)}px`, '--w': `${w}px`, '--dur': `${scaled(700)}ms` } });
    fxLayer.appendChild(el);
    later(scaled(700) + 60, () => el.remove());
    sprite('sparks', { x: c.x + 120, y: c.y + 10 }, { w: 240, h: 200, anim: 'rise', dur: 800, tint: '#ff4a30' });
  }

  /**
   * Death: the card shatters into two dark halves flying apart with golden sparks (~1 s); the card itself is
   * hidden at once. Returns false when the card is not on the board (no layout).
   */
  function shatter(side, slot, dur) {
    const card = cardOf(side, slot);
    if (!card || !card.isConnected || !card.getBoundingClientRect) return false;
    const s = scale();
    const r = card.getBoundingClientRect();
    if (!r.width) return false;
    const b = roots.fx.getBoundingClientRect();
    const box = { left: (r.left - b.left) / s, top: (r.top - b.top) / s, w: r.width / s, h: r.height / s };
    for (const half of ['a', 'b']) {
      const clone = card.cloneNode(true);
      clone.classList.remove(...CARD_FX_CLASSES, 'interactive');
      clone.removeAttribute('data-uid');
      clone.removeAttribute('role');
      clone.removeAttribute('tabindex');
      const piece = h('div.fx-shard', { class: half, style: { left: `${box.left}px`, top: `${box.top}px`, width: `${box.w}px`, height: `${box.h}px`, '--dur': `${dur}ms` } }, clone);
      fxLayer.appendChild(piece);
      later(dur + 60, () => piece.remove());
    }
    return true;
  }

  return {
    center, wrapOf, cardOf, slotOf, playerBar, barTrough, isPlayer, targetCenter, aimPoint, rowCenter,
    sprite, cardFx, clearCardFx, invulnAura, beam, bullet, floatNum, buffArrows, flashCard, flashBar, hitBurst, playerBurst, shatter,
  };
}
