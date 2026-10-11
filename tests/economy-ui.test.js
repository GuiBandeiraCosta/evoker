'use strict';
/**
 * Unit tests for the pure helpers of the Shop / Booster-opening / Character screens (src/ui/screens/
 * daily-view.js, profile-view.js, booster-view.js, settings-view.js, save-file.js): daily calendar model,
 * stat-point spinner constraints, booster prices and token icons, booster grid, settings normalisation and
 * save-file validation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyCalendar, describeDailyReward, dailyRewardIcons, DAILY_CYCLE, tokenIconFor } from '../src/ui/screens/daily-view.js';
import {
  emptyAllocation, adjustAllocation, allocationTotal, allocationPreview, hasUnspentPoints, cleanName, avatarIds,
} from '../src/ui/screens/profile-view.js';
import { tokenSpriteFor, boosterGrid, rarityGlowVar, capitalize } from '../src/ui/screens/booster-view.js';
import { normalizeSettings } from '../src/ui/screens/settings-view.js';
import { validateSave, parseSaveFile, serializeSave, saveFileName } from '../src/ui/screens/save-file.js';
import { DAILY_REWARDS, claimDaily, BOOSTERS } from '../src/game/shop.js';
import { newGame, DAY_MS, SAVE_VERSION } from '../src/game/state.js';
import { makeDeps } from './fixtures-game/deps.js';
import { T0 } from './fixtures/real.js';


/* ---------------------------------------------------------------- daily calendar */

test('dailyCalendar: fresh save shows day 1 claimable, everything else future', () => {
  const cal = dailyCalendar({ streak: 0, lastClaim: '' }, T0);
  assert.equal(cal.cells.length, DAILY_CYCLE);
  assert.equal(DAILY_CYCLE, 21);
  assert.equal(cal.claimable, true);
  assert.equal(cal.claimedToday, false);
  assert.equal(cal.nextDay, 1);
  assert.equal(cal.position, 1);
  assert.equal(cal.streak, 0);
  assert.equal(cal.cells[0].status, 'today');
  assert.ok(cal.cells.slice(1).every((c) => c.status === 'future'));
  assert.deepEqual(cal.reward, DAILY_REWARDS[0]);
  assert.deepEqual(cal.nextReward, DAILY_REWARDS[0]);
  assert.equal(cal.today, '2026-10-07');
});

test('dailyCalendar: claimed today marks the cell and shows tomorrow\'s reward', () => {
  const r = claimDaily(newGame('T', 1, T0 - DAY_MS), T0);
  const cal = dailyCalendar(r.state.daily, T0 + 3600 * 1000);
  assert.equal(cal.claimable, false);
  assert.equal(cal.claimedToday, true);
  assert.equal(cal.streak, 1);
  assert.equal(cal.cells[0].status, 'claimed-today');
  assert.equal(cal.cells[1].status, 'future');
  assert.deepEqual(cal.nextReward, DAILY_REWARDS[1]);
});

test('a brand-new game pays no daily reward on its first day; day 1 comes the next day', () => {
  const s = newGame('T', 1, T0);
  const first = claimDaily(s, T0 + 3600 * 1000);
  assert.equal(first.claimed, false);
  const cal = dailyCalendar(s.daily, T0);
  assert.equal(cal.claimable, false);
  assert.equal(cal.startsTomorrow, true);
  assert.equal(cal.nextDay, 1);
  assert.ok(cal.cells.every((c) => c.status === 'future' || c.status === 'today'));
  const next = claimDaily(s, T0 + DAY_MS);
  assert.equal(next.claimed, true);
  assert.equal(next.day, 1);
});

test('dailyCalendar: consecutive days advance; previous cells are claimed', () => {
  let s = newGame('T', 1, T0 - DAY_MS);
  for (let d = 0; d < 4; d++) s = claimDaily(s, T0 + d * DAY_MS).state;
  const cal = dailyCalendar(s.daily, T0 + 4 * DAY_MS);
  assert.equal(cal.claimable, true);
  assert.equal(cal.nextDay, 5);
  assert.equal(cal.streak, 4);
  assert.deepEqual(cal.cells.slice(0, 4).map((c) => c.status), ['claimed', 'claimed', 'claimed', 'claimed']);
  assert.equal(cal.cells[4].status, 'today');
  assert.equal(cal.cells[5].status, 'future');
  assert.deepEqual(cal.reward, DAILY_REWARDS[4]);
  // and the model agrees with the game function
  assert.equal(claimDaily(s, T0 + 4 * DAY_MS).day, 5);
});

test('dailyCalendar: a missed day resets to a fresh cycle (day 1 claimable)', () => {
  let s = newGame('T', 1, T0 - DAY_MS);
  for (let d = 0; d < 3; d++) s = claimDaily(s, T0 + d * DAY_MS).state;
  const cal = dailyCalendar(s.daily, T0 + 5 * DAY_MS);
  assert.equal(cal.claimable, true);
  assert.equal(cal.nextDay, 1);
  assert.equal(cal.streak, 0);
  assert.equal(cal.cells[0].status, 'today');
  assert.ok(cal.cells.slice(1).every((c) => c.status === 'future'));
  assert.equal(claimDaily(s, T0 + 5 * DAY_MS).day, 1);
});

test('dailyCalendar: the calendar cycles after day 21', () => {
  let s = newGame('T', 1, T0 - DAY_MS);
  for (let d = 0; d < 21; d++) s = claimDaily(s, T0 + d * DAY_MS).state;
  const done = dailyCalendar(s.daily, T0 + 20 * DAY_MS);
  assert.equal(done.position, 21);
  assert.equal(done.cells[20].status, 'claimed-today');
  assert.deepEqual(done.nextReward, DAILY_REWARDS[0]);
  const next = dailyCalendar(s.daily, T0 + 21 * DAY_MS);
  assert.equal(next.nextDay, 22);
  assert.equal(next.position, 1);
  assert.equal(next.cells[0].status, 'today');
  assert.equal(next.cells[0].day, 22);
  assert.deepEqual(next.cells[0].reward, DAILY_REWARDS[0]);
  assert.ok(next.cells.slice(1).every((c) => c.status === 'future'));
});

test('describeDailyReward and icons cover every entry of the table', () => {
  assert.equal(describeDailyReward({ stamina: 2 }), '2 Stamina potions');
  assert.equal(describeDailyReward({ mana: 1, stamina: 1 }), '1 Mana + 1 Stamina potions');
  assert.equal(describeDailyReward({ mana: 1 }), '1 Mana potion');
  assert.equal(describeDailyReward({ gems: 40 }), '40 Gems');
  assert.equal(describeDailyReward({ tokens: 'neophyte', count: 2 }), '2 Neophyte tokens');
  assert.equal(describeDailyReward({ tokens: 'archmage', count: 1 }), '1 Archmage token');
  assert.equal(describeDailyReward(null), '');
  for (const r of DAILY_REWARDS) {
    assert.ok(describeDailyReward(r).length > 0);
    assert.ok(dailyRewardIcons(r).length > 0);
  }
  assert.deepEqual(dailyRewardIcons({ gems: 80 }), [{ icon: 'gem', count: 80 }]);
  assert.deepEqual(dailyRewardIcons({ mana: 1, stamina: 2 }), [{ icon: 'potion-orange', count: 2 }, { icon: 'potion-blue', count: 1 }]);
  assert.deepEqual(dailyRewardIcons({ tokens: 'summoner', count: 2 }), [{ icon: 'token-silver', count: 2 }]);
});

/* ---------------------------------------------------------------- stat points */

test('adjustAllocation never goes below 0 nor above the available points', () => {
  let a = emptyAllocation();
  assert.deepEqual(a, { stamina: 0, mana: 0, hp: 0 });
  a = adjustAllocation(a, 'stamina', -1, 12);
  assert.equal(a.stamina, 0);
  a = adjustAllocation(a, 'stamina', 5, 12);
  a = adjustAllocation(a, 'mana', 5, 12);
  a = adjustAllocation(a, 'hp', 5, 12);
  assert.deepEqual(a, { stamina: 5, mana: 5, hp: 2 });
  assert.equal(allocationTotal(a), 12);
  a = adjustAllocation(a, 'hp', 1, 12);
  assert.equal(a.hp, 2);
  a = adjustAllocation(a, 'stamina', -2, 12);
  a = adjustAllocation(a, 'hp', 1, 12);
  assert.deepEqual(a, { stamina: 3, mana: 5, hp: 3 });
  // unknown stat is ignored, input never mutated
  const before = { ...a };
  const same = adjustAllocation(a, 'luck', 3, 12);
  assert.deepEqual(same, before);
  assert.deepEqual(a, before);
  // no points available: nothing can be added
  assert.deepEqual(adjustAllocation(emptyAllocation(), 'mana', 1, 0), emptyAllocation());
});

test('allocationPreview: button states, remaining points and the +30 HP per point preview', () => {
  const player = { staminaMax: 50, manaMax: 50, hpMax: 1500, statPoints: 12 };
  const empty = allocationPreview(player, emptyAllocation());
  assert.equal(empty.remaining, 12);
  assert.equal(empty.canConfirm, false);
  assert.deepEqual(empty.canInc, { stamina: true, mana: true, hp: true });
  assert.deepEqual(empty.canDec, { stamina: false, mana: false, hp: false });
  const full = allocationPreview(player, { stamina: 4, mana: 4, hp: 4 });
  assert.equal(full.remaining, 0);
  assert.equal(full.canConfirm, true);
  assert.deepEqual(full.preview, { staminaMax: 54, manaMax: 54, hpMax: 1620 });
  assert.deepEqual(full.canInc, { stamina: false, mana: false, hp: false });
  assert.deepEqual(full.canDec, { stamina: true, mana: true, hp: true });
  const over = allocationPreview({ ...player, statPoints: 2 }, { stamina: 3, mana: 0, hp: 0 });
  assert.equal(over.canConfirm, false);
  assert.equal(hasUnspentPoints({ statPoints: 0 }), false);
  assert.equal(hasUnspentPoints({ statPoints: 12 }), true);
  assert.equal(hasUnspentPoints(null), false);
});

/* ---------------------------------------------------------------- shop */

test('booster catalog (per-pick gem prices, "May contain" rarities) and token icons', () => {
  assert.equal(BOOSTERS.neophyte.pickGems, 50);
  assert.equal(BOOSTERS.summoner.pickGems, 350);
  assert.equal(BOOSTERS.archmage.pickGems, 975);
  assert.deepEqual(BOOSTERS.neophyte.mayContain, ['uncommon', 'rare', 'heroic']);
  assert.equal(tokenIconFor('neophyte'), 'token-bronze');
  assert.equal(tokenIconFor('summoner'), 'token-silver');
  assert.equal(tokenIconFor('archmage'), 'token-gold');
  assert.equal(tokenIconFor('portalHigh'), 'token-gold');
  assert.deepEqual(['neophyte', 'summoner', 'archmage'].map(tokenSpriteFor), ['token_small', 'token_medium', 'token_big']);
  assert.equal(capitalize('rare'), 'Rare');
});

/* ---------------------------------------------------------------- booster opening */

test('boosterGrid lays the nine cards out row by row; rarityGlowVar', () => {
  const g = boosterGrid({ cards: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], drawn: [0] }, { type: 'token', amount: 1 });
  assert.deepEqual(g.map((c) => `${c.row}${c.col}`), ['00', '01', '02', '10', '11', '12', '20', '21', '22']);
  assert.deepEqual(g[1].cost, { type: 'token', amount: 1 });
  assert.equal(g[0].cardId, 'a');
  assert.equal(rarityGlowVar('legendary'), 'var(--r-legendary)');
  assert.equal(rarityGlowVar('nope'), 'var(--r-common)');
});

/* ---------------------------------------------------------------- settings and save files */

test('normalizeSettings fills defaults and coerces values', () => {
  assert.deepEqual(normalizeSettings(undefined), { sound: false, speed: 1, raids: true, reducedMotion: false });
  assert.deepEqual(normalizeSettings({ sound: 1, speed: '2', raids: 0, reducedMotion: 'yes' }), { sound: true, speed: 2, raids: false, reducedMotion: true });
  assert.equal(normalizeSettings({ speed: 7 }).speed, 1);
});

test('validateSave accepts a real save and rejects malformed ones', () => {
  const state = newGame('Tester', 7, T0, makeDeps());
  assert.equal(validateSave(state).ok, true);
  assert.equal(validateSave(null).ok, false);
  assert.equal(validateSave([]).ok, false);
  assert.equal(validateSave({}).ok, false);
  assert.match(validateSave({ version: 1 }).error, /player/);
  assert.match(validateSave({ version: SAVE_VERSION + 1, player: state.player, cards: [] }).error, /newer/);
  assert.match(validateSave({ version: 1, player: { ...state.player, level: 0 }, cards: [] }).error, /level/);
  assert.match(validateSave({ version: 1, player: state.player }).error, /collection/);
  assert.match(validateSave({ version: 1, player: state.player, cards: [{ uid: 1 }] }).error, /card entry/);
  assert.match(validateSave({ version: 1, player: state.player, cards: [], deck: 'x' }).error, /deck/);
});

test('serializeSave / parseSaveFile round-trip; invalid JSON is reported', () => {
  const state = newGame('Tester', 7, T0, makeDeps());
  const text = serializeSave(state);
  const back = parseSaveFile(text);
  assert.equal(back.ok, true);
  assert.deepEqual(back.save, state);
  assert.match(parseSaveFile('{not json').error, /JSON/);
  assert.equal(parseSaveFile('42').ok, false);
  assert.equal(saveFileName(T0), 'evoker-save-2026-10-07.json');
});

test('cleanName trims, collapses spaces and caps at 20 characters', () => {
  assert.deepEqual(cleanName('  Morden   the  Great  '), { ok: true, name: 'Morden the Great' });
  assert.deepEqual(cleanName('   '), { ok: false, name: '' });
  assert.equal(cleanName('a'.repeat(40)).name.length, 20);
  assert.equal(avatarIds(makeDeps().names).length, 12);
  assert.deepEqual(avatarIds(null), []);
});
