'use strict';
/**
 * Parity fuzz fixture for EvokerCore (Tests/EvokerCoreTests/Parity/engine-fuzz.json): random raw-buff fights run
 * through the WEB engine, timeline and board model. The Swift ParityTests replay every case and compare the
 * event log, the result, the playback steps, the final board and the lethal step. Unlike the goldens (real
 * cards only) the buffs here cover every handler, event, scope / pick / filter and extension field in random
 * combinations, so engine paths the catalog never reaches are compared too.
 *
 *   node Tools/gen-parity.mjs [cases] [seed]   (from Evoker iOS/; the committed fixture is 400 cases, seed 20261011)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '../../Evoker Web');
const out = path.resolve(here, '../EvokerCore/Tests/EvokerCoreTests/Parity/engine-fuzz.json');

const { mulberry32 } = await import(`file:///${web.replace(/\\/g, '/')}/src/core/rng.js`);
const { simulateBattle } = await import(`file:///${web.replace(/\\/g, '/')}/src/engine/battle.js`);
const { fromEvents, lethalStep } = await import(`file:///${web.replace(/\\/g, '/')}/src/ui/battle/timeline.js`);
const { finalState } = await import(`file:///${web.replace(/\\/g, '/')}/src/ui/battle/model.js`);

const rng = mulberry32(Number(process.argv[3] || 20261011));
const pick = (arr) => arr[rng.int(arr.length)];
const chance = (p) => rng.next() < p;
const int = (lo, hi) => lo + rng.int(hi - lo + 1);

const DIRS = ['front', 'frontLeft', 'frontRight', 'left', 'right', 'self'];
const CARD_DIRS = ['direct', 'left', 'right', 'ownLeft', 'ownRight'];
const TRIBES = ['dwarf', 'elf', 'orc', 'neutral', 'Orks', 'Elfen'];
const SCOPES = ['own_cards', 'opponent_cards', 'all_cards', 'each_side'];
const PICKS = ['highest_attack', 'lowest_attack', 'random'];
const ROUND_EVENTS = ['always', 'always', 'always', 'round_eq', 'round_ge', 'round_le', 'round_odd', 'round_even'];
const EVENT_EVENTS = ['onDamage', 'onDeath', 'onHeal'];
const EVENT_DATA = [undefined, 'self', 'opponent_cards', 'own_cards'];

function someDirs(min = 1) {
  const n = int(min, 3);
  const set = new Set();
  while (set.size < n) set.add(pick(DIRS));
  return [...set];
}

function roundEvent(b) {
  b.event = pick(ROUND_EVENTS);
  if (['round_eq', 'round_ge', 'round_le'].includes(b.event)) b.eventData = int(1, 4);
}

function anyEvent(b) {
  if (chance(0.55)) { roundEvent(b); return; }
  b.event = pick(EVENT_EVENTS);
  const ed = pick(EVENT_DATA);
  if (ed !== undefined) b.eventData = ed;
  if (chance(0.15)) b.nextRound = true;
  if (chance(0.15)) b.triggerDirection = pick(DIRS.filter((d) => d !== 'self'));
  if (b.event === 'onDeath' && chance(0.2)) b.damagedBySelf = true;
}

/** Round mode, or an onDeath trigger (never onDamage: see randomBuff). */
function deathEvent(b) {
  if (chance(0.55)) { roundEvent(b); return; }
  b.event = 'onDeath';
  const ed = pick(EVENT_DATA);
  if (ed !== undefined) b.eventData = ed;
  if (chance(0.15)) b.nextRound = true;
  if (chance(0.15)) b.triggerDirection = pick(DIRS.filter((d) => d !== 'self'));
  if (chance(0.2)) b.damagedBySelf = true;
}

function scoped(b) {
  b.scope = pick(SCOPES);
  if (chance(0.7)) { b.pick = pick(PICKS); b.count = int(1, 3); }
  if (chance(0.4)) {
    b.filter = {};
    const keys = ['tribe', 'offensive', 'excludeSelf', 'hasAbility'];
    for (const k of keys) if (chance(0.4)) b.filter[k] = k === 'tribe' ? pick(['dwarf', 'elf', 'orc', 'neutral']) : true;
    if (!Object.keys(b.filter).length) b.filter.excludeSelf = true;
  }
}

function strengthOrPercent(b) {
  if (chance(0.3)) { b.strengthPercent = int(5, 150); if (chance(0.5)) b.baseAttack = true; } else b.strength = int(5, 300);
}

/** One random buff in the engine's raw shape. */
function randomBuff() {
  const type = pick([
    'no_buff', 'heal', 'raise_attack', 'raise_hp', 'raise_player_hp', 'heal_player', 'increment_attack', 'invulnerable',
    'no_damage', 'attack', 'resurrect', 'reflect_damage', 'reflect_damage_to_player', 'deal_damage_to_opponent_player',
    'deal_damage_to_player', 'deal_damage_to_all_opponent_cards', 'self_damage', 'bonus_attack', 'kill', 'resurrect_allies',
    'swap_stats_random', 'wheel', 'gamble', 'heal_boost_percent', 'reduce_ability_attack_percent', 'stun_pattern',
    'heal', 'raise_attack', 'attack', 'reflect_damage', 'deal_damage_to_opponent_player', 'bonus_attack',
  ]);
  const b = { type };
  switch (type) {
    case 'no_buff': case 'invulnerable': case 'no_damage':
      if (chance(0.25)) scoped(b); else b.directions = someDirs();
      anyEvent(b); break;
    case 'heal':
      if (chance(0.25)) scoped(b); else b.directions = someDirs();
      b.strength = int(5, 300);
      if (b.directions && chance(0.2)) b.perTarget = true;
      anyEvent(b);
      // an onHeal-triggered heal of several cards multiplies the heal events without end: only the self-heal form
      if (b.event === 'onHeal') { b.eventData = 'self'; delete b.scope; delete b.pick; delete b.count; delete b.filter; b.directions = ['self']; delete b.perTarget; }
      if (['onHeal', 'onDamage'].includes(b.event) && chance(0.4)) { delete b.strength; b.strengthFromEvent = true; }
      break;
    case 'raise_attack': case 'increment_attack':
      if (chance(0.25)) scoped(b); else b.directions = someDirs();
      strengthOrPercent(b);
      if (b.directions && b.strength !== undefined && chance(0.15)) b.perTarget = true;
      if (chance(0.3)) b.strength = -Math.abs(b.strength || 50);
      anyEvent(b); break;
    case 'raise_hp':
      if (chance(0.25)) scoped(b); else b.directions = someDirs();
      b.strength = chance(0.2) ? -int(5, 100) : int(5, 300);
      anyEvent(b); break;
    case 'raise_player_hp': case 'heal_player': case 'deal_damage_to_player': case 'deal_damage_to_opponent_player':
    case 'self_damage': case 'deal_damage_to_all_opponent_cards':
      b.strength = int(5, 300);
      b.directions = chance(0.35) ? someDirs() : [];
      if (type === 'deal_damage_to_all_opponent_cards' && chance(0.3)) b.unreflectable = true;
      // card damage in event mode only on deaths (an onDamage trigger would multiply the damage events without end)
      if (type === 'deal_damage_to_all_opponent_cards') deathEvent(b); else anyEvent(b);
      break;
    case 'attack':
      b.directions = chance(0.9) ? someDirs() : [];
      if (chance(0.3)) b.emptyReduction = int(0, 150);
      if (chance(0.2)) b.unreflectable = true;
      if (chance(0.15)) { b.strengthPercent = int(20, 200); if (chance(0.5)) b.baseAttack = true; }
      roundEvent(b); break;
    case 'resurrect':
      b.directions = ['self']; b.event = 'onDeath'; b.eventData = chance(0.8) ? 'self' : undefined; break;
    case 'reflect_damage': case 'reflect_damage_to_player':
      b.directions = ['self']; b.event = 'onDamage'; b.eventData = chance(0.8) ? 'self' : pick(EVENT_DATA);
      if (chance(0.5)) b.cap = int(10, 200);
      if (chance(0.1)) b.nextRound = true;
      break;
    case 'bonus_attack':
      b.directions = chance(0.85) ? someDirs() : [];
      b.strengthPercent = int(20, 200);
      if (chance(0.5)) b.baseAttack = true;
      if (chance(0.3)) b.emptyReduction = int(0, 100);
      b.event = 'onDeath';
      const ed = pick(EVENT_DATA); if (ed !== undefined) b.eventData = ed;
      if (chance(0.2)) b.nextRound = true;
      if (chance(0.2)) b.triggerDirection = pick(DIRS.filter((d) => d !== 'self'));
      if (b.event === 'onDeath' && chance(0.25)) b.damagedBySelf = true;
      break;
    case 'kill':
      scoped(b); if (!b.pick) { b.pick = pick(PICKS); b.count = int(1, 2); }
      b.event = 'round_eq'; b.eventData = int(1, 4); break;
    case 'resurrect_allies':
      b.event = 'onDeath'; b.eventData = chance(0.8) ? 'self' : undefined; break;
    case 'swap_stats_random':
      scoped(b); b.pick = 'random'; b.count = int(1, 2); b.event = 'round_eq'; b.eventData = int(1, 3); break;
    case 'wheel':
      scoped(b); b.strength = int(10, 200); roundEvent(b); break;
    case 'gamble':
      scoped(b); b.strengthPercent = int(0, 100); roundEvent(b); break;
    case 'heal_boost_percent':
      b.strengthPercent = int(10, 150); roundEvent(b); break;
    case 'reduce_ability_attack_percent':
      scoped(b); b.strengthPercent = int(10, 90); roundEvent(b); break;
    case 'stun_pattern':
      roundEvent(b); break;
    default: break;
  }
  if (b.eventData === undefined) delete b.eventData;
  if (b.directions && b.directions.length === 0 && type !== 'attack' && type !== 'bonus_attack') delete b.directions;
  return b;
}

let cardNo = 0;
function randomCard() {
  const maxHp = int(50, 900);
  const card = {
    instanceId: 'f' + (++cardNo),
    cardId: 'fuzz-' + cardNo,
    name: chance(0.05) ? '' : 'Fuzz ' + cardNo,
    tribe: pick(TRIBES),
    attack: chance(0.1) ? 0 : int(20, 400),
    maxHp,
    hp: chance(0.25) ? int(1, maxHp) : maxHp,
    abilityValue: int(1, 100),
    dirs: CARD_DIRS.filter(() => chance(0.4)),
  };
  const buffs = [];
  // an explicit attack most of the time (raw cards do not get the implicit attack), then 0..3 random buffs
  if (chance(0.8)) buffs.push({ type: 'attack', directions: CARD_DIRS.filter(() => chance(0.45)).map((d) => ({ direct: 'front', left: 'frontLeft', right: 'frontRight', ownLeft: 'left', ownRight: 'right' }[d])), event: 'always' });
  const n = int(0, 3);
  for (let i = 0; i < n; i++) buffs.push(randomBuff());
  if (chance(0.1)) buffs.push({ type: 'raise_attack', strength: 'value', directions: ['self'], event: 'always' });
  if (chance(0.1)) buffs.push({ type: 'heal', strength: '-value', directions: ['self'], event: 'always' });
  card.buffs = buffs;
  return card;
}

function randomSide(forceBonusFlag) {
  const cards = [];
  for (let i = 0; i < 5; i++) cards.push(chance(0.75) ? randomCard() : null);
  const maxHp = int(300, 4000);
  const player = { name: chance(0.9) ? 'P' + int(1, 99) : '', hp: chance(0.2) ? int(1, maxHp) : maxHp, maxHp };
  if (forceBonusFlag !== undefined) player.tribeBonus = forceBonusFlag;
  if (chance(0.3)) player.baseMaxHp = maxHp;
  return { player, cards };
}

const cases = [];
const N = Number(process.argv[2] || 400);
for (let i = 0; i < N; i++) {
  const flagA = chance(0.3) ? chance(0.5) : undefined;
  const flagD = chance(0.3) ? chance(0.5) : undefined;
  const cfg = { attacker: randomSide(flagA), defender: randomSide(flagD), seed: rng.int(0x7fffffff) };
  const options = {};
  if (chance(0.3)) options.maxRounds = int(1, 25);
  if (chance(0.2)) options.raceBonus = chance(0.5);
  if (Object.keys(options).length) cfg.options = options;
  const { events, result } = simulateBattle(cfg);
  const steps = fromEvents(events, 1).map((s) => ({ type: s.type, dur: s.dur, base: s.base ?? null, factor: s.factor ?? null, events: s.events.length }));
  const steps2 = fromEvents(events, 2).map((s) => s.dur);
  const final = finalState(events);
  cases.push({ name: `fuzz-${i}`, cfg, expected: { result, events, steps, durationsAt2x: steps2, final, lethalStep: lethalStep(events) } });
}

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(cases));
const bytes = readFileSync(out).length;
console.log(`wrote ${cases.length} cases (${(bytes / 1024 / 1024).toFixed(1)} MB) to ${out}`);
