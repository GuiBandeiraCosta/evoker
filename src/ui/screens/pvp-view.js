'use strict';
/**
 * Pure, DOM-free view helpers of the Arena / Pieces / Replays and League screens:
 *  - the fight xp the result popup lists for piece and league fights
 *  - difficulty colours of the three arena offers, the row HP and the strongest card (portrait)
 *  - fight-history lines (Won / Lost / Draw, dd.mm.yyyy, hh:mm:ss) and the replay side rebuild for the engine
 *  - avatar and opponent-preview helpers used by the prebattle hand-off
 * The event banner lives in pvp-events.js, the puzzle geometry in pvp-puzzle.js. Unit-tested in Node
 * (tests/pvp-ui.test.js).
 */
import { DIFFICULTIES } from '../../game/arena.js';
import { scaledSimDeck, sideOptions, simDeckMana } from '../../game/opponents.js';
import { cardFightXp, playerFightXp, eventId } from '../../game/player.js';

/* ------------------------------------------------------------------ fights */

/**
 * Add the `cardXp` / `playerXp` the result popup lists to a fight info object that lacks them
 * (fightHolder / fightLeague return only their mode-specific rewards; runPvpFight computed the xp with
 * exactly these inputs). Infos that already carry the values are returned unchanged.
 * @param {object} info  result of fightLeague / fightHolder
 * @param {object} sim  the simulated opponent
 * @param {number} power  strength multiplier used for the fight
 * @param {object} deps
 * @param {object|string|null} [event]  today's daily event
 * @returns {object}
 */
export function withFightXp(info, sim, power, deps, event) {
  if (!info || !sim) return info;
  const out = { ...info };
  if (out.cardXp == null) out.cardXp = cardFightXp(simDeckMana(sim, deps), Boolean(info.won), eventId(event) === 'infinite-wisdom');
  if (out.playerXp == null) out.playerXp = playerFightXp(Math.round(sim.level * (power || 1)), Boolean(info.won));
  return out;
}

/* ------------------------------------------------------------------ arena */

/** CSS colour class of an arena difficulty ('green' | 'yellow' | 'red'). */
export const DIFFICULTY_COLORS = Object.fromEntries(DIFFICULTIES.map((d) => [d.id, d.color]));

/**
 * Colour class for a difficulty id (unknown ids fall back to yellow).
 * @param {string} difficulty  'easy' | 'normal' | 'hard'
 * @returns {'green'|'yellow'|'red'}
 */
export function difficultyColor(difficulty) {
  return DIFFICULTY_COLORS[difficulty] || 'yellow';
}

/**
 * Colour class for an arena offer object (uses its stored colour, else its difficulty).
 * @param {{color?: string, difficulty?: string}} offer
 * @returns {'green'|'yellow'|'red'}
 */
export function offerColor(offer) {
  if (!offer) return 'yellow';
  if (offer.color === 'green' || offer.color === 'yellow' || offer.color === 'red') return offer.color;
  return difficultyColor(offer.difficulty);
}

/**
 * HP shown on an arena row: the opponent's health scaled by the offer's strength, exactly what the fight uses
 * (opponentPreview).
 * @param {{hpMax: number}} sim
 * @param {number} [power]
 * @returns {number}
 */
export function offerHp(sim, power) {
  return Math.round(((sim && sim.hpMax) || 0) * (power || 1));
}

/**
 * Strongest card of a line-up (highest level, then mana): the card whose thumbnail the client shows as the
 * opponent's portrait (comp_enemy_entry / comp_pvp_history_entry `strongestCard`).
 * @param {Array<{cardId: string, stage?: number, level?: number}|null>} cards
 * @param {{get: (id: string) => object|undefined}} db
 * @returns {{cardId: string, stage: number, level: number}|null}
 */
export function strongestCard(cards, db) {
  const list = (cards || []).filter((c) => c && db.get(c.cardId));
  if (!list.length) return null;
  const mana = (c) => (db.get(c.cardId) || {}).mana || 0;
  const best = list.slice().sort((a, b) => ((b.level | 0) - (a.level | 0)) || ((b.stage | 0) - (a.stage | 0)) || (mana(b) - mana(a)))[0];
  return { cardId: best.cardId, stage: best.stage | 0, level: Math.max(1, best.level | 0) };
}

/* ---------------------------------------------------------------- replays */

/**
 * Result label and colour class of a replay.
 * @param {{won: boolean, result?: {winner?: string}}} replay
 * @returns {{label: 'Victory'|'Defeat'|'Draw', cls: 'win'|'loss'|'draw'}}
 */
export function replayResult(replay) {
  const winner = replay && replay.result && replay.result.winner;
  if (winner === 'draw') return { label: 'Draw', cls: 'draw' };
  if (replay && replay.won) return { label: 'Victory', cls: 'win' };
  return { label: 'Defeat', cls: 'loss' };
}

/**
 * Result line of a fight-history entry (comp_pvp_history_entry): "Won" green (25, 150, 50), "Lost" red,
 * "Draw" bright orange.
 * @param {{won: boolean, result?: {winner?: string}}} replay
 * @returns {{label: 'Won'|'Lost'|'Draw', cls: 'win'|'loss'|'draw'}}
 */
export function historyResult(replay) {
  const r = replayResult(replay);
  return { label: r.cls === 'win' ? 'Won' : r.cls === 'draw' ? 'Draw' : 'Lost', cls: r.cls };
}

/**
 * Date and time lines of a fight-history entry like the client ("09.10.2026", "14:05:09").
 * @param {number} ms
 * @param {boolean} [utc=false]
 * @returns {{date: string, time: string}}
 */
export function historyDate(ms, utc = false) {
  const d = new Date(Number(ms) || 0);
  const p = (n) => String(n).padStart(2, '0');
  const g = (k) => (utc ? d[`getUTC${k}`]() : d[`get${k}`]());
  return {
    date: `${p(g('Date'))}.${p(g('Month') + 1)}.${g('FullYear')}`,
    time: `${p(g('Hours'))}:${p(g('Minutes'))}:${p(g('Seconds'))}`,
  };
}

/**
 * Rebuild a saved replay side as an engine FighterSide. The stored maxHp already includes the tribe
 * bonus, so the bonus is not applied again.
 * @param {{name: string, maxHp: number, cards: Array<{cardId: string, stage: number, level: number}|null>}} side
 * @param {object} deps
 * @returns {object} FighterSide
 */
export function replaySide(side, deps) {
  const cards = (side.cards || []).map((c, i) => (c && deps.db.get(c.cardId) ? { uid: 'replay-' + i, cardId: c.cardId, stage: c.stage | 0, level: Math.max(1, c.level | 0), evolveQuality: 1 } : null));
  while (cards.length < 5) cards.push(null);
  // older replays carry no avatar and fall back to the default portrait
  return deps.engine.buildSide({ name: side.name, hp: side.maxHp, maxHp: side.maxHp, avatar: side.avatar }, cards.slice(0, 5), { ...sideOptions(deps), tribeBonus: false });
}

/**
 * Re-run a saved replay through the engine (same seed, same line-ups → identical events).
 * @param {object} replay  stored by recordReplay (src/game)
 * @param {object} deps
 * @returns {{events: object[], result: object, attacker: object, defender: object}}
 */
export function rerunReplay(replay, deps) {
  const attacker = replaySide(replay.attacker, deps);
  const defender = replaySide(replay.defender, deps);
  const battle = deps.engine.simulateBattle({ attacker, defender, seed: replay.seed });
  return { events: battle.events, result: battle.result, attacker, defender };
}

/* ---------------------------------------------------------------- avatars */

/**
 * Card id used as the avatar portrait for an avatar index (wraps around the list).
 * @param {number} index
 * @param {string[]} avatars  deps.names.avatars
 * @returns {string|null}
 */
export function avatarCardId(index, avatars) {
  if (!Array.isArray(avatars) || avatars.length === 0) return null;
  const i = ((index | 0) % avatars.length + avatars.length) % avatars.length;
  return avatars[i] || null;
}

/**
 * Portrait URL for an avatar index (card art), or null when unknown.
 * @param {number} index
 * @param {object} deps  { db, names }
 * @param {(def: object, stage?: number) => string|null} artUrlFor
 * @returns {string|null}
 */
export function avatarUrl(index, deps, artUrlFor) {
  const id = avatarCardId(index, deps.names && deps.names.avatars);
  const def = id && deps.db.get(id);
  return def ? artUrlFor(def, 0) : null;
}

/**
 * The `opponent` object the prebattle screen expects (architecture §8.4) for a simulated player:
 * face-down cards with tribe emblems, scaled by the power multiplier.
 * @param {object} sim  SimPlayer
 * @param {object} deps
 * @param {number} power
 * @param {{defView: Function, artUrlFor: Function}} view
 * @returns {{name: string, portraitUrl: string|null, level: number, hp: number, maxHp: number, faceDown: boolean, cards: Array<object|null>}}
 */
export function opponentPreview(sim, deps, power, view) {
  const hp = Math.round(sim.hpMax * (power || 1));
  const cards = scaledSimDeck(sim, deps, power || 1).map((c) => {
    if (!c) return null;
    const def = deps.db.get(c.cardId);
    return def ? view.defView(def, c.stage, c.level) : null;
  });
  while (cards.length < 5) cards.push(null);
  return { name: sim.name, portraitUrl: avatarUrl(sim.avatar, deps, view.artUrlFor), level: sim.level, hp, maxHp: hp, faceDown: true, cards: cards.slice(0, 5) };
}

/**
 * Preview-style side for the battle screen from an engine FighterSide (replays).
 * @param {object} side  FighterSide
 * @param {object} deps
 * @param {{battleView: Function, artUrlFor: Function}} view
 * @returns {{name: string, portraitUrl: string|null, hp: number, maxHp: number, faceDown: boolean, cards: Array<object|null>}}
 */
export function sidePreview(side, deps, view) {
  const cards = (side.cards || []).map((bc) => (bc && deps.db.get(bc.cardId) ? view.battleView(bc, deps.db.get(bc.cardId)) : null));
  while (cards.length < 5) cards.push(null);
  return { name: side.player.name, portraitUrl: avatarUrl(side.player.portrait, deps, view.artUrlFor), hp: side.player.hp, maxHp: side.player.maxHp, faceDown: false, cards: cards.slice(0, 5) };
}
