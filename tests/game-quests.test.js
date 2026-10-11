'use strict';
/**
 * src/game: quests (portal rotation, minion waves, taps, boss line-ups and fights, rewards).
 * Two kinds of tests: the "(fixture catalog)" groups run on the 21-card fixture catalog and a stub engine
 * (tests/fixtures-game); the "§" groups verify the rules of docs/design/game-design.md (and the brief §5 tables
 * it points to) against the real data through the real cards-db and stats modules, with the stub engine where a
 * fight needs a known outcome. Every state the "§" groups hand to a game function is deep-frozen first (`fz`),
 * so any mutation of an input throws.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../src/core/rng.js';
import { DAY_MS } from '../src/game/state.js';
import { tokenCount } from '../src/game/player.js';
import {
  portalSchedule, startQuest, tapMinion, bossLineup, fightBoss, questStatus, prepareBoss, questProgressPct,
} from '../src/game/quests.js';
import { rollWaveReward, rollBossReward, applyReward, rollTapGold } from '../src/game/rewards.js';
import * as stats from '../src/core/stats.js';
import * as S from '../src/game/state.js';
import * as P from '../src/game/player.js';
import * as Q from '../src/game/quests.js';
import * as R from '../src/game/rewards.js';
import {
  T0, DAY, QUESTS, db, deps, fz, fresh, tutorialStart, rich, mainNode, portal, within,
} from './fixtures/real.js';
import * as stub from './fixtures-game/game.js';

describe('quests (fixture catalog)', () => {
  const { fresh } = stub; // the fixture-catalog builders

  // ---------------------------------------------------------------- quests

  test('portal rotation: 7 days per portal from createdAt', () => {
    const { deps } = fresh();
    const s0 = portalSchedule(deps, T0, T0);
    assert.equal(s0.portalId, 'the-dark-beyond');
    assert.equal(s0.remainingMs, 7 * DAY_MS);
    assert.equal(portalSchedule(deps, T0, T0 + 7 * DAY_MS).portalId, 'dragon-hunt');
    assert.equal(portalSchedule(deps, T0, T0 + 20 * DAY_MS).portalId, 'dwarven-rage');
    assert.equal(portalSchedule(deps, T0, T0 + 21 * DAY_MS).portalId, 'the-dark-beyond');
    assert.equal(portalSchedule(deps, T0, T0 + 8 * DAY_MS).portalId, 'dragon-hunt');
  });

  test('startQuest builds 2-5 waves of minions matching the figure count; locked quests refuse', () => {
    const { state, deps } = fresh();
    const r = startQuest(state, deps, T0, { line: 'main', n: 1 });
    assert.equal(r.active.figuresTotal, 5);
    assert.equal(r.active.waves.length, 2);
    assert.ok(r.active.waves.every((w) => w.length >= 2 && w.length <= 4));
    assert.ok(r.active.waves.flat().every((id) => ['common', 'standard'].includes(deps.db.get(id).rarity)));
    assert.throws(() => startQuest(state, deps, T0, { line: 'main', n: 2 }), /locked/i);
    const big = startQuest({ ...state, quests: { ...state.quests, main: { unlocked: 60, done: 59, firstWins: [] } } }, deps, T0, { line: 'main', n: 60 });
    assert.ok(big.active.waves.length >= 2 && big.active.waves.length <= 5);
    assert.equal(big.active.waves.flat().length, deps.quests.main.nodes[59].figures);
  });

  test('tapMinion: stamina per tap, potion dialog when short, wave rewards, boss ready', () => {
    let { state, deps } = fresh();
    state = startQuest(state, deps, T0, { line: 'main', n: 1 }).state;
    let r = tapMinion(state, deps, T0);
    // Quest 1: 2 stamina and 6 gold per tap, +10 on the last tap (tutorial.md §1.4); 1 xp per stamina.
    assert.equal(r.state.player.stamina, 48);
    assert.equal(r.gold, 6);
    assert.equal(r.perfect, true);
    assert.equal(r.xp, 2);
    assert.equal(r.state.player.gold, 306);
    assert.equal(r.minion, state.quests.active.waves[0][0]);
    assert.equal(r.pct, 20);
    const short = { ...state, player: { ...state.player, stamina: 1 } };
    const blocked = tapMinion(short, deps, T0);
    assert.equal(blocked.needsPotion.needed, true);
    assert.equal(blocked.state, short);
    let s = r.state;
    let rewards = [];
    let cleared = 0;
    for (let i = 0; i < 4; i++) {
      r = tapMinion(s, deps, T0);
      s = r.state;
      if (r.waveCleared) { cleared++; rewards.push(r.reward); }
    }
    assert.equal(cleared, 2);
    assert.equal(r.bossReady, true);
    assert.equal(r.pct, 100);
    assert.equal(s.player.stamina, 40);
    assert.equal(r.gold, 16);
    assert.equal(s.player.gold, 300 + 5 * 6 + 10 + rewards.filter((x) => x && x.type === 'card' && x.converted).reduce((a, x) => a + x.gold, 0));
    assert.equal(s.player.xp, 10);
    assert.ok(rewards.every((x) => x === null || x.type === 'card' || (x.type === 'gold' && x.burst)));
    const again = tapMinion(s, deps, T0);
    assert.equal(again.bossReady, true);
    assert.equal(again.state.player.stamina, 40);
  });

  // DECISIONS D2: gold is paid per tap (flat, ~1 in 10 taps a ~4.5× burst); a wave end only drops a card (20 %).
  test('wave drop odds ≈ 20 % card / 80 % nothing; tap gold flat with ~10 % bursts of 4.5× (seeded)', () => {
    const { deps } = fresh();
    const quest = deps.quests.main.nodes[11];
    const rng = mulberry32(99);
    const counts = { card: 0, none: 0 };
    const N = 4000;
    for (let i = 0; i < N; i++) counts[rollWaveReward(rng, deps, quest).type]++;
    assert.ok(Math.abs(counts.card / N - 0.2) < 0.03);
    assert.ok(Math.abs(counts.none / N - 0.8) < 0.03);
    let bursts = 0;
    for (let i = 0; i < N; i++) {
      const t = rollTapGold(rng, quest);
      assert.equal(t.tap, 30);
      if (t.burst) { bursts++; assert.equal(t.burst, 135); }
    }
    assert.ok(Math.abs(bursts / N - 0.1) < 0.02);
    assert.deepEqual(rollTapGold({ next: () => 0.05 }, quest, { event: 'golden-day' }), { gold: 45 + 203, tap: 45, burst: 203, perfect: true });
    const q1 = deps.quests.main.nodes[0];
    assert.deepEqual(rollTapGold({ next: () => 0 }, q1), { gold: 6, tap: 6, burst: 0, perfect: true });
    assert.deepEqual(rollTapGold({ next: () => 0 }, q1, { last: true }), { gold: 16, tap: 6, burst: 10, perfect: true });
  });

  test('boss lineup: fixed boss in the middle slot, band levels; Q1 = Worm Shaman with 2 Throat-Cutters', () => {
    const { deps } = fresh();
    const q1 = deps.quests.main.nodes[0];
    const l1 = bossLineup(q1, mulberry32(3), deps.db, deps.stats, 'main');
    assert.deepEqual(l1.cards.filter(Boolean).map((c) => c.cardId), ['throat-cutter', 'throat-cutter']);
    assert.equal(l1.cards[2].cardId, 'throat-cutter');
    assert.equal(l1.player.name, 'Worm Shaman');
    assert.equal(l1.player.maxHp, 250);
    assert.equal(l1.cards[2].level, 1);
    const q100 = deps.quests.main.nodes[99];
    const l100 = bossLineup(q100, mulberry32(5), deps.db, deps.stats, 'main');
    assert.equal(l100.cards[2].cardId, 'imperial-dragon');
    assert.equal(l100.cards[2].stage, 2);
    assert.equal(l100.cards[2].level, 34);
    assert.equal(l100.player.name, 'Imperial Dragon++');
    assert.equal(l100.cards.filter(Boolean).length, 5);
    for (const c of l100.cards.filter(Boolean)) {
      const def = deps.db.get(c.cardId);
      assert.ok(c.level <= deps.stats.capFor(def, c.stage));
      assert.ok(c.level >= 18);
      assert.ok(['heroic', 'legendary'].includes(def.rarity) || c.isBoss);
    }
    const q5 = deps.quests.main.nodes[4];
    const l5 = bossLineup(q5, mulberry32(8), deps.db, deps.stats, 'main');
    assert.ok(['common', 'standard'].includes(deps.db.get(l5.cards[2].cardId).rarity));
    assert.ok(l5.cards.filter(Boolean).every((c) => c.level >= 1 && c.level <= 3));
  });

  test('quest flow: win unlocks the next quest, grants xp and a boss reward; a loss resets the minions', () => {
    let { state, deps } = fresh({ winner: 'attacker' });
    state = startQuest(state, deps, T0, { line: 'main', n: 1 }).state;
    for (let i = 0; i < 5; i++) state = tapMinion(state, deps, T0).state;
    assert.equal(state.quests.active.bossReady, true);
    const pb = prepareBoss(state, deps, T0);
    assert.equal(pb.lineup.cards[2].cardId, 'throat-cutter');
    const r = fightBoss(pb.state, deps, T0);
    assert.equal(r.won, true);
    assert.equal(r.unlocked, 2);
    assert.equal(r.firstWin, true);
    assert.equal(r.state.quests.main.unlocked, 2);
    assert.equal(r.state.player.questsDone, 1);
    assert.equal(r.state.quests.active, null);
    // Boss fights give no player xp (playthroughs-2.md §1.3); quest 1's first win gives the Throat-Cutter soul card.
    assert.equal(r.playerXp, 0);
    assert.deepEqual([r.reward.type, r.reward.cardId], ['card', 'throat-cutter']);
    assert.equal(r.deckSlots, null);
    assert.equal(questStatus(r.state, 'main', 1), 'done');
    assert.equal(questStatus(r.state, 'main', 2), 'current');
    assert.ok(r.state.cards.find((c) => c.uid === state.deck[1]).xp > 0 || r.cardLevelUps.length > 0);
    assert.equal(deps.engine.calls.length, 1);
    assert.equal(deps.engine.calls[0].defender.player.maxHp, 250);

    deps.engine.winner = 'defender';
    let s = startQuest(r.state, deps, T0, { line: 'main', n: 2 }).state;
    while (!s.quests.active.bossReady) s = tapMinion(s, deps, T0).state;
    const loss = fightBoss(s, deps, T0);
    assert.equal(loss.won, false);
    assert.equal(loss.state.quests.main.unlocked, 2);
    assert.equal(loss.state.quests.active.figuresDone, 0);
    assert.equal(loss.state.quests.active.bossReady, false);
    assert.equal(questProgressPct(loss.state.quests.active), 0);
    assert.equal(loss.playerXp, 0);
    assert.throws(() => fightBoss({ ...r.state, quests: { ...r.state.quests, active: null } }, deps, T0), /active quest|not beaten/);
  });

  test('replaying a beaten quest gives no second first-win and does not re-unlock', () => {
    let { state, deps } = fresh({ winner: 'attacker' });
    state = { ...state, quests: { ...state.quests, main: { unlocked: 3, done: 2, firstWins: [1, 2] } } };
    state = startQuest(state, deps, T0, { line: 'main', n: 1 }).state;
    while (!state.quests.active.bossReady) state = tapMinion(state, deps, T0).state;
    const r = fightBoss(state, deps, T0);
    assert.equal(r.firstWin, false);
    assert.equal(r.unlocked, null);
    assert.equal(r.state.quests.main.unlocked, 3);
    assert.equal(r.state.player.questsDone, 0);
  });

  test('boss reward odds ≈ 45/25/15/10/5 and portal node 25 gives a high token on the first win', () => {
    const { deps } = fresh();
    const line = deps.quests.main;
    const quest = line.nodes[71]; // Q72: pieces eligible (legendary)
    const rng = mulberry32(2024);
    const counts = { gold: 0, token: 0, piece: 0, potion: 0, gems: 0 };
    const N = 4000;
    for (let i = 0; i < N; i++) counts[rollBossReward(rng, deps, line, quest, false).type]++;
    assert.ok(Math.abs(counts.gold / N - 0.45) < 0.03);
    assert.ok(Math.abs(counts.token / N - 0.25) < 0.03);
    assert.ok(Math.abs(counts.piece / N - 0.15) < 0.03);
    assert.ok(Math.abs(counts.potion / N - 0.1) < 0.03);
    assert.ok(Math.abs(counts.gems / N - 0.05) < 0.02);
    const early = line.nodes[4];
    const c2 = { gold: 0, token: 0, piece: 0, potion: 0, gems: 0 };
    for (let i = 0; i < 1000; i++) c2[rollBossReward(rng, deps, line, early, false).type]++;
    assert.equal(c2.piece, 0);
    const tok = rollBossReward(mulberry32(1), deps, line, early, false);
    if (tok.type === 'token') assert.equal(tok.token, 'neophyte');
    const portal = deps.quests.portals[0];
    const first = rollBossReward(mulberry32(1), deps, portal, portal.nodes[24], true);
    assert.deepEqual(first, { type: 'token', token: 'portalHigh', portalId: 'the-dark-beyond', count: 1 });
    const later = rollBossReward(mulberry32(1), deps, portal, portal.nodes[24], false);
    assert.notEqual(later.type === 'token' && later.token === 'portalHigh' && later.count === 1 && later.portalId === 'the-dark-beyond', false && true);
    for (let i = 0; i < 200; i++) {
      const p = rollBossReward(rng, deps, portal, portal.nodes[10], false);
      if (p.type === 'piece') assert.ok(portal.cards.includes(p.cardId));
      if (p.type === 'token') assert.equal(p.token, 'portalHigh');
    }
  });

  test('applyReward handles every reward type', () => {
    let { state, deps } = fresh();
    state = applyReward(state, deps, T0, { type: 'gold', gold: 50 }).state;
    assert.equal(state.player.gold, 350);
    state = applyReward(state, deps, T0, { type: 'gems', gems: 13 }).state;
    assert.equal(state.player.gems, 13);
    state = applyReward(state, deps, T0, { type: 'potion', potion: 'mana', count: 2 }).state;
    assert.equal(state.player.manaPotions, 3);
    state = applyReward(state, deps, T0, { type: 'token', token: 'portalLow', portalId: 'dragon-hunt', count: 1 }).state;
    assert.equal(tokenCount(state, 'portalLow', 'dragon-hunt'), 1);
    const card = applyReward(state, deps, T0, { type: 'card', cardId: 'basilisk', stage: 0, level: 2 });
    assert.equal(card.reward.converted, false);
    assert.equal(card.state.cards.find((c) => c.uid === card.reward.uid).level, 2);
    const piece = applyReward(card.state, deps, T0, { type: 'piece', cardId: 'dwarf-king' });
    assert.equal(piece.state.pieces.length, 1);
    assert.equal(piece.state.pieces[0].total, 10);
    assert.equal(piece.reward.huntIndex, 0);
  });
});

// ================================================================= §4 Quest map

describe('§4 quest flow', () => {
  test('portal rotation: one portal open 7 days at a time from the save date, cycling in order', () => {
    const d = deps();
    const s = fresh();
    const ids = QUESTS.portals.map((p) => p.id);
    for (let k = 0; k < 20; k++) {
      const now = T0 + k * 7 * DAY + 3 * DAY;
      const sch = Q.portalSchedule(d, T0, now);
      assert.equal(sch.portalId, ids[k % ids.length], 'period ' + k);
      assert.equal(sch.startedAt, T0 + k * 7 * DAY);
      assert.equal(sch.endsAt, T0 + (k + 1) * 7 * DAY);
      assert.equal(sch.remainingMs, 4 * DAY);
    }
    assert.equal(Q.portalSchedule(d, T0, T0 + 7 * DAY - 1).portalId, ids[0]);
    assert.equal(Q.portalSchedule(d, T0, T0 + 7 * DAY).portalId, ids[1]);
    // every portal is reachable even when the schedule is elsewhere
    assert.equal(Q.questStatus(s, 'dying-dreams', 1), 'current');
    assert.equal(Q.questStatus(s, 'dying-dreams', 2), 'locked');
  });

  // tutorial.md §1.4 / §4: Worm Shaman 250 HP (300 with the tribe bonus) with 2 Throat-Cutters; 5 minions × 2 stamina.
  test('§9 quest 1: unlocked from the start, 2 stamina per tap, 5 figures, Worm Shaman with 2 Throat-Cutters, 250 HP', () => {
    const d = deps();
    const s = tutorialStart();
    assert.equal(Q.questStatus(s, 'main', 1), 'current');
    assert.equal(Q.questStatus(s, 'main', 2), 'locked');
    assert.throws(() => Q.startQuest(s, d, T0, { line: 'main', n: 2 }), /locked/);
    const q1 = mainNode(1);
    assert.equal(q1.staminaPerTap, 2); assert.equal(q1.figures, 5); assert.equal(q1.bossHp, 250);
    const st = Q.startQuest(s, d, T0, { line: 'main', n: 1 });
    assert.equal(st.active.figuresTotal, 5);
    assert.equal(st.active.waves.length, 2);
    assert.deepEqual(st.active.waves.map((w) => w.length), [3, 2]);
    const lineup = Q.bossLineup(q1, mulberry32(5), db, stats, 'main');
    assert.equal(lineup.boss.cardId, 'throat-cutter');
    assert.equal(lineup.boss.level, 1);
    assert.equal(lineup.boss.stage, 0);
    assert.equal(lineup.cards[2], lineup.boss, 'the boss card sits in the middle slot');
    assert.deepEqual(lineup.cards.filter(Boolean).map((c) => c.cardId), ['throat-cutter', 'throat-cutter']);
    assert.equal(lineup.player.hp, 250); assert.equal(lineup.player.maxHp, 250);
    assert.equal(lineup.player.level, 1);
    assert.equal(lineup.player.name, 'Worm Shaman');
    for (const c of lineup.cards.filter((c) => c && c !== lineup.boss)) {
      assert.ok(['common', 'standard'].includes(db.get(c.cardId).rarity));
      assert.ok(c.level >= 1 && c.level <= 3);
    }
  });

  test('waves: 2–5 waves, each 2–4 minions when the figure total allows it, minions from the band, no trainers', () => {
    const d = deps();
    const lines = [['main', QUESTS.main], ...QUESTS.portals.map((p) => [p.id, p])];
    for (const [lineId, line] of lines) {
      for (const q of line.nodes) {
        const waves = Q.generateWaves(mulberry32(q.n * 31 + lineId.length), d, q);
        assert.ok(waves.length >= 2 && waves.length <= 5, `${lineId} ${q.n} waves`);
        assert.equal(waves.reduce((s, w) => s + w.length, 0), q.figures, `${lineId} ${q.n} figures`);
        for (const w of waves) {
          assert.ok(w.length >= 2, `${lineId} ${q.n} wave size`);
          if (q.figures <= 20) assert.ok(w.length <= 4, `${lineId} ${q.n} wave size ${w.length}`);
          for (const id of w) {
            const def = db.get(id);
            assert.ok(def && !def.trainer && q.band.rarities.includes(def.rarity), `${lineId} ${q.n} minion ${id}`);
          }
        }
      }
    }
  });

  // DECISIONS D2: every tap costs the quest's stamina and pays flat gold ("Perfect!") and 1 xp per stamina.
  test('tapping a minion costs the quest stamina per tap and pays gold and xp; the Drink-potion dialog appears when short', () => {
    const d = deps();
    const s = fresh();
    const st = fz(Q.startQuest(s, d, T0, { line: 'main', n: 1 }).state);
    const t1 = Q.tapMinion(st, d, T0, {});
    assert.equal(t1.state.player.stamina, 48);
    assert.equal(t1.needsPotion, null);
    assert.equal(t1.waveCleared, false);
    assert.equal(t1.pct, 20);
    assert.equal(t1.minion, st.quests.active.waves[0][0]);
    assert.deepEqual([t1.stamina, t1.gold, t1.tapGold, t1.burst, t1.perfect, t1.xp], [2, 6, 6, 0, true, 2]);
    assert.equal(t1.state.player.gold, st.player.gold + 6);
    assert.equal(t1.state.player.xp, st.player.xp + 2);
    assert.deepEqual(Q.questTapInfo(mainNode(12)), { stamina: 5, gold: 30, xp: 5, figures: 11, burstChance: 0.1, endGold: 0 });
    const short = fz({ ...st, player: { ...st.player, stamina: 1 } });
    const t2 = Q.tapMinion(short, d, T0, { event: 'drinking-contest' });
    assert.equal(t2.state, short, 'nothing changes when short');
    assert.equal(t2.needsPotion.needed, true);
    assert.equal(t2.needsPotion.kind, 'stamina');
    assert.equal(t2.needsPotion.price, 20);
    assert.equal(t2.needsPotion.missing, 1);
    assert.equal(Q.tapMinion(short, d, T0, {}).needsPotion.price, 40);
    // the quest's own per-tap value is used (Q31 = 6); the xp of a tap can level the player up
    const r31 = fz({ ...rich(s), quests: { ...s.quests, main: { unlocked: 31, done: 30, firstWins: [] } } });
    const st31 = fz(Q.startQuest(r31, d, T0, { line: 'main', n: 31 }).state);
    assert.equal(Q.tapMinion(st31, d, T0, {}).state.player.stamina, 5000 - 6);
    const edge = fz({ ...st31, player: { ...st31.player, xp: stats.playerXpToNext(10) - 1, stamina: 10, staminaMax: 60 } });
    const lv = Q.tapMinion(edge, d, T0, {});
    assert.deepEqual(lv.levelUps, [11]);
    assert.equal(lv.levelUpDetails[0].rewards.gold, 550);
    assert.equal(lv.state.player.stamina, 60, 'a level-up refills stamina');
    // a portal node uses the wiki stamina per figure
    const stP = fz(Q.startQuest(rich(s), d, T0, { line: 'the-dark-beyond', n: 1 }).state);
    assert.equal(Q.tapMinion(stP, d, T0, {}).state.player.stamina, 5000 - 6);
  });

  test('clearing every wave: progress 0→100 %, a reward roll per wave, then the boss is ready', () => {
    const d = deps();
    let s = fz(Q.startQuest(rich(fresh()), d, T0, { line: 'main', n: 1 }).state);
    const total = s.quests.active.figuresTotal;
    let rewards = 0, cleared = 0;
    for (let i = 0; i < total; i++) {
      const r = Q.tapMinion(s, d, T0, {});
      s = fz(r.state);
      assert.equal(r.pct, Math.round(((i + 1) / total) * 100));
      if (r.waveCleared) { cleared++; rewards++; }
      assert.ok(r.reward === null || r.reward.type === 'card' || (r.reward.type === 'gold' && r.reward.burst), 'card drop or gold burst');
      if (i < total - 1) assert.ok(r.reward === null || r.reward.type === 'card', 'quest 1 has no random bursts');
      assert.equal(r.bossReady, i === total - 1);
    }
    assert.equal(cleared, s.quests.active.waves.length);
    assert.equal(rewards, 2);
    assert.equal(s.quests.active.bossReady, true);
    assert.equal(Q.questProgressPct(s.quests.active), 100);
    assert.equal(s.player.stamina, 5000 - 2 * total);
    const after = Q.tapMinion(s, d, T0, {});
    assert.equal(after.state, s, 'no more taps once the boss is ready');
    assert.equal(after.bossReady, true);
    assert.throws(() => Q.prepareBoss(fz(Q.startQuest(rich(fresh()), d, T0, { line: 'main', n: 1 }).state), d, T0), /minions/);
  });

  // DECISIONS D2: gold per tap (flat, ~1 in 10 taps a ~4.5× burst, Q12: 140 at 30/tap); a wave only drops a card.
  test('wave drop odds: 20 % band card, 80 % nothing; tap gold flat with 10 % bursts of 4.5×; Golden Day +50 % gold', () => {
    const d = deps();
    const q = mainNode(45);
    const N = 20000;
    const count = { gold: 0, card: 0, none: 0 };
    let bursts = 0;
    for (let i = 0; i < N; i++) {
      const t = R.rollTapGold(mulberry32(i), q, {});
      assert.equal(t.tap, 33);
      if (t.burst) { bursts++; assert.equal(t.burst, Math.round(33 * 4.5)); }
      const r = R.rollWaveReward(mulberry32(i), d, q);
      count[r.type]++;
      if (r.type === 'card') {
        const def = db.get(r.cardId);
        assert.ok(q.band.rarities.includes(def.rarity));
        assert.ok(!def.trainer);
        assert.equal(r.level, 1);
        assert.equal(r.stage, q.band.stages[0]);
      }
    }
    assert.equal(count.gold, 0);
    assert.ok(within(count.card / N, 0.2, 0.015), 'card ' + count.card / N);
    assert.ok(within(count.none / N, 0.8, 0.015), 'none ' + count.none / N);
    assert.ok(within(bursts / N, 0.1, 0.01), 'bursts ' + bursts / N);
    assert.deepEqual(R.WAVE_ODDS, { card: 0.2, none: 0.8 });
    assert.equal(R.rollTapGold(mulberry32(1), q, { event: 'golden-day' }).tap, Math.round(33 * 1.5));
    assert.equal(P.goldWithEvent(100, 'golden-day'), 150);
    assert.equal(P.goldWithEvent(100, { id: 'golden-day' }), 150);
    assert.equal(P.goldWithEvent(100, 'infinite-wisdom'), 100);
    // fused-band waves drop fused cards of the band's first stage
    let fused = null;
    for (let i = 0; fused === null; i++) { const r = R.rollWaveReward(mulberry32(i), d, mainNode(70)); if (r.type === 'card') fused = r; }
    assert.equal(fused.stage, 1);
  });

  test('boss line-ups: fixed boss at the band level in the middle, 4 band cards at matching levels, no trainers', () => {
    const d = deps();
    const check = (lineId, q, seed) => {
      const lu = Q.bossLineup(q, mulberry32(seed), db, stats, lineId);
      const [lo, hi] = q.band.levels;
      assert.equal(lu.cards.filter(Boolean).length, 1 + q.bossCards);
      assert.equal(lu.player.hp, q.bossHp);
      assert.equal(lu.player.level, q.n);
      if (q.boss) { assert.equal(lu.boss.cardId, q.boss); assert.equal(lu.boss.stage, q.bossStage); }
      const t = Q.bandPosition(lineId, q.n);
      const bdef = db.get(lu.boss.cardId);
      // the tutorial bosses (Q1–10) play level-1 cards (bossLevel, tutorial-v2.md §10)
      const want = q.bossLevel != null ? q.bossLevel : Math.round(lo + (hi - lo) * t);
      assert.equal(lu.boss.level, Math.max(1, Math.min(stats.capFor(bdef, lu.boss.stage), want)));
      for (const c of lu.cards.filter((c) => c && c !== lu.boss)) {
        const def = db.get(c.cardId);
        assert.ok(!def.trainer, 'trainer in line-up');
        assert.ok(q.band.rarities.includes(def.rarity), `${lineId} ${q.n} rarity ${def.rarity}`);
        assert.ok(c.stage >= q.band.stages[0] && c.stage <= q.band.stages[1]);
        assert.ok(c.level >= Math.max(1, lo - 2) && c.level <= hi + 2, `${lineId} ${q.n} level ${c.level}`);
        assert.ok(c.level <= stats.capFor(def, c.stage), 'level above cap');
      }
      return lu;
    };
    for (const n of [1, 5, 11, 30, 33, 45, 61, 77, 91, 100]) for (let seed = 1; seed <= 5; seed++) check('main', mainNode(n), seed * 100 + n);
    for (const p of QUESTS.portals) for (const n of [1, 4, 8, 9, 17, 18, 25]) check(p.id, p.nodes[n - 1], n);
    const q100 = check('main', mainNode(100), 1);
    assert.equal(q100.boss.cardId, 'imperial-dragon');
    assert.equal(q100.boss.stage, 2);
    assert.equal(q100.boss.level, 34);
    assert.equal(q100.player.name, 'Imperial Dragon++');
    assert.equal(q100.player.hp, 10500);
    const q33 = check('main', mainNode(33), 1);
    assert.equal(q33.boss.cardId, 'tunnel-digger');
    assert.equal(q33.player.hp, 1500 + 90 * 33);
  });

  test('boss reward odds: 45 % gold (3 × wave gold), 25 % token, 15 % piece, 10 % potion, 5 % gems (13–82)', () => {
    const d = deps();
    const N = 20000;
    const tally = (line, q, firstWin, event) => {
      const c = { gold: 0, token: 0, piece: 0, potion: 0, gems: 0 };
      const seen = { tokens: new Set(), pieces: new Set(), potions: new Set(), gemsMin: Infinity, gemsMax: -Infinity, gold: new Set() };
      for (let i = 0; i < N; i++) {
        const r = R.rollBossReward(mulberry32(i), d, line, q, firstWin, event);
        c[r.type]++;
        if (r.type === 'token') seen.tokens.add(r.token + ':' + (r.portalId || ''));
        if (r.type === 'piece') seen.pieces.add(r.cardId);
        if (r.type === 'potion') { seen.potions.add(r.potion); assert.equal(r.count, 1); }
        if (r.type === 'gems') { seen.gemsMin = Math.min(seen.gemsMin, r.gems); seen.gemsMax = Math.max(seen.gemsMax, r.gems); }
        if (r.type === 'gold') seen.gold.add(r.gold);
      }
      return { c, seen };
    };
    const q50 = mainNode(50);
    const { c, seen } = tally(QUESTS.main, q50, false, null);
    assert.ok(within(c.gold / N, 0.45, 0.015), 'gold ' + c.gold / N);
    assert.ok(within(c.token / N, 0.25, 0.015), 'token ' + c.token / N);
    assert.ok(within(c.piece / N, 0.15, 0.015), 'piece ' + c.piece / N);
    assert.ok(within(c.potion / N, 0.1, 0.012), 'potion ' + c.potion / N);
    assert.ok(within(c.gems / N, 0.05, 0.01), 'gems ' + c.gems / N);
    assert.deepEqual([...seen.gold], [q50.goldPerFigure * 4 * 3]);
    assert.deepEqual([...seen.tokens], ['summoner:']);
    assert.deepEqual([...seen.potions].sort(), ['mana', 'stamina']);
    assert.equal(seen.gemsMin, 13); assert.equal(seen.gemsMax, 82);
    for (const id of seen.pieces) {
      assert.ok(QUESTS.main.cards.includes(id), 'piece of a main set card');
      assert.equal(db.get(id).rarity, 'heroic');
    }
    assert.deepEqual(R.BOSS_ODDS, { gold: 0.45, token: 0.25, piece: 0.15, potion: 0.1, gems: 0.05 });
    assert.deepEqual(R.BOSS_GEMS_RANGE, [13, 82]);
    // before Q31 no pieces: the 15 % goes to gold; Neophyte tokens
    const early = tally(QUESTS.main, mainNode(12), true, null);
    assert.equal(early.c.piece, 0);
    assert.ok(within(early.c.gold / N, 0.6, 0.015));
    assert.deepEqual([...early.seen.tokens], ['neophyte:']);
    // Q71+: Legendary pieces, Archmage tokens
    const late = tally(QUESTS.main, mainNode(80), false, null);
    assert.deepEqual([...late.seen.tokens], ['archmage:']);
    assert.ok(late.seen.pieces.size > 0);
    for (const id of late.seen.pieces) assert.equal(db.get(id).rarity, 'legendary');
    // Golden Day
    let g = null;
    for (let i = 0; g === null; i++) { const r = R.rollBossReward(mulberry32(i), d, QUESTS.main, q50, false, 'golden-day'); if (r.type === 'gold') g = r.gold; }
    assert.equal(g, Math.round(q50.goldPerFigure * 12 * 1.5));
  });

  test('portal boss rewards: pieces from node 4 (set cards), low/high portal tokens, node 25 always a high token on the first win', () => {
    const d = deps();
    const p = portal(0);
    const N = 6000;
    const tally = (q, firstWin) => {
      const c = { gold: 0, token: 0, piece: 0, potion: 0, gems: 0 };
      const tokens = new Set(), pieces = new Set();
      for (let i = 0; i < N; i++) {
        const r = R.rollBossReward(mulberry32(i), d, p, q, firstWin, null);
        c[r.type]++;
        if (r.type === 'token') tokens.add(r.token + ':' + r.portalId);
        if (r.type === 'piece') pieces.add(r.cardId);
      }
      return { c, tokens, pieces };
    };
    const n3 = tally(p.nodes[2], true);
    assert.equal(n3.c.piece, 0, 'no pieces before node 4');
    assert.ok(within(n3.c.gold / N, 0.6, 0.025));
    assert.deepEqual([...n3.tokens], ['portalLow:the-dark-beyond']);
    const n4 = tally(p.nodes[3], true);
    assert.ok(within(n4.c.piece / N, 0.15, 0.025));
    for (const id of n4.pieces) assert.ok(p.cards.includes(id), 'portal piece from the portal set');
    const n20 = tally(p.nodes[19], false);
    assert.deepEqual([...n20.tokens], ['portalHigh:the-dark-beyond']);
    const n25first = tally(p.nodes[24], true);
    assert.equal(n25first.c.token, N, 'node 25 first win is always the high token');
    assert.deepEqual([...n25first.tokens], ['portalHigh:the-dark-beyond']);
    const n25again = tally(p.nodes[24], false);
    assert.ok(within(n25again.c.token / N, 0.25, 0.025), 'replays roll normally');
  });

  test('boss fight: win unlocks the next quest, counts the quest once, grants xp and the reward; loss resets the minions', () => {
    const base = rich(fresh(), { level: 10, xp: 0 });
    const clear = (s0, d) => {
      let s = fz(Q.startQuest(s0, d, T0, { line: 'main', n: 1 }).state);
      while (!s.quests.active.bossReady) s = fz(Q.tapMinion(s, d, T0, {}).state);
      return s;
    };
    // win
    const dw = deps('attacker');
    const ready = clear(base, dw);
    const pb = Q.prepareBoss(ready, dw, T0);
    assert.equal(pb.lineup.boss.cardId, 'throat-cutter');
    const stored = fz(pb.state);
    assert.equal(Q.prepareBoss(stored, dw, T0).lineup, stored.quests.active.boss, 'line-up is stored once');
    assert.equal(Q.prepareBoss(stored, dw, T0).state, stored);
    const win = Q.fightBoss(fz(pb.state), dw, T0, { event: null });
    assert.equal(win.won, true);
    assert.equal(win.unlocked, 2);
    assert.equal(win.firstWin, true);
    assert.equal(win.state.quests.main.unlocked, 2);
    assert.equal(win.state.quests.main.done, 1);
    assert.deepEqual(win.state.quests.main.firstWins, [1]);
    assert.equal(win.state.player.questsDone, 1);
    assert.equal(win.state.quests.active, null);
    assert.equal(win.playerXp, 0, 'boss fights give no player xp (playthroughs-2.md §1.3)');
    const enemyMana = pb.lineup.cards.filter(Boolean).reduce((m, c) => m + db.get(c.cardId).mana, 0);
    assert.equal(win.cardXp, P.cardFightXp(enemyMana, true, false));
    assert.deepEqual([win.reward.type, win.reward.cardId, win.reward.soul], ['card', 'throat-cutter', true], 'quest 1 gives the soul card');
    assert.equal(win.state.player.xp, pb.state.player.xp + win.playerXp);
    assert.equal(dw.engine.calls.length, 1);
    assert.equal(dw.engine.calls[0].defender.player.maxHp, 250);
    assert.equal(dw.engine.calls[0].attacker.player.maxHp, base.player.hpMax);
    // Infinite Wisdom doubles card xp
    const wis = Q.fightBoss(fz(pb.state), dw, T0, { event: 'infinite-wisdom' });
    assert.equal(wis.cardXp, P.cardFightXp(enemyMana, true, true));
    // replay of a beaten quest: no second first-win, nothing new unlocked
    const replay = fz(Q.startQuest(fz(win.state), dw, T0, { line: 'main', n: 1 }).state);
    let rs = replay;
    while (!rs.quests.active.bossReady) rs = fz(Q.tapMinion(rs, dw, T0, {}).state);
    const again = Q.fightBoss(rs, dw, T0, {});
    assert.equal(again.firstWin, false);
    assert.equal(again.unlocked, null);
    assert.equal(again.state.quests.main.done, 1);
    assert.equal(again.state.player.questsDone, 1);
    assert.equal(again.state.quests.main.unlocked, 2);
    assert.notEqual(again.reward.cardId === 'throat-cutter' && again.reward.soul, true, 'the soul card only on the first win');
    // the quest-2 boss opens the third deck slot; the last portal quest pays 1000 gold
    const q2 = fz({ ...win.state, player: { ...win.state.player, deckSlots: 2 }, quests: { ...win.state.quests, active: null } });
    let s2 = fz(Q.startQuest(q2, dw, T0, { line: 'main', n: 2 }).state);
    while (!s2.quests.active.bossReady) s2 = fz(Q.tapMinion(s2, dw, T0, {}).state);
    const w2 = Q.fightBoss(s2, dw, T0, {});
    assert.equal(w2.deckSlots, 3);
    assert.equal(S.deckSlotCount(w2.state), 3);
    const p25 = fz({ ...rich(fresh()), quests: { ...fresh().quests, portals: { 'dying-dreams': { unlocked: 25, done: 24, firstWins: [] } } } });
    let sp = fz(Q.startQuest(p25, dw, T0, { line: 'dying-dreams', n: 25 }).state);
    while (!sp.quests.active.bossReady) sp = fz(Q.tapMinion(sp, dw, T0, {}).state);
    const wp = Q.fightBoss(sp, dw, T0, {});
    assert.equal(wp.bonusGold, 1000);
    assert.equal(wp.state.player.gold, sp.player.gold + 1000);
    // loss
    const dl = deps('defender');
    const readyL = clear(base, dl);
    const loss = Q.fightBoss(readyL, dl, T0, {});
    assert.equal(loss.won, false);
    assert.equal(loss.reward, null);
    assert.equal(loss.state.quests.main.unlocked, 1);
    assert.equal(loss.state.player.questsDone, 0);
    assert.equal(loss.state.quests.active.bossReady, false);
    assert.equal(loss.state.quests.active.figuresDone, 0);
    assert.equal(loss.state.quests.active.waveIndex, 0);
    assert.equal(loss.state.quests.active.boss, null);
    assert.equal(Q.questProgressPct(loss.state.quests.active), 0);
    assert.equal(loss.playerXp, 0);
    assert.equal(loss.cardXp, P.cardFightXp(loss.lineup.cards.filter(Boolean).reduce((m, c) => m + db.get(c.cardId).mana, 0), false, false));
    assert.equal(Q.guideLine(fz(loss.state), { lastLoss: true }), null);
    // an empty deck cannot fight
    assert.throws(() => Q.fightBoss(fz({ ...readyL, deck: [null, null, null, null, null] }), dl, T0, {}), /empty/);
  });

  test('§9 guide lines come from the tutorial (src/ui/tutorial); a save without a tutorial record gets none', () => {
    assert.equal(Q.guideLine(fresh()), null);
  });

  test('map nodes and quest status', () => {
    const d = deps();
    const s = fz({ ...fresh(), quests: { ...fresh().quests, main: { unlocked: 5, done: 4, firstWins: [1, 2, 3, 4] } } });
    const nodes = Q.mapNodes(s, d, 'main');
    assert.equal(nodes.length, 100);
    assert.deepEqual(nodes.slice(0, 6).map((n) => n.status), ['done', 'done', 'done', 'done', 'current', 'locked']);
    assert.equal(Q.mapNodes(s, d, 'the-dark-beyond').length, 25);
    assert.equal(Q.getQuest(d, 'main', 101), null);
    assert.throws(() => Q.startQuest(s, d, T0, { line: 'main', n: 101 }), /No such quest/);
  });
});
