'use strict';
/**
 * The menu helpers (no DOM): the level-up dialog (comp_levelup port), the feature unlock popups
 * (view_unlocked_feature_popup), the Quest-tab landing feed, the phase-1 wiring (league points from Arena and Pieces
 * wins, league unlock level 6, save defaults), the portal level gate and the ended-portal guard of the quest map,
 * the daily reward toasts and the help texts.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/game/state.js';
import { levelUpRewards, spendStatPoints, addPlayerXp } from '../src/game/player.js';
import { fightArena, ensureOffers } from '../src/game/arena.js';
import { addPiece, fightHolder } from '../src/game/pieces.js';
import { openLeague, joinLeague, pointsFor } from '../src/game/league.js';
import {
  autoDistribute, autoSteps, coinSprite, rewardColumn, toDetails, dialogBudget, ATTRIBUTES,
} from '../src/ui/components/popup-levelup.js';
import { unlockPopupFor, pendingUnlocks, markSeen, UNLOCK_POPUPS } from '../src/ui/components/popup-unlock.js';
import { feedBanners, dailyStrip, isFeedView, dailyRewardIcon } from '../src/ui/screens/quest-feed.js';
import { NAV_ITEMS } from '../src/ui/components/nav.js';
import {
  PORTAL_LEVEL, PORTAL_LOCKED, canEnterPortals, resolveMapLine, runningPortal,
} from '../src/ui/screens/quest-portal.js';
import { dailyRewardIcons } from '../src/ui/screens/daily-view.js';
import { TOPICS } from '../src/ui/screens/help.js';
import { makeDeps } from './fixtures-game/deps.js';
import { classicGame } from './fixtures-game/classic.js';
import { T0, DAY, deps, portal } from './fixtures/real.js';

const withLevel = (s, level) => ({ ...s, player: { ...s.player, level } });

describe('level-up dialog (comp_levelup)', () => {
  test('Proceed spreads the unplaced points evenly: mana, stamina, health (overlays.levelup autoLevelUp)', () => {
    assert.deepEqual(autoDistribute(12, {}), { hp: 4, stamina: 4, mana: 4 });
    assert.deepEqual(autoDistribute(1, {}), { hp: 0, stamina: 0, mana: 1 });
    assert.deepEqual(autoDistribute(2, {}), { hp: 0, stamina: 1, mana: 1 });
    // points placed by hand count: the lowest attribute is filled first
    assert.deepEqual(autoDistribute(9, { stamina: 3 }), { hp: 4, stamina: 4, mana: 4 });
    assert.deepEqual(autoDistribute(0, { hp: 12 }), { hp: 12, stamina: 0, mana: 0 });
    // without the mana feature: stamina, then health
    assert.deepEqual(autoDistribute(3, {}, false), { hp: 1, stamina: 2, mana: 0 });
  });

  test('the automatic points count up health first, then stamina, then mana (autoCount)', () => {
    assert.deepEqual(autoSteps({ hp: 0, stamina: 1, mana: 0 }, { hp: 1, stamina: 2, mana: 1 }), ['hp', 'stamina', 'mana']);
    assert.deepEqual(autoSteps({ hp: 2, stamina: 0, mana: 0 }, { hp: 2, stamina: 0, mana: 0 }), []);
  });

  test('rows: Health +30, Stamina +1, Mana +1 per point with the client icons', () => {
    assert.deepEqual(ATTRIBUTES.map((a) => [a.id, a.mult, a.sprite]), [['hp', 30, 'hud_healthicon02'], ['stamina', 1, 'hud_stamicon01'], ['mana', 1, 'hud_manaicon01']]);
  });

  test('rewards column: the gold pile by amount and one special reward', () => {
    assert.equal(coinSprite(100), 'shop_coins01');
    assert.equal(coinSprite(500), 'shop_coins03');
    assert.equal(coinSprite(1000), 'shop_coins04');
    assert.deepEqual(rewardColumn(levelUpRewards(2)), { gold: 100, special: { kind: 'gems', sprite: 'reward_gems', count: 5, label: '5 gems' } });
    assert.equal(rewardColumn(levelUpRewards(3)).special.sprite, 'potion_stamina1');
    assert.equal(rewardColumn(levelUpRewards(5)).special.sprite, 'potion_mana1');
    assert.equal(rewardColumn(levelUpRewards(6)).special.sprite, 'token_small');
    assert.equal(rewardColumn({ gold: 50 }).special, null);
  });

  test('callers may pass a levelUpDetails entry, a level or a list; budgets per dialog', () => {
    const d = toDetails(4);
    assert.deepEqual(d, [{ level: 4, rewards: levelUpRewards(4), statPoints: 12, unlocked: ['arena'] }]);
    assert.deepEqual(toDetails([{ level: 2, rewards: levelUpRewards(2), statPoints: 12, unlocked: ['fusion'] }, 3]).map((x) => x.level), [2, 3]);
    assert.deepEqual(toDetails([1, null, 'x']), []);
    assert.equal(dialogBudget(24, 12, false), 12, 'an earlier dialog of a 2-level jump offers its own 12');
    assert.equal(dialogBudget(12, 12, true), 12);
    assert.equal(dialogBudget(30, 12, true), 30, 'the last dialog offers every unspent point (getAttributePoints)');
    assert.equal(dialogBudget(5, 12, false), 5);
  });

  test('a level-up then Proceed with the default spread: max values grow, points are gone', () => {
    const deps = makeDeps();
    let s = classicGame('T', 1, T0);
    const r = addPlayerXp(s, deps, deps.stats.playerXpToNext(1));
    s = r.state;
    assert.equal(s.player.statPoints, 12);
    s = spendStatPoints(s, autoDistribute(12, {}));
    assert.equal(s.player.statPoints, 0);
    assert.equal(s.player.hpMax, 1500 + 4 * 30);
    assert.equal(s.player.staminaMax, 54);
    assert.equal(s.player.manaMax, 54);
  });
});

describe('unlock popups (view_unlocked_feature_popup)', () => {
  test('client strings and pictures', () => {
    assert.deepEqual(unlockPopupFor('evolve'), { id: 'fusion', title: 'Card Fusing Unlocked!', text: 'Combine two identical cards to power up.', sprite: 'unlock_fuse' });
    assert.equal(unlockPopupFor('enhance').title, 'Card Training Unlocked!');
    assert.equal(unlockPopupFor('pvp').text, 'Duel against other players');
    assert.deepEqual(unlockPopupFor('leagues'), { id: 'league', title: 'Leagues Unlocked!', text: 'Get to the Top!', sprite: 'unlock_pvp' });
    assert.deepEqual(unlockPopupFor('cardslot', { slots: 3 }), { id: 'cardslot3', title: 'Card Slot Unlocked!', text: 'Your deck can now hold 3 cards.', sprite: 'unlock_cardslot' });
    assert.equal(unlockPopupFor('nope'), null);
    for (const p of Object.values(UNLOCK_POPUPS)) assert.match(p.title, /Unlocked!$/);
  });

  test('the card-slot popup follows the quest-2 boss win, once', () => {
    let s = S.newGame('T', 1, T0);
    assert.deepEqual(pendingUnlocks(s).show, []);
    s = S.unlockSlotsForQuest(s, 'main', 2).state;
    s = { ...s, quests: { ...s.quests, main: { ...s.quests.main, unlocked: 3, firstWins: [1, 2] } } };
    const p = pendingUnlocks(s);
    assert.deepEqual(p.show.map((u) => u.text), ['Your deck can now hold 3 cards.']);
    s = markSeen(s, p.show.map((u) => u.id));
    assert.deepEqual(pendingUnlocks(s).show, []);
    assert.equal(markSeen(s, ['cardslot3']), s, 'nothing new: same state');
  });

  test('an old save gets no flood of popups: long-open features are marked silently', () => {
    const s = { ...classicGame('Old', 1, T0), player: { ...classicGame('Old', 1, T0).player, level: 20, deckSlots: 5 } };
    const old = { ...s, quests: { ...s.quests, main: { ...s.quests.main, unlocked: 40 } } };
    const p = pendingUnlocks(old);
    assert.deepEqual(p.show, []);
    assert.deepEqual(p.silent.sort(), ['arena', 'cardslot3', 'cardslot4', 'cardslot5', 'fusion', 'league', 'training']);
  });
});

describe('Quest-tab landing feed', () => {
  test('the feed only with {feed: true} (login, home button); the Quest tab itself and a line open the map', () => {
    assert.equal(isFeedView({ feed: true }), true);
    assert.equal(isFeedView({}), false);
    assert.equal(isFeedView(undefined), false);
    assert.equal(isFeedView({ line: 'main' }), false);
    assert.equal(isFeedView({ line: 'the-dark-beyond' }), false);
  });

  test('banners: daily strip, main quest, event, current portal, Get Cards, next portal', () => {
    const deps = makeDeps();
    const s = S.newGame('T', 1, T0);
    const banners = feedBanners(s, deps, T0 + 3600 * 1000, { id: 'infinite-wisdom', name: 'Infinite Wisdom', desc: 'Double card XP from every fight.' });
    assert.deepEqual(banners.map((b) => b.kind), ['daily', 'quest', 'event', 'portal', 'shop', 'next-portal']);
    const ev = banners[2];
    assert.equal(ev.double, true);
    assert.equal(ev.endsAt, Date.UTC(2026, 9, 8));
    const portal = banners[3];
    assert.equal(portal.line, deps.quests.portals[0].id);
    assert.equal(portal.endsAt, T0 + 7 * DAY, 'portal closes when the 7-day rotation ends');
    const next = banners[5];
    assert.equal(next.line, deps.quests.portals[1].id);
    assert.equal(next.startsAt, portal.endsAt);
    assert.equal(banners[1].quest, 1);
  });

  test('daily strip: next streak days, the cycle end, countdown to midnight UTC', () => {
    const s = { ...S.newGame('T', 1, T0), daily: { streak: 1, lastClaim: S.utcDay(T0) } };
    const strip = dailyStrip(s, T0);
    assert.deepEqual(strip.items.map((i) => i.day), [2, 3, 4, 21]);
    assert.equal(strip.items[3].gap, true);
    assert.equal(strip.endsAt, Date.UTC(2026, 9, 8));
    const late = dailyStrip({ ...s, daily: { streak: 20, lastClaim: S.utcDay(T0) } }, T0);
    assert.deepEqual(late.items.map((i) => i.day), [21]);
    const missed = dailyStrip({ ...s, daily: { streak: 9, lastClaim: '2026-10-01' } }, T0);
    assert.equal(missed.items[0].day, 1, 'a missed day restarts the cycle');
    assert.equal(dailyRewardIcon({ gems: 40 }).sprite, 'reward_gems');
    assert.equal(dailyRewardIcon({ tokens: 'archmage', count: 2 }).sprite, 'token_big');
  });
});

describe('phase-1 wiring', () => {
  test('League unlocks at level 6 (nav, features)', () => {
    assert.equal(NAV_ITEMS.find((i) => i.id === 'league').unlockLevel, 6);
    assert.equal(S.FEATURE_LEVELS.league, 6);
  });

  test('new saves carry the league and booster defaults; old saves keep their league unknown', () => {
    const s = S.defaultState(T0, 1);
    assert.equal(s.sim.leagueTier, 'bronze');
    assert.equal(s.sim.leagueJoined, false);
    assert.equal(s.sim.leaguePending, null);
    assert.deepEqual(s.boosters, {});
    const round = S.migrate(JSON.parse(JSON.stringify(s)), T0);
    assert.equal(round.sim.leagueJoined, false);
    assert.equal(round.sim.leagueTier, 'bronze');
    const old = S.migrate({ seed: 2, player: { level: 9 }, sim: { leagueHistory: [{ rank: 1 }] } }, T0);
    assert.equal(old.sim.leagueJoined, null, 'league.hasJoined decides from the history');
    assert.equal(old.sim.leagueTier, null);
    assert.deepEqual(old.boosters, {});
  });

  test('Arena and Pieces wins add league points once the league is joined', () => {
    const deps = makeDeps({ winner: 'attacker' });
    let s = classicGame('T', 1, T0);
    s = { ...s, player: { ...s.player, level: 10, mana: 300, manaMax: 300, gems: 5000 } };
    // not joined: no points
    let r = fightArena(ensureOffers(s, deps, T0).state, deps, T0, { offerIndex: 0 });
    assert.equal(r.won, true);
    assert.equal(r.rewards.leaguePoints, 0);
    // joined
    s = joinLeague(openLeague(s, deps, T0).state);
    const eo = ensureOffers(s, deps, T0);
    const offer = eo.offers[0];
    const stake = pointsFor(eo.state.sim.league, 'arena', null, { difficulty: offer.difficulty, oppLevel: offer.level, myLevel: 10 });
    assert.ok(stake > 0);
    r = fightArena(eo.state, deps, T0, { offerIndex: 0 });
    assert.equal(r.rewards.leaguePoints, stake);
    assert.equal(r.state.sim.league.points, stake);
    s = { ...r.state, player: { ...r.state.player, mana: 300 } };
    const a = addPiece(s, deps, T0, deps.db.all().find((c) => c.rarity === 'heroic').id);
    const f = fightHolder(a.state, deps, T0, { index: a.index });
    assert.ok(f.leaguePoints >= 18 && f.leaguePoints <= 48, `pieces points ${f.leaguePoints}`);
    assert.equal(f.state.sim.league.points, stake + f.leaguePoints);
  });
});

describe('portals on the quest map', () => {
  test('level gate: the client\'s "Portals / Reach user level 8 to enter portals." below level 8', () => {
    const s = S.newGame('T', 1, T0);
    assert.equal(PORTAL_LEVEL, 8);
    assert.deepEqual({ ...PORTAL_LOCKED }, { title: 'Portals', text: 'Reach user level 8 to enter portals.' });
    assert.equal(canEnterPortals(withLevel(s, 7)), false);
    assert.equal(canEnterPortals(withLevel(s, 8)), true);
    assert.equal(canEnterPortals(null), false);
  });

  test('resolveMapLine: running portal from level 8; ended portal, low level and unknown lines fall back to main', () => {
    const deps = makeDeps();
    const s = withLevel(S.newGame('T', 1, T0), 10);
    const run = runningPortal(s, deps, T0 + 3600 * 1000).portalId;
    const ended = deps.quests.portals.map((p) => p.id).find((id) => id !== run);
    assert.deepEqual(resolveMapLine(s, deps, T0, run), { line: run, reason: null });
    assert.deepEqual(resolveMapLine(s, deps, T0, ended), { line: 'main', reason: 'closed' });
    assert.deepEqual(resolveMapLine(withLevel(s, 3), deps, T0, run), { line: 'main', reason: 'level' });
    assert.deepEqual(resolveMapLine(s, deps, T0, 'main'), { line: 'main', reason: null });
    assert.deepEqual(resolveMapLine(s, deps, T0, 'no-such-line'), { line: 'main', reason: null });
    assert.deepEqual(resolveMapLine(s, deps, T0, undefined), { line: 'main', reason: null });
    // a week later the rotation has moved on: the old portal is closed
    assert.equal(resolveMapLine(s, deps, T0 + 7 * DAY + 1000, run).reason, 'closed');
  });
});

describe('daily reward toasts and help texts', () => {
  test('a daily reward is shown with its own icon (not always the gem)', () => {
    assert.equal(dailyRewardIcons({ gems: 40 })[0].icon, 'gem');
    assert.equal(dailyRewardIcons({ stamina: 2 })[0].icon, 'potion-orange');
    assert.equal(dailyRewardIcons({ tokens: 'summoner', count: 2 })[0].icon, 'token-silver');
  });

  test('help: Look inside opens the pack; the reward calendar repeats every 21 days; portals from level 8', () => {
    const shop = TOPICS.shop.paragraphs.join(' ');
    assert.match(shop, /"Look inside" button to open it/);
    assert.doesNotMatch(shop, /Look inside" to see which rarities/);
    const character = TOPICS.character.paragraphs.join(' ');
    assert.match(character, /repeat every 21 days/);
    assert.match(TOPICS['quest-map'].paragraphs.join(' '), /level 8/);
  });
});
