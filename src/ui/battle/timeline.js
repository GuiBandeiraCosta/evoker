'use strict';
/**
 * Battle playback timeline (pure, no DOM): groups the engine's event log (architecture.md §4) into timed steps
 * for the battle player (src/ui/battle-player.js).
 *
 *  - fromEvents(events, speed)   steps `{ type, dur, ...data, events }`; steps of round n carry `factor` =
 *                                 roundFactor(n) (the server's 0.9x per round)
 *  - tribeBonuses(battleStart)   the sides whose HP the tribe bonus raised (+20 %)
 *  - lethalStep(events)          the step the lethal-blow finale (FINALE) replaces
 */
import { bonusTribe, TRIBE_BONUS_MULT } from '../../engine/tribe-bonus.js';
import { initialModel, reduceEvent, finalState } from './model.js';

/**
 * Base duration (ms at speed 1x) of every step type: the time until the next step starts (effects may run on).
 * 1x is the original pacing. The client drew whatever timeline the server sent; the one server timeline that
 * ships in the APK (exploration/apk/assets/scripts/script_intro_fight.json) starts an attacker every 1500 ms
 * (wind-up 0-400, missile 200-700, impact + HP tween 700-1200, "-N" 800-1500), a death 1400 ms after the last
 * hit's impact (card fade at +600), and plays round n at 0.9^(n-1) of round 1's speed (ROUND_FACTOR). That
 * matches the videos (exploration/research/round3/screens.md §1.5): ~1.5 s per attack, rounds 3 -> 11 in ~6-7 s,
 * a 5v5 fight of 2-3 rounds in 25-35 s.
 */
export const STEP_MS = Object.freeze({
  start: 200, bonus: 1300, round: 100, status: 700, buff: 700, attack: 1500, damage: 1200,
  heal: 1000, death: 900, revive: 1000, roundEnd: 0, end: 300, misc: 300,
});

/** Speed-up per round of the original server timelines: round n runs at ROUND_FACTOR^(n-1) of round 1. */
export const ROUND_FACTOR = 0.9;
/** Floor of the per-round factor (the sample has two rounds; long fights must stay readable). */
export const MIN_ROUND_FACTOR = 0.3;

/**
 * Time factor of a round (1 for round 1, 0.9 for round 2, ...).
 * @param {number} round
 * @returns {number}
 */
export function roundFactor(round) {
  const n = Math.max(1, Number(round) || 1);
  return Math.max(MIN_ROUND_FACTOR, Math.pow(ROUND_FACTOR, n - 1));
}

/**
 * Duration of a step at a playback speed.
 * @param {{type: string, base?: number}} step
 * @param {number} [speed=1]
 * @returns {number} ms
 */
export function stepDuration(step, speed = 1) {
  let base = Number.isFinite(step.base) ? step.base : (STEP_MS[step.type] ?? STEP_MS.misc);
  if (Number.isFinite(step.factor)) base *= step.factor;
  const s = Number(speed) > 0 ? Number(speed) : 1;
  return Math.max(1, Math.round(base / s));
}

/** A max-HP change of a player (raise_player_hp), not of a card. */
function isPlayerMaxHp(ev) {
  return !!ev && ev.t === 'buff' && ev.stat === 'maxHp' && (ev.slot === null || ev.slot === undefined);
}

function sameSource(a, b) {
  if (!a || !b) return false;
  return a.side === b.side && a.slot === b.slot && (a.effect || null) === (b.effect || null);
}

/**
 * The engine logs a reflector's death before the damage it reflects (damage -> death -> damage/reflect from the dead
 * card): drawn literally, the card dissolves and then fires its bounced beam. Move each death past the reflect
 * damages its card sources right after it, so the bounce joins the attack step and the dissolve follows.
 * @param {object[]} list
 * @returns {object[]}
 */
export function orderDeathsAfterReflects(list) {
  const out = list.slice();
  for (let i = 0; i < out.length; i++) {
    const ev = out[i];
    if (ev.t !== 'death') continue;
    let j = i + 1;
    while (j < out.length && out[j].t === 'damage' && out[j].cause === 'reflect' && out[j].source && out[j].source.side === ev.side && out[j].source.slot === ev.slot) j++;
    if (j === i + 1) continue;
    out.splice(i, 1);
    out.splice(j - 1, 0, ev);
    i = j - 1;
  }
  return out;
}

/**
 * Build the playback timeline from an event log.
 * Consecutive damage events of an attack are folded into the attack step; consecutive ability damages,
 * heals (same source) and deaths are grouped so they animate together.
 * @param {object[]} events
 * @param {number} [speed=1]
 * @returns {object[]} steps, each with `dur` (ms) and `events` (the raw events it covers)
 */
export function fromEvents(events, speed = 1) {
  const list = orderDeathsAfterReflects(Array.isArray(events) ? events : []);
  const steps = [];
  let factor = 1;
  for (let i = 0; i < list.length; i++) {
    const ev = list[i];
    let step;
    switch (ev.t) {
      case 'battleStart': {
        const bonus = tribeBonuses(ev);
        step = { type: 'start', attacker: ev.attacker, defender: ev.defender, seed: ev.seed, bonus, events: [ev] };
        if (bonus.length) step.base = STEP_MS.bonus;
        break;
      }
      case 'roundStart':
        factor = roundFactor(ev.round);
        step = { type: 'round', round: ev.round, events: [ev] };
        break;
      case 'status':
        step = { type: 'status', side: ev.side, slot: ev.slot, status: ev.status, on: ev.on !== false, source: ev.source || null, events: [ev] };
        break;
      case 'buff':
        step = { type: 'buff', side: ev.side, slot: ev.slot === undefined ? null : ev.slot, stat: ev.stat, delta: ev.delta, permanent: !!ev.permanent, source: ev.source || null, events: [ev] };
        if (isPlayerMaxHp(ev)) {
          // the engine re-applies the player max-HP raises every round start (-x for the old raise, +x for the
          // new one): one step with the net change, silent when nothing changed
          while (i + 1 < list.length && isPlayerMaxHp(list[i + 1]) && list[i + 1].side === ev.side) step.events.push(list[++i]);
          step.delta = step.events.reduce((sum, e) => sum + (Number(e.delta) || 0), 0);
          if (!step.delta) step.base = 1;
        }
        break;
      case 'attack': {
        const hits = [];
        while (i + 1 < list.length && list[i + 1].t === 'damage' && (list[i + 1].cause === 'attack' || list[i + 1].cause === 'reflect')) hits.push(list[++i]);
        step = { type: 'attack', side: ev.side, slot: ev.slot, attack: ev.attack, targets: ev.targets || [], hits, events: [ev, ...hits] };
        if (!step.targets.length && !hits.length) step.base = 200;
        break;
      }
      case 'damage': {
        const hits = [ev];
        while (i + 1 < list.length && list[i + 1].t === 'damage' && list[i + 1].cause === ev.cause && sameSource(list[i + 1].source, ev.source)) hits.push(list[++i]);
        step = { type: 'damage', cause: ev.cause, source: ev.source || null, hits, events: hits.slice() };
        break;
      }
      case 'heal': {
        const heals = [ev];
        while (i + 1 < list.length && list[i + 1].t === 'heal' && sameSource(list[i + 1].source, ev.source)) heals.push(list[++i]);
        step = { type: 'heal', source: ev.source || null, heals, events: heals.slice() };
        break;
      }
      case 'death': {
        const deaths = [ev];
        while (i + 1 < list.length && list[i + 1].t === 'death') deaths.push(list[++i]);
        step = { type: 'death', deaths, events: deaths.slice() };
        break;
      }
      case 'revive':
        step = { type: 'revive', side: ev.side, slot: ev.slot, hp: ev.hp, attack: ev.attack, events: [ev] };
        break;
      case 'roundEnd':
        step = { type: 'roundEnd', round: ev.round, attackerHp: ev.attackerHp, defenderHp: ev.defenderHp, events: [ev] };
        break;
      case 'battleEnd':
        step = { type: 'end', winner: ev.winner, rounds: ev.rounds, attackerHp: ev.attackerHp, defenderHp: ev.defenderHp, endedBy: ev.endedBy, events: [ev] };
        break;
      default:
        step = { type: 'misc', event: ev, events: [ev] };
    }
    if (step.type !== 'start' && step.type !== 'end' && factor !== 1) step.factor = factor;
    step.dur = stepDuration(step, speed);
    steps.push(step);
  }
  return steps;
}

/**
 * The tribe-bonus moment of a fight start: for every side whose player HP the race bonus raised, the HP before
 * and after (+20 %) and the tribe that earned it. The battleStart snapshot carries `tribeBonus` and, for sides
 * built by buildSide(), `baseMaxHp`; otherwise the base is derived from the multiplier.
 * @param {object} start  battleStart event
 * @returns {{side: 'attacker'|'defender', from: number, to: number, tribe: string}[]}
 */
export function tribeBonuses(start) {
  const out = [];
  for (const side of ['attacker', 'defender']) {
    const s = start && start[side];
    const p = s && s.player;
    if (!p || !p.tribeBonus) continue;
    const to = Number(p.maxHp) || 0;
    const from = Number(p.baseMaxHp) > 0 ? Number(p.baseMaxHp) : Math.round(to / TRIBE_BONUS_MULT);
    if (!(to > from)) continue;
    out.push({ side, from, to, tribe: bonusTribe((s.cards || []).filter(Boolean)) || 'neutral' });
  }
  return out;
}

/**
 * The lethal-blow finale (reOM @ 5:51-5:54; ours keeps the cards on the board and draws the whole last round first):
 * the board holds a moment, then a white starburst, then the banner. `countMs` is the original's HP count-down,
 * kept for countdownValue(); the player no longer uses it. ms at 1x.
 */
export const FINALE = Object.freeze({ lead: 250, hold: 450, burst: 200, countMs: 1800 });

/**
 * Index of the step that would drop a losing player's HP to 0 or below (the finale replaces it and every step
 * after it), or -1 when the fight does not end on a player's HP (round limit, no attacks left).
 * @param {object[]} events
 * @param {object[]} [steps]  fromEvents(events) (computed when omitted)
 * @param {object} [final]  finalState(events) (computed when omitted)
 * @returns {number}
 */
export function lethalStep(events, steps = fromEvents(events), final = finalState(events)) {
  const end = (events || []).find((e) => e.t === 'battleEnd');
  if (!end || end.endedBy !== 'playerHp') return -1;
  const lethal = ['attacker', 'defender'].filter((s) => final[s].player.hp <= 0);
  if (!lethal.length) return -1;
  const scratch = initialModel(events);
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].type === 'end') return -1;
    for (const ev of steps[i].events || []) reduceEvent(scratch, ev);
    if (lethal.some((s) => scratch[s].player.hp <= 0)) return i;
  }
  return -1;
}

/**
 * The HP shown during the finale count-down: ease-in from `from` to `to` (k = 0..1).
 * @param {number} from
 * @param {number} to
 * @param {number} k
 * @returns {number}
 */
export function countdownValue(from, to, k) {
  const t = Math.max(0, Math.min(1, Number(k) || 0));
  return Math.round(from + (to - from) * t * t);
}
