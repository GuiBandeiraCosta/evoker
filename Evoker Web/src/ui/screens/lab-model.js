'use strict';
/**
 * The Card Lab's pure part (no DOM, unit-tested in tests/lab-effects.test.js): scenario builders, the fight runner
 * and the effect showcase - one entry per effect type an ability can have, with the card, preset and seed that
 * show it earliest and what to look for on the battle screen.
 */
import { sideOptions } from '../../game/opponents.js';
import { summariseBattle } from '../../engine/battle.js';
import { hasAbility, abilityForStage } from '../../core/abilities.js';
import { capFor } from '../../core/stats.js';

/** Both players' HP in the lab (enough for several rounds against maxed cards). */
export const LAB_HP = 10000;

/** @typedef {{cardId: string, stage: number, level: number}} LabSlot */

/**
 * Ability-free direct attackers of the catalog, so that only the tested card's ability is in play: `weak` hits
 * softly (lowest base attack) and `strong` kills (highest) - the opponent presets - and `ally` lasts (highest base
 * hp), so that allies are still standing when a round-2 or on-death effect reaches them. With `tribe`, only cards
 * of that tribe (abilities that work on "your orcs" etc.); falls back to any tribe when it has no plain card.
 * @param {object} db
 * @param {string|null} [tribe]
 * @returns {{weak: object, strong: object, ally: object}}
 */
export function fillerCards(db, tribe = null) {
  let plain = db.all().filter((d) => !d.trainer && d.base && d.base.attack > 0 && (d.dirs || []).includes('direct')
    && ![0, 1, 2, 3, 4].some((s) => hasAbility(d.ability, s)));
  if (tribe) { const ofTribe = plain.filter((d) => d.tribe === tribe); if (ofTribe.length) plain = ofTribe; }
  const byAttack = plain.slice().sort((a, b) => a.base.attack - b.base.attack || a.mana - b.mana);
  const byHp = plain.slice().sort((a, b) => b.base.hp - a.base.hp || b.base.attack - a.base.attack);
  return { weak: byAttack[0], strong: byAttack[byAttack.length - 1], ally: byHp[0] };
}

/**
 * The tribe an ability's buffs are restricted to (`filter.tribe`, e.g. Bone Oracle's "neighbors, if orcs"), so the
 * allies can be of that tribe; null when unrestricted.
 * @param {object|null|undefined} ability
 * @param {number} stage
 * @returns {string|null}
 */
export function requiredTribe(ability, stage) {
  const a = abilityForStage(ability, stage);
  for (const b of (a && a.buffs) || []) if (b && b.filter && typeof b.filter.tribe === 'string') return b.filter.tribe;
  return null;
}

/** A slot of `cardId` at `stage`, at the stage's level cap. */
export const slotAt = (db, cardId, stage) => ({ cardId, stage, level: capFor(db.get(cardId), stage) });

/**
 * The simplest scenario around a card: it sits in the middle of the own row between two sturdy allies at its own
 * stage and level (of the ability's tribe when it is restricted to one); five fillers at that stage and level
 * stand opposite (weak or strong).
 * @param {object} db
 * @param {string} cardId
 * @param {number} stage
 * @param {number} level
 * @param {boolean} strong
 * @returns {{own: (LabSlot|null)[], opp: (LabSlot|null)[]}}
 */
export function autoScenario(db, cardId, stage, level, strong = false) {
  const def = db.get(cardId);
  const tribe = def ? requiredTribe(def.ability, stage) : null;
  const { ally } = fillerCards(db, tribe);
  const { weak, strong: hard } = fillerCards(db);
  const at = (d) => ({ cardId: d.id, stage, level: Math.min(level, capFor(d, stage)) });
  const foe = strong ? hard : weak;
  return {
    own: [at(ally), at(ally), { cardId, stage, level }, at(ally), at(ally)],
    opp: [at(foe), at(foe), at(foe), at(foe), at(foe)],
  };
}

/**
 * Run the scenario through the engine.
 * @param {object} deps
 * @param {{own: (LabSlot|null)[], opp: (LabSlot|null)[], hp: number, seed: number}} setup
 * @returns {{battle: object, summary: object}}
 */
export function runLabFight(deps, setup) {
  const opts = sideOptions(deps);
  const inst = (slot, side, i) => (slot && slot.cardId ? { uid: `lab-${side}-${i}`, cardId: slot.cardId, stage: slot.stage | 0, level: Math.max(1, slot.level | 0), xp: 0, evolveQuality: 1 } : null);
  const attacker = deps.engine.buildSide({ name: 'You', hp: setup.hp, maxHp: setup.hp }, setup.own.map((s, i) => inst(s, 'own', i)), opts);
  const defender = deps.engine.buildSide({ name: 'Lab opponent', hp: setup.hp, maxHp: setup.hp }, setup.opp.map((s, i) => inst(s, 'opp', i)), opts);
  const battle = deps.engine.simulateBattle({ attacker, defender, seed: setup.seed });
  return { battle, summary: summariseBattle(battle.events) };
}

/* ------------------------------------------------------------------ the showcase */

/**
 * @typedef {object} Showcase
 * @property {string} type     effect (buff) type, as in data/abilities.json
 * @property {string} label    short name
 * @property {string} what     what the effect does
 * @property {string} look     what to look for on the battle screen (src/ui/battle-player.js effect table)
 * @property {string} cardId   the card that shows it
 * @property {number} stage    fusion stage of that card (and of the fillers)
 * @property {boolean} strong  opponent preset
 * @property {number} seed     fight seed (random effects replay identically)
 * @property {(db: object) => {own: (LabSlot|null)[], opp: (LabSlot|null)[]}} [rows]  hand-built rows when the
 *           auto scenario cannot show the effect (it needs other ability cards on the board)
 */

/** @type {Showcase[]} */
export const SHOWCASE = [
  { type: 'raise_attack', label: 'Raise attack', what: 'Targets hit harder this round (flat or %).', look: 'Red sword arrows and a glow on the boosted cards, "+N" in orange over them; their attack number rises for the round.', cardId: 'air-elemental', stage: 4, strong: false, seed: 1 },
  { type: 'increment_attack', label: 'Increment attack (permanent)', what: 'Attack grows for good, accumulating every time it triggers.', look: 'The same sword arrows and "+N", but the attack number stays raised after the round.', cardId: 'baby-dragon', stage: 4, strong: true, seed: 1 },
  { type: 'raise_hp', label: 'Raise HP', what: 'Targets get more maximum HP.', look: 'Green heart arrows and "+N" on the neighbours; their HP numbers go up.', cardId: 'arch-angel', stage: 4, strong: false, seed: 1 },
  { type: 'raise_player_hp', label: 'Raise player HP', what: 'Your own player gets more maximum HP.', look: 'Your HP bar (bottom) jumps to a bigger maximum right at the start.', cardId: 'dwarven-sage', stage: 4, strong: false, seed: 1 },
  { type: 'reduce_ability_attack_percent', label: 'Weaken ability cards', what: 'Every card with an ability loses X % of its attack in round 1.', look: 'Red "-N" debuff arrows on all five enemy Air Elementals (ability cards) in round 1; the allies, with no ability, are untouched.', cardId: 'medusa', stage: 4, strong: false, seed: 1, rows: (db) => { const { ally } = fillerCards(db); const a = (id) => slotAt(db, id, 4); return { own: [a(ally.id), a(ally.id), a('medusa'), a(ally.id), a(ally.id)], opp: [a('air-elemental'), a('air-elemental'), a('air-elemental'), a('air-elemental'), a('air-elemental')] }; } },
  { type: 'heal', label: 'Heal', what: 'Heals the cards in its directions every round.', look: 'Green glow on the healer, green "+N" on the healed cards, their HP bars refill.', cardId: 'airborne-parasite', stage: 4, strong: false, seed: 1 },
  { type: 'heal_player', label: 'Heal player', what: 'Heals your own player.', look: 'Your HP bar (bottom) flashes green with a "+N".', cardId: 'astral-navigator', stage: 4, strong: true, seed: 1 },
  { type: 'heal_boost_percent', label: 'Heal boost', what: 'Your other cards\' heals are X % stronger while it lives.', look: 'The two Alchemists\' green "+N" on their neighbours are bigger than an Alchemist\'s own heal value (compare the card\'s ability value).', cardId: 'djinn', stage: 4, strong: false, seed: 1, rows: (db) => { const { ally, weak } = fillerCards(db); const a = (id) => slotAt(db, id, 4); return { own: [a('alchemist'), a(ally.id), a('djinn'), a(ally.id), a('alchemist')], opp: [a(weak.id), a(weak.id), a(weak.id), a(weak.id), a(weak.id)] }; } },
  { type: 'deal_damage_to_opponent_player', label: 'Damage the enemy player', what: 'Direct damage to the opposing player every round, past the cards.', look: 'A bolt from the card to the enemy HP bar (top), the bar flashes red with "-N".', cardId: 'raptorial-fungus', stage: 4, strong: false, seed: 1 },
  { type: 'deal_damage_to_player', label: 'Damage your own player', what: 'The card hurts its own player every round (a drawback).', look: 'A bolt from the card to your own HP bar (bottom), "-N" on it.', cardId: 'arch-demon', stage: 4, strong: false, seed: 1 },
  { type: 'deal_damage_to_all_opponent_cards', label: 'Damage all enemies', what: 'Hits every enemy card at once, regardless of direction.', look: 'Bolts from the card to all five enemy cards at the same time, each with a burst and "-N".', cardId: 'lightning-spirit', stage: 4, strong: false, seed: 1 },
  { type: 'bonus_attack', label: 'Bonus attack (on death)', what: 'An extra attack with a share of its attack, typically when it dies.', look: 'When the card dies, one more attack beam leaves it before it shatters.', cardId: 'flameling', stage: 4, strong: true, seed: 1 },
  { type: 'self_damage', label: 'Self damage', what: 'The card wounds itself every round.', look: 'A damage burst and "-N" on the card itself with nobody attacking it.', cardId: 'blood-spitter', stage: 0, strong: true, seed: 1 },
  { type: 'reflect_damage', label: 'Reflect damage', what: 'Whoever hits it takes the same damage back.', look: 'A shockwave on the reflector and the beam bounces back to the attacker, which takes a burst and "-N".', cardId: 'lookalike', stage: 4, strong: false, seed: 1 },
  { type: 'reflect_damage_to_player', label: 'Reflect to the enemy player', what: 'Whoever hits it, their player takes the damage (capped).', look: 'The bounce goes from the card to the enemy HP bar (top) instead of the attacker.', cardId: 'loremaster', stage: 4, strong: true, seed: 1 },
  { type: 'kill', label: 'Kill', what: 'Outright kills a chosen card at the end of a given round, ignoring HP.', look: 'At the end of round 2 the enemy with the highest attack explodes with a skull/attacked icon and dies, whatever its HP (the sturdy opponents survive the weak allies until then).', cardId: 'colossus', stage: 4, strong: false, seed: 1, rows: (db) => { const { ally, weak } = fillerCards(db); return { own: [slotAt(db, weak.id, 0), slotAt(db, weak.id, 0), slotAt(db, 'colossus', 4), slotAt(db, weak.id, 0), slotAt(db, weak.id, 0)], opp: [slotAt(db, ally.id, 4), slotAt(db, ally.id, 4), slotAt(db, ally.id, 4), slotAt(db, ally.id, 4), slotAt(db, ally.id, 4)] }; } },
  { type: 'invulnerable', label: 'Invulnerable', what: 'Takes no damage (in given rounds, for neighbours, or for its tribe).', look: 'A golden aura with rays on the protected card; hits on it show "blocked" with a shield icon.', cardId: 'anvil-guard', stage: 4, strong: false, seed: 1 },
  { type: 'no_damage', label: 'Dazed (deals no damage)', what: 'The target cannot deal damage for a while.', look: 'The dazed status icon on the enemy opposite; its attack beam lands for 0.', cardId: 'basilisk', stage: 4, strong: false, seed: 1 },
  { type: 'no_buff', label: 'Suspended (ability off)', what: 'The ability of the target is switched off.', look: 'The suspended status icon on the enemy opposite in round 1; its ability does nothing that round.', cardId: 'scorpion-rider', stage: 4, strong: false, seed: 1 },
  { type: 'stun_pattern', label: 'Stun pattern', what: 'Dazes and suspends the front and sides in odd rounds, the diagonals in even rounds.', look: 'Dazed + suspended icons on three enemies, then on the two diagonal ones, alternating every round.', cardId: 'thief-of-time', stage: 4, strong: false, seed: 1 },
  { type: 'resurrect', label: 'Resurrect', what: 'The first time it dies it comes back (at full health, or with more attack).', look: 'The card shatters, then returns in a big glow with a lens flare.', cardId: 'phoenix', stage: 4, strong: true, seed: 1 },
  { type: 'resurrect_allies', label: 'Resurrect allies', what: 'When it dies, every ally that died this round returns with it.', look: 'Moon Dragon dies and all the allies that fell this round come back in a glow.', cardId: 'moon-dragon', stage: 4, strong: true, seed: 1 },
];

/**
 * The rows of a showcase entry (hand-built or the auto scenario).
 * @param {object} db
 * @param {Showcase} entry
 */
export function showcaseScenario(db, entry) {
  if (entry.rows) return entry.rows(db);
  return autoScenario(db, entry.cardId, entry.stage, capFor(db.get(entry.cardId), entry.stage), entry.strong);
}

/**
 * The round in which an effect of `type` sourced by the own middle card (slot 2) first shows in an event log, or
 * null. Effects without an event of their own are judged by what they cause (a heal boost by heals of own cards).
 * @param {object[]} events
 * @param {string} type
 * @returns {number|null}
 */
export function effectFires(events, type) {
  let round = 0;
  const mine = (e) => e.source && e.source.side === 'attacker' && e.source.slot === 2;
  for (const e of events) {
    if (e.t === 'roundStart') round = e.round;
    const eff = e.source && e.source.effect;
    if (eff === type && mine(e)) return round;
    switch (type) {
      case 'resurrect': if (e.t === 'revive' && e.side === 'attacker' && e.slot === 2) return round; break;
      case 'resurrect_allies': if (e.t === 'revive' && e.side === 'attacker') return round; break;
      case 'swap_stats_random': if (e.t === 'swap') return round; break;
      case 'gamble': if (e.t === 'gamble') return round; break;
      case 'kill': if ((e.t === 'damage' || e.t === 'death') && e.cause === 'kill') return round; break;
      case 'heal_boost_percent': if (e.t === 'heal' && e.side === 'attacker' && round >= 1) return round; break;
      case 'self_damage': if (e.t === 'damage' && e.side === 'attacker' && e.slot === 2 && e.cause !== 'attack') return round; break;
      default: break;
    }
  }
  return null;
}
