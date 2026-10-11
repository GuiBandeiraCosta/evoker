'use strict';

/**
 * Handler registry and phase list of the original simulator (docs/design/original-engine.md §5),
 * with the extension phases inserted where their semantics need them (ability-encoding.md §3.1).
 * For cards that only use the 18 original buff types the extension phases are no-ops, so the original
 * order is preserved exactly.
 */

import * as h from './handlers.js';
import * as x from './extensions.js';

/** The 18 original buff types in their handler-registration order. */
export const ORIGINAL_TYPES = Object.freeze([
  'no_buff', 'heal', 'raise_attack', 'raise_hp', 'raise_player_hp', 'heal_player', 'increment_attack',
  'invulnerable', 'no_damage', 'attack', 'resurrect', 'die', 'reflect_damage', 'reflect_damage_to_player',
  'deal_damage_to_opponent_player', 'deal_damage_to_player', 'deal_damage_to_all_opponent_cards', 'self_damage',
]);

/** Extension buff types (original-engine.md §8). */
export const EXTENSION_TYPES = Object.freeze([
  'bonus_attack', 'kill', 'resurrect_allies', 'swap_stats_random', 'wheel', 'gamble', 'heal_boost_percent',
  'reduce_ability_attack_percent', 'stun_pattern',
]);

/** @type {Record<string, Function>} handler name -> function */
export const HANDLERS = Object.freeze({
  no_buff: h.no_buff,
  heal: h.heal,
  raise_attack: h.raise_attack,
  raise_hp: h.raise_hp,
  raise_player_hp: h.raise_player_hp,
  heal_player: h.heal_player,
  increment_attack: h.increment_attack,
  invulnerable: h.invulnerable,
  no_damage: h.no_damage,
  attack: h.attack,
  resurrect: h.resurrect,
  die: h.die,
  reflect_damage: h.reflect_damage,
  reflect_damage_to_player: h.reflect_damage_to_player,
  deal_damage_to_opponent_player: h.deal_damage_to_opponent_player,
  deal_damage_to_player: h.deal_damage_to_player,
  deal_damage_to_all_opponent_cards: h.deal_damage_to_all_opponent_cards,
  self_damage: h.self_damage,
  bonus_attack: x.bonus_attack,
  kill: x.kill,
  resurrect_allies: x.resurrect_allies,
  swap_stats_random: x.swap_stats_random,
  wheel: x.wheel,
  gamble: x.gamble,
  heal_boost_percent: x.heal_boost_percent,
  reduce_ability_attack_percent: x.reduce_ability_attack_percent,
  stun_pattern_suppress: x.stun_pattern_suppress,
  stun_pattern_daze: x.stun_pattern_daze,
});

/**
 * Phase list: one buff type per phase, in the original order
 *   no_buff, raise_attack, raise_hp, raise_player_hp, increment_attack, invulnerable, no_damage, attack,
 *   reflect_damage, reflect_damage_to_player, deal_damage_to_all_opponent_cards, self_damage, heal,
 *   heal_player, die, resurrect, deal_damage_to_opponent_player, deal_damage_to_player
 * with the extension phases interleaved (marked `ext`). `handler` names the registry entry when it
 * differs from the type (stun_pattern runs in two parts).
 * @type {ReadonlyArray<{type: string, handler?: string, ext?: boolean}>}
 */
export const PHASES = Object.freeze([
  { type: 'no_buff' },
  { type: 'stun_pattern', handler: 'stun_pattern_suppress', ext: true },
  { type: 'swap_stats_random', ext: true },
  { type: 'raise_attack' },
  { type: 'raise_hp' },
  { type: 'raise_player_hp' },
  { type: 'increment_attack' },
  { type: 'gamble', ext: true },
  { type: 'reduce_ability_attack_percent', ext: true },
  { type: 'invulnerable' },
  { type: 'no_damage' },
  { type: 'stun_pattern', handler: 'stun_pattern_daze', ext: true },
  { type: 'attack' },
  { type: 'bonus_attack', ext: true },
  { type: 'reflect_damage' },
  { type: 'reflect_damage_to_player' },
  { type: 'deal_damage_to_all_opponent_cards' },
  { type: 'self_damage' },
  { type: 'heal_boost_percent', ext: true },
  { type: 'heal' },
  { type: 'wheel', ext: true },
  { type: 'heal_player' },
  { type: 'die' },
  { type: 'resurrect' },
  { type: 'resurrect_allies', ext: true },
  { type: 'deal_damage_to_opponent_player' },
  { type: 'deal_damage_to_player' },
  { type: 'kill', ext: true },
]);

/** The `die` phase entry (run again after every event-loop pass). */
export const DIE_PHASE = PHASES.find((p) => p.type === 'die');

/**
 * Original buff types whose handler ignores its target. When such a buff carries directions and fires in
 * event mode, the directions act as a trigger filter: the handler runs only for directions whose target
 * is the event's `to` card ("if the card opposite dies ...", ability-encoding.md §2.3).
 */
export const TARGETLESS_TYPES = new Set([
  'raise_player_hp', 'heal_player', 'self_damage', 'deal_damage_to_opponent_player', 'deal_damage_to_player',
  'deal_damage_to_all_opponent_cards', 'resurrect',
]);

/** Extension types called once per matched buff (target null) whatever their scope says. */
export const ONCE_TYPES = new Set(['heal_boost_percent', 'resurrect_allies', 'stun_pattern']);
