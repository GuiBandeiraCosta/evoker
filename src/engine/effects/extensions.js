'use strict';

/**
 * Extension buff types (docs/design/original-engine.md §8, docs/design/ability-encoding.md §3) for cards
 * added after the 2016 client and for the help-text caps. They share the handler signature of
 * handlers.js and are placed in the phase list of effects/index.js at the position their semantics
 * need. Set-targeting buffs (`scope` + `filter` + `pick`) are resolved by the dispatcher in battle.js,
 * which calls the handler once per chosen card; the ONCE types are called a single time with target null.
 * Randomness only through `S.rng`; random picks are memoised per (card, round, scope) by the dispatcher.
 */

import {
  otherId, isCard, ref, target as targetOf, shownHp, emit, emitCardDamage, emitHeal, emitBuff, markDead,
} from './helpers.js';
import { attack, no_buff, no_damage, noteDamage } from './handlers.js';
import { SLOT_COUNT, ROUND_EVENTS } from '../battle-state.js';

const round = Math.round;

/** Does a card have an ability besides its normal attack (and the implicit die)? */
export function hasAbilityBuffs(card) {
  return card.buffs.some((b) => b.type !== 'attack' && b.type !== 'die');
}

/** Is the card "offensive" (has a normal attack with at least one direction)? */
export function isOffensive(card) {
  return card.buffs.some((b) => b.type === 'attack' && ROUND_EVENTS.includes(b.event) && b.directions && b.directions.length > 0);
}

/** Percent of a buff (strengthPercent, else strength). */
function pctOf(buff) {
  const p = buff.strengthPercent;
  return p === undefined || p === null ? (buff.strength || 0) : p;
}

/**
 * `bonus_attack`: an extra attack with strengthPercent of the card's attack (origAttack with baseAttack)
 * in the buff's directions (Schemer, Warg Rider, Flameling, Goblin Patriarch: `onDeath` / `self`).
 */
export function bonus_attack(S, card, target, player, opponent, buff, out, ev) {
  if (card.noBuffsAllowed) return;
  attack(S, card, target, player, opponent, buff, out, ev);
}

/**
 * `kill` (round mode, `round_eq N`, scope + pick + count resolved by the dispatcher): the chosen card is
 * marked dead (ignores invulnerable) and `onDeath` is pushed.
 */
export function kill(S, card, target, player, opponent, buff, out) {
  if (card.noBuffsAllowed || !isCard(target) || target.died) return;
  const remaining = Math.max(0, target.hp - target.takenDamage);
  target.takenDamage = Math.max(target.takenDamage, target.hp);
  emitCardDamage(S, target, remaining, 'kill', card, buff.type);
  markDead(S, target, out);
}

/**
 * `resurrect_allies` (Moon Dragon, `onDeath` / `self`, ONCE): every own card that died this round,
 * itself included, returns to full health; a card is never revived twice (`resurrected` flag).
 */
export function resurrect_allies(S, card, target, player, opponent, buff) {
  if (card.noBuffsAllowed || card.resurrectAlliesUsed) return;
  card.resurrectAlliesUsed = true;
  const own = S.cards[card.playerId];
  for (let i = 1; i <= SLOT_COUNT; i++) {
    const c = own[i];
    if (!c || !c.died || c.resurrected) continue;
    c.takenDamage = 0;
    c.died = false;
    c.resurrected = true;
    emit(S, { t: 'revive', ...ref(c), hp: shownHp(c), attack: c.attack, source: { ...ref(card), effect: buff.type } });
  }
}

/** `swap_stats_random` (Goblin Thieves, round 1): the chosen card swaps its attack and hp (orig values too). */
export function swap_stats_random(S, card, target, player, opponent, buff) {
  if (card.noBuffsAllowed || !isCard(target)) return;
  const v = target;
  const a = v.origAttack;
  v.origAttack = v.origHp;
  v.origHp = a;
  v.attack = v.origAttack;
  v.hp = v.origHp;
  v.uiMaxHp = v.hp;
  emit(S, { t: 'swap', ...ref(v), attack: v.attack, hp: shownHp(v), maxHp: v.hp, source: { ...ref(card), effect: buff.type } });
}

/**
 * `wheel` (Wheel of Fortune, per card of the scope): healed by strength (50 %) or damaged by strength
 * (50 %; invulnerable blocks, pushes onDamage). One roll per card.
 */
export function wheel(S, card, target, player, opponent, buff, out) {
  if (card.noBuffsAllowed || !isCard(target)) return;
  const s = buff.strength || 0;
  const c = target;
  if (S.rng.chance(0.5)) {
    c.takenDamage -= s;
    if (s !== 0) emitHeal(S, ref(c), s, shownHp(c), card, buff.type);
    if (s > 0) out.push({ type: 'onHeal', from: card, to: c, value: s });
  } else if (c.invulnerable) {
    if (s > 0) emitCardDamage(S, c, 0, 'ability', card, buff.type, true);
  } else {
    c.takenDamage += s;
    if (s > 0) noteDamage(c, card);
    out.push({ type: 'onDamage', from: card, to: c, player, opponent, value: s });
    if (s !== 0) emitCardDamage(S, c, s, 'ability', card, buff.type);
  }
}

/**
 * `gamble` (Wizard Apprentice, per card of the scope): one roll per (card, round): with probability
 * strengthPercent % the spell fails and the targets lose 25 % attack this round, otherwise they gain 25 %.
 */
export function gamble(S, card, target, player, opponent, buff) {
  if (card.noBuffsAllowed || !isCard(target)) return;
  const key = `gamble:${card.playerId}:${card.id}:${S.round}`;
  let failed = S.memo.get(key);
  if (failed === undefined) {
    failed = S.rng.chance(pctOf(buff) / 100);
    S.memo.set(key, failed);
    emit(S, { t: 'gamble', ...ref(card), failed, source: { ...ref(card), effect: buff.type } });
  }
  const delta = round(target.attack * 0.25) * (failed ? -1 : 1);
  if (delta === 0) return;
  target.attack = Math.max(0, target.attack + delta);
  emitBuff(S, ref(target), 'attack', delta, false, card, buff.type);
}

/** `heal_boost_percent` (Djinn, ONCE): the side's card heals this round are multiplied by (1 + pct / 100); several Djinns add. */
export function heal_boost_percent(S, card, target, player, opponent, buff) {
  if (card.noBuffsAllowed) return;
  const p = S.players[card.playerId];
  p.healBoost = (p.healBoost || 0) + pctOf(buff);
}

/** `reduce_ability_attack_percent` (Medusa / Dark Mage, per card of the scope): the target loses pct % of its attack this round. */
export function reduce_ability_attack_percent(S, card, target, player, opponent, buff) {
  if (card.noBuffsAllowed || !isCard(target)) return;
  const delta = -round(target.attack * pctOf(buff) / 100);
  if (delta === 0) return;
  target.attack = Math.max(0, target.attack + delta);
  emitBuff(S, ref(target), 'attack', delta, false, card, buff.type);
}

/** Targets of the Thief of Time pattern: odd rounds front + own neighbours, even rounds the enemy diagonals. */
function stunTargets(S, card) {
  const dirs = S.round % 2 === 1 ? ['front', 'left', 'right'] : ['frontLeft', 'frontRight'];
  const own = S.cards[card.playerId];
  const opp = S.cards[otherId(card.playerId)];
  return dirs.map((d) => targetOf(card.id, d, own, opp)).filter(isCard);
}

/** `stun_pattern`, suppress part (ONCE, runs right after `no_buff`): `no_buff` on every pattern target (so, like it, NOT blocked by the source's noBuffsAllowed). */
export function stun_pattern_suppress(S, card, target, player, opponent, buff) {
  for (const t of stunTargets(S, card)) no_buff(S, card, t, player, opponent, buff);
}

/** `stun_pattern`, daze part (ONCE, runs right after `no_damage`): `no_damage` on every pattern target. */
export function stun_pattern_daze(S, card, target, player, opponent, buff) {
  for (const t of stunTargets(S, card)) no_damage(S, card, t, player, opponent, buff);
}

