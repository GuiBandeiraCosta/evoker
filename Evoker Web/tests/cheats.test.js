'use strict';
/**
 * src/ui/cheats.js: the console cheats (user's request 2026-10-12, `cheats.help()` in the F12 console) on a real
 * round-3 save with the real data, through a minimal store; the big ones delegate to the app's debug API.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCheats, findCard, CHEAT_LIST, PLENTY, MANY_POTIONS, GOD_MAX } from '../src/ui/cheats.js';
import { tutorialOf, startTutorial } from '../src/ui/tutorial/progress.js';
import { deps as makeDeps, tutorialStart, T0, QUESTS, db } from './fixtures/real.js';

/** A store like app.js's: one save, pure updates with (state, deps, now). */
function makeStore(d, state0) {
  let state = state0;
  return {
    get: () => state,
    set: (s) => { state = s; },
    update(fn) { state = fn(state, d, T0); return state; },
  };
}

function setup() {
  const d = makeDeps();
  const store = makeStore(d, tutorialStart(d));
  const calls = [];
  const debug = { unlockAll: () => calls.push('unlockAll'), addDays: (n) => calls.push(`addDays:${n}`), reset: () => calls.push('reset') };
  const router = { rerender: () => calls.push('rerender') };
  const logs = [];
  const toasts = [];
  const cheats = createCheats({ store, deps: d, debug, router, toast: (m) => toasts.push(m), log: (...a) => logs.push(a.join(' ')) });
  return { d, store, cheats, calls, logs, toasts };
}

test('help lists every cheat and every listed cheat exists', () => {
  const { cheats, logs } = setup();
  const names = cheats.help();
  assert.deepEqual(names, CHEAT_LIST.map(([n]) => n));
  for (const n of names) assert.equal(typeof cheats[n], 'function', n);
  assert.ok(logs.some((l) => l.includes('cheats.gold(')), 'the signatures are printed');
  for (const n of ['unlockAllLevels', 'allCards', 'card', 'gems', 'gold']) assert.ok(names.includes(n), n);
});

test('gold / gems / potions / refill / level change the player and re-render the screen', () => {
  const { store, cheats, calls, toasts } = setup();
  const p0 = store.get().player;
  assert.equal(cheats.gold(), p0.gold + PLENTY);
  assert.equal(cheats.gems(), p0.gems + PLENTY);
  assert.equal(cheats.gold(10), p0.gold + PLENTY + 10);
  assert.deepEqual(cheats.potions(), { stamina: p0.staminaPotions + MANY_POTIONS, mana: p0.manaPotions + MANY_POTIONS });
  store.update((s) => ({ ...s, player: { ...s.player, stamina: 1, mana: 2 } }));
  assert.deepEqual(cheats.refill(), { stamina: store.get().player.staminaMax, mana: store.get().player.manaMax });
  const points0 = store.get().player.statPoints | 0;
  assert.equal(cheats.level(50), 50);
  assert.equal(store.get().player.level, 50);
  assert.equal(store.get().player.statPoints, points0 + 49 * 12, 'the 49 levels gained bring their stat points');
  assert.equal(cheats.level(10), 10);
  assert.equal(store.get().player.statPoints, points0 + 49 * 12, 'going down takes none away');
  assert.equal(cheats.level(9999), 200, 'clamped to the max level');
  assert.equal(cheats.level('abc'), 1, 'nonsense falls back to 1');
  assert.ok(calls.filter((c) => c === 'rerender').length >= 7, 'every cheat re-renders');
  assert.ok(toasts.length >= 7, 'every cheat toasts');
});

test('card: by id, by name in any case, by unique prefix; stage and level clamped to the cap; unknown names add nothing', () => {
  const { store, cheats, logs } = setup();
  const before = store.get().cards.length;
  const uid = cheats.card('worm-shaman');
  assert.ok(uid, 'returns the uid');
  assert.equal(store.get().cards.length, before + 1);
  const inst = store.get().cards.find((c) => c.uid === uid);
  assert.equal(inst.cardId, 'worm-shaman');
  assert.equal(inst.stage, 0);
  assert.equal(inst.level, 1);
  const uid2 = cheats.card('Worm Shaman', 4, 999);
  const inst2 = store.get().cards.find((c) => c.uid === uid2);
  assert.equal(inst2.stage, 4);
  assert.equal(inst2.level, db.get('worm-shaman').caps[4], 'level clamped to the ++++ cap');
  const uid3 = cheats.card('worm sha');
  assert.equal(store.get().cards.find((c) => c.uid === uid3).cardId, 'worm-shaman', 'a unique name prefix');
  assert.equal(cheats.card('no such card at all'), null);
  assert.ok(logs.some((l) => l.includes('No card called')));
  assert.equal(findCard(db, 'ENVOY').id, 'envoy');
  assert.equal(findCard(db, ''), null);
  assert.ok(cheats.names().includes('Worm Shaman'));
});

test('allCards adds one copy of every card at the stage cap; maxCards raises every owned card to its cap', () => {
  const { store, cheats, d } = setup();
  const n = cheats.allCards(4);
  assert.equal(n, d.db.all().length);
  const added = store.get().cards.filter((c) => c.stage === 4);
  assert.equal(added.length, n);
  for (const c of added) assert.equal(c.level, d.db.get(c.cardId).caps[4], c.cardId);
  store.update((s) => ({ ...s, cards: s.cards.map((c) => ({ ...c, level: 1 })) }));
  cheats.maxCards();
  for (const c of store.get().cards) assert.equal(c.level, d.db.get(c.cardId).caps[c.stage], c.cardId);
});

test('unlockAllLevels opens the whole main line and every portal; skipTutorial ends the tutorial', () => {
  const { store, cheats } = setup();
  store.set(startTutorial(store.get()));   // the round-3 record (newTutorialGame does this at the title screen)
  assert.equal(tutorialOf(store.get()).done, false);
  assert.equal(cheats.unlockAllLevels(), QUESTS.main.nodes.length);
  for (const line of QUESTS.portals) assert.equal(store.get().quests.portals[line.id].unlocked, line.nodes.length, line.id);
  cheats.skipTutorial();
  assert.equal(tutorialOf(store.get()).done, true);
});

test('days, god and reset go through the app debug API; nothing runs without a save', () => {
  const { store, cheats, calls } = setup();
  assert.equal(cheats.days(7), 7);
  assert.ok(calls.includes('addDays:7'));
  cheats.god();
  assert.ok(calls.includes('unlockAll'));
  assert.equal(store.get().player.level, 200);
  assert.ok(store.get().player.gold >= PLENTY && store.get().player.gems >= PLENTY);
  const p = store.get().player;
  assert.equal(p.staminaMax, GOD_MAX, 'the orange bar maximum (reported 2026-10-12: god mode left it at 50)');
  assert.equal(p.stamina, p.staminaMax, 'and full');
  assert.ok(p.manaMax >= GOD_MAX && p.mana === p.manaMax, 'the blue one too');
  assert.equal(tutorialOf(store.get()).done, true);
  cheats.reset();
  assert.ok(calls.includes('reset'));
  store.set(null);
  assert.equal(cheats.gold(), undefined, 'no save: nothing happens');
  assert.equal(cheats.card('envoy'), undefined);
});

test('wiring: window.cheats and evoker.cheats in app.js, the console hint, the README', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes('const cheats = createCheats({ store, deps, debug, router, toast })'));
  assert.ok(app.includes('window.cheats = cheats;'));
  assert.ok(app.includes('cheats.help()'), 'the console hint names help()');
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(readme.includes('cheats.help()') && readme.includes('cheats.unlockAllLevels()'), 'README documents the cheats');
});
