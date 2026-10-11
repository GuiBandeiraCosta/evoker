'use strict';

/**
 * The 18 buff handlers of the original simulator (exploration/apk/lua/game.fightsimulatorv2.txt,
 * main.#0 .. main.#17; spec: docs/design/original-engine.md §3), ported literally.
 *
 * Handler signature: (S, card, target, player, opponent, buff, out, ev)
 *   S        engine state (UI log, rng, players, cards)
 *   card     the acting card
 *   target   a card, a direction string (empty slot) or null (buff without directions / scope)
 *   player   the acting card's player in round mode; in event mode, for buffs with directions, the
 *            triggering event's `player` (the attacker's player)
 *   opponent the other player (same rule)
 *   buff     the matched buff
 *   out      engine events produced by this handler (onDamage / onDeath / onHeal)
 *   ev       the triggering event in event mode, else null
 *
 * Every handler mirrors the original's `noBuffsAllowed` guard, rounding and clamping exactly; the only
 * additions are the UI-log emits and the documented extensions (docs/design/ability-encoding.md §3:
 * strengthPercent / baseAttack, cap, unreflectable, heal boost, onHeal events, damagedBy tracking).
 */

import {
  otherId, isCard, ref, playerRef, shownHp, playerHp, emit, emitStatus, emitCardDamage,
  emitPlayerDamage, emitHeal, emitBuff, syncCardMaxHp, syncPlayerMaxHp, markDead,
} from './helpers.js';
import { SLOT_COUNT } from '../battle-state.js';

const round = Math.round;

/** Number of directions of a buff (the original divides by `#directions`; scope buffs and direction-less buffs count as 1). */
function nDirs(buff) {
  return buff.directions && buff.directions.length ? buff.directions.length : 1;
}

/** Damage cause for the UI log: ability damage triggered by a death is shown as `death`. */
function causeOf(ev) {
  return ev && ev.type === 'onDeath' ? 'death' : 'ability';
}

/** Flat strength, or the percent of the target's (base) attack when the buff carries `strengthPercent`. */
function percentOrFlat(buff, card) {
  const pct = buff.strengthPercent;
  if (pct === undefined || pct === null) return buff.strength || 0;
  const base = buff.baseAttack ? (card.origAttack || 0) : (card.attack || 0);
  return round(base * pct / 100);
}

/** Remember that `by` damaged `card` this round (extension field `damagedBySelf`). Shared with the extension handlers. */
export function noteDamage(card, by) {
  if (card.damagedBy) card.damagedBy.add(by);
}

/* --------------------------------------------------------------- statuses */

/** `no_buff`: target.noBuffsAllowed = true. NOT blocked by the source's own noBuffsAllowed. */
export function no_buff(S, card, target, player, opponent, buff) {
  if (!isCard(target)) return;
  target.noBuffsAllowed = true;
  target.suppressedBy = card;
  emitStatus(S, target, 'suspended', card, buff.type);
}

/** `invulnerable`: target.invulnerable = true (per round). */
export function invulnerable(S, card, target, player, opponent, buff) {
  if (card.noBuffsAllowed || !isCard(target)) return;
  target.invulnerable = true;
  emitStatus(S, target, 'indestructible', card, buff.type);
}

/** `no_damage`: target.attack = 0 (per round). Logged as `stunned` when the same card also suppressed the target this round. */
export function no_damage(S, card, target, player, opponent, buff) {
  if (card.noBuffsAllowed || !isCard(target)) return;
  target.attack = 0;
  const stunned = target.noBuffsAllowed && target.suppressedBy === card;
  emitStatus(S, target, stunned ? 'stunned' : 'dazed', card, buff.type);
}

/* ------------------------------------------------------------------ buffs */

/** `raise_attack`: target.attack = max(0, attack + round(strength / #directions)) (per round). */
export function raise_attack(S, card, target, player, opponent, buff) {
  if (card.noBuffsAllowed || !isCard(target)) return;
  const amount = round(percentOrFlat(buff, target) / nDirs(buff));
  target.attack = Math.max(0, (target.attack || 0) + amount);
  emitBuff(S, ref(target), 'attack', amount, false, card, buff.type);
}

/** `raise_hp`: target.hp = max(0, hp + round(strength / #directions)) (per round). */
export function raise_hp(S, card, target, player, opponent, buff) {
  if (card.noBuffsAllowed || !isCard(target)) return;
  const amount = round((buff.strength || 0) / nDirs(buff));
  target.hp = Math.max(0, (target.hp || 0) + amount);
  syncCardMaxHp(S, target, card, buff.type);
}

/** `raise_player_hp`: player.hp = max(0, hp + strength) (per round, not split). */
export function raise_player_hp(S, card, target, player, opponent, buff) {
  if (card.noBuffsAllowed) return;
  const s = buff.strength || 0;
  player.hp = Math.max(0, (player.hp || 0) + s);
  syncPlayerMaxHp(S, player, card, buff.type);
}

/** `increment_attack`: permanent: origAttack = max(0, origAttack + strength); attack += strength. Not split. */
export function increment_attack(S, card, target, player, opponent, buff) {
  if (card.noBuffsAllowed || !isCard(target)) return;
  const s = percentOrFlat(buff, target);
  target.origAttack = Math.max(0, (target.origAttack || 0) + s);
  target.attack = (target.attack || 0) + s;
  emitBuff(S, ref(target), 'attack', s, true, card, buff.type);
}

/* ------------------------------------------------------------------ heals */

/** `heal`: card target, not died: takenDamage -= round(strength / #directions) (may go below 0; clamped at round end). Pushes `onHeal`. */
export function heal(S, card, target, player, opponent, buff, out) {
  if (card.noBuffsAllowed || !isCard(target) || target.died) return;
  const boost = 1 + ((S.players[card.playerId].healBoost || 0) / 100);
  const amount = round((buff.strength || 0) * boost / nDirs(buff));
  target.takenDamage -= amount;
  if (amount !== 0) emitHeal(S, ref(target), amount, shownHp(target), card, buff.type);
  if (amount > 0) out.push({ type: 'onHeal', from: card, to: target, value: amount });
}

/** `heal_player`: player.takenDamage = max(0, takenDamage - strength). */
export function heal_player(S, card, target, player, opponent, buff) {
  if (card.noBuffsAllowed) return;
  const before = player.takenDamage || 0;
  player.takenDamage = Math.max(0, before - (buff.strength || 0));
  const amount = before - player.takenDamage;
  if (amount !== 0) emitHeal(S, playerRef(player), amount, playerHp(player), card, buff.type);
}

/* ----------------------------------------------------------------- attack */

/**
 * Append a target to the attack event of the current (card, buff, event) group, opening the event on
 * the first visible hit. Hits for 0 damage (dazed attacker) are not shown.
 */
function logHit(S, card, buff, ev, where, damage, blocked, direction) {
  let group = S.openAttack;
  if (!group || group.card !== card || group.buff !== buff || group.ev !== ev) {
    group = S.openAttack = { card, buff, ev, event: null };
  }
  if (!(damage > 0)) return;
  if (!group.event) {
    group.event = emit(S, { t: 'attack', ...ref(card), attack: card.attack, bonus: buff.type !== 'attack' || !!ev, targets: [] });
  }
  group.event.targets.push({ ...where, damage, blocked, dir: direction });
}

/**
 * `attack` (also `bonus_attack`): dmg = round(attack / #directions); on an empty slot the opponent
 * player takes round((attack - emptyReduction) / #directions). Invulnerable targets block the hit.
 * Pushes an `onDamage` event for every card hit (unless `unreflectable`). Not blocked by noBuffsAllowed.
 * Extensions: `strengthPercent` (of `origAttack` with `baseAttack`) scales the attack (bonus attacks).
 */
export function attack(S, card, target, player, opponent, buff, out, ev) {
  const n = nDirs(buff);
  const pct = buff.strengthPercent;
  const atk = buff.baseAttack ? card.origAttack : card.attack;
  const base = pct !== undefined && pct !== null ? atk * pct / 100 : atk;
  const dmg = round(base / n);
  let edmg = dmg;
  if (buff.emptyReduction !== undefined && buff.emptyReduction !== null) edmg = round((base - buff.emptyReduction) / n);
  const direction = S.direction || (typeof target === 'string' ? target : null);
  if (isCard(target)) {
    if (target.invulnerable) {
      logHit(S, card, buff, ev, ref(target), dmg, true, direction);
      if (dmg > 0) emitCardDamage(S, target, 0, 'attack', card, buff.type, true);
      return;
    }
    target.takenDamage += dmg;
    if (dmg > 0) noteDamage(target, card);
    if (!buff.unreflectable) out.push({ type: 'onDamage', from: card, to: target, player, opponent, value: dmg });
    logHit(S, card, buff, ev, ref(target), dmg, false, direction);
    if (dmg > 0) emitCardDamage(S, target, dmg, 'attack', card, buff.type);
    return;
  }
  opponent.takenDamage = (opponent.takenDamage || 0) + edmg;
  logHit(S, card, buff, ev, playerRef(opponent), edmg, false, direction);
  if (edmg > 0) emitPlayerDamage(S, opponent, edmg, 'attack', card, buff.type);
}

/* --------------------------------------------------------------- reflects */

/** `reflect_damage` (event mode): for an onDamage event aimed at this card, the attacker takes the same amount (min cap). */
export function reflect_damage(S, card, target, player, opponent, buff, out, ev) {
  if (card.noBuffsAllowed || !ev || ev.type !== 'onDamage' || ev.to !== card) return;
  let value = ev.value;
  if (buff.cap !== undefined && buff.cap !== null) value = Math.min(value, buff.cap);
  if (ev.from.invulnerable) {
    if (value > 0) emitCardDamage(S, ev.from, 0, 'reflect', card, buff.type, true);
    return;
  }
  ev.from.takenDamage = (ev.from.takenDamage || 0) + value;
  if (value > 0) {
    noteDamage(ev.from, card);
    emitCardDamage(S, ev.from, value, 'reflect', card, buff.type);
  }
}

/** `reflect_damage_to_player` (event mode): the attacker's player takes the damage value (min cap). No target check in the client: the data uses eventData `self`. */
export function reflect_damage_to_player(S, card, target, player, opponent, buff, out, ev) {
  if (card.noBuffsAllowed || !ev || ev.type !== 'onDamage') return;
  const p = ev.player || S.players[otherId(card.playerId)];
  let value = ev.value;
  if (buff.cap !== undefined && buff.cap !== null) value = Math.min(value, buff.cap);
  p.takenDamage = (p.takenDamage || 0) + value;
  if (value > 0) emitPlayerDamage(S, p, value, 'reflect', card, buff.type);
}

/* ----------------------------------------------------------------- damage */

/** `deal_damage_to_all_opponent_cards`: every opponent card takes strength (invulnerable blocks); pushes onDamage per card unless `unreflectable`. Not split. */
export function deal_damage_to_all_opponent_cards(S, card, target, player, opponent, buff, out, ev) {
  if (card.noBuffsAllowed) return;
  const s = buff.strength || 0;
  const cards = S.cards[opponent.id];
  for (let i = 1; i <= SLOT_COUNT; i++) {
    const c = cards[i];
    if (!c) continue;
    if (c.invulnerable) {
      if (s > 0) emitCardDamage(S, c, 0, causeOf(ev), card, buff.type, true);
      continue;
    }
    c.takenDamage = (c.takenDamage || 0) + s;
    if (s > 0) noteDamage(c, card);
    if (!buff.unreflectable) out.push({ type: 'onDamage', from: card, to: c, player, opponent, value: s });
    if (s !== 0) emitCardDamage(S, c, s, causeOf(ev), card, buff.type);
  }
}

/** `self_damage`: card.takenDamage += strength. */
export function self_damage(S, card, target, player, opponent, buff, out, ev) {
  if (card.noBuffsAllowed) return;
  const s = buff.strength || 0;
  card.takenDamage = (card.takenDamage || 0) + s;
  if (s !== 0) emitCardDamage(S, card, s, causeOf(ev), card, buff.type);
}

/** `deal_damage_to_opponent_player`: opponent.takenDamage += strength. */
export function deal_damage_to_opponent_player(S, card, target, player, opponent, buff, out, ev) {
  if (card.noBuffsAllowed) return;
  const s = buff.strength || 0;
  opponent.takenDamage = (opponent.takenDamage || 0) + s;
  if (s !== 0) emitPlayerDamage(S, opponent, s, causeOf(ev), card, buff.type);
}

/** `deal_damage_to_player`: own player.takenDamage += strength (Minor Demon, Arch Demon). */
export function deal_damage_to_player(S, card, target, player, opponent, buff, out, ev) {
  if (card.noBuffsAllowed) return;
  const s = buff.strength || 0;
  player.takenDamage = (player.takenDamage || 0) + s;
  if (s !== 0) emitPlayerDamage(S, player, s, causeOf(ev), card, buff.type);
}

/* ----------------------------------------------------------- death / life */

/** `die`: card target not yet dead with hp <= takenDamage -> died, push onDeath. Not blocked by noBuffsAllowed. */
export function die(S, card, target, player, opponent, buff, out) {
  if (!isCard(target) || target.died) return;
  if (target.hp <= target.takenDamage) markDead(S, target, out);
}

/** `resurrect`: acts on the card itself, once per fight: takenDamage = 0, died = false. */
export function resurrect(S, card, target, player, opponent, buff) {
  if (card.noBuffsAllowed || card.resurrected) return;
  card.takenDamage = 0;
  card.died = false;
  card.resurrected = true;
  emit(S, { t: 'revive', ...ref(card), hp: shownHp(card), attack: card.attack, source: { ...ref(card), effect: buff.type } });
}
