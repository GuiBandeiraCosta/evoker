'use strict';
/**
 * src/game: the simulated players, the Arena, card pieces and replays.
 * Two kinds of tests: the "(fixture catalog)" groups run on the 21-card fixture catalog and a stub engine
 * (tests/fixtures-game); the "§" groups verify the rules of docs/design/game-design.md (and the brief §5 tables
 * it points to) against the real data through the real cards-db and stats modules, with the stub engine where a
 * fight needs a known outcome. Every state the "§" groups hand to a game function is deep-frozen first (`fz`),
 * so any mutation of an input throws.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../src/core/rng.js';
import { deckMana, DAY_MS } from '../src/game/state.js';
import { needsPotion, cardFightXp } from '../src/game/player.js';
import { generatePool, ensurePool, buildSimDeck, simStats, getSim } from '../src/game/opponents.js';
import { ensureOffers, fightArena, OFFER_ROTATION_MS } from '../src/game/arena.js';
import { canFightPvp } from '../src/game/pvp.js';
import {
  addPiece, fightHolder, missingPrice, buyMissingPieces, buyFirstPiece, dailyRaids, piecesTotal, MAX_HUNTS,
} from '../src/game/pieces.js';
import * as stats from '../src/core/stats.js';
import { RARITIES } from '../src/core/constants.js';
import * as S from '../src/game/state.js';
import * as P from '../src/game/player.js';
import * as R from '../src/game/rewards.js';
import * as O from '../src/game/opponents.js';
import * as A from '../src/game/arena.js';
import * as Pv from '../src/game/pvp.js';
import * as Pc from '../src/game/pieces.js';
import {
  T0, MIN, DAY, RARITY_IDS, QUESTS, NAMES, db, deps, fz, fresh, rich, give, sample, within,
} from './fixtures/real.js';
import * as stub from './fixtures-game/game.js';

describe('opponents, arena and pieces (fixture catalog)', () => {
  const { fresh, rich } = stub; // the fixture-catalog builders

  // ---------------------------------------------------------------- opponents

  test('simulated player pool: 60 players around the player level, decks within mana budget, deterministic', () => {
    const { state, deps } = fresh();
    const base = rich(state);
    const p1 = generatePool(base, deps, T0).state;
    const p2 = generatePool(base, deps, T0).state;
    assert.equal(p1.sim.players.length, 60);
    assert.equal(new Set(p1.sim.players.map((s) => s.id)).size, 60);
    assert.deepEqual(p1.sim.players, p2.sim.players);
    assert.equal(p1.sim.day, '2026-10-07');
    for (const sim of p1.sim.players) {
      assert.ok(sim.level >= 7 && sim.level <= 15, 'level ' + sim.level);
      assert.ok(sim.name.length > 0);
      assert.ok(sim.avatar >= 0 && sim.avatar < 12);
      const cards = sim.deck.filter(Boolean);
      assert.ok(cards.length >= 3 && cards.length <= 5);
      const mana = cards.reduce((s, c) => s + deps.db.get(c.cardId).mana, 0);
      assert.ok(mana <= sim.manaMax);
      assert.equal(sim.hpMax, simStats(sim.level).hpMax);
      for (const c of cards) assert.ok(c.level <= deps.stats.capFor(deps.db.get(c.cardId), c.stage));
    }
    const low = buildSimDeck(mulberry32(1), deps, 1, 1);
    assert.equal(low[0], null);
    assert.equal(low[4], null);
    assert.ok(low.slice(1, 4).every((c) => c && ['common', 'standard'].includes(deps.db.get(c.cardId).rarity)));
    const strong = buildSimDeck(mulberry32(1), deps, 100, 1);
    assert.ok(strong.filter(Boolean).every((c) => c.stage === 3 && ['heroic', 'legendary'].includes(deps.db.get(c.cardId).rarity)));
  });

  test('pool refresh: once per UTC day, levels creep up, stale players are replaced', () => {
    const { state, deps } = fresh();
    const p = ensurePool(rich(state), deps, T0);
    assert.equal(p.refreshed, true);
    const same = ensurePool(p.state, deps, T0 + 60 * 60 * 1000);
    assert.equal(same.refreshed, false);
    assert.equal(same.state, p.state);
    const jumped = { ...p.state, player: { ...p.state.player, level: 40 } };
    const next = ensurePool(jumped, deps, T0 + DAY_MS);
    assert.equal(next.refreshed, true);
    assert.equal(next.state.sim.day, '2026-10-08');
    assert.ok(next.state.sim.players.every((s) => s.level >= 35));
    assert.ok(next.state.sim.players.some((s) => s.level >= 39));
    const noJump = ensurePool(p.state, deps, T0 + DAY_MS).state;
    const total = (st) => st.sim.players.reduce((s, x) => s + x.level, 0);
    assert.ok(total(noJump) > total(p.state));
    assert.ok(total(noJump) - total(p.state) <= 60);
  });

  // ---------------------------------------------------------------- arena

  test('arena offers: easy / normal / hard with level ranges and power multipliers', () => {
    const { state, deps } = fresh();
    const r = ensureOffers(rich(state), deps, T0);
    assert.equal(r.offers.length, 3);
    assert.deepEqual(r.offers.map((o) => o.difficulty), ['easy', 'normal', 'hard']);
    assert.deepEqual(r.offers.map((o) => o.power), [0.7, 1, 1.3]);
    assert.ok(r.offers[0].level >= 8 && r.offers[0].level <= 10);
    assert.ok(r.offers[1].level >= 9 && r.offers[1].level <= 11);
    assert.ok(r.offers[2].level >= 11 && r.offers[2].level <= 13);
    assert.equal(r.rerollAt, T0 + OFFER_ROTATION_MS);
    assert.equal(ensureOffers(r.state, deps, T0 + 1000).state, r.state);
    const later = ensureOffers(r.state, deps, T0 + OFFER_ROTATION_MS + 1);
    assert.notEqual(later.state, r.state);
  });

  test('arena fight: mana check, gold = enemy deck mana × 6 (×2 on a win), 10 TP, replay, auto reroll', () => {
    const { state, deps } = fresh({ winner: 'attacker' });
    const s = ensureOffers(rich(state), deps, T0).state;
    const cost = deckMana(s, deps);
    assert.equal(canFightPvp(s, deps).mana, cost);
    const broke = { ...s, player: { ...s.player, mana: cost - 1 } };
    assert.deepEqual(canFightPvp(broke, deps), { ok: false, reason: 'Not enough mana', mana: cost, needsPotion: true });
    assert.throws(() => fightArena(broke, deps, T0, { offerIndex: 1 }), /mana/i);
    const offer = s.sim.arena.offers[1];
    const sim = getSim(s, offer.simId);
    const enemyMana = sim.deck.filter(Boolean).reduce((a, c) => a + deps.db.get(c.cardId).mana, 0);
    const r = fightArena(s, deps, T0, { offerIndex: 1 });
    assert.equal(r.won, true);
    assert.equal(r.rewards.gold, enemyMana * 6 * 2);
    assert.equal(r.rewards.tournamentPoints, 10);
    assert.equal(r.state.player.mana, 200 - cost);
    assert.equal(r.state.player.tournamentPoints, 10);
    assert.equal(r.state.player.battlesWon, 1);
    assert.equal(r.state.replays.length, 1);
    assert.equal(r.state.replays[0].mode, 'arena');
    assert.equal(r.state.replays[0].defender.name, sim.name);
    assert.equal(r.rewards.cardXp, cardFightXp(enemyMana, true, false));
    assert.notEqual(r.state.sim.arena.offers[1].simId + r.state.sim.arena.rerollAt, offer.simId + s.sim.arena.rerollAt);
    deps.engine.winner = 'defender';
    const loss = fightArena(s, deps, T0, { offerIndex: 2 });
    assert.equal(loss.won, false);
    assert.equal(loss.rewards.tournamentPoints, 0);
    assert.equal(loss.state.player.battlesWon, 0);
    const hard = deps.engine.calls[deps.engine.calls.length - 1];
    assert.equal(hard.defender.player.maxHp, Math.round(getSim(s, s.sim.arena.offers[2].simId).hpMax * 1.3));
    assert.equal(hard.attacker.player.maxHp, 1500);
  });

  // ---------------------------------------------------------------- pieces

  test('pieces: a drop starts a hunt with a holder; the last piece creates the card; 8 slots max', () => {
    let { state, deps } = fresh();
    state = rich(state);
    assert.equal(piecesTotal(deps, 'arch-angel'), 2);
    assert.equal(piecesTotal(deps, 'dwarf-king'), 10);
    const r1 = addPiece(state, deps, T0, 'arch-angel');
    assert.equal(r1.completed, false);
    assert.equal(r1.state.pieces[0].owned, 1);
    assert.ok(r1.state.pieces[0].holderId);
    assert.ok(getSim(r1.state, r1.state.pieces[0].holderId));
    const r2 = addPiece(r1.state, deps, T0, 'arch-angel');
    assert.equal(r2.completed, true);
    assert.equal(r2.state.pieces.length, 0);
    assert.equal(r2.state.cards.find((c) => c.uid === r2.uid).cardId, 'arch-angel');
    let s = r2.state;
    const ids = ['dwarf-king', 'imperial-dragon', 'rat-eater', 'armorer', 'phoenix', 'guruk-the-destroyer', 'sister-elenia', 'airborne-parasite'];
    for (const id of ids) s = addPiece(s, deps, T0, id).state;
    assert.equal(s.pieces.length, MAX_HUNTS);
    const full = addPiece(s, deps, T0, 'basilisk');
    assert.equal(full.full, true);
    assert.equal(full.state.pieces.length, 8);
  });

  test('piece fights: win steals a piece (+10 TP), loss gives nothing, completion creates the card', () => {
    let { state, deps } = fresh({ winner: 'attacker' });
    state = addPiece(rich(state), deps, T0, 'rat-eater').state;
    state = { ...state, pieces: [{ ...state.pieces[0], owned: 3 }] };
    deps.engine.winner = 'defender';
    const loss = fightHolder(state, deps, T0, { index: 0 });
    assert.equal(loss.won, false);
    assert.equal(loss.state.pieces[0].owned, 3);
    assert.equal(loss.state.player.mana, 200 - deckMana(state, deps));
    deps.engine.winner = 'attacker';
    const win = fightHolder(state, deps, T0, { index: 0 });
    assert.equal(win.won, true);
    assert.equal(win.completed, true);
    assert.equal(win.state.pieces.length, 0);
    assert.equal(win.state.cards.find((c) => c.uid === win.uid).cardId, 'rat-eater');
    assert.equal(win.tournamentPoints, 10);
    assert.equal(win.state.player.battlesWon, 1);
  });

  test('piece prices: wiki table, halved on Card-piece Day; buying completes; first piece costs 100/50 gems', () => {
    assert.equal(missingPrice('uncommon', 1), 20);
    assert.equal(missingPrice('rare', 3), 140);
    assert.equal(missingPrice('heroic', 5), 1700);
    assert.equal(missingPrice('legendary', 9), 4000);
    assert.equal(missingPrice('legendary', 4, 'card-piece-day'), 400);
    let { state, deps } = fresh();
    state = addPiece(rich(state), deps, T0, 'armorer').state;
    const r = buyMissingPieces(state, deps, T0, { index: 0 });
    assert.equal(r.cost, 140);
    assert.equal(r.state.player.gems, 5000 - 140);
    assert.equal(r.state.pieces.length, 0);
    assert.equal(r.state.cards.find((c) => c.uid === r.uid).cardId, 'armorer');
    const f = buyFirstPiece(r.state, deps, T0, {});
    assert.equal(f.cost, 100);
    assert.equal(f.state.pieces[0].cardId, f.cardId);
    assert.ok(['rare', 'heroic'].includes(deps.db.get(f.cardId).rarity));
    assert.equal(buyFirstPiece(r.state, deps, T0, { event: 'card-piece-day' }).cost, 50);
  });

  test('daily raids: 20 % per hunt per day, once per day, deterministic, can be disabled', () => {
    let { state, deps } = fresh();
    state = rich(state);
    for (const id of ['dwarf-king', 'imperial-dragon', 'sister-elenia', 'guruk-the-destroyer', 'phoenix']) state = addPiece(state, deps, T0, id).state;
    state = { ...state, pieces: state.pieces.map((h) => ({ ...h, owned: 3 })) };
    assert.deepEqual(dailyRaids(state, deps, T0).stolen, []);
    let stolenTotal = 0;
    let s = state;
    for (let d = 1; d <= 40; d++) {
      const r = dailyRaids(s, deps, T0 + d * DAY_MS);
      stolenTotal += r.stolen.length;
      assert.equal(dailyRaids(r.state, deps, T0 + d * DAY_MS).stolen.length, 0);
      s = r.state;
    }
    assert.ok(stolenTotal >= 8 && stolenTotal <= 15, 'stolen ' + stolenTotal);
    assert.equal(s.notices.filter((n) => n.type === 'raid').length, stolenTotal);
    assert.ok(s.pieces.every((h) => h.owned >= 0));
    const off = { ...state, settings: { ...state.settings, raids: false } };
    assert.deepEqual(dailyRaids(off, deps, T0 + DAY_MS).stolen, []);
    const again = dailyRaids(state, deps, T0 + DAY_MS);
    assert.deepEqual(again.stolen, dailyRaids(state, deps, T0 + DAY_MS).stolen);
  });
});

// ================================================================= §5 Arena / Pieces / Replays

describe('§5 simulated players and arena', () => {
  test('pool: 60 simulated players around the player level, legal decks within their mana, no trainers, refreshed daily', () => {
    const d = deps();
    const s = rich(fresh());
    const g = O.ensurePool(s, d, T0);
    assert.equal(g.refreshed, true);
    const players = g.state.sim.players;
    assert.equal(players.length, 60);
    assert.equal(O.POOL_SIZE, 60);
    assert.equal(new Set(players.map((p) => p.id)).size, 60);
    assert.equal(g.state.sim.day, S.utcDay(T0));
    for (const sim of players) {
      assert.ok(sim.level >= 7 && sim.level <= 15, 'level ' + sim.level);
      assert.ok(sim.avatar >= 0 && sim.avatar < 12);
      assert.ok(NAMES.names.includes(sim.name));
      assert.equal(sim.deck.length, 5);
      const cards = sim.deck.filter(Boolean);
      assert.ok(cards.length >= 1);
      assert.ok(O.simDeckMana(sim, d) <= sim.manaMax, 'deck within the sim max mana');
      for (const c of cards) {
        const def = db.get(c.cardId);
        assert.ok(def && !def.trainer, 'trainer in a sim deck');
        assert.ok(c.level >= 1 && c.level <= stats.capFor(def, c.stage));
      }
      // unlocked slots mirror the human rules
      if (sim.level < 3) assert.equal(sim.deck[4], null);
      if (sim.level < 5) assert.equal(sim.deck[0], null);
      assert.deepEqual(O.simStats(sim.level), { hpMax: sim.hpMax, staminaMax: sim.staminaMax, manaMax: sim.manaMax });
    }
    assert.equal(O.ensurePool(fz(g.state), d, T0 + 3 * 60 * MIN).refreshed, false, 'same day: untouched');
    const next = O.ensurePool(fz(g.state), d, T0 + DAY);
    assert.equal(next.refreshed, true);
    assert.equal(next.state.sim.day, S.utcDay(T0 + DAY));
    assert.equal(next.state.sim.players.length, 60);
    const grew = next.state.sim.players.filter((p, i) => p.level > players[i].level).length;
    assert.ok(grew > 5 && grew < 35, 'sims gain levels slowly: ' + grew);
    // a human who out-levelled the pool gets replacements
    const far = fz({ ...g.state, player: { ...g.state.player, level: 40 } });
    const re = O.ensurePool(far, d, T0 + DAY);
    assert.ok(re.state.sim.players.every((p) => p.level >= 39 && p.level <= 43));
  });

  test('arena offers: easy (−2…0, ×0.7), normal (±1, ×1.0), hard (+1…+3, ×1.3); 30-minute timer', () => {
    const d = deps();
    const s = rich(fresh());
    const eo = A.ensureOffers(s, d, T0);
    assert.equal(eo.offers.length, 3);
    assert.deepEqual(eo.offers.map((o) => o.difficulty), ['easy', 'normal', 'hard']);
    assert.deepEqual(eo.offers.map((o) => o.color), ['green', 'yellow', 'red']);
    assert.deepEqual(eo.offers.map((o) => o.power), [0.7, 1, 1.3]);
    const ranges = [[-2, 0], [-1, 1], [1, 3]];
    eo.offers.forEach((o, i) => {
      const sim = O.getSim(eo.state, o.simId);
      assert.ok(sim.level - 10 >= ranges[i][0] && sim.level - 10 <= ranges[i][1], `${o.difficulty} level ${sim.level}`);
      assert.equal(o.level, sim.level);
      const info = A.offerInfo(fz(eo.state), d, i);
      assert.equal(info.level, sim.level);
      assert.ok(info.bestCard && info.stamina === sim.staminaMax && info.mana === sim.manaMax && info.hp === sim.hpMax);
      assert.equal(info.quests, sim.questsDone); assert.equal(info.battlesWon, sim.battlesWon);
    });
    assert.equal(new Set(eo.offers.map((o) => o.simId)).size, 3);
    assert.equal(eo.rerollAt, T0 + 30 * MIN);
    assert.equal(A.OFFER_ROTATION_MS, 30 * MIN);
    // stable until the timer
    const same = A.ensureOffers(fz(eo.state), d, T0 + 29 * MIN);
    assert.deepEqual(same.offers, eo.offers);
    const expired = A.ensureOffers(fz(eo.state), d, T0 + 30 * MIN);
    assert.equal(expired.rerollAt, T0 + 60 * MIN);
  });

  test('arena fight: costs deck mana; gold = enemyDeckMana × 6 (×2 on a win); 10 TP per win; offers rerolled; xp', () => {
    const run = (winner, event) => {
      const d = deps(winner);
      const s = fz(A.ensureOffers(rich(fresh()), d, T0).state);
      const offer = s.sim.arena.offers[1];
      const sim = O.getSim(s, offer.simId);
      const r = A.fightArena(s, d, T0, { offerIndex: 1, event });
      return { s, sim, r, d };
    };
    const w = run('attacker', null);
    const enemyMana = O.simDeckMana(w.sim, w.d);
    assert.equal(w.r.won, true);
    assert.equal(w.r.state.player.mana, 300 - S.deckMana(w.s, w.d), 'deck mana spent');
    assert.equal(w.r.rewards.gold, enemyMana * 6 * 2);
    assert.equal(w.r.state.player.gold, w.s.player.gold + enemyMana * 12);
    assert.equal(w.r.rewards.tournamentPoints, 10);
    assert.equal(w.r.state.player.tournamentPoints, 10);
    assert.equal(w.r.state.player.battlesWon, 1);
    assert.equal(w.r.rewards.cardXp, P.cardFightXp(enemyMana, true, false));
    assert.equal(w.r.rewards.playerXp, P.playerFightXp(w.sim.level, true));
    assert.equal(w.r.state.player.xp, w.s.player.xp + w.r.rewards.playerXp);
    assert.equal(w.r.state.sim.arena.rerollAt, T0 + 30 * MIN, 'offers rerolled after the fight');
    assert.equal(w.r.state.replays.length, 1);
    assert.equal(w.r.state.replays[0].mode, 'arena');
    assert.equal(w.r.state.replays[0].won, true);
    assert.equal(w.r.opponent.name, w.sim.name);
    assert.equal(w.d.engine.calls[0].defender.player.maxHp, w.sim.hpMax, 'normal difficulty: sim at full strength');
    const l = run('defender', null);
    const lm = O.simDeckMana(l.sim, l.d);
    assert.equal(l.r.won, false);
    assert.equal(l.r.rewards.gold, lm * 6);
    assert.equal(l.r.rewards.tournamentPoints, 0);
    assert.equal(l.r.state.player.battlesWon, 0);
    assert.equal(l.r.state.player.mana, 300 - S.deckMana(l.s, l.d), 'mana is lost on a loss too');
    assert.equal(l.r.rewards.playerXp, P.playerFightXp(l.sim.level, false));
    const g = run('attacker', 'golden-day');
    assert.equal(g.r.rewards.gold, Math.round(O.simDeckMana(g.sim, g.d) * 12 * 1.5));
    const wis = run('attacker', 'infinite-wisdom');
    assert.equal(wis.r.rewards.cardXp, P.cardFightXp(O.simDeckMana(wis.sim, wis.d), true, true));
    // hard / easy scale the opponent's hp and card levels by the power factor
    const dh = deps();
    const sh = fz(A.ensureOffers(rich(fresh()), dh, T0).state);
    const hard = A.fightArena(sh, dh, T0, { offerIndex: 2 });
    const hardSim = O.getSim(sh, sh.sim.arena.offers[2].simId);
    assert.equal(dh.engine.calls[0].defender.player.maxHp, Math.round(hardSim.hpMax * 1.3));
    assert.equal(hard.rewards.playerXp, P.playerFightXp(Math.round(hardSim.level * 1.3), true));
    const easy = A.fightArena(sh, dh, T0, { offerIndex: 0 });
    const easySim = O.getSim(sh, sh.sim.arena.offers[0].simId);
    assert.equal(dh.engine.calls[1].defender.player.maxHp, Math.round(easySim.hpMax * 0.7));
    assert.ok(easy.won);
  });

  test('mana gate: not enough mana → the potion dialog; a deck over the max mana cannot be selected', () => {
    const d = deps();
    const s = fz(A.ensureOffers(rich(fresh()), d, T0).state);
    const low = fz({ ...s, player: { ...s.player, mana: S.deckMana(s, d) - 1 } });
    const c = Pv.canFightPvp(low, d);
    assert.equal(c.ok, false); assert.equal(c.needsPotion, true); assert.equal(c.mana, S.deckMana(s, d));
    assert.throws(() => A.fightArena(low, d, T0, { offerIndex: 0 }), /mana/);
    assert.equal(Pv.canFightPvp(fz({ ...s, player: { ...s.player, mana: S.deckMana(s, d) } }), d).ok, true);
    assert.throws(() => A.fightArena(s, d, T0, { offerIndex: 3 }), /No such opponent/);
  });

  test('replays: the last 10 fights are kept', () => {
    const d = deps();
    let s = fz(A.ensureOffers(rich(fresh()), d, T0).state);
    for (let i = 0; i < 12; i++) s = fz(A.fightArena(s, d, T0 + i * MIN, { offerIndex: 0 }).state);
    assert.equal(s.replays.length, 10);
    assert.equal(Pv.MAX_REPLAYS, 10);
    assert.equal(s.replays[0].at, T0 + 11 * MIN, 'newest first');
    for (const r of s.replays) {
      assert.ok(Number.isInteger(r.seed));
      assert.equal(r.attacker.cards.length, 5);
      assert.equal(r.defender.cards.length, 5);
      assert.ok(r.result && typeof r.result.winner === 'string');
    }
  });
});

describe('§5 pieces', () => {
  test('8 hunt slots; pieces per rarity (Uncommon 2, Rare 4, Heroic 6, Legendary 10, Ultimate 12) match core constants', () => {
    assert.equal(Pc.MAX_HUNTS, 8);
    const d = deps();
    assert.equal(Pc.piecesTotal(d, sample('uncommon').id), 2);
    assert.equal(Pc.piecesTotal(d, sample('rare').id), 4);
    assert.equal(Pc.piecesTotal(d, sample('heroic').id), 6);
    assert.equal(Pc.piecesTotal(d, sample('legendary').id), 10);
    assert.equal(Pc.piecesTotal(d, sample('ultimate').id), 12);
  });

  test('gem prices for missing pieces (wiki table), halved on Card-piece Day; every rarity has prices up to its piece count', () => {
    const table = { uncommon: [20], rare: [30, 60, 140], heroic: [170, 285, 625, 1100, 1700], legendary: [125, 200, 450, 800, 1250, 1750, 2500, 3200, 4000] };
    for (const r of Object.keys(table)) table[r].forEach((price, i) => {
      assert.equal(Pc.missingPrice(r, i + 1), price, `${r} ${i + 1}`);
      assert.equal(Pc.missingPrice(r, i + 1, 'card-piece-day'), Math.ceil(price / 2), `${r} ${i + 1} event`);
    });
    assert.equal(Pc.missingPrice('rare', 0), 0);
    for (const r of ['uncommon', 'rare', 'heroic', 'legendary', 'ultimate']) {
      assert.ok(Array.isArray(Pc.PIECE_PRICES[r]), r + ' has a price row');
      assert.equal(Pc.PIECE_PRICES[r].length, RARITIES[r].pieces - 1, r + ' prices cover every missing count');
      for (let m = 2; m < RARITIES[r].pieces; m++) assert.ok(Pc.missingPrice(r, m) > Pc.missingPrice(r, m - 1), r + ' price rises');
    }
    assert.ok(Pc.missingPrice('ultimate', 11) > Pc.missingPrice('legendary', 9), 'Ultimate costs more than Legendary');
    const d = deps();
    const s = fz({ ...fresh(), pieces: [{ cardId: sample('heroic').id, owned: 2, total: 6, holderId: null, raidDay: '' }] });
    assert.equal(Pc.huntBuyPrice(s, d, 0, null), 1100);
    assert.equal(Pc.huntBuyPrice(s, d, 0, 'card-piece-day'), 550);
  });

  test('first piece of an empty slot: 100 gems (50 on Card-piece Day), a random Rare/Heroic portal set card, never a trainer', () => {
    const d = deps();
    const portalIds = new Set(QUESTS.portals.flatMap((p) => p.cards));
    for (let seed = 1; seed <= 30; seed++) {
      const s = fz({ ...rich(fresh()), seed });
      const r = Pc.buyFirstPiece(s, d, T0, {});
      assert.equal(r.cost, 100);
      assert.equal(r.state.player.gems, s.player.gems - 100);
      assert.equal(r.index, 0);
      const def = db.get(r.cardId);
      assert.ok(['rare', 'heroic'].includes(def.rarity), def.rarity);
      assert.ok(!def.trainer);
      assert.ok(portalIds.has(def.id), 'set card ' + def.id);
      assert.equal(r.state.pieces[0].owned, 1);
      assert.equal(r.state.pieces[0].total, Pc.piecesTotal(d, def.id));
      assert.ok(r.state.pieces[0].holderId && O.getSim(r.state, r.state.pieces[0].holderId), 'a holder is assigned');
    }
    const ev = Pc.buyFirstPiece(rich(fresh()), d, T0, { event: 'card-piece-day' });
    assert.equal(ev.cost, 50);
    assert.equal(Pc.FIRST_PIECE_GEMS, 100); assert.equal(Pc.FIRST_PIECE_GEMS_EVENT, 50);
    const full = fz({ ...rich(fresh()), pieces: new Array(8).fill(null).map((_, i) => ({ cardId: 'x' + i, owned: 1, total: 4, holderId: null, raidDay: '' })) });
    assert.throws(() => Pc.buyFirstPiece(full, d, T0, {}), /slots/);
    assert.throws(() => Pc.buyFirstPiece(fz({ ...fresh(), player: { ...fresh().player, gems: 99 } }), d, T0, {}), /gems/);
  });

  test('a boss piece drop starts a hunt; the 9th hunt is refused; the last piece creates the card even over the limit', () => {
    const d = deps();
    const def = sample('rare');
    const s = rich(fresh());
    const r1 = Pc.addPiece(s, d, T0, def.id);
    assert.equal(r1.completed, false); assert.equal(r1.full, false); assert.equal(r1.index, 0);
    assert.deepEqual({ cardId: r1.state.pieces[0].cardId, owned: r1.state.pieces[0].owned, total: r1.state.pieces[0].total }, { cardId: def.id, owned: 1, total: 4 });
    let s3 = fz(r1.state);
    s3 = fz(Pc.addPiece(s3, d, T0, def.id).state);
    s3 = fz(Pc.addPiece(s3, d, T0, def.id).state);
    assert.equal(s3.pieces[0].owned, 3);
    // fill the collection to the limit, then the 4th piece still creates the card
    let fullS = s3;
    while (fullS.cards.length < 80) fullS = give(fullS, d, 'envoy')[0];
    const done = Pc.addPiece(fullS, d, T0, def.id);
    assert.equal(done.completed, true);
    assert.ok(done.uid);
    assert.equal(S.getCard(done.state, done.uid).cardId, def.id);
    assert.equal(S.getCard(done.state, done.uid).stage, 0);
    assert.equal(S.getCard(done.state, done.uid).level, 1);
    assert.equal(done.state.cards.length, 81);
    assert.equal(done.state.pieces.length, 0, 'the slot is freed');
    // 8 hunts max
    let eight = s;
    const rares = db.byRarity('rare').filter((x) => !x.trainer).slice(0, 9);
    for (let i = 0; i < 8; i++) eight = fz(Pc.addPiece(eight, d, T0, rares[i].id).state);
    assert.equal(eight.pieces.length, 8);
    const ninth = Pc.addPiece(eight, d, T0, rares[8].id);
    assert.equal(ninth.full, true);
    assert.equal(ninth.state, eight);
    const ap = R.applyReward(eight, d, T0, { type: 'piece', cardId: rares[8].id });
    assert.equal(ap.reward.full, true);
    assert.match(R.describeReward(ap.reward, db), /full/);
  });

  test('piece fight: costs deck mana; win = +1 piece (card completed on the last), loss = nothing; the holder is rerolled', () => {
    const def = sample('uncommon'); // 2 pieces
    const setup = (winner) => {
      const d = deps(winner);
      const s = fz(Pc.addPiece(rich(fresh()), d, T0, def.id).state);
      return { d, s };
    };
    const l = setup('defender');
    const holderBefore = l.s.pieces[0].holderId;
    const lr = Pc.fightHolder(l.s, l.d, T0, { index: 0 });
    assert.equal(lr.won, false);
    assert.equal(lr.completed, false);
    assert.equal(lr.state.pieces[0].owned, 1, 'a loss costs no piece');
    assert.equal(lr.state.player.mana, 300 - S.deckMana(l.s, l.d));
    assert.equal(lr.state.player.gems, l.s.player.gems);
    assert.notEqual(lr.state.pieces[0].holderId, holderBefore, 'new holder after the fight');
    assert.equal(lr.state.replays[0].mode, 'pieces');
    const w = setup('attacker');
    const wr = Pc.fightHolder(w.s, w.d, T0, { index: 0 });
    assert.equal(wr.won, true);
    assert.equal(wr.completed, true, 'second of 2 pieces completes the card');
    assert.equal(S.getCard(wr.state, wr.uid).cardId, def.id);
    assert.equal(wr.state.pieces.length, 0);
    assert.equal(wr.hunt, null);
    // a 4-piece card: a win adds one and the hunt continues
    const d4 = deps('attacker');
    const s4 = fz(Pc.addPiece(rich(fresh()), d4, T0, sample('rare').id).state);
    const r4 = Pc.fightHolder(s4, d4, T0, { index: 0 });
    assert.equal(r4.completed, false);
    assert.equal(r4.state.pieces[0].owned, 2);
    assert.ok(r4.hunt.holderId && O.getSim(r4.state, r4.hunt.holderId));
    // skipping the holder costs 10 gems
    const sk = Pc.skipHolder(fz(r4.state), d4, T0, 0);
    assert.equal(sk.player.gems, r4.state.player.gems - 10);
    assert.notEqual(sk.pieces[0].holderId, r4.state.pieces[0].holderId);
    assert.equal(Pc.SKIP_GEMS, 10);
    const hh = Pc.huntHolder(fz(sk), d4, T0, 0);
    assert.equal(hh.holder.id, sk.pieces[0].holderId);
  });

  test('buying the missing pieces completes the card for the table price', () => {
    const d = deps();
    const def = sample('heroic');
    const s = fz({ ...rich(fresh()), pieces: [{ cardId: def.id, owned: 1, total: 6, holderId: null, raidDay: '' }] });
    const r = Pc.buyMissingPieces(s, d, T0, { index: 0 });
    assert.equal(r.cost, 1700);
    assert.equal(r.state.player.gems, s.player.gems - 1700);
    assert.equal(S.getCard(r.state, r.uid).cardId, def.id);
    assert.equal(r.state.pieces.length, 0);
    const ev = Pc.buyMissingPieces(s, d, T0, { index: 0, event: 'card-piece-day' });
    assert.equal(ev.cost, 850);
    assert.throws(() => Pc.buyMissingPieces(fz({ ...s, player: { ...s.player, gems: 1699 } }), d, T0, { index: 0 }), /gems/);
  });

  test('simulated raids: once per real day, 20 % per unfinished hunt with pieces; off by setting; notices', () => {
    const d = deps();
    const base = fresh();
    const yesterday = S.utcDay(T0 - DAY);
    const hunts = [
      { cardId: sample('rare').id, owned: 2, total: 4, holderId: null, raidDay: yesterday },
      { cardId: sample('heroic').id, owned: 0, total: 6, holderId: null, raidDay: yesterday },
    ];
    let stolen = 0;
    const N = 2000;
    for (let seed = 1; seed <= N; seed++) {
      const s = fz({ ...base, seed, pieces: hunts });
      const r = Pc.dailyRaids(s, d, T0);
      assert.equal(r.state.pieces[1].owned, 0, 'a hunt without pieces cannot lose one');
      assert.equal(r.state.pieces[0].raidDay, S.utcDay(T0));
      if (r.stolen.length) {
        stolen++;
        assert.deepEqual(r.stolen, [hunts[0].cardId]);
        assert.equal(r.state.pieces[0].owned, 1);
        assert.equal(r.state.notices.at(-1).type, 'raid');
        assert.equal(r.state.notices.at(-1).cardId, hunts[0].cardId);
      } else {
        assert.equal(r.state.pieces[0].owned, 2);
      }
      // the same day never raids twice
      const raided = fz(r.state);
      const again = Pc.dailyRaids(raided, d, T0 + 60 * MIN);
      assert.equal(again.state, raided);
      assert.deepEqual(again.stolen, []);
    }
    assert.ok(within(stolen / N, 0.2, 0.03), 'raid rate ' + stolen / N);
    for (let seed = 1; seed <= 50; seed++) {
      const off = fz({ ...base, seed, settings: { ...base.settings, raids: false }, pieces: hunts });
      const r = Pc.dailyRaids(off, d, T0);
      assert.equal(r.state, off, 'raids disabled: untouched');
      assert.deepEqual(r.stolen, []);
    }
  });
});
