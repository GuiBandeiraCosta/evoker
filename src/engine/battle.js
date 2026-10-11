'use strict';

/**
 * Evoker battle engine: a literal port of the original client's simulator
 * (exploration/apk/lua/game.fightsimulatorv2.txt, main.#18; spec: docs/design/original-engine.md).
 * Pure and deterministic for a given seed; never mutates its input. Public API: architecture.md §4.
 *
 * Round loop (original-engine.md §5):
 *   round = 1
 *   while not over() and round <= 20:
 *     round 1: race bonus; resetRound(1); resetRound(2)
 *     for phase in PHASES: processPhase(1, phase); processPhase(2, phase)       -- round mode
 *     while events: for phase in PHASES: processPhase(1/2, phase, events); die(1); die(2)  -- event loop
 *     cleanup(1); cleanup(2)
 *
 * Slot mapping (effects/helpers.js): internal 1-based slots from each player's own left, UI 0-based
 * facing slots: attacker ui = id - 1, defender ui = 5 - id. Processing order "player 1 slots 1..5 then
 * player 2 slots 1..5" is therefore attacker 0..4 then defender 4..0 in UI slots.
 */

import { mulberry32 } from '../core/rng.js';
import { hasTribeBonus, TRIBE_BONUS_MULT } from './tribe-bonus.js';
import { SLOT_COUNT, normaliseDirs, normaliseBuff, resolveBuffs, toOriginalDirs } from './battle-state.js';
import { PHASES, DIE_PHASE, HANDLERS, TARGETLESS_TYPES, ONCE_TYPES } from './effects/index.js';
import {
  SIDE_OF, otherId, internalSlot, isCard, target as targetOf, playerHp, emit, cardSnapshot, syncCardMaxHp, syncPlayerMaxHp,
  livingCards,
} from './effects/helpers.js';
import { hasAbilityBuffs, isOffensive } from './effects/extensions.js';

export const DEFAULT_MAX_ROUNDS = 20;
/** Safety cap on event-loop passes within one round (the original has none; a ping-pong of onDamage buffs would hang it). */
const EVENT_LOOP_CAP = 1000;

/**
 * @typedef {import('./battle-state.js').FighterSide} FighterSide
 * @typedef {import('./battle-state.js').BattleCard} BattleCard
 *
 * @typedef {object} BattleResult
 * @property {'attacker'|'defender'|'draw'} winner
 * @property {number} rounds          completed rounds (0 when nobody can attack from the start)
 * @property {number} attackerHp      hp - takenDamage of player 1 (may be negative, as in the original)
 * @property {number} defenderHp
 * @property {{attacker: number, defender: number}} deaths   death events per side
 * @property {'playerHp'|'maxRounds'|'noAttack'} endedBy
 */

/* ------------------------------------------------------------------ state */

/**
 * Internal card from a public BattleCard (original-engine.md §1).
 * @param {BattleCard} card
 * @param {number} playerId
 * @param {number} id   internal 1-based slot
 */
function internCard(card, playerId, id) {
  const attack = Math.max(0, Math.round(Number(card.attack) || 0));
  const maxHp = Math.max(1, Math.round(Number(card.maxHp ?? card.hp) || 1));
  const hp = Number.isFinite(card.hp) ? Math.round(card.hp) : maxHp;
  const dirs = normaliseDirs(card.dirs);
  const odirs = toOriginalDirs(card.dirs);
  const buffs = Array.isArray(card.buffs)
    ? card.buffs.filter((b) => b && b.type).map((b) => normaliseBuff(b, Number(card.abilityValue) || 0, odirs))
    : resolveBuffs(card.ability, card.stage | 0, card.abilityValue, dirs);
  const pub = { ...card };
  delete pub.buffs;
  pub.instanceId = String(card.instanceId ?? card.uid ?? card.cardId);
  pub.dirs = dirs;
  pub.tribe = String(card.tribe || card.race || 'neutral').toLowerCase();
  return {
    id,
    playerId,
    cardId: card.cardId,
    name: card.name || card.cardId,
    race: pub.tribe,
    origHp: maxHp,
    hp: maxHp,
    origAttack: attack,
    attack,
    takenDamage: Math.max(0, maxHp - hp),
    buffs,
    died: false,
    resurrected: false,
    invulnerable: false,
    noBuffsAllowed: false,
    suppressedBy: null,
    resurrectAlliesUsed: false,
    damagedBy: new Set(),
    uiMaxHp: maxHp,
    pub,
  };
}

/**
 * Internal player + card list from a FighterSide.
 * @param {FighterSide} side
 * @param {number} playerId
 * @returns {{player: object, cards: Array<object|null>}}
 */
function internSide(side, playerId) {
  if (!side) throw new Error(`simulateBattle: missing ${SIDE_OF[playerId]} side`);
  const p = side.player || {};
  const maxHp = Math.max(1, Math.round(Number(p.maxHp ?? p.hpMax ?? p.hp) || 1500));
  const hp = Number.isFinite(p.hp) ? Math.round(p.hp) : maxHp;
  const cards = [null, null, null, null, null, null];
  const list = side.cards || [];
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const c = list[slot];
    if (c) {
      const id = internalSlot(playerId, slot);
      cards[id] = internCard(c, playerId, id);
    }
  }
  const player = {
    id: playerId,
    key: SIDE_OF[playerId],
    name: String(p.name || SIDE_OF[playerId]),
    portrait: p.portrait ?? 0,
    origHp: maxHp,
    hp: maxHp,
    takenDamage: Math.max(0, maxHp - hp),
    tribeBonus: p.tribeBonus,
    healBoost: 0,
    uiMaxHp: maxHp,
    pub: { ...p },
  };
  return { player, cards };
}

/** The slots of a side in UI order (null for an empty slot). */
function uiCards(S, playerId) {
  return Array.from({ length: SLOT_COUNT }, (_, slot) => S.cards[playerId][internalSlot(playerId, slot)]);
}

/** Public snapshot of a side (battleStart event), in UI slot order. */
function sideSnapshot(S, playerId) {
  const p = S.players[playerId];
  return {
    player: { ...p.pub, name: p.name, portrait: p.portrait, hp: playerHp(p), maxHp: p.hp, tribeBonus: !!p.tribeBonus },
    cards: uiCards(S, playerId).map((c) => (c ? cardSnapshot(c) : null)),
  };
}

/** Per-slot current health (0 for empty / dead) of a side, UI order: the original per-round snapshot. */
function hpSnapshot(S, playerId) {
  return uiCards(S, playerId).map((c) => (c ? c.hp - c.takenDamage : 0));
}

/* ---------------------------------------------------------- buff matching */

/**
 * `getBuff(card, type, mode, data)` (original-engine.md §4): the first buff of the card with the type
 * whose condition holds. Round mode: always / round_eq / round_ge / round_le (+ ext round_odd /
 * round_even). Event mode: buff.event == event.type and eventData nil (any card) / "opponent_cards" /
 * "self"; extensions: `triggerDirection` (the event's `to` card must be the card in that direction) and
 * `damagedBySelf` (this card must have damaged the event's `to` card this round).
 * @returns {object|null}
 */
export function getBuff(S, card, type, mode, data) {
  for (const b of card.buffs) {
    if (b.type !== type) continue;
    let ok = false;
    if (mode === 'round') {
      const n = Number(b.eventData);
      switch (b.event) {
        case 'always': ok = true; break;
        case 'round_eq': ok = data === n; break;
        case 'round_ge': ok = data >= n; break;
        case 'round_le': ok = data <= n; break;
        case 'round_odd': ok = data % 2 === 1; break;
        case 'round_even': ok = data % 2 === 0; break;
        default: ok = false;
      }
    } else if (b.event === data.type) {
      const ed = b.eventData;
      if (ed === null || ed === undefined) ok = true;
      else if (ed === 'opponent_cards') ok = !!data.to && data.to.playerId !== card.playerId;
      else if (ed === 'self') ok = data.to === card;
      else if (ed === 'own_cards') ok = !!data.to && data.to.playerId === card.playerId && data.to !== card;
      if (ok && b.triggerDirection) {
        const t = targetOf(card.id, b.triggerDirection, S.cards[card.playerId], S.cards[otherId(card.playerId)]);
        ok = !!data.to && t === data.to;
      }
      if (ok && b.damagedBySelf) ok = !!data.to && !!data.to.damagedBy && data.to.damagedBy.has(card);
    }
    if (ok) return b;
  }
  return null;
}

/**
 * Does a card pass a buff `filter` ({tribe, offensive, excludeSelf, hasAbility})?
 * @param {object} c  candidate card
 * @param {object} self  the acting card
 * @param {object|undefined} f
 * @returns {boolean}
 */
function matchesFilter(c, self, f) {
  if (!f) return true;
  if (f.excludeSelf && c === self) return false;
  if (f.tribe && c.race !== String(f.tribe).toLowerCase()) return false;
  if (f.offensive && !isOffensive(c)) return false;
  if (f.hasAbility && !hasAbilityBuffs(c)) return false;
  return true;
}

/** Deterministic pick of `count` cards from a pool (random via the seeded rng, highest/lowest attack with ties to the first slot). */
function pickFrom(S, pool, pick, count) {
  const chosen = [];
  let rest = pool.slice();
  for (let k = 0; k < count && rest.length; k++) {
    let v;
    if (pick === 'random') v = S.rng.pick(rest);
    else if (pick === 'lowest_attack') v = rest.reduce((a, c) => (c.attack < a.attack ? c : a), rest[0]);
    else v = rest.reduce((a, c) => (c.attack > a.attack ? c : a), rest[0]);
    chosen.push(v);
    rest = rest.filter((c) => c !== v);
  }
  return chosen;
}

/**
 * Target set of a scope buff (ability-encoding.md §2.7): own_cards | opponent_cards | all_cards |
 * each_side (one pick per side), narrowed by `filter`, chosen by `pick` + `count`. Picks are memoised
 * per (card, round, scope) so sibling buffs (Bouncer's no_buff + no_damage) hit the same cards.
 * @returns {object[]}
 */
function scopeTargets(S, card, buff) {
  const own = card.playerId;
  const opp = otherId(own);
  let pools;
  switch (buff.scope) {
    case 'own_cards': pools = [livingCards(S, own)]; break;
    case 'opponent_cards': pools = [livingCards(S, opp)]; break;
    case 'all_cards': pools = [[...livingCards(S, 1), ...livingCards(S, 2)]]; break;
    case 'each_side': pools = [livingCards(S, own), livingCards(S, opp)]; break;
    default: return [];
  }
  pools = pools.map((pool) => pool.filter((c) => matchesFilter(c, card, buff.filter)));
  if (!buff.pick) return pools.flat();
  const key = `${card.playerId}:${card.id}:${S.round}:${buff.scope}`;
  if (S.picks.has(key)) return S.picks.get(key);
  const count = Math.max(1, buff.count || 1);
  const chosen = pools.flatMap((pool) => pickFrom(S, pool, buff.pick, count));
  S.picks.set(key, chosen);
  return chosen;
}

/**
 * `hasAttack(card, round)`: an `attack` buff that can still fire now or later (original-engine.md §5).
 * Damaging abilities do not count.
 */
export function hasAttack(card, round) {
  for (const b of card.buffs) {
    if (b.type !== 'attack') continue;
    const n = Number(b.eventData);
    switch (b.event) {
      case 'always': case 'round_ge': case 'round_odd': case 'round_even': return true;
      case 'round_le': if (round <= n) return true; break;
      case 'round_eq': if (round <= n) return true; break;
      default: break;
    }
  }
  return false;
}

/* ----------------------------------------------------------------- phases */

/**
 * Run one matched buff: resolve its directions (or scope) to targets and call the handler per target
 * (`none` skipped, an empty slot passed as the direction string), or once with target null.
 */
function dispatch(S, phase, card, buff, ev, ownPlayer, ownOpponent, out) {
  S.openAttack = null;
  const handler = HANDLERS[phase.handler || phase.type];
  if (!handler) return;
  const dirs = buff.directions || [];
  // event mode + directions: player / opponent come from the event (the attacker's), as in the original
  const useEvent = !!ev && dirs.length > 0;
  const player = useEvent && ev.player ? ev.player : ownPlayer;
  const opponent = useEvent && ev.opponent ? ev.opponent : ownOpponent;
  S.direction = null;
  if (ONCE_TYPES.has(buff.type)) {
    handler(S, card, null, player, opponent, buff, out, ev);
    return;
  }
  if (buff.scope) {
    for (const t of scopeTargets(S, card, buff)) handler(S, card, t, player, opponent, buff, out, ev);
    return;
  }
  if (dirs.length === 0) {
    handler(S, card, null, player, opponent, buff, out, ev);
    return;
  }
  const own = S.cards[card.playerId];
  const opp = S.cards[otherId(card.playerId)];
  const trigger = !!ev && !!ev.to && TARGETLESS_TYPES.has(buff.type);
  for (const d of dirs) {
    let t = targetOf(card.id, d, own, opp);
    if (t === 'none') continue;
    if (t === null || t === undefined) t = d;
    if (trigger && t !== ev.to) continue;
    if (buff.filter && isCard(t) && !matchesFilter(t, card, buff.filter)) continue;
    S.direction = d;
    handler(S, card, t, player, opponent, buff, out, ev);
  }
}

/** The buff as the handler should see it for an event: `strengthFromEvent` takes the event's value. */
function buffForEvent(buff, ev) {
  if (!buff.strengthFromEvent || !ev) return buff;
  return { ...buff, strength: Number(ev.value) || 0 };
}

/**
 * `processPhase(playerId, type, eventsIn, eventsOut)`: slots 1..5 of the player; round mode when
 * `eventsIn` is null (buffs matched against the round), else event mode (every event against every
 * card). The `die` phase runs for every card in round mode (implicit die buff).
 */
function processPhase(S, playerId, phase, eventsIn, out) {
  const own = S.cards[playerId];
  const player = S.players[playerId];
  const opponent = S.players[otherId(playerId)];
  if (eventsIn === null) {
    if (phase.type === 'die') {
      for (let i = 1; i <= SLOT_COUNT; i++) {
        const c = own[i];
        if (c) HANDLERS.die(S, c, c, player, opponent, { type: 'die', directions: ['self'] }, out, null);
      }
      return;
    }
    // queued next-round effects of this type for this player (extension), before the normal slot pass
    if (S.queue.current.length) {
      const mine = S.queue.current.filter((q) => q.playerId === playerId && q.buff.type === phase.type);
      if (mine.length) {
        S.queue.current = S.queue.current.filter((q) => !mine.includes(q));
        for (const q of mine) {
          if (own[q.card.id] !== q.card) continue;
          dispatch(S, phase, q.card, q.buff, q.ev, player, opponent, out);
        }
      }
    }
    for (let i = 1; i <= SLOT_COUNT; i++) {
      const c = own[i];
      if (!c) continue;
      const buff = getBuff(S, c, phase.type, 'round', S.round);
      if (!buff) continue;
      dispatch(S, phase, c, buff, null, player, opponent, out);
    }
    return;
  }
  for (let i = 1; i <= SLOT_COUNT; i++) {
    const c = own[i];
    if (!c) continue;
    for (const ev of eventsIn) {
      const matched = getBuff(S, c, phase.type, 'event', ev);
      if (!matched) continue;
      const buff = buffForEvent(matched, ev);
      if (buff.nextRound) {
        S.queue.next.push({ playerId, card: c, buff, ev });
        continue;
      }
      dispatch(S, phase, c, buff, ev, player, opponent, out);
    }
  }
}

/** Round reset (original `resetRound`): hp = origHp (players and cards), attack = origAttack, flags off. */
function resetRound(S, playerId) {
  const p = S.players[playerId];
  p.hp = p.origHp;
  p.healBoost = 0;
  const own = S.cards[playerId];
  for (let i = 1; i <= SLOT_COUNT; i++) {
    const c = own[i];
    if (!c) continue;
    c.noBuffsAllowed = false;
    c.suppressedBy = null;
    c.attack = c.origAttack;
    c.hp = c.origHp;
    c.invulnerable = false;
    c.damagedBy = new Set();
  }
}

/** Original `cleanup`: remove died cards from their slots, clamp negative takenDamage to 0. */
function cleanup(S, playerId) {
  const own = S.cards[playerId];
  for (let i = 1; i <= SLOT_COUNT; i++) {
    const c = own[i];
    if (!c) continue;
    if (c.died) own[i] = null;
    if (c.takenDamage < 0) c.takenDamage = 0;
  }
}

/** Original `over()`: a player at <= 0, or nobody able to attack any more. */
function over(S) {
  if (playerHp(S.players[1]) <= 0 || playerHp(S.players[2]) <= 0) return true;
  for (const pid of [1, 2]) {
    for (let i = 1; i <= SLOT_COUNT; i++) {
      const c = S.cards[pid][i];
      if (c && hasAttack(c, S.round)) return false;
    }
  }
  return true;
}

/**
 * Does the engine apply the race bonus itself for this side? buildSide() already applied it (and set a
 * boolean `tribeBonus`) for the sides the game builds; raw sides (tests) get the original rule here.
 * `options.raceBonus` forces it on/off.
 */
function engineRaceBonus(S, playerId) {
  const opt = S.options.raceBonus;
  if (opt === false) return false;
  if (opt !== true && S.players[playerId].tribeBonus !== undefined) return false;
  return hasTribeBonus(S.cards[playerId]);
}

/** Round-1 race bonus (original-engine.md §6): hp = round(hp * 1.2), origHp = hp. */
function raceBonus(S, playerId) {
  if (!engineRaceBonus(S, playerId)) return;
  const p = S.players[playerId];
  p.hp = Math.round(p.hp * TRIBE_BONUS_MULT);
  p.origHp = p.hp;
  p.tribeBonus = true;
  syncPlayerMaxHp(S, p, null, 'race_bonus');
}

/** After the raise_hp / raise_player_hp phases: tell the UI about max hp that silently went back to normal. */
function syncMaxHps(S, phaseType) {
  if (phaseType === 'raise_hp') {
    for (const pid of [1, 2]) for (let i = 1; i <= SLOT_COUNT; i++) { const c = S.cards[pid][i]; if (c) syncCardMaxHp(S, c, null, phaseType); }
  } else if (phaseType === 'raise_player_hp') {
    for (const pid of [1, 2]) syncPlayerMaxHp(S, S.players[pid], null, phaseType);
  }
}

/** One full round (original `main.#18.#14` loop body). */
function playRound(S) {
  emit(S, { t: 'roundStart', round: S.round, attackerHp: playerHp(S.players[1]), defenderHp: playerHp(S.players[2]) });
  if (S.round === 1) {
    raceBonus(S, 1);
    raceBonus(S, 2);
  }
  resetRound(S, 1);
  resetRound(S, 2);
  S.queue.current = S.queue.next;
  S.queue.next = [];
  let events = [];
  for (const phase of PHASES) {
    processPhase(S, 1, phase, null, events);
    processPhase(S, 2, phase, null, events);
    syncMaxHps(S, phase.type);
  }
  let passes = 0;
  while (events.length > 0 && passes++ < EVENT_LOOP_CAP) {
    const next = [];
    for (const phase of PHASES) {
      processPhase(S, 1, phase, events, next);
      processPhase(S, 2, phase, events, next);
    }
    processPhase(S, 1, DIE_PHASE, null, next);
    processPhase(S, 2, DIE_PHASE, null, next);
    events = next;
  }
  S.queue.current = [];
  cleanup(S, 1);
  cleanup(S, 2);
  emit(S, {
    t: 'roundEnd',
    round: S.round,
    attackerHp: playerHp(S.players[1]),
    defenderHp: playerHp(S.players[2]),
    cards: { attacker: hpSnapshot(S, 1), defender: hpSnapshot(S, 2) },
  });
}

/* ------------------------------------------------------------------ public */

/**
 * Simulate a whole battle.
 * @param {object} cfg
 * @param {FighterSide} cfg.attacker  player 1: { player:{name,hp,maxHp}, cards:[BattleCard|null x5] }
 * @param {FighterSide} cfg.defender  player 2
 * @param {number} cfg.seed
 * @param {{maxRounds?: number, raceBonus?: boolean}} [cfg.options]  raceBonus: force the engine's round-1
 *        race bonus on/off (default: applied only for sides without a `player.tribeBonus` flag, i.e. not
 *        built by buildSide, which applies it itself)
 * @returns {{events: object[], result: BattleResult}}
 */
export function simulateBattle(cfg) {
  if (!cfg) throw new Error('simulateBattle: cfg required');
  const options = cfg.options || {};
  const maxRounds = Math.max(0, Number.isFinite(options.maxRounds) ? options.maxRounds | 0 : DEFAULT_MAX_ROUNDS);
  const seed = Number(cfg.seed) || 0;
  const s1 = internSide(cfg.attacker, 1);
  const s2 = internSide(cfg.defender, 2);
  const S = {
    round: 1,
    maxRounds,
    options,
    rng: mulberry32(seed),
    events: [],
    players: [null, s1.player, s2.player],
    cards: [null, s1.cards, s2.cards],
    queue: { current: [], next: [] },
    picks: new Map(),
    memo: new Map(),
    openAttack: null,
    direction: null,
    deaths: { attacker: 0, defender: 0 },
  };
  emit(S, { t: 'battleStart', seed, attacker: sideSnapshot(S, 1), defender: sideSnapshot(S, 2) });

  while (!over(S) && S.round <= maxRounds) {
    playRound(S);
    S.round++;
  }
  const rounds = S.round - 1;
  const h1 = playerHp(S.players[1]);
  const h2 = playerHp(S.players[2]);
  const winner = h1 < h2 ? 'defender' : h2 < h1 ? 'attacker' : 'draw';
  const endedBy = h1 <= 0 || h2 <= 0 ? 'playerHp' : rounds >= maxRounds && !over(S) ? 'maxRounds' : 'noAttack';
  const result = { winner, rounds, attackerHp: h1, defenderHp: h2, deaths: { ...S.deaths }, endedBy };
  emit(S, { t: 'battleEnd', winner, rounds, attackerHp: h1, defenderHp: h2, endedBy });
  return { events: S.events, result };
}

/**
 * Human-readable summary of an event log (for console logs and tests).
 * @param {object[]} events
 * @returns {{winner: string|null, rounds: number, attackerHp: number|null, defenderHp: number|null,
 *            deaths: {attacker: number, defender: number}, lines: string[]}}
 */
export function summariseBattle(events) {
  const who = (e) => `${e.side}${e.slot === null || e.slot === undefined ? ' player' : `[${e.slot}]`}`;
  const lines = [];
  const deaths = { attacker: 0, defender: 0 };
  let end = null;
  for (const e of events || []) {
    switch (e.t) {
      case 'battleStart': lines.push(`battle start (seed ${e.seed})`); break;
      case 'roundStart': lines.push(`-- round ${e.round}`); break;
      case 'status': lines.push(`${who(e)} ${e.status}`); break;
      case 'buff': lines.push(`${who(e)} ${e.stat} ${e.delta >= 0 ? '+' : ''}${e.delta}${e.permanent ? ' (permanent)' : ''}`); break;
      case 'attack': lines.push(`${who(e)} attacks ${e.targets.map((t) => `${t.side}${t.slot === null ? ' player' : `[${t.slot}]`} for ${t.damage}${t.blocked ? ' (blocked)' : ''}`).join(', ') || 'nothing'}`); break;
      case 'damage': lines.push(`${who(e)} takes ${e.amount} (${e.cause}${e.blocked ? ', blocked' : ''}) -> ${e.hp}`); break;
      case 'heal': lines.push(`${who(e)} heals ${e.amount} -> ${e.hp}`); break;
      case 'death': deaths[e.side]++; lines.push(`${who(e)} ${e.card.name} dies`); break;
      case 'revive': lines.push(`${who(e)} revives at ${e.hp} hp, attack ${e.attack}`); break;
      case 'swap': lines.push(`${who(e)} swaps stats -> attack ${e.attack}, hp ${e.hp}`); break;
      case 'gamble': lines.push(`${who(e)} gamble ${e.failed ? 'failed' : 'succeeded'}`); break;
      case 'roundEnd': lines.push(`round ${e.round} end: attacker ${e.attackerHp} / defender ${e.defenderHp}`); break;
      case 'battleEnd': end = e; lines.push(`battle end: ${e.winner} after ${e.rounds} rounds (${e.attackerHp} vs ${e.defenderHp})`); break;
      default: lines.push(`${e.t} ${JSON.stringify(e)}`);
    }
  }
  return {
    winner: end ? end.winner : null,
    rounds: end ? end.rounds : 0,
    attackerHp: end ? end.attackerHp : null,
    defenderHp: end ? end.defenderHp : null,
    deaths,
    lines,
  };
}

