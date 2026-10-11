'use strict';
/**
 * Game-layer parity fixture for EvokerCore (Tests/EvokerCoreTests/Parity/game-parity.json): the WEB game functions
 * the game goldens do not reach (or reach only once), on the real data with fixed seeds. The Swift ParityTests
 * replay every section and compare canonical JSON.
 *
 *   node Tools/gen-parity-game.mjs            (from Evoker iOS/)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '../../Evoker Web');
const W = `file:///${web.replace(/\\/g, '/')}/`;
const out = path.resolve(here, '../EvokerCore/Tests/EvokerCoreTests/Parity/game-parity.json');

const { mulberry32 } = await import(W + 'src/core/rng.js');
const { createCardsDb } = await import(W + 'src/core/cards-db.js');
const stats = await import(W + 'src/core/stats.js');
const { simulateBattle } = await import(W + 'src/engine/battle.js');
const { buildSide } = await import(W + 'src/engine/battle-state.js');
const S = await import(W + 'src/game/state.js');
const P = await import(W + 'src/game/player.js');
const C = await import(W + 'src/game/collection.js');
const Q = await import(W + 'src/game/quests.js');
const R = await import(W + 'src/game/rewards.js');
const O = await import(W + 'src/game/opponents.js');
const L = await import(W + 'src/game/league.js');
const Sh = await import(W + 'src/game/shop.js');

const db = createCardsDb(JSON.parse(readFileSync(path.join(web, 'data/cards.json'), 'utf8')));
const quests = JSON.parse(readFileSync(path.join(web, 'data/quests.json'), 'utf8'));
const names = JSON.parse(readFileSync(path.join(web, 'data/names.json'), 'utf8'));
const deps = { db, stats, engine: { simulateBattle, buildSide }, rng: mulberry32, quests, names };
const T0 = Date.UTC(2026, 9, 7, 12, 0, 0);
const g = {};

// stats with an evolve bonus below 1 (older fusions), percent / flat / base-0 stats included
g.statsQ = [];
for (const id of ['envoy', 'master-brewer', 'djinn', 'scrapmaster', 'blood-spitter', 'cursed-stag', 'bouncer', 'medusa', 'bone-dragon']) {
  const def = db.get(id);
  if (!def) continue;
  for (const stage of [0, 2, 4]) {
    const cap = stats.capFor(def, stage);
    for (const level of [1, 5, cap]) {
      for (const q of [0.75, 0.8, 1]) {
        g.statsQ.push({ id, stage, level, q, attack: stats.statAt(def, 'attack', stage, level, q), hp: stats.statAt(def, 'hp', stage, level, q), ability: stats.statAt(def, 'ability', stage, level, q) });
      }
    }
  }
}

// sortCards: every order over a mixed collection
const col = [];
let n = 0;
const all = db.all().filter((d) => !d.trainer);
const r1 = mulberry32(99);
for (let i = 0; i < 40; i++) {
  const d = all[r1.int(all.length)];
  col.push({ uid: 'c' + (++n), cardId: d.id, stage: r1.int(5), level: 1 + r1.int(12), xp: 0, evolveQuality: 1 });
}
// duplicates with equal level / mana / name to exercise stability and the byStage tie-breaker
col.push({ uid: 'c' + (++n), cardId: col[0].cardId, stage: 3, level: col[0].level, xp: 0, evolveQuality: 1 });
col.push({ uid: 'c' + (++n), cardId: col[0].cardId, stage: 1, level: col[0].level, xp: 0, evolveQuality: 1 });
g.sortCards = { cards: col, orders: {} };
for (const order of ['default', 'level', 'mana', 'name', 'rarity', 'attack']) g.sortCards.orders[order] = C.sortCards(col, db, order, stats).map((c) => c.uid);

// shopOffers: rotation, an explicit portal, no portal; tokens held, an open booster, a few days in
let st = S.newGame('Tester', 4242, T0, deps);
st = P.addTokens(st, 'neophyte', 2);
const now = T0 + 3 * S.DAY_MS + 5 * 3600 * 1000;
const sch = Q.portalSchedule(deps, st.createdAt, now);
st = P.addTokens(st, 'portalLow', 1, sch.portalId);
st = Sh.openBooster(st, deps, T0, { booster: 'summoner', open: true }).state;
st = { ...st, player: { ...st.player, gems: 5000 } };
st = Sh.drawBoosterCard(st, deps, T0, { booster: 'summoner', position: 4 }).state;
const proj = (o) => ({
  event: o.event ? o.event.id : null,
  potionDeal: o.potionDeal,
  boosters: o.boosters.map((b) => ({ id: b.id, name: b.name, setName: b.setName, portalId: b.portalId ?? null, price: b.price, discounted: b.discounted, tokens: b.tokens, left: b.left, pre: b.pre, endsInMs: b.endsInMs, startsInMs: b.startsInMs })),
});
g.shopOffers = {
  state: st, now,
  rotation: proj(Sh.shopOffers(st, deps, now)),
  explicit: proj(Sh.shopOffers(st, deps, now, 'dying-dreams')),
  none: proj(Sh.shopOffers(st, deps, now, null)),
  main: proj(Sh.shopOffers(st, deps, now, 'main')),
};

// bossLineup: scripted tutorial nodes, band nodes, portal nodes, with a fixed rng each
g.bossLineups = [];
for (const [line, ns] of [['main', [1, 2, 3, 5, 6, 8, 9, 10, 11, 35, 61, 95, 100]], [quests.portals[0].id, [1, 4, 9, 18, 25]], [quests.portals[3].id, [2, 17]]]) {
  for (const nq of ns) {
    for (const seed of [123, 777]) {
      const quest = Q.getQuest(deps, line, nq);
      g.bossLineups.push({ line, n: nq, seed, lineup: Q.bossLineup(quest, mulberry32(seed), db, stats, line) });
    }
  }
}

// rankRows: ties, zero points, the human inside a tie, name order (punctuation included)
const rows = [
  { id: 'a', name: 'Zed', points: 300, isPlayer: false }, { id: 'b', name: 'amy', points: 300, isPlayer: false }, { id: 'player', name: 'Me', points: 300, isPlayer: true },
  { id: 'c', name: 'Bob', points: 0, isPlayer: false }, { id: 'd', name: 'Al', points: 450, isPlayer: false }, { id: 'e', name: 'Amy', points: 300, isPlayer: false },
  { id: 'f', name: 'Cy', points: 0, isPlayer: false }, { id: 'g', name: 'Dee-Dee', points: 150, isPlayer: false }, { id: 'h', name: 'Dee\'Dee', points: 150, isPlayer: false },
  { id: 'i', name: 'Dee Dee', points: 150, isPlayer: false }, { id: 'j', name: 'dee-dee', points: 150, isPlayer: false },
];
g.rankRows = { rows, ranked: L.rankRows(rows).map((r) => ({ id: r.id, rank: r.rank, rankText: r.rankText })) };

// rollTapGold: bursts, the end gold, Golden Day
g.tapGold = [];
for (const [line, nq] of [['main', 1], ['main', 2], ['main', 12], [quests.portals[0].id, 3]]) {
  const quest = Q.getQuest(deps, line, nq);
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    for (const last of [false, true]) {
      for (const event of [null, 'golden-day']) g.tapGold.push({ line, n: nq, seed, last, event, out: R.rollTapGold(mulberry32(seed), quest, { last, event }) });
    }
  }
}

// generateWaves / pickBandCard sequences
g.waves = [];
for (const [line, nq] of [['main', 1], ['main', 7], ['main', 40], ['main', 99], [quests.portals[1].id, 20]]) {
  for (const seed of [11, 12]) g.waves.push({ line, n: nq, seed, waves: Q.generateWaves(mulberry32(seed), deps, Q.getQuest(deps, line, nq)) });
}
g.bandPicks = [];
for (const band of [{ rarities: ['common', 'standard'] }, { rarities: ['ultimate'] }, { rarities: ['legendary', 'ultimate', 'heroic'] }, { rarities: [] }]) {
  const r = mulberry32(5);
  g.bandPicks.push({ band, ids: Array.from({ length: 6 }, () => (R.pickBandCard(r, db, band) || {}).id || null) });
}

// simProfile / buildSimDeck / makeSim
g.simProfiles = [];
for (const tier of L.TIERS) {
  const r = mulberry32(31);
  g.simProfiles.push({ tier: tier.id, profiles: Array.from({ length: 12 }, () => L.simProfile(r, tier)) });
}
g.simDecks = [];
for (const level of [1, 2, 3, 4, 7, 14, 20, 39, 60, 130, 150, 200]) {
  for (const power of [1, 0.7, 1.3]) g.simDecks.push({ level, power, deck: O.buildSimDeck(mulberry32(level * 10 + Math.round(power * 10)), deps, level, power) });
}
g.makeSims = [];
for (const level of [0, 1, 5, 50, 250]) g.makeSims.push({ level, sim: O.makeSim(mulberry32(level + 3), deps, 'sim-x', level, '2026-10-07', 'Name') });

// small formulas by quest node
g.tapInfo = [];
for (const [line, nq] of [['main', 1], ['main', 2], ['main', 6], ['main', 31], ['main', 71], [quests.portals[0].id, 5]]) g.tapInfo.push({ line, n: nq, info: Q.questTapInfo(Q.getQuest(deps, line, nq)) });
g.bandPosition = [['main', 1], ['main', 10], ['main', 11], ['main', 30], ['main', 55], ['main', 100], ['main', 150], ['x', 1], ['x', 8], ['x', 9], ['x', 25], ['x', 30]].map(([l, nq]) => [l, nq, Q.bandPosition(l, nq)]);

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(g));
console.log(`wrote game parity (${(readFileSync(out).length / 1024).toFixed(0)} KB) to ${out}`);
