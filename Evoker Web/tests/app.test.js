'use strict';
/**
 * Unit tests for the app's pure parts: the store (update returning info, subscribe, autosave),
 * HUD data, clock shifting for the debug API, save parsing, nav mapping, seeds and names.
 * No DOM here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStore, hudData, shiftClocks, addDays, shiftDay, parseSave, serializeSave, navScreen, NAV_SCREENS,
  seedFromNow,
} from '../src/ui/store.js';
import { utcDay, DAY_MS, SAVE_VERSION } from '../src/game/state.js';
import { classicGame } from './fixtures-game/classic.js';
import { applyRegen, addGold } from '../src/game/player.js';
import * as stats from '../src/core/stats.js';
import { nodePos, NODE_STEP, MAP_TOP } from '../src/ui/screens/quest-map-layout.js';
import { pendingUnlocks } from '../src/ui/components/popup-unlock.js';
import { topicFor, TOPICS } from '../src/ui/screens/help.js';
import { burstInfo } from '../src/ui/screens/quest-model.js';
import { battleRewards } from '../src/ui/screens/boss-intro.js';
import { levelUpRows } from '../src/ui/screens/battle-result-model.js';
import { T0 } from './fixtures/real.js';

const deps = { stats };

function freshState(t = T0) {
  return classicGame('Tester', 42, t);
}

test('store.update applies a plain-state function and autosaves', () => {
  const saved = [];
  const store = createStore({ state: freshState(), deps, now: () => T0, save: (s) => saved.push(s) });
  const info = store.update((s) => addGold(s, 100));
  assert.equal(info, undefined);
  assert.equal(store.get().player.gold, 400);
  assert.equal(saved.length, 1);
  assert.equal(saved[0], store.get());
});

test('store.update returns the info of a {state, ...info} result and passes deps/now', () => {
  let seen = null;
  const store = createStore({ state: freshState(), deps, now: () => 777 });
  const info = store.update((s, d, now) => {
    seen = { d, now };
    return { state: { ...s, marker: 1 }, won: true, reward: { type: 'gold', gold: 5 } };
  });
  assert.deepEqual(info, { won: true, reward: { type: 'gold', gold: 5 } });
  assert.equal(store.get().marker, 1);
  assert.equal(seen.d, deps);
  assert.equal(seen.now, 777);
});

test('store.subscribe notifies after update and set; unsubscribe stops it', () => {
  const store = createStore({ state: freshState(), deps, now: () => T0 });
  const calls = [];
  const off = store.subscribe((s, info) => calls.push({ gold: s.player.gold, info }));
  store.update((s) => addGold(s, 1));
  store.update((s) => ({ state: addGold(s, 1), tag: 'x' }));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].gold, 301);
  assert.equal(calls[0].info, undefined);
  assert.deepEqual(calls[1].info, { tag: 'x' });
  off();
  store.set(freshState());
  assert.equal(calls.length, 2);
  assert.equal(store.get().player.gold, 300);
});

test('store starts empty without a save; update throws, set loads', () => {
  const store = createStore({ state: null, deps, now: () => T0 });
  assert.equal(store.get(), null);
  assert.equal(store.hasSave(), false);
  assert.throws(() => store.update((s) => s), /no save/);
  store.set(freshState());
  assert.equal(store.hasSave(), true);
});

test('store keeps running when the autosave callback throws', () => {
  const errors = [];
  const store = createStore({ state: freshState(), deps, now: () => T0, save: () => { throw new Error('quota'); }, onError: (e) => errors.push(e) });
  store.update((s) => addGold(s, 1));
  assert.equal(store.get().player.gold, 301);
  assert.equal(errors.length, 1);
});

test('hudData maps the save to the HUD fields', () => {
  const s = freshState();
  const d = hudData(s, stats);
  assert.equal(d.level, 1);
  assert.equal(d.xp, 0);
  assert.equal(d.xpToNext, stats.playerXpToNext(1));
  assert.equal(d.stamina, 50);
  assert.equal(d.staminaMax, 50);
  assert.equal(d.staminaPotions, 2);
  assert.equal(d.manaPotions, 1);
  assert.equal(d.gold, 300);
  assert.equal(d.gems, 0);
  const capped = { ...s, player: { ...s.player, level: 200, xp: 5 } };
  assert.ok(Number.isFinite(hudData(capped, stats).xpToNext));
});

test('shiftDay and shiftClocks move every clock; addDays makes the save older so regen applies', () => {
  assert.equal(shiftDay('2026-10-07', -DAY_MS), '2026-10-06');
  assert.equal(shiftDay('', -DAY_MS), '');
  assert.equal(shiftDay(undefined, 5), undefined);
  let s = freshState();
  s = { ...s, daily: { ...s.daily, lastClaim: utcDay(T0) }, sim: { ...s.sim, day: utcDay(T0), league: { day: utcDay(T0), startedAt: T0, endsAt: T0 + DAY_MS, points: 0 } }, pieces: [{ cardId: 'x', owned: 1, total: 2, raidDay: utcDay(T0) }] };
  const shifted = addDays(s, 2);
  assert.equal(shifted.createdAt, T0 - 2 * DAY_MS);
  assert.equal(shifted.player.regenAt, T0 - 2 * DAY_MS);
  assert.equal(shifted.daily.lastClaim, utcDay(T0 - 2 * DAY_MS));
  assert.equal(shifted.sim.day, utcDay(T0 - 2 * DAY_MS));
  assert.equal(shifted.sim.league.day, utcDay(T0 - 2 * DAY_MS));
  assert.equal(shifted.sim.league.endsAt, T0 - DAY_MS);
  assert.equal(shifted.pieces[0].raidDay, utcDay(T0 - 2 * DAY_MS));
  assert.equal(s.createdAt, T0, 'input not mutated');
  const spent = { ...shifted, player: { ...shifted.player, stamina: 1, mana: 1 } };
  const regen = applyRegen(spent, T0);
  assert.equal(regen.player.stamina, 50);
  assert.equal(regen.player.mana, 50);
  assert.equal(shiftClocks(s, 0).createdAt, T0);
});

test('parseSave / serializeSave round-trip and reject garbage', () => {
  const s = freshState();
  const raw = serializeSave(s, T0 + 5);
  const back = parseSave(raw, T0 + 10);
  assert.equal(back.version, SAVE_VERSION);
  assert.equal(back.player.name, 'Tester');
  assert.equal(back.lastSeen, T0 + 5);
  assert.equal(back.cards.length, s.cards.length);
  assert.equal(parseSave(null, T0), null);
  assert.equal(parseSave('', T0), null);
  assert.equal(parseSave('{not json', T0), null);
  assert.equal(parseSave('{"foo":1}', T0), null);
  assert.equal(parseSave('42', T0), null);
});

test('navScreen maps the six nav ids and passes screen ids through', () => {
  assert.equal(navScreen('quest'), 'quest-map');
  assert.equal(navScreen('cards'), 'cards');
  assert.equal(navScreen('character'), 'character');
  assert.equal(navScreen('help'), 'help');
  assert.deepEqual(Object.keys(NAV_SCREENS), ['league', 'arena', 'quest', 'cards', 'shop', 'character']);
});

test('seedFromNow is deterministic, non-zero and 32-bit', () => {
  assert.equal(seedFromNow(T0), seedFromNow(T0));
  assert.notEqual(seedFromNow(T0), seedFromNow(T0 + 1));
  assert.ok(seedFromNow(0) > 0 && seedFromNow(0) < 2 ** 32);
});

test('quest map node positions wind inside the stage and descend', () => {
  for (let i = 0; i < 100; i++) {
    const p = nodePos(i);
    assert.ok(p.x >= 100 && p.x <= 620, `x in bounds for ${i}`);
    assert.equal(p.y, MAP_TOP + i * NODE_STEP);
  }
  assert.notEqual(nodePos(0).x, nodePos(3).x);
});

test('pendingUnlocks lists feature and card-slot popups once, old unlocks silently', () => {
  const s = { ...freshState(), player: { ...freshState().player, deckSlots: 2 } };
  assert.deepEqual(pendingUnlocks(s), { show: [], silent: [] });
  const l2 = { ...s, player: { ...s.player, level: 2 } };
  assert.deepEqual(pendingUnlocks(l2).show.map((u) => u.id), ['fusion']);
  const l4 = { ...s, player: { ...s.player, level: 4 }, tutorial: { step: 0, seen: ['fusion'] } };
  assert.deepEqual(pendingUnlocks(l4).show.map((u) => u.id), ['arena']);
  const l6seen = { ...s, player: { ...s.player, level: 6 }, tutorial: { step: 0, seen: ['fusion', 'arena', 'training'] } };
  assert.deepEqual(pendingUnlocks(l6seen).show.map((u) => u.title), ['Leagues Unlocked!']);
  const slot = { ...s, player: { ...s.player, deckSlots: 3 }, quests: { ...s.quests, main: { ...s.quests.main, unlocked: 3 } } };
  assert.deepEqual(pendingUnlocks(slot).show.map((u) => [u.id, u.text]), [['cardslot3', 'Your deck can now hold 3 cards.']]);
});

test('help topics cover every screen and aliases resolve', () => {
  for (const id of ['quest-map', 'quest', 'battle', 'cards', 'training', 'fusion', 'arena', 'pieces', 'league', 'shop', 'character']) {
    assert.ok(TOPICS[id], `topic ${id}`);
    assert.ok(TOPICS[id].paragraphs.length >= 2);
  }
  assert.equal(topicFor('prebattle'), 'battle');
  assert.equal(topicFor('booster-open'), 'shop');
  assert.equal(topicFor('nonsense'), 'quest-map');
});

test('quest reward bursts and battle reward summaries describe the reward', () => {
  assert.equal(burstInfo({ type: 'gold', gold: 1234 }).title, '+1,234 gold');
  assert.equal(burstInfo({ type: 'card', cardId: 'x' }).icon, 'cards');
  assert.equal(burstInfo({ type: 'potion', potion: 'mana' }).icon, 'potion-blue');
  const db = { get: (id) => ({ envoy: { name: 'Envoy' } }[id]) };
  const r = battleRewards({ won: true, playerXp: 33, cardXp: 15, reward: { type: 'gold', gold: 168 }, gems: 20, unlocked: 2, firstWin: true }, db);
  assert.equal(r.won, true);
  assert.equal(r.gold, 168);
  assert.equal(r.gems, 20);
  assert.equal(r.text, '168 gold');
  assert.equal(r.items.length, 4);
  assert.equal(r.unlocked, 2);
  const loss = battleRewards({ won: false, playerXp: 22, cardXp: 10, reward: null }, db);
  assert.equal(loss.items.length, 2);
  assert.equal(loss.text, '');
});

test('levelUpRows uses the stat formulas for old and new values', () => {
  const def = {
    id: 'envoy', name: 'Envoy', tribe: 'elf', rarity: 'common', mana: 2, dirs: ['direct'],
    base: { attack: 100, hp: 100, ability: null }, caps: [9, 10, 11, 12, 13],
    growth: { attack: [null, null, null, null, null], hp: [null, null, null, null, null], ability: [null, null, null, null, null] },
    ability: null, set: 'main', art: {},
  };
  const d = { db: { get: (id) => (id === 'envoy' ? def : undefined) }, stats };
  const rows = levelUpRows(d, { cardId: 'envoy', stage: 0, evolveQuality: 1 }, 1, 2);
  assert.equal(rows[0].kind, 'level');
  assert.deepEqual([rows[0].from, rows[0].to], [1, 2]);
  assert.equal(rows[1].kind, 'attack');
  assert.ok(rows[1].to > rows[1].from);
  assert.equal(rows[2].kind, 'hp');
  assert.equal(rows.length, 3, 'no ability row for a card without ability');
  const fallback = levelUpRows(d, { cardId: 'missing', stage: 0 }, 3, 4);
  assert.deepEqual(fallback, [{ kind: 'level', from: 3, to: 4 }]);
});
