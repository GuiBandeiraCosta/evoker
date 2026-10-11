// Game-layer goldens for EvokerCoreTests/GoldenGameTests.swift (package B). Called by gen-goldens.mjs:
//   appendGameGoldens({ deps, mod, write, mulberry32, statsAdapter })
// Each file is a deterministic sequence of web game-function calls recorded as steps
//   { fn, args, now, info, state }
// where `state` is the full save after the step (JSON), `info` the returned info minus `state` (null for a
// function that returns a plain state) and `fn: "set"` replaces the state wholesale (no comparison, but the Swift
// side checks that the state decodes and re-encodes to the same JSON). Query steps (`previewTraining`, `canFuse`,
// `standings` …) leave the state untouched and record only their result. Projections applied to `info`:
// fight steps keep `battle.result` and drop `battle.events`; a `quest` node is reduced to `{ n }`.
// Never edit the outputs by hand: node Tools/gen-goldens.mjs regenerates them.

const T0 = Date.UTC(2026, 9, 7, 12, 0, 0); // the web tests' clock, 2026-10-07 12:00 UTC
const MIN = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

/** Projection of an info object (see the header). */
function project(info) {
  if (!info || typeof info !== 'object' || Array.isArray(info)) return info === undefined ? null : info;
  const out = {};
  for (const [k, v] of Object.entries(info)) {
    if (k === 'battle' && v && typeof v === 'object') out.battle = { result: v.result };
    else if (k === 'quest' && v && typeof v === 'object') out.quest = { n: v.n };
    else out[k] = v;
  }
  return out;
}

/** Records steps of game-function calls on one evolving state. */
function recorder(initial) {
  const steps = [];
  let state = initial;
  const push = (fn, args, now, info) => steps.push({ fn, args: clone(args), now: now === undefined ? null : now, info: clone(info), state: clone(state) });
  return {
    /** A state-changing call: `call(state)` returns `{ state, ...info }` or a plain state. */
    step(fn, args, now, call) {
      const res = call(state);
      let info = null;
      if (res && typeof res === 'object' && !Array.isArray(res) && Object.prototype.hasOwnProperty.call(res, 'state')) {
        const { state: next, ...rest } = res;
        state = next;
        info = project(rest);
      } else if (res && typeof res === 'object') {
        state = res;
      }
      push(fn, args, now, info);
      return res;
    },
    /** A pure query: the state stays, only the result is recorded. */
    query(fn, args, now, call) {
      const res = call(state);
      push(fn, args, now, project(res));
      return res;
    },
    /** Replace the state wholesale (crafted states between phases). */
    set(next) {
      state = next;
      push('set', null, null, null);
    },
    get: () => state,
    steps,
  };
}

export async function appendGameGoldens({ deps, mod, write, mulberry32 }) {
  const S = await mod('src/game/state.js');
  const P = await mod('src/game/player.js');
  const C = await mod('src/game/collection.js');
  const T = await mod('src/game/training.js');
  const Fu = await mod('src/game/fusion.js');
  const Q = await mod('src/game/quests.js');
  const O = await mod('src/game/opponents.js');
  const A = await mod('src/game/arena.js');
  const Pc = await mod('src/game/pieces.js');
  const L = await mod('src/game/league.js');
  const Sh = await mod('src/game/shop.js');
  const R = await mod('src/game/rewards.js');
  const store = await mod('src/ui/store.js');
  const db = deps.db;

  /** app.js onOpen (not importable: app.js boots the DOM), copied verbatim. */
  function onOpen(state, d, t) {
    let s = P.applyRegen(state, t);
    const notices = [];
    const daily = Sh.claimDaily(s, t);
    s = daily.state;
    if (daily.claimed) notices.push({ type: 'daily', ...daily.reward });
    const league = s.sim && s.sim.league;
    if (league && !league.settled && league.day !== S.utcDay(t)) {
      const r = L.settleLeague(s, league, d);
      s = r.state;
    }
    const raids = Pc.dailyRaids(s, d, t);
    s = raids.state;
    for (const n of s.notices || []) notices.push(n);
    s = { ...s, notices: [] };
    return { state: S.touch(s, t), notices };
  }
  /** app.js debug.addDays without the onOpen that follows it (recorded as its own step). */
  function debugAddDays(state, n) {
    const s = store.addDays(state, n);
    return { ...s, daily: { ...s.daily, dayShift: (Number(s.daily.dayShift) || 0) + (Number(n) || 0) } };
  }
  const refill = (s) => ({ ...s, player: { ...s.player, stamina: s.player.staminaMax, mana: s.player.manaMax } });
  const pick = (...ids) => ids.find((id) => db.get(id)) || db.all().find((d) => !d.trainer).id;
  const withPlayer = (s, p) => ({ ...s, player: { ...s.player, ...p } });

  /* ------------------------------------------------ (1) new game, open, quests 1-3 */
  {
    const r = recorder(null);
    r.step('newGame', { name: 'Tester', seed: 4242 }, T0, () => S.newGame('Tester', 4242, T0, deps));
    r.step('onOpen', null, T0, (s) => onOpen(s, deps, T0));
    r.step('placeInDeck', { uid: 'c2', slot: 1 }, T0, (s) => C.placeInDeck(s, deps, 'c2', 1));
    let now = T0;
    for (let n = 1; n <= 3; n++) {
      let won = false;
      for (let attempt = 0; attempt < 4 && !won; attempt++) {
        r.step('startQuest', { line: 'main', n }, now, (s) => Q.startQuest(s, deps, now, { line: 'main', n }));
        while (!r.get().quests.active.bossReady) {
          const res = r.step('tapMinion', { event: null }, now, (s) => Q.tapMinion(s, deps, now, {}));
          if (res.needsPotion) r.set(refill(r.get()));
        }
        r.step('prepareBoss', null, now, (s) => Q.prepareBoss(s, deps, now));
        const f = r.step('fightBoss', { event: null }, now, (s) => Q.fightBoss(s, deps, now, {}));
        won = f.won;
        if (!won) {
          // a stronger deck for the retry: every deck card to its stage cap
          const s = r.get();
          r.set({ ...s, cards: s.cards.map((c) => (s.deck.includes(c.uid) ? { ...c, level: deps.stats.capFor(db.get(c.cardId), c.stage), xp: 0 } : c)) });
        }
        now += MIN;
      }
      // the Throat-Cutter soul card fills the slot the quest-2 win opened
      const s = r.get();
      const tc = s.cards.find((c) => c.cardId === 'throat-cutter');
      if (tc && !s.deck.includes(tc.uid) && S.slotUnlocked(s, 3) && S.deckMana({ ...s, deck: s.deck.map((u, i) => (i === 3 ? tc.uid : u)) }, deps) <= s.player.manaMax) {
        r.step('placeInDeck', { uid: tc.uid, slot: 3 }, now, (st) => C.placeInDeck(st, deps, tc.uid, 3));
      }
      r.set(refill(r.get()));
    }
    r.query('mapNodesStatus', { lineId: 'main' }, now, (s) => Q.mapNodes(s, deps, 'main').slice(0, 6).map((n) => ({ n: n.n, status: n.status })));
    r.query('deckSlotCount', null, now, (s) => S.deckSlotCount(s));
    r.query('isUnlocked', { feature: 'fusion' }, now, (s) => S.isUnlocked(s, 'fusion'));
    write('game-newgame-quests.json', r.steps);
  }

  /* ------------------------------------------------ (2) a level-8 save: arena, league, settlement, pieces */
  {
    const r = recorder(null);
    let s = S.newGame('Tester', 777, T0, deps);
    const ids = ['pikeman', 'bone-breaker', 'scout', 'throat-cutter', 'armorer', 'rat-eater', 'phoenix', 'basilisk', 'club-swinger', 'tunnel-digger', 'lurking-goblin', 'flinger'];
    for (const id of ids) s = C.addCard(s, deps, pick(id), { stage: ids.indexOf(id) % 3, level: 2 + ids.indexOf(id), force: true }).state;
    s = withPlayer(s, { level: 8, xp: 0, mana: 300, manaMax: 300, stamina: 200, staminaMax: 200, gems: 500, gold: 5000, deckSlots: 5, regenAt: T0 });
    s = { ...s, quests: { ...s.quests, main: { unlocked: 9, done: 8, firstWins: [1, 2, 3, 4, 5, 6, 7, 8] } } };
    // five cards whose mana fits, strongest first
    const sorted = C.sortCards(s.cards, db, 'default');
    const deck = [];
    let mana = 0;
    for (const c of sorted) {
      const m = db.get(c.cardId).mana;
      if (deck.length < 5 && mana + m <= s.player.manaMax) { deck.push(c.uid); mana += m; }
    }
    while (deck.length < 5) deck.push(null);
    s = { ...s, deck };
    r.set(s);
    const T1 = T0 + 5 * MIN;
    r.step('ensureOffers', null, T1, (st) => A.ensureOffers(st, deps, T1));
    r.query('offerInfo', { offerIndex: 1 }, T1, (st) => A.offerInfo(st, deps, 1));
    r.step('openLeague', { event: null }, T1, (st) => L.openLeague(st, deps, T1, {}));
    r.step('joinLeague', null, T1, (st) => L.joinLeague(st));
    r.query('leagueStake', { source: 'arena', difficulty: 'hard', oppLevel: 9, event: null }, T1, (st) => L.leagueStake(st, { source: 'arena', difficulty: 'hard', oppLevel: 9 }));
    for (let i = 0; i < 3; i++) {
      const now = T1 + (i + 1) * MIN;
      r.step('fightArena', { offerIndex: i, event: null }, now, (st) => A.fightArena(st, deps, now, { offerIndex: i }));
      r.set(refill(r.get()));
    }
    const simIds = r.get().sim.league.simIds;
    for (let i = 0; i < 2; i++) {
      const now = T1 + 10 * MIN + i * MIN;
      r.step('fightLeague', { simId: simIds[i], event: i === 1 ? 'double-league-points' : null }, now, (st) => L.fightLeague(st, deps, now, { simId: simIds[i], event: i === 1 ? 'double-league-points' : null }));
      r.set(refill(r.get()));
    }
    r.query('canFightLeague', { simId: simIds[0] }, T1 + 12 * MIN, (st) => L.canFightLeague(st, simIds[0], T1 + 12 * MIN));
    r.query('standings', null, T1 + 12 * MIN, (st) => L.standings(st, deps, T1 + 12 * MIN));
    r.step('addDays', { days: 1 }, null, (st) => debugAddDays(st, 1));
    const T2 = T1 + 20 * MIN;
    r.step('onOpen', null, T2, (st) => onOpen(st, deps, T2));
    r.step('collectLeagueResult', null, T2, (st) => L.collectLeagueResult(st, deps));
    r.step('openLeague', { event: null }, T2, (st) => L.openLeague(st, deps, T2, {}));
    r.step('buyFirstPiece', { event: null }, T2, (st) => Pc.buyFirstPiece(st, deps, T2, {}));
    r.query('huntHolderInfo', { index: 0 }, T2, (st) => Pc.huntHolder(st, deps, T2, 0).holder);
    r.step('fightHolder', { index: 0, event: null }, T2 + MIN, (st) => Pc.fightHolder(st, deps, T2 + MIN, { index: 0 }));
    r.set(refill(r.get()));
    const rareId = db.byRarity('rare').filter((d) => !d.trainer && !r.get().pieces.some((h) => h.cardId === d.id))[1].id;
    r.step('addPiece', { cardId: rareId }, T2 + 2 * MIN, (st) => Pc.addPiece(st, deps, T2 + 2 * MIN, rareId));
    const idx = r.get().pieces.findIndex((h) => h.cardId === rareId);
    r.step('skipHolder', { index: idx }, T2 + 2 * MIN, (st) => Pc.skipHolder(st, deps, T2 + 2 * MIN, idx));
    r.query('huntBuyPrice', { index: idx, event: 'card-piece-day' }, T2 + 2 * MIN, (st) => Pc.huntBuyPrice(st, deps, idx, 'card-piece-day'));
    r.step('buyMissingPieces', { index: idx, event: 'card-piece-day' }, T2 + 3 * MIN, (st) => Pc.buyMissingPieces(st, deps, T2 + 3 * MIN, { index: idx, event: 'card-piece-day' }));
    // raids: every hunt's raid day moved to yesterday, two pieces owned
    {
      const st = r.get();
      r.set({ ...st, pieces: st.pieces.map((h) => ({ ...h, owned: Math.max(h.owned, 2), raidDay: S.utcDay(T2 - DAY) })) });
    }
    r.step('dailyRaids', null, T2 + 4 * MIN, (st) => Pc.dailyRaids(st, deps, T2 + 4 * MIN));
    r.step('ensurePool', null, T2 + DAY, (st) => O.ensurePool(st, deps, T2 + DAY));
    r.step('rollOffers', null, T2 + DAY, (st) => A.rollOffers(st, deps, T2 + DAY));
    write('game-pvp.json', r.steps);
  }

  /* ------------------------------------------------ (3) shop: boosters, daily rewards, potion deal, sets */
  {
    const r = recorder(null);
    let s = S.newGame('Tester', 99, T0, deps);
    s = withPlayer(s, { gems: 20000, tokens: { ...s.player.tokens, neophyte: 3, portalHigh: { 'the-dark-beyond': 2 } } });
    r.set(s);
    r.query('pickPayment', { booster: 'neophyte', event: null }, T0, (st) => Sh.pickPayment(st, 'neophyte', undefined, null));
    r.step('openBooster', { booster: 'neophyte', open: true }, T0, (st) => Sh.openBooster(st, deps, T0, { booster: 'neophyte', open: true }));
    for (const pos of [4, 0, 8, 1, 2, 3, 5, 6, 7]) {
      const event = pos === 8 ? 'get-the-best-cards' : null;
      r.step('drawBoosterCard', { booster: 'neophyte', position: pos, event }, T0, (st) => Sh.drawBoosterCard(st, deps, T0, { booster: 'neophyte', position: pos, event }));
    }
    r.step('discardBooster', { booster: 'neophyte' }, T0, (st) => Sh.discardBooster(st, deps, T0, { booster: 'neophyte' }));
    const portal = deps.quests.portals.find((p) => p.id === 'the-dark-beyond') || deps.quests.portals[0];
    r.step('openBooster', { booster: 'portalHigh', portalId: portal.id, open: false }, T0 + MIN, (st) => Sh.openBooster(st, deps, T0 + MIN, { booster: 'portalHigh', portalId: portal.id }));
    r.step('openBooster', { booster: 'portalHigh', portalId: portal.id, open: true }, T0 + MIN, (st) => Sh.openBooster(st, deps, T0 + MIN, { booster: 'portalHigh', portalId: portal.id, open: true }));
    for (let pos = 0; pos < 9; pos++) {
      r.step('drawBoosterCard', { booster: 'portalHigh', portalId: portal.id, position: pos, event: null }, T0 + MIN, (st) => Sh.drawBoosterCard(st, deps, T0 + MIN, { booster: 'portalHigh', portalId: portal.id, position: pos }));
    }
    r.step('discardBooster', { booster: 'portalHigh', portalId: portal.id }, T0 + MIN, (st) => Sh.discardBooster(st, deps, T0 + MIN, { booster: 'portalHigh', portalId: portal.id }));
    // daily rewards over four days through the debug addDays (the third jump skips a day: the streak resets)
    for (const days of [1, 1, 2, 1]) {
      r.step('addDays', { days }, null, (st) => debugAddDays(st, days));
      r.step('claimDaily', null, T0, (st) => Sh.claimDaily(st, T0));
    }
    r.query('claimDailyAgain', null, T0, (st) => Sh.claimDaily(st, T0).claimed);
    // the potion deal on its event day (the save's clock: eventClock adds the shifted days)
    let dealDay = 0;
    while (Sh.dailyEvent(P.eventClock(r.get(), T0 + dealDay * DAY)).id !== 'great-potion-deal') dealDay++;
    const dealNow = T0 + dealDay * DAY;
    r.query('dailyEvent', null, dealNow, (st) => Sh.dailyEvent(P.eventClock(st, dealNow), st));
    r.query('potionDealAvailable', { event: 'great-potion-deal' }, dealNow, (st) => Sh.potionDealAvailable(st, dealNow, 'great-potion-deal'));
    r.step('buyPotionDeal', { event: 'great-potion-deal' }, dealNow, (st) => Sh.buyPotionDeal(st, dealNow, 'great-potion-deal'));
    r.query('potionDealAvailable', { event: 'great-potion-deal' }, dealNow, (st) => Sh.potionDealAvailable(st, dealNow, 'great-potion-deal'));
    // a complete portal set
    {
      let st = r.get();
      for (const id of portal.cards) if (!st.cards.some((c) => c.cardId === id)) st = C.addCard(st, deps, id, { stage: 1, level: 1, force: true }).state;
      r.set(st);
    }
    r.query('albumNewCards', null, dealNow, (st) => Sh.albumNewCards(st, deps));
    r.query('setCollections', null, dealNow, (st) => Sh.setCollections(st, deps));
    r.step('claimCollection', { setId: portal.id }, dealNow, (st) => Sh.claimCollection(st, deps, portal.id));
    r.step('markAlbumSeen', { cardIds: portal.cards.slice(0, 3) }, dealNow, (st) => Sh.markAlbumSeen(st, portal.cards.slice(0, 3)));
    r.query('albumNewCards', null, dealNow, (st) => Sh.albumNewCards(st, deps));
    r.query('setProgressFor', { cardId: portal.cards[0] }, dealNow, (st) => Sh.setProgressFor(st, deps, portal.cards[0]));
    write('game-shop.json', r.steps);
  }

  /* ------------------------------------------------ (4) cards: collection, deck, training, fusion, xp, player */
  {
    const r = recorder(null);
    let s = S.newGame('Tester', 55, T0, deps);
    s = withPlayer(s, { gold: 100000, gems: 1000, statPoints: 12, mana: 100, manaMax: 100, staminaPotions: 1, manaPotions: 1, deckSlots: 5 });
    r.set(s);
    const rare = db.byRarity('rare').filter((d) => !d.trainer)[0].id;
    const uncommon = db.byRarity('uncommon').filter((d) => !d.trainer)[0].id;
    const trainer = db.get('lich-king') ? 'lich-king' : db.all().find((d) => d.trainer).id;
    const add = (cardId, opts) => r.step('addCard', { cardId, ...opts }, T0, (st) => C.addCard(st, deps, cardId, opts));
    const a = add(rare, { stage: 0, level: 5, force: false }).uid;
    const b = add(rare, { stage: 0, level: 6, force: false }).uid;
    add(uncommon, { stage: 1, level: 3, force: false });
    const f1 = add(uncommon, { stage: 0, level: 1, force: true }).uid;
    const f2 = add(uncommon, { stage: 0, level: 1, force: true }).uid;
    const lich = add(trainer, { stage: 0, level: 1, force: true }).uid;
    add(pick('pikeman'), { stage: 0, level: 0, force: false });
    r.query('sortCards', { order: 'default' }, T0, (st) => C.sortCards(st.cards, db, 'default'));
    r.query('sortCards', { order: 'rarity' }, T0, (st) => C.sortCards(st.cards, db, 'rarity'));
    r.query('sortCards', { order: 'attack' }, T0, (st) => C.sortCards(st.cards, db, 'attack', deps.stats));
    r.query('bestCard', null, T0, (st) => C.bestCard(st, deps));
    r.step('placeInDeck', { uid: a, slot: 1 }, T0, (st) => C.placeInDeck(st, deps, a, 1));
    r.step('placeInDeck', { uid: a, slot: 3 }, T0, (st) => C.placeInDeck(st, deps, a, 3));
    r.query('validateDeck', null, T0, (st) => C.validateDeck(st, deps));
    r.step('setDeck', { slots: [null, 'c1', 'c2', a, null] }, T0, (st) => C.setDeck(st, deps, [null, 'c1', 'c2', a, null]));
    r.step('removeFromDeck', { slot: 2 }, T0, (st) => C.removeFromDeck(st, 2));
    r.step('sellCard', { uid: 'c2' }, T0, (st) => C.sellCard(st, deps, 'c2'));
    r.query('previewTraining', { trainUid: a, sacrificeUids: [lich, b] }, T0, (st) => T.previewTraining(st, deps, a, [lich, b]));
    r.query('previewTraining', { trainUid: a, sacrificeUids: ['c1'] }, T0, (st) => T.previewTraining(st, deps, a, ['c1']));
    r.step('train', { trainUid: a, sacrificeUids: [lich, b] }, T0, (st) => T.train(st, deps, a, [lich, b]));
    r.query('canFuse', { uidA: f1, uidB: f2 }, T0, (st) => Fu.canFuse(st, deps, f1, f2));
    r.query('canFuse', { uidA: f1, uidB: a }, T0, (st) => Fu.canFuse(st, deps, f1, a));
    r.query('fusionCandidates', null, T0, (st) => Fu.fusionCandidates(st, deps));
    r.step('fuse', { uidA: f1, uidB: f2 }, T0, (st) => Fu.fuse(st, deps, f1, f2));
    r.step('addDeckXp', { xp: 150 }, T0, (st) => C.addDeckXp(st, deps, 150));
    r.step('addCardXp', { uid: 'c1', xp: 5000 }, T0, (st) => C.addCardXp(st, deps, 'c1', 5000));
    r.query('previewStatPoints', { stamina: 4, mana: 3, hp: 5 }, T0, (st) => P.previewStatPoints(st, { stamina: 4, mana: 3, hp: 5 }));
    r.step('spendStatPoints', { stamina: 4, mana: 3, hp: 5 }, T0, (st) => P.spendStatPoints(st, { stamina: 4, mana: 3, hp: 5 }));
    r.step('editProfile', { name: '  Morden the Great and Terrible  ', avatar: 11 }, T0, (st) => P.editProfile(st, { name: '  Morden the Great and Terrible  ', avatar: 11 }));
    r.step('editProfile', { name: '   ', avatar: 12 }, T0, (st) => P.editProfile(st, { name: '   ', avatar: 12 }));
    r.set(withPlayer(r.get(), { stamina: 10, mana: 45, regenAt: T0 }));
    r.step('applyRegen', null, T0 + 5 * MIN + 30 * 1000, (st) => P.applyRegen(st, T0 + 5 * MIN + 30 * 1000));
    r.step('addPlayerXp', { amount: 400 }, T0, (st) => P.addPlayerXp(st, deps, 400));
    r.query('levelUpRewards', { level: 7 }, T0, () => P.levelUpRewards(7));
    r.set(withPlayer(r.get(), { stamina: 2, mana: 1 }));
    r.query('needsPotion', { kind: 'stamina', amount: 3, event: 'drinking-contest' }, T0, (st) => P.needsPotion(st, 'stamina', 3, 'drinking-contest'));
    r.step('drinkPotion', { kind: 'stamina' }, T0, (st) => P.drinkPotion(st, 'stamina'));
    r.step('buyAndDrinkPotion', { kind: 'mana', event: 'drinking-contest' }, T0, (st) => P.buyAndDrinkPotion(st, 'mana', 'drinking-contest'));
    r.step('addTokens', { kind: 'portalLow', count: 2, portalId: 'dragon-hunt' }, T0, (st) => P.addTokens(st, 'portalLow', 2, 'dragon-hunt'));
    r.set(withPlayer(r.get(), { deckSlots: 2 }));
    r.step('unlockSlotsForQuest', { lineId: 'main', n: 2 }, T0, (st) => S.unlockSlotsForQuest(st, 'main', 2));
    r.step('applyReward', { reward: { type: 'card', cardId: rare, stage: 0, level: 2 } }, T0, (st) => R.applyReward(st, deps, T0, { type: 'card', cardId: rare, stage: 0, level: 2 }));
    r.step('applyReward', { reward: { type: 'piece', cardId: rare } }, T0, (st) => R.applyReward(st, deps, T0, { type: 'piece', cardId: rare }));
    r.step('applyReward', { reward: { type: 'token', token: 'summoner', count: 2 } }, T0, (st) => R.applyReward(st, deps, T0, { type: 'token', token: 'summoner', count: 2 }));
    // the inventory limit: card rewards are sold at 100 cards
    {
      let st = r.get();
      while (st.cards.length < 100) st = C.addCard(st, deps, 'envoy', { force: true }).state;
      r.set(st);
    }
    r.step('addCard', { cardId: rare, stage: 1, level: 7, force: false }, T0, (st) => C.addCard(st, deps, rare, { stage: 1, level: 7 }));
    write('game-cards.json', r.steps);
  }

  /* ------------------------------------------------ (5) migration of old saves */
  {
    const rng = mulberry32(5);
    const oldSims = [];
    for (let i = 1; i <= 8; i++) oldSims.push(O.makeSim(rng, deps, 'sim-' + i, 7, '2026-09-06', 'Sim ' + i));
    const start = S.utcDayStart(T0 - 31 * DAY);
    const rates = Object.fromEntries(oldSims.map((p, i) => [p.id, 4 + i]));
    const preRound3 = {
      version: 1, createdAt: T0 - 60 * DAY, lastSeen: T0 - 31 * DAY, seed: 123, rngStep: 40, uidCounter: 6,
      player: {
        name: 'Old', avatar: 2, level: 7, xp: 10, statPoints: 3, stamina: 20, staminaMax: 56, mana: 30, manaMax: 56, hpMax: 1500,
        staminaPotions: 1, manaPotions: 0, gold: 1234, gems: 77, tokens: { neophyte: 1, summoner: 0, archmage: 0, portalLow: { 'dragon-hunt': 2 }, portalHigh: {} },
        regenAt: T0 - 31 * DAY, questsDone: 9, battlesWon: 4, tournamentPoints: 30,
      },
      cards: [
        { uid: 'c1', cardId: 'envoy', stage: 0, level: 3, xp: 10, evolveQuality: 1 },
        { uid: 'c2', cardId: 'master-brewer', stage: 1, level: 2, xp: 0, evolveQuality: 0.9 },
        { uid: 'c5', cardId: pick('scout'), stage: 0, level: 1 },
        { uid: 'c6', cardId: pick('pikeman') },
      ],
      deck: [null, 'c1', 'c2', 'c5', null],
      pieces: [{ cardId: pick('armorer'), owned: 1, total: 4, holderId: 'sim-3', raidDay: '2026-09-06' }],
      quests: { main: { unlocked: 10, done: 9, firstWins: [1, 2, 3, 4, 5, 6, 7, 8, 9] }, portals: { 'the-dark-beyond': { unlocked: 2, done: 1, firstWins: [1] } }, active: null },
      sim: {
        players: oldSims, day: '2026-09-06', arena: { offers: [], rerollAt: 0 },
        league: { day: S.utcDay(start), startedAt: start, endsAt: start + DAY, tier: 'platinum', power: 1.4, simIds: oldSims.map((p) => p.id), rates, fights: { 'sim-1': 2 }, points: 600, doublePoints: false, settled: false },
        leagueScore: 7000, leagueHistory: [],
      },
      daily: { streak: 3, lastClaim: '2026-09-06' },
      collections: { claimed: [] },
      replays: [],
      settings: { sound: false, speed: 2, raids: true, reducedMotion: false },
      tutorial: { step: 0, seen: [] },
      notices: [],
    };
    // a current save that lost its settings, boosters, album list and potion-deal day (older builds)
    let cur = S.newGame('Recent', 9, T0 - 3 * DAY, deps);
    cur = C.addCard(cur, deps, pick('scout'), { level: 4, force: true }).state;
    cur = Q.startQuest(cur, deps, T0 - 3 * DAY, { line: 'main', n: 1 }).state;
    const missingSettings = JSON.parse(JSON.stringify(cur));
    delete missingSettings.settings;
    delete missingSettings.boosters;
    delete missingSettings.collections.seen;
    delete missingSettings.daily.potionDealDay;
    missingSettings.quests.active.startedAt = undefined;
    // no deckSlots, level 3, cards in slots 1 and 4, an unknown card and an unknown portal to prune
    const noSlots = {
      createdAt: T0 - 10 * DAY, lastSeen: T0 - DAY, seed: 31,
      player: { name: 'Slots', level: 3, gold: 50, tokens: { neophyte: 0, summoner: 0, archmage: 0, portalLow: {}, portalHigh: {} } },
      cards: [{ uid: 'c1', cardId: 'envoy' }, { uid: 'c2', cardId: pick('scout') }, { uid: 'c7', cardId: 'dungeon-casino-dealer' }, { uid: 'c3', cardId: pick('pikeman'), level: 2 }],
      deck: [null, 'c1', null, null, 'c2'],
      quests: { main: { unlocked: 2, done: 1, firstWins: [1] }, portals: { 'dungeon-casino': { unlocked: 3, done: 2, firstWins: [1, 2] }, 'dragon-hunt': { unlocked: 1, done: 0, firstWins: [] } }, active: { line: 'dungeon-casino', n: 3, waves: [['envoy']], waveIndex: 0, waveDone: 0, figuresDone: 0, figuresTotal: 1, bossReady: false, boss: null }, manualPortal: 'dungeon-casino' },
      collections: { claimed: ['dungeon-casino', 'the-dark-beyond'], seen: ['envoy', 'dungeon-casino-dealer'] },
      settings: { sound: true, musicVolume: 0.5, fxVolume: 0.5, speed: 1, raids: false, reducedMotion: true },
    };
    const cases = [];
    for (const [name, raw] of [['pre-round-3', preRound3], ['missing-settings', missingSettings], ['no-deck-slots', noSlots]]) {
      const text = JSON.stringify(raw);
      const migrated = store.parseSave(text, T0);
      const pruned = S.pruneRemoved(migrated, deps);
      cases.push({ name, now: T0, raw: JSON.parse(text), migrated, pruned, legacyDeckSlots: S.legacyDeckSlots(JSON.parse(text)) });
    }
    write('game-migrate.json', cases);
  }
}
