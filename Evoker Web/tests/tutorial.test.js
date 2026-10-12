'use strict';
/**
 * The tutorial, rebuilt step by step from the German 1.7.0 tutorial video (exploration/research/round3/tutorial-v2.md):
 * the tutorial record and its migration (saves without one count as finished), the new game (automatic
 * "user-<digits>" name, the Envoy alone), the scripted quest data (Master Brewer soul card, boss line-ups and
 * outcomes with the real engine, first-win rewards, slot and feature unlocks by quest), the step script (texts,
 * sparkles, drag arrows), the ranger's map lines, the name prompt, the scripted opening fight and the lines; the
 * playtest fixes (exploration/research/round5/playtest-tutorial.md, playtest-progression.md: no daily event and no gold
 * bursts during the tutorial, the "amateur mage" piece holder, Q9 without the tribe bonus, in-fight lines, the
 * fusion lesson's reveal, the portal guard, a whole tutorial on the game modules); and game-design §9.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  tutorialOf, isTutorialActive, startTutorial, newTutorialGame, recordBossFight, markSeen, needsName, setPlayerName,
  cleanPlayerName, defaultPlayerName, hintFor, pendingLesson, arenaLesson, tutorialFacts, TARGETS, FIGHT_LINES,
  FINAL_QUEST, NAME_MAX, HAND_DELAY, patchTutorial, FIGHT_LINE_ROUND,
} from '../src/ui/tutorial/progress.js';
import { LINES, SPEAKERS, line } from '../src/ui/tutorial/lines.js';
import { INTRO_FIGHT, INTRO_SOUNDS } from '../src/ui/tutorial/intro-fight-script.js';
import { INTRO_LORE, LORE_TIMES, SKIP_INTRO, PREVIEW_SPEED, PREVIEW_CARD, introTarget, MISSILE_MS } from '../src/ui/tutorial/opening.js';
import { arrowGeometry, SPARKLE_FRAMES, SPARKLE_BASE } from '../src/ui/tutorial/overlay.js';
import { NAME_PROMPT_TEXT, NAME_PORTRAIT } from '../src/ui/tutorial/name-popup.js';
import * as Q from '../src/game/quests.js';
import {
  migrate, defaultState, slotUnlocked, isUnlocked, featuresUnlockedAt, inTutorial,
} from '../src/game/state.js';
import { addCard } from '../src/game/collection.js';
import * as stats from '../src/core/stats.js';
import { mulberry32 } from '../src/core/rng.js';
import { pendingUnlocks } from '../src/ui/components/popup-unlock.js';
import { dailyEvent, shopOffers } from '../src/game/shop.js';
import { feedBanners } from '../src/ui/screens/quest-feed.js';
import { TUTORIAL_HOLDER, getSim, simInfo } from '../src/game/opponents.js';
import * as P from '../src/game/pieces.js';
import { fuse } from '../src/game/fusion.js';
import { hasTribeBonus } from '../src/engine/tribe-bonus.js';
import { portalBlock, TAP_GOLD_COUNT } from '../src/ui/screens/quest-model.js';
import * as S from '../src/game/state.js';
import * as C from '../src/game/collection.js';
import * as Sh from '../src/game/shop.js';
import { ROOT, QUESTS, db, realDeps, readJson, fz, tutorialStart, openSlots } from './fixtures/real.js';
import * as real from './fixtures/real.js';

const T0 = Date.UTC(2026, 9, 8, 12, 0, 0);
/** Everything real, the battle engine included. */
const deps = realDeps();

const node = (n) => QUESTS.main.nodes.find((q) => q.n === n);

/** A new tutorial game with the given main-quest first wins, losses and extra cards. */
function game({ wins = [], lost = [], extra = [], level = 1 } = {}) {
  let s = newTutorialGame(4242, T0, deps);
  s = { ...s, quests: { ...s.quests, main: { unlocked: Math.max(0, ...wins) + 1, done: wins.length, firstWins: wins } } };
  s = { ...s, player: { ...s.player, level } };
  for (const cardId of extra) s = addCard(s, deps, cardId, { force: true }).state;
  for (const n of lost) s = recordBossFight(s, 'main', n, false);
  return s;
}
const uidOf = (s, cardId, k = 0) => s.cards.filter((c) => c.cardId === cardId)[k].uid;
const putInDeck = (s, cardId, slot, k = 0) => { const deck = s.deck.map((u) => (u === uidOf(s, cardId, k) ? null : u)); deck[slot] = uidOf(s, cardId, k); return { ...s, deck }; };
const route = (id, params = {}) => ({ id, params });

/** Fight the boss of main quest n with the given deck (card ids by slot) on the real engine. */
function bossFight(n, deckIds, level = 1) {
  let s = defaultState(T0, 99);
  s = { ...s, player: { ...s.player, level: 2, deckSlots: 5 }, quests: { ...s.quests, main: { unlocked: n, done: n - 1, firstWins: [] } } };
  deckIds.forEach((id, i) => {
    if (!id) return;
    const [cardId, stage] = id.split('+');
    const r = addCard(s, deps, cardId, { force: true, stage: Number(stage) || 0, level });
    s = r.state;
    const deck = s.deck.slice(); deck[i] = r.uid; s = { ...s, deck };
  });
  s = Q.startQuest(s, deps, T0, { line: 'main', n }).state;
  s = { ...s, quests: { ...s.quests, active: { ...s.quests.active, bossReady: true } } };
  return Q.fightBoss(s, deps, T0, {});
}

/* ------------------------------------------------------------------ record and migration */

test('saves without a tutorial record (every save before round 3) count as finished: no hints, no lines, no name prompt', () => {
  const old = migrate({ player: { name: 'Old', level: 7 }, tutorial: { step: 0, seen: ['arena'] } }, T0);
  const t = tutorialOf(old);
  assert.equal(t.done, true);
  assert.equal(t.named, true);
  assert.equal(isTutorialActive(old), false);
  assert.equal(needsName(old), false);
  assert.deepEqual(hintFor(old, route('quest-map')), { text: null, hand: null });
  assert.equal(Q.guideLine(old), null);
  assert.equal(Q.guideLine(old, { lastLoss: true }), null);
  assert.equal(recordBossFight(old, 'main', 1, false), old);
  assert.equal(markSeen(old, 'x'), old);
  assert.equal(tutorialOf(null).done, true);
  assert.equal(isTutorialActive(defaultState(T0, 1)), false);
  // such a save keeps the level unlocks (fusion 2, arena 4, training 5, league 6)
  const lv = (level) => ({ ...old, player: { ...old.player, level } });
  assert.equal(isUnlocked(lv(4), 'arena'), true);
  assert.deepEqual(featuresUnlockedAt(2, lv(2)), ['fusion']);
});

test('newTutorialGame (tutorial-v2 §1): user-<digits>, the Envoy alone in slot 3, 200 gold, 0 gems, slots 2-3 open; survives migrate', () => {
  const s = newTutorialGame(4242, T0, deps);
  assert.match(s.player.name, /^user-\d{7}$/);
  assert.equal(s.player.name, defaultPlayerName(4242));
  assert.equal(s.player.gold, 200);
  assert.equal(s.player.gems, 0);
  assert.deepEqual(s.cards.map((c) => c.cardId), ['envoy']);
  assert.equal(s.deck[2], s.cards[0].uid);
  assert.deepEqual(openSlots(s), [1, 2]);
  assert.deepEqual({ ...tutorialOf(s) }, { intro: true, lost: [], seen: [], named: false, done: false });
  assert.equal(needsName(s), true);
  const round = migrate(JSON.parse(JSON.stringify(s)), T0);
  assert.equal(isTutorialActive(round), true, 'the record survives save + load');
  assert.deepEqual(round.cards.map((c) => c.cardId), ['envoy']);
  assert.equal(isTutorialActive(startTutorial(defaultState(T0, 1))), true);
});

test('recordBossFight: losses are remembered once; the tutorial ends after the final quest (10) with the first League visit', () => {
  let s = newTutorialGame(1, T0, deps);
  s = recordBossFight(s, 'main', 2, false);
  s = recordBossFight(s, 'main', 2, false);
  assert.deepEqual(tutorialOf(s).lost, [2]);
  assert.equal(recordBossFight(s, 'dragon-hunt', 2, false), s, 'portal fights are not tutorial fights');
  assert.equal(recordBossFight(s, 'main', FINAL_QUEST, true), s, 'Q10 itself does not end it (the League visit does)');
  assert.equal(isTutorialActive(recordBossFight(s, 'main', FINAL_QUEST + 1, true)), false);
  assert.equal(FINAL_QUEST, 10);
  assert.deepEqual(tutorialOf(markSeen(newTutorialGame(1, T0, deps), 'a')).seen, ['a']);
});

/* ------------------------------------------------------------------ scripted quest data (game layer) */

test('quest 1: the 2nd minion drops the Master Brewer soul card into deck slot 2; no random wave cards', () => {
  let s = newTutorialGame(7, T0, deps);
  s = Q.startQuest(s, deps, T0, { line: 'main', n: 1 }).state;
  const taps = [];
  for (let i = 0; i < 5; i++) { const r = Q.tapMinion(s, deps, T0, {}); s = r.state; taps.push(r); }
  assert.equal(taps[0].soulCard, null);
  assert.deepEqual({ ...taps[1].soulCard, uid: 'x' }, { type: 'card', cardId: 'master-brewer', stage: 0, level: 1, uid: 'x', soul: true, slot: 1 });
  assert.equal(s.deck[1], taps[1].soulCard.uid);
  assert.ok(taps.every((r) => !r.reward || r.reward.type !== 'card'), 'no random card drops in the tutorial quests');
  assert.equal(s.player.stamina, 40, '5 minions x 2 stamina');
  assert.equal(s.player.gold, 240, '6 gold per minion + 10 at the end');
  // a save that already owns a Master Brewer gets none
  let t = game({ extra: ['master-brewer'] });
  t = Q.startQuest(t, deps, T0, { line: 'main', n: 1 }).state;
  t = Q.tapMinion(t, deps, T0, {}).state;
  assert.equal(Q.tapMinion(t, deps, T0, {}).soulCard, null);
  for (let n = 1; n <= 10; n++) assert.equal(node(n).waveCards, false, `Q${n}`);
});

test('boss fights on the real engine follow the video: Q1 won with Master Brewer + Envoy, Q2 lost with them, won with the Throat-Cutter', () => {
  assert.equal(bossFight(1, [null, 'master-brewer', 'envoy']).won, true);
  assert.equal(bossFight(2, [null, 'master-brewer', 'envoy']).won, false);
  assert.equal(bossFight(2, [null, 'master-brewer', 'throat-cutter']).won, true);
  assert.equal(bossFight(3, [null, 'master-brewer', 'throat-cutter', 'envoy']).won, true);
  assert.equal(bossFight(4, [null, 'master-brewer', 'throat-cutter+1', 'envoy']).won, true);
  assert.equal(bossFight(5, [null, 'falconer', 'throat-cutter+1', 'master-brewer', 'envoy'], 2).won, true);
  const q1 = bossFight(1, [null, 'master-brewer', 'envoy']);
  assert.deepEqual(q1.lineup.cards.map((c) => c && c.cardId), [null, 'throat-cutter', 'throat-cutter', null, null]);
  assert.equal(q1.lineup.player.name, 'Worm Shaman');
  assert.equal(q1.reward.cardId, 'throat-cutter');
  const q3 = bossFight(3, [null, 'master-brewer', 'throat-cutter', 'envoy']);
  assert.deepEqual(q3.lineup.cards.map((c) => c && c.cardId), [null, 'throat-cutter', 'lurking-goblin', 'throat-cutter', null]);
  const q5 = bossFight(5, [null, 'falconer', 'throat-cutter+1', 'master-brewer', 'envoy'], 2);
  assert.deepEqual(q5.lineup.cards.map((c) => c && c.cardId), [null, 'throat-cutter', 'worm-shaman', 'pouch-tearer', 'throat-cutter']);
  assert.ok(q5.lineup.cards.every((c) => !c || c.level === 1), 'level-1 boss cards');
});

test('quests 1-10: boss names, HP and first-win rewards of the video (tutorial-v2 §10 items 8-9)', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => node(n).bossName), Array(5).fill('Worm Shaman'));
  assert.deepEqual([6, 7, 8, 9].map((n) => node(n).bossName), Array(4).fill('???'));
  assert.equal(node(10).bossName, 'Succubus');
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => node(n).boss),
    ['throat-cutter', 'bone-breaker', 'lurking-goblin', 'flinger', 'worm-shaman', 'blood-spitter', 'club-swinger', 'tribe-avenger', 'ugluk-maggot-eater', 'succubus']);
  const reward = (n) => node(n).rewardCard || node(n).firstWinReward;
  assert.deepEqual([1, 3, 4, 5, 7, 9, 10].map((n) => node(n).rewardCard), ['throat-cutter', 'throat-cutter', 'falconer', 'worm-shaman', 'gremlin', 'pouch-tearer', 'bone-breaker']);
  assert.deepEqual([reward(2), reward(6), reward(8)], [{ type: 'gold', gold: 50 }, { type: 'piece', cardId: 'club-swinger' }, { type: 'gold', gold: 100 }]);
  assert.equal(node(5).showdown, true);
  assert.equal(node(10).showdown, true);
  for (let n = 1; n <= 10; n++) for (const id of [node(n).boss, ...(node(n).bossCardIds || []), node(n).rewardCard].filter(Boolean)) assert.ok(db.get(id), id);
});

test('unlocks of a tutorial game follow the boss wins: slots after Q2/Q4/Q7, fusion Q3, Arena Q8, training Q9, League Q10', () => {
  const at = (wins, level = 1) => game({ wins, level });
  assert.deepEqual(openSlots(at([1, 2])), [1, 2, 3]);
  assert.deepEqual(openSlots(at([1, 2, 3, 4])), [1, 2, 3, 4]);
  assert.deepEqual(openSlots(at([1, 2, 3, 4, 5, 6, 7])), [0, 1, 2, 3, 4]);
  assert.equal(isUnlocked(at([1, 2], 2), 'fusion'), false, 'level 2 alone does not open fusion');
  assert.equal(isUnlocked(at([1, 2, 3], 2), 'fusion'), true);
  assert.equal(isUnlocked(at([1, 2, 3, 4, 5, 6, 7], 4), 'arena'), false);
  assert.equal(isUnlocked(at([1, 2, 3, 4, 5, 6, 7, 8], 4), 'arena'), true);
  assert.equal(isUnlocked(at([1, 2, 3, 4, 5, 6, 7, 8], 4), 'pieces'), true);
  assert.equal(isUnlocked(at([1, 2, 3, 4, 5, 6, 7, 8, 9], 4), 'training'), true);
  assert.equal(isUnlocked(at([1, 2, 3, 4, 5, 6, 7, 8, 9], 5), 'league'), false);
  assert.equal(isUnlocked(at([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5), 'league'), true);
  // no unlock popup with the level-up dialog; the map shows it after the win
  assert.deepEqual(featuresUnlockedAt(2, at([1])), []);
  const s3 = at([1, 2, 3], 2);
  assert.deepEqual(pendingUnlocks(s3).show.map((u) => u.id), ['fusion', 'cardslot3']);
  assert.deepEqual(pendingUnlocks(at([1, 2, 3, 4, 5, 6, 7, 8], 4)).show.map((u) => u.id).filter((id) => id === 'arena'), ['arena']);
});

/* ------------------------------------------------------------------ the step script, screen by screen */

test('§1 quest 1: node 1 sparkles on the map (hand after 2 s), "Smite them!" until the 1st tap, "Avenge the village!" on Attack!', () => {
  const s = game();
  assert.deepEqual(hintFor(s, route('quest-map', { line: 'main' })), { text: null, hand: { tap: TARGETS.mapNode(1), sparkle: true, delay: HAND_DELAY } });
  assert.equal(HAND_DELAY, 2000);
  assert.equal(hintFor(s, route('quest-map', { feed: true })).hand.tap, TARGETS.feedQuest);
  assert.equal(Q.guideLine(s), "Don't let it end like this! Follow him to his lair....");
  const q = (figuresDone) => ({ quest: { line: 'main', n: 1, figuresDone } });
  assert.deepEqual(hintFor(s, route('quest', { line: 'main', quest: 1 }), q(0)), { text: 'smite', position: 'bottom', hand: { tap: TARGETS.minion, delay: HAND_DELAY } });
  assert.equal(hintFor(s, route('quest', { line: 'main', quest: 1 }), q(1)).text, null);
  const pre = hintFor(s, route('prebattle', { mode: 'quest', line: 'main', quest: 1 }));
  assert.equal(pre.text, 'avenge');
  assert.equal(pre.hand.tap, TARGETS.attack);
  assert.equal(hintFor(s, route('prebattle', { mode: 'arena', quest: 1 })).text, null);
  // no lines during the won Q1 fight; "The Shaman has fled!" over the reward
  const fight = (o) => hintFor(s, route('battle'), { battle: { n: 1, line: 'main', mode: 'quest', won: true, elapsed: 3000, resultShown: false, resultElapsed: 0, ...o } });
  assert.equal(fight({}).text, null);
  assert.equal(fight({ resultShown: true, resultElapsed: 3000 }).text, 'shamanFled');
  assert.equal(Q.guideLine(game({ wins: [1] })), 'I think he went this way! After him!');
});

test('§2 quest 2 lost: "That card is tough!" + Cards sparkle, the arrow drags the Throat-Cutter onto the Envoy, then back to quest 2', () => {
  let s = game({ wins: [1], extra: ['master-brewer', 'throat-cutter'] });
  s = putInDeck(s, 'master-brewer', 1);
  assert.equal(pendingLesson(tutorialFacts(s)), null, 'nothing before the loss');
  s = recordBossFight(s, 'main', 2, false);
  assert.equal(Q.guideLine(s), 'That card is tough! You need a stronger deck.');
  assert.deepEqual(hintFor(s, route('quest-map', { line: 'main' })).hand, { tap: TARGETS.nav('cards'), sparkle: true, delay: HAND_DELAY });
  const cards = hintFor(s, route('cards'), { cardsTab: 'deck' });
  assert.equal(cards.text, 'throatCutterStronger');
  assert.deepEqual(cards.hand.drag, { from: TARGETS.sliderCard(uidOf(s, 'throat-cutter')), to: TARGETS.slot(2) });
  assert.equal(hintFor(s, route('cards'), { cardsTab: 'fusion' }).hand.tap, TARGETS.modeTab('deck'));
  s = putInDeck(s, 'throat-cutter', 2);
  const after = hintFor(s, route('cards'), { cardsTab: 'deck' });
  assert.equal(after.text, 'beatBoneBreaker');
  assert.equal(after.hand.tap, TARGETS.nav('quest'));
  assert.equal(Q.guideLine(s), null);
  assert.equal(hintFor(s, route('quest-map', { line: 'main' })).hand.tap, TARGETS.mapNode(2));
  const retry = (elapsed) => hintFor(s, route('battle'), { battle: { n: 2, line: 'main', mode: 'quest', won: true, elapsed, resultShown: false, resultElapsed: 0 } });
  assert.equal(retry(3000).text, 'nextVictory');
  // the first, lost fight is already in the record when the battle opens: no line there (lostBefore false)
  const first = hintFor(s, route('battle'), { battle: { n: 2, line: 'main', mode: 'quest', won: false, lostBefore: false, elapsed: 3000, resultShown: false, resultElapsed: 0 } });
  assert.equal(first.text, null);
  assert.equal(line('nextVictory').speaker, 'shaman');
});

test('§2.12 a new deck slot: Cards sparkle, then the arrow from the spare card to the open slot, once', () => {
  let s = game({ wins: [1, 2], extra: ['master-brewer', 'throat-cutter'] });
  s = putInDeck(putInDeck(s, 'master-brewer', 1), 'throat-cutter', 2);
  const lesson = pendingLesson(tutorialFacts(s, deps));
  assert.deepEqual(lesson, { kind: 'slot', uid: uidOf(s, 'envoy'), toSlot: 3, key: 'slot3' });
  assert.equal(hintFor(s, route('quest-map', { line: 'main' })).hand.tap, TARGETS.nav('cards'));
  const h = hintFor(s, route('cards'), { cardsTab: 'deck', deps });
  assert.deepEqual(h.hand.drag, { from: TARGETS.sliderCard(uidOf(s, 'envoy')), to: TARGETS.slot(3) });
  assert.equal(h.once, 'slot3');
  assert.equal(pendingLesson(tutorialFacts(markSeen(s, 'slot3'))), null);
  assert.equal(pendingLesson(tutorialFacts(putInDeck(s, 'envoy', 3))), null);
});

test('§3 fusion after the quest-3 win: fusion tab sparkle, "Fuse identical cards ..." with the arrow to Slot 1, then to Slot 2, then OK', () => {
  let s = game({ wins: [1, 2, 3], level: 2, extra: ['master-brewer', 'throat-cutter', 'throat-cutter'] });
  s = putInDeck(putInDeck(putInDeck(s, 'master-brewer', 1), 'throat-cutter', 2), 'envoy', 3);
  assert.equal(pendingLesson(tutorialFacts(s)).kind, 'fusion');
  assert.equal(hintFor(s, route('cards'), { cardsTab: 'deck' }).hand.tap, TARGETS.modeTab('fusion'));
  const step1 = hintFor(s, route('cards'), { cardsTab: 'fusion', zones: {} });
  assert.equal(step1.text, 'fuseGuide');
  assert.equal(step1.hand.drag.to, TARGETS.zone('fuse1'));
  const a = uidOf(s, 'throat-cutter', 0);
  const b = uidOf(s, 'throat-cutter', 1);
  const step2 = hintFor(s, route('cards'), { cardsTab: 'fusion', zones: { fuse1: a } });
  assert.equal(step2.text, 'fuseSecond');
  assert.deepEqual(step2.hand.drag, { from: TARGETS.sliderCard(b), to: TARGETS.zone('fuse2') });
  assert.equal(line('fuseSecond').speaker, 'box');
  assert.deepEqual(hintFor(s, route('cards'), { cardsTab: 'fusion', zones: { fuse1: a, fuse2: b } }).hand, { tap: TARGETS.fusionOk });
  // fused: done
  const fused = { ...s, cards: s.cards.map((c) => (c.uid === a ? { ...c, stage: 1 } : c)).filter((c) => c.uid !== b) };
  assert.equal(pendingLesson(tutorialFacts(fused)), null);
  // before the quest-3 win nothing (level 2 is reached in quest 3)
  assert.notEqual((pendingLesson(tutorialFacts(game({ wins: [1, 2], level: 2, extra: ['throat-cutter', 'throat-cutter'] }))) || {}).kind, 'fusion');
});

test('§4-§6 quest screen and pre-battle lines: the Shaman on quest 5, showdown lines, the rune, the card piece, the Arena', () => {
  const s4 = game({ wins: [1, 2, 3, 4] });
  assert.equal(hintFor(s4, route('quest', { line: 'main', quest: 5 }), { quest: { line: 'main', n: 5, figuresDone: 0 } }).text, 'noMoreRunning');
  assert.equal(line('noMoreRunning').speaker, 'shaman');
  assert.equal(hintFor(s4, route('prebattle', { mode: 'quest', line: 'main', quest: 5 })).text, 'looksDeadly');
  assert.equal(hintFor(recordBossFight(s4, 'main', 5, false), route('prebattle', { mode: 'quest', line: 'main', quest: 5 })).text, 'wrongOrder');
  const won = (n, resultElapsed) => hintFor(s4, route('battle'), { battle: { n, line: 'main', mode: 'quest', won: true, elapsed: 9000, resultShown: true, resultElapsed } }).text;
  assert.equal(won(5, 500), 'didIt');
  assert.equal(won(6, 3000), 'mightyPiece');
  assert.equal(Q.guideLine(game({ wins: [1, 2, 3, 4, 5] })), "A rune has been branded onto the Shaman's hand. Who sent him to burn your town?");
  const s5 = game({ wins: [1, 2, 3, 4, 5] });
  assert.equal(hintFor(s5, route('prebattle', { mode: 'quest', line: 'main', quest: 6 })).text, 'uglyThing');
  assert.equal(Q.guideLine(game({ wins: [1, 2, 3, 4, 5, 6] })), 'We must go to the Arena to complete cards!');
  assert.equal(Q.guideLine(game({ wins: [1, 2, 3, 4, 5, 6, 7] })), 'I can see the Arena in the south!');
  assert.equal(hintFor(game({ wins: [1, 2, 3, 4, 5, 6, 7] }), route('prebattle', { mode: 'quest', line: 'main', quest: 8 })).text, 'tribeAvenger');
});

test('§7 the Arena after quest 8: Arena sparkle, Pieces tab, "Defeat this amateur mage ..." on the piece, then the steal warning once', () => {
  const s = game({ wins: [1, 2, 3, 4, 5, 6, 7, 8], level: 4 });
  assert.equal(Q.guideLine(s), 'Time to finish the Club Swinger!');
  assert.equal(arenaLesson(tutorialFacts(s)), 'go');
  assert.equal(hintFor(s, route('quest-map', { line: 'main' })).hand.tap, TARGETS.nav('arena'));
  assert.equal(hintFor(s, route('arena'), { arenaTab: 'arena' }).hand.tap, TARGETS.arenaTab('pieces'));
  const pieces = hintFor(s, route('arena'), { arenaTab: 'pieces' });
  assert.equal(pieces.text, 'amateurMage');
  assert.equal(pieces.hand.tap, TARGETS.pieceAttack('club-swinger'));
  assert.equal(hintFor(s, route('prebattle', { mode: 'pieces' })).text, 'hidesCards');
  const done = game({ wins: [1, 2, 3, 4, 5, 6, 7, 8], level: 4, extra: ['club-swinger'] });
  assert.equal(Q.guideLine(done), null);
  const steal = hintFor(done, route('arena'), { arenaTab: 'pieces' });
  assert.deepEqual([steal.text, steal.once], ['stealPieces', 'steal']);
  assert.equal(hintFor(markSeen(done, 'steal'), route('arena'), { arenaTab: 'pieces' }).text, null);
});

test('§8-§9 training after quest 9 and the League after quest 10', () => {
  let s = game({ wins: [1, 2, 3, 4, 5, 6, 7, 8, 9], level: 4, extra: ['club-swinger', 'gremlin'] });
  s = markSeen(markSeen(s, 'steal'), 'slot5');
  assert.equal(hintFor(s, route('quest', { line: 'main', quest: 9 }), { quest: { line: 'main', n: 9, figuresDone: 0 } }).text, null, 'quest 9 already won');
  const q9 = game({ wins: [1, 2, 3, 4, 5, 6, 7, 8], level: 4, extra: ['club-swinger'] });
  assert.equal(hintFor(q9, route('quest', { line: 'main', quest: 9 }), { quest: { line: 'main', n: 9, figuresDone: 0 } }).text, 'strangeTracks');
  assert.equal(pendingLesson(tutorialFacts(s, deps)).kind, 'training');
  assert.equal(hintFor(s, route('cards'), { cardsTab: 'deck', deps }).hand.tap, TARGETS.modeTab('training'));
  const t1 = hintFor(s, route('cards'), { cardsTab: 'training', zones: {}, deps });
  assert.equal(t1.text, 'trainGuide');
  assert.deepEqual(t1.hand.drag, { from: TARGETS.sliderCard(uidOf(s, 'club-swinger')), to: TARGETS.zone('train') });
  const t2 = hintFor(s, route('cards'), { cardsTab: 'training', zones: { train: uidOf(s, 'club-swinger') }, deps });
  assert.deepEqual(t2.hand.drag, { from: TARGETS.sliderCard(uidOf(s, 'gremlin')), to: TARGETS.zone('stack') });
  assert.deepEqual(hintFor(s, route('cards'), { cardsTab: 'training', zones: { train: uidOf(s, 'club-swinger'), stack: 1 }, deps }).hand, { tap: TARGETS.trainingOk });
  assert.equal(pendingLesson(tutorialFacts(markSeen(s, 'trainLesson'))), null);
  // quest 10
  const q10 = markSeen(s, 'trainLesson');
  assert.equal(hintFor(q10, route('quest', { line: 'main', quest: 10 }), { quest: { line: 'main', n: 10, figuresDone: 0 } }).text, 'peasantWomen');
  const fight = (elapsed) => hintFor(q10, route('battle'), { battle: { n: 10, line: 'main', mode: 'quest', won: true, elapsed, resultShown: false, resultElapsed: 0 } }).text;
  assert.deepEqual([fight(2000), fight(5000)], ['demoness', 'wretchedVillage']);
  assert.equal(line('wretchedVillage').speaker, 'succubus');
  const after = markSeen(game({ wins: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], level: 5, extra: ['club-swinger'] }), 'steal');
  assert.equal(hintFor(markSeen(markSeen(after, 'trainLesson'), 'slot5'), route('quest-map', { line: 'main' })).hand.tap, TARGETS.nav('league'));
});

test('fight line tables do not overlap and every id is a known line', () => {
  for (const table of Object.values(FIGHT_LINES)) {
    table.forEach(([a, b, id], i) => {
      assert.ok(a < b, id);
      assert.ok(line(id), id);
      if (i) assert.ok(table[i - 1][1] <= a, id);
    });
  }
});

/* ------------------------------------------------------------------ lines */

test('lines: English client text where it was recorded, the 2016 translations, known speakers, no "Morden", no 2014-only lines', () => {
  for (const l of Object.values(LINES)) assert.ok(SPEAKERS[l.speaker], l.text);
  const texts = Object.values(LINES).map((l) => l.text);
  for (const t of [...texts, ...Object.values(Q.GUIDE_LINES)]) assert.doesNotMatch(t, /Morden|Neophyte token|stat points|Puny minions|fatally wounded|taking your Envoy/i, t);
  assert.equal(line('avenge').text, 'Avenge the village! Unleash your cards!');
  assert.equal(line('throatCutterStronger').text, 'Your Throat-Cutter is stronger than the Envoy.');
  assert.equal(line('tough').text, 'That card is tough! You need a stronger deck.');
  assert.equal(line('follow').text, "Don't let it end like this! Follow him to his lair....");
  assert.equal(line('nope'), null);
  for (const sp of Object.values(SPEAKERS)) if (sp.portrait) assert.ok(existsSync(join(ROOT, sp.portrait.slice(1))), sp.portrait);
  assert.doesNotMatch(readFileSync(join(ROOT, 'src/game/quests.js'), 'utf8'), /Morden/);
});

/* ------------------------------------------------------------------ name prompt */

test('name prompt: loca text and guard portrait, 18 characters, empty keeps the old name, asked until OK', () => {
  const loca = readFileSync(join(ROOT, 'exploration/apk/lua/assets.loca.en.txt'), 'utf8');
  assert.ok(loca.includes(NAME_PROMPT_TEXT), 'the English value of the client key');
  assert.ok(existsSync(join(ROOT, NAME_PORTRAIT.slice(1))));
  assert.equal(NAME_MAX, 18);
  assert.equal(cleanPlayerName('  Gandalf   the  Grey  '), 'Gandalf the Grey');
  assert.equal(cleanPlayerName('a'.repeat(30)).length, 18);
  assert.equal(cleanPlayerName('<b>'), 'b');
  let s = newTutorialGame(9, T0, deps);
  assert.equal(needsName(s), true);
  assert.equal(setPlayerName(s, '   ').player.name, s.player.name);
  s = setPlayerName(s, 'Gorlak');
  assert.equal(s.player.name, 'Gorlak');
  assert.equal(needsName(s), false);
  assert.equal(isTutorialActive(s), true, 'naming does not end the tutorial');
});

/* ------------------------------------------------------------------ opening */

/**
 * Every HP change of the scripted intro fight, in time order (ms from the first round).
 * @returns {{at: number, target: string, hp: number}[]}
 */
function introHpTimeline() {
  const out = [];
  let base = 0;
  for (const r of INTRO_FIGHT.rounds) {
    for (const e of r.events) if (e[1] === 'hp') out.push({ at: base + e[0], target: e[2], hp: e[3] });
    base += r.time;
  }
  return out.sort((a, b) => a.at - b.at);
}

test('opening fight: ported from script_intro_fight.json, the Envoy dies and the player falls to 0 against an untouched Shaman', () => {
  const raw = readJson('exploration/apk/assets/scripts/script_intro_fight.json');
  const cfg = readJson('exploration/apk/assets/scripts/intro_fight_config.json');
  assert.equal(INTRO_FIGHT.enemyName, cfg.enemyName);
  assert.equal(INTRO_FIGHT.rounds.length, raw.visualized.length);
  INTRO_FIGHT.rounds.forEach((r, i) => assert.equal(r.events.length, raw.visualized[i].visualization.length));
  for (const c of [...INTRO_FIGHT.enemyCards, ...INTRO_FIGHT.playerCards].filter(Boolean)) assert.ok(db.get(c.cardId), c.cardId);
  assert.deepEqual(INTRO_FIGHT.enemyCards.map((c) => c && c.cardId), [null, 'throat-cutter', 'flinger', 'lurking-goblin', null]);
  assert.deepEqual(INTRO_FIGHT.playerCards.map((c) => c && c.cardId), [null, null, 'envoy', null, null]);
  const hp = introHpTimeline();
  assert.deepEqual(hp.filter((e) => e.target === 'p').map((e) => e.hp), [1200, 1100, 1000, 800, 500, 400, 300, 200, 0]);
  assert.ok(hp.some((e) => e.target === 'p3' && e.hp === 0), 'the Envoy dies');
  assert.ok(!hp.some((e) => e.target === 'e'), 'the Shaman keeps his 300 HP');
  assert.equal(INTRO_FIGHT.playerMaxHp, 1500);
  assert.equal(INTRO_FIGHT.enemyMaxHp, 300);
  for (const r of INTRO_FIGHT.rounds) for (const e of r.events) if (e[1] === 'sound') assert.ok(INTRO_SOUNDS[e[2]], e[2]);
  for (const list of Object.values(INTRO_SOUNDS)) for (const f of list) assert.ok(existsSync(join(ROOT, `assets/orig/sfx/${f}.mp3`)), f);
  for (const a of ['intro_part1', 'intro_part2', 'bossfight_preview']) assert.ok(existsSync(join(ROOT, `assets/orig/animations/${a}.json`)), a);
  // the boss preview of ctrl_intro_fight: speed 1.2, the Worm Shaman's card in the template slot
  assert.equal(PREVIEW_SPEED, 1.2);
  assert.ok(db.get(PREVIEW_CARD));
  assert.deepEqual(readJson('assets/orig/animations/bossfight_preview.json').templates, { baseCard: 3 });
});

test('opening lore: full English loca values, captions in order inside intro_part1, "Skip intro"', () => {
  const loca = readFileSync(join(ROOT, 'exploration/apk/lua/assets.loca.en.txt'), 'utf8');
  for (const l of INTRO_LORE) assert.ok(loca.includes(l), l);
  const part1 = readJson('assets/orig/animations/intro_part1.json');
  LORE_TIMES.forEach(([a, b], i) => {
    assert.ok(a < b && b <= part1.duration, `caption ${i}`);
    if (i) assert.ok(LORE_TIMES[i - 1][1] <= a);
  });
  assert.equal(SKIP_INTRO, 'Skip intro');
});

/* ------------------------------------------------------------------ overlay */

test('overlay: drag arrow geometry, the sparkle frames', () => {
  assert.deepEqual(arrowGeometry({ x: 0, y: 0 }, { x: 0, y: 100 }), { length: 100, angle: 0 });
  assert.equal(Math.round(arrowGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }).angle), -90);
  assert.equal(Math.round(Math.abs(arrowGeometry({ x: 0, y: 100 }, { x: 0, y: 0 }).angle)), 180);
  for (const f of SPARKLE_FRAMES) assert.ok(existsSync(join(ROOT, `assets/orig/ui/${f}.png`)), f);
  assert.ok(slotUnlocked(newTutorialGame(1, T0, deps), 2));
});

describe('playtest fixes (the 2026-10-09 clock)', () => {
  const T0 = Date.UTC(2026, 9, 9, 12, 0, 0);

  test('no daily event while the tutorial runs; the calendar and finished / old saves keep it', () => {
    const s = newTutorialGame(5, T0, deps);
    assert.equal(inTutorial(s), true);
    assert.equal(dailyEvent(T0, s), null);
    assert.ok(dailyEvent(T0), 'without a save: the event of the day');
    const done = patchTutorial(s, { done: true });
    assert.equal(inTutorial(done), false);
    assert.deepEqual(dailyEvent(T0, done), dailyEvent(T0));
    const old = defaultState(T0, 1);
    assert.equal(inTutorial(old), false);
    assert.deepEqual(dailyEvent(T0, old), dailyEvent(T0));
  });

  test('no event in the shop offers or the landing feed of a tutorial save; a finished tutorial gets the event back', () => {
    const s = newTutorialGame(5, T0, deps);
    // a day with a shop-visible event (the Great Potion Deal) so the potion deal would show without the guard
    let day = T0;
    while (dailyEvent(day).id !== 'great-potion-deal') day += 24 * 3600 * 1000;
    const tut = { ...s, createdAt: day };
    const offers = shopOffers(tut, deps, day);
    assert.equal(offers.event, null);
    assert.equal(offers.potionDeal, null);
    assert.ok(!feedBanners(tut, deps, day).some((b) => b.kind === 'event'));
    const done = patchTutorial(tut, { done: true });
    assert.equal(shopOffers(done, deps, day).event.id, 'great-potion-deal');
    assert.ok(shopOffers(done, deps, day).potionDeal);
    assert.ok(feedBanners(done, deps, day).some((b) => b.kind === 'event'));
  });

  test('quests 1-10 pay flat gold per tap (no random bursts): both runs of quest 2 pay the same, like the video', () => {
    for (let n = 1; n <= 10; n++) assert.equal(node(n).burstChance, 0, `Q${n}`);
    const run = (seed) => {
      let s = newTutorialGame(seed, T0, deps);
      s = { ...s, quests: { ...s.quests, main: { unlocked: 2, done: 1, firstWins: [1] } } };
      s = Q.startQuest(s, deps, T0, { line: 'main', n: 2 }).state;
      const g0 = s.player.gold;
      while (!s.quests.active.bossReady) { const r = Q.tapMinion(s, deps, T0, {}); assert.equal(r.burst, 0); s = r.state; }
      return s.player.gold - g0;
    };
    assert.deepEqual([run(1), run(2), run(3)], [108, 108, 108]);
    assert.ok(TAP_GOLD_COUNT.steps >= 1);
  });

  test('Q9 has no tribe bonus (1400 HP in the video: "these tracks aren\'t only from orcs"), Q8 and Q10 keep theirs', () => {
    const cardsOf = (n) => [node(n).boss, ...node(n).bossCardIds].map((id) => db.get(id));
    assert.equal(hasTribeBonus(cardsOf(9)), false);
    assert.equal(hasTribeBonus(cardsOf(8)), true);
    assert.equal(hasTribeBonus(cardsOf(10)), true);
  });

  test('the tutorial piece is held by the scripted "amateur mage" Baltasar, raids leave it alone; other saves use the pool', () => {
    let s = newTutorialGame(9, T0, deps);
    s = P.addPiece(s, deps, T0, P.TUTORIAL_PIECE).state;
    const i = P.huntIndex(s, P.TUTORIAL_PIECE);
    assert.equal(s.pieces[i].holderId, TUTORIAL_HOLDER.id);
    const info = simInfo(getSim(s, TUTORIAL_HOLDER.id), deps);
    assert.deepEqual([info.name, info.level, info.quests, info.battlesWon, info.hp], ['Baltasar', 2, 2, 0, 1500]);
    assert.equal(TUTORIAL_HOLDER.deck.filter(Boolean).length, 3);
    // skipping the holder keeps him during the tutorial
    s = { ...s, player: { ...s.player, gems: 50 } };
    assert.equal(P.skipHolder(s, deps, T0, i).pieces[i].holderId, TUTORIAL_HOLDER.id);
    // raids: never the tutorial piece
    const raided = P.dailyRaids({ ...s, settings: { ...s.settings, raids: true } }, deps, T0 + 3 * 86400000);
    assert.deepEqual(raided.stolen, []);
    assert.equal(raided.state.pieces[i].owned, 1);
    // a finished tutorial: a pool player
    const after = P.addPiece(patchTutorial(newTutorialGame(9, T0, deps), { done: true }), deps, T0, P.TUTORIAL_PIECE).state;
    assert.notEqual(after.pieces[0].holderId, TUTORIAL_HOLDER.id);
  });

  test('in-fight lines: the Shaman in round 2 of the quest-2 retry, the ranger and the Succubus as quest 10 starts; not on replays', () => {
    let s = newTutorialGame(3, T0, deps);
    s = recordBossFight(s, 'main', 2, false);
    // the retry has been won when the battle opens: the save holds the first win already
    s = { ...s, quests: { ...s.quests, main: { unlocked: 3, done: 2, firstWins: [1, 2] } } };
    const b = (o) => ({ n: 2, line: 'main', mode: 'quest', won: true, wonBefore: false, lostBefore: true, elapsed: 9000, resultShown: false, resultElapsed: 0, ...o });
    assert.equal(FIGHT_LINE_ROUND.q2Retry, 2);
    assert.equal(hintFor(s, route('battle'), { battle: b({ sinceRound: { 1: 5000 } }) }).text, null, 'not in round 1');
    assert.equal(hintFor(s, route('battle'), { battle: b({ sinceRound: { 1: 6000, 2: 1000 } }) }).text, 'nextVictory');
    assert.equal(hintFor(s, route('battle'), { battle: b({ sinceRound: { 2: FIGHT_LINES.q2Retry[0][1] + 10 } }) }).text, null);
    assert.equal(hintFor(s, route('battle'), { battle: b({ lostBefore: false, sinceRound: { 2: 1000 } }) }).text, null, 'the first, lost fight');
    // quest 10: from round 1, only before the first win
    const q10 = (o) => hintFor(s, route('battle'), { battle: { n: 10, line: 'main', mode: 'quest', won: true, wonBefore: false, resultShown: false, resultElapsed: 0, elapsed: 0, ...o } }).text;
    assert.equal(q10({ sinceRound: {} }), null, 'before ROUND 1');
    assert.equal(q10({ sinceRound: { 1: 1000 } }), 'demoness');
    assert.equal(q10({ sinceRound: { 1: 5000, 2: 100 } }), 'wretchedVillage');
    assert.equal(q10({ wonBefore: true, sinceRound: { 1: 1000 } }), null, 'a replay');
    // the reward line of quest 1 only after the first win
    const won1 = (wonBefore) => hintFor(s, route('battle'), { battle: { n: 1, line: 'main', mode: 'quest', won: true, wonBefore, resultShown: true, resultElapsed: 3000, elapsed: 0 } }).text;
    assert.deepEqual([won1(false), won1(true)], ['shamanFled', null]);
  });

  test('text box positions of the video: over the nav ("bottom") except the Quests-button step ("bottom_menu")', () => {
    const s = newTutorialGame(3, T0, deps);
    const h = hintFor(s, route('quest', { line: 'main', quest: 1 }), { quest: { line: 'main', n: 1, figuresDone: 0 } });
    assert.equal(h.position, 'bottom');
    assert.equal(hintFor(s, route('prebattle', { mode: 'quest', line: 'main', quest: 1 })).position, 'bottom');
  });

  test('fusion lesson: on the deck tab the spare copy is turned to the front of the slider (reveal) while the fusion tab sparkles', () => {
    let s = newTutorialGame(3, T0, deps);
    s = { ...s, player: { ...s.player, level: 2 }, quests: { ...s.quests, main: { unlocked: 4, done: 3, firstWins: [1, 2, 3] } } };
    for (const id of ['master-brewer', 'throat-cutter', 'throat-cutter']) s = addCard(s, deps, id, { force: true }).state;
    const tcs = s.cards.filter((c) => c.cardId === 'throat-cutter');
    s = { ...s, deck: [null, s.cards.find((c) => c.cardId === 'master-brewer').uid, tcs[0].uid, s.cards.find((c) => c.cardId === 'envoy').uid, null] };
    s = markSeen(s, 'slot3');
    const h = hintFor(s, route('cards'), { cardsTab: 'deck' });
    assert.equal(h.hand.tap, TARGETS.modeTab('fusion'));
    assert.equal(h.reveal, TARGETS.sliderCard(tcs[1].uid));
  });

  test('the sparkle frames are alpha images (no blend mode needed inside the isolated overlay layer)', () => {
    assert.equal(SPARKLE_BASE, '/assets/ui/tutorial/');
    for (const f of SPARKLE_FRAMES) assert.ok(existsSync(join(ROOT, 'assets/ui/tutorial', `${f}.png`)), f);
    assert.ok(!/mix-blend-mode/.test(readFileSync(join(ROOT, 'css/tutorial.css'), 'utf8').split('.tut-sparkle-frame {')[1].split('}')[0]));
  });

  test('portal quests: an ended portal or a portal below level 8 can not be played; the main line always can', () => {
    const s = defaultState(T0, 4);
    assert.equal(portalBlock(s, deps, T0, 'main'), null);
    const sch = Q.portalSchedule(deps, s.createdAt, T0);
    const other = QUESTS.portals.map((p) => p.id).find((id) => id !== sch.portalId);
    assert.equal(portalBlock(s, deps, T0, other), 'closed');
    assert.equal(portalBlock(s, deps, T0, sch.portalId), 'level');
    assert.equal(portalBlock({ ...s, player: { ...s.player, level: 8 } }, deps, T0, sch.portalId), null);
  });

  test('the whole tutorial without an event on the real engine: Q2 lost then won, Q5 lost unarranged / won arranged, Q8-Q10 won, Baltasar beaten', () => {
    let s = newTutorialGame(4242, T0, deps);
    const uid = (id, k = 0) => s.cards.filter((c) => c.cardId === id)[k].uid;
    const level = (id) => s.cards.find((c) => c.cardId === id).level;
    const put = (id, slot) => { const u = uid(id); const from = s.deck.indexOf(u); const deck = s.deck.slice(); const old = deck[slot]; deck[slot] = u; if (from >= 0) deck[from] = old; s = { ...s, deck }; };
    const play = (n) => {
      s = Q.startQuest(s, deps, T0, { line: 'main', n }).state;
      while (!s.quests.active.bossReady) {
        let r = Q.tapMinion(s, deps, T0, { event: dailyEvent(T0, s) });
        if (r.needsPotion) { s = { ...s, player: { ...s.player, stamina: s.player.staminaMax } }; r = Q.tapMinion(s, deps, T0, {}); }
        s = r.state;
      }
      const r = Q.fightBoss(s, deps, T0, { event: dailyEvent(T0, s) });
      s = r.state;
      if (!r.won) s = recordBossFight(s, 'main', n, false);
      return r.won;
    };
    assert.equal(play(1), true);
    assert.equal(s.player.gold, 240);
    assert.equal(play(2), false);
    put('throat-cutter', s.deck.indexOf(uid('envoy')));
    assert.equal(play(2), true);
    put('envoy', 3);
    assert.equal(play(3), true);
    const tcs = s.cards.filter((c) => c.cardId === 'throat-cutter');
    s = fuse(s, deps, tcs[0].uid, tcs[1].uid, { allowDeck: true }).state;
    assert.equal(play(4), true);
    put('falconer', 4);
    assert.equal(level('master-brewer'), 1, 'Master Brewer is still level 1 before the Q5 fight (video 3:23)');
    assert.equal(play(5), false, 'unarranged');
    put('falconer', 1);
    assert.equal(play(5), true, 'the Falconer moved to slot 2');
    assert.equal(level('master-brewer'), 2, 'level 2 by the Q6 pre-battle (video 3:49)');
    assert.equal(level('falconer'), 1);
    assert.equal(play(6), true);
    assert.equal(level('envoy'), 2, 'the Envoy levels after Q6 (video 4:10)');
    assert.equal(play(7), true);
    assert.equal(level('falconer'), 1, 'Falconer level 1 at the Q8 pre-battle (video 5:27)');
    put('worm-shaman', 0); // the slot lesson's card (the best spare)
    assert.equal(play(8), true, 'Q8 with the enemy order of the video (Tribe Avenger 4th)');
    assert.equal(level('falconer'), 2, 'Falconer level 2 at the Pieces pre-battle (video 6:09)');
    assert.equal(level('master-brewer'), 2);
    const i = P.huntIndex(s, P.TUTORIAL_PIECE);
    const pf = P.fightHolder(s, deps, T0, { index: i, event: dailyEvent(T0, s) });
    assert.equal(pf.won, true);
    assert.equal(pf.completed, true);
    s = pf.state;
    put('club-swinger', s.deck.indexOf(uid('master-brewer'))); // the video puts the completed Club Swinger in the deck
    assert.equal(play(9), true);
    assert.equal(play(10), true);
  });

  test('quest 8 line-up in the order of the video: Bone Breaker, Pouch Tearer, Throat-Cutter+, Tribe Avenger (boss), Pouch Tearer', () => {
    const lineup = Q.bossLineup(node(8), mulberry32(1), db, stats);
    assert.deepEqual(lineup.cards.map((c) => c && c.cardId), ['bone-breaker', 'pouch-tearer', 'throat-cutter', 'tribe-avenger', 'pouch-tearer']);
    assert.equal(lineup.cards[3].isBoss, true);
    assert.equal(lineup.cards[2].stage, 1);
    // other quests keep the boss in the middle
    assert.equal(Q.bossLineup(node(10), mulberry32(1), db, stats).cards[2].cardId, 'succubus');
  });

  test('card XP floor: unfused Common / Standard cards need 105 then 180; fused and Uncommon cards keep the curve', () => {
    const mb = db.get('master-brewer');
    assert.equal(stats.cardXpToNext(mb, 1), 105);
    assert.equal(stats.cardXpToNext(mb, 2), 180);
    assert.equal(stats.cardXpToNext(mb, 7), Math.round(40 * 3 * 7 ** 1.5 / 10), 'the curve takes over (mana 3 from level 7)');
    assert.equal(stats.cardXpToNext(mb, 1, 1), 20, 'fused: the plain curve');
    assert.equal(stats.cardXpToNext(db.get('club-swinger'), 1), 24, 'Uncommon: the plain curve');
  });

  test('album sets of the video: Throat-Cutter is Orc Grunt 1/8, Falconer Elven Novice 2/8 next to the Envoy, Gremlin Arborearch 1/7; the album badge', async () => {
    const Sh = await import('../src/game/shop.js');
    const { navBadges } = await import('../src/ui/components/nav.js');
    let s = newTutorialGame(7, T0, deps);
    const own = (id) => { s = addCard(s, deps, id).state; };
    own('throat-cutter');
    assert.deepEqual(Sh.setProgressFor(s, deps, 'throat-cutter'), { id: 'orc-grunt', name: 'Orc Grunt', owned: 1, total: 8 });
    if (!s.cards.some((c) => c.cardId === 'envoy')) own('envoy');
    own('falconer');
    assert.deepEqual(Sh.setProgressFor(s, deps, 'falconer'), { id: 'elven-novice', name: 'Elven Novice', owned: 2, total: 8 });
    own('gremlin');
    assert.deepEqual(Sh.setProgressFor(s, deps, 'gremlin'), { id: 'arborearch', name: 'Arborearch', owned: 1, total: 7 });
    assert.equal(Sh.setProgressFor(s, deps, 'master-brewer').name, 'Dwarven Apprentice');
    assert.equal(Sh.setProgressFor(s, deps, 'club-swinger'), null, 'Club Swinger is in a later set we do not have');
    // the album "!" badge: owned set cards the album has not shown; showing them clears it
    const helpers = { albumNew: (st) => Sh.albumNewCards(st, deps) };
    assert.equal(navBadges(s, helpers).album, true);
    assert.equal(navBadges(s, helpers).extend, true);
    s = Sh.markAlbumSeen(s, Sh.albumNewCards(s, deps));
    assert.equal(navBadges(s, helpers).album, false);
    assert.equal(Sh.markAlbumSeen(s, ['falconer']), s, 'nothing new: same state');
  });

  test('album badge migration: an old save counts every card it owns as seen', () => {
    const old = { ...defaultState(T0, 1), cards: [{ uid: 'c1', cardId: 'falconer', level: 1, stage: 0, xp: 0 }], collections: { claimed: [] } };
    const m = migrate(old, T0);
    assert.deepEqual(m.collections.seen, ['falconer']);
  });
});

// ================================================================= §9 Tutorial

describe('§9 tutorial', () => {
  // game-design §9 on the shared clock and the stub-engine bundle of tests/fixtures/real.js
  const { T0, deps } = real;

  // DECISIONS D1, tutorial.md §3 items 2 and 11: Envoy (Common 100/100/2) in slot 3, Master Brewer (Standard
  // 100/200/3) in the collection, 200 gold, 0 gems, 50/50, 1500 HP.
  test('starter state: Envoy in the deck, Master Brewer in the collection, 200 gold, 0 gems, 5 + 5 potions (ours; the original gave none)', () => {
    const s = tutorialStart();
    assert.deepEqual(s.cards.map((c) => [c.cardId, db.get(c.cardId).rarity, db.get(c.cardId).mana]), [['envoy', 'common', 2], ['master-brewer', 'standard', 3]]);
    for (const c of s.cards) { assert.equal(c.stage, 0); assert.equal(c.level, 1); assert.equal(c.xp, 0); assert.equal(c.evolveQuality, 1); }
    assert.deepEqual(s.deck.map((u) => (u ? S.getCard(s, u).cardId : null)), [null, null, 'envoy', null, null]);
    assert.equal(C.validateDeck(s, deps()).ok, true);
    assert.equal(S.deckMana(s, deps()), 2);
    assert.deepEqual([s.player.gold, s.player.gems, s.player.staminaPotions, s.player.manaPotions], [200, 0, 5, 5]);
    assert.deepEqual([s.player.stamina, s.player.mana, s.player.hpMax, s.player.level], [50, 50, 1500, 1]);
  });

  test('tutorial milestones: quest 1 costs 10 stamina and pays 40 gold; the 2-card deck fights the Worm Shaman; the first win gives the soul card', () => {
    const d = realDeps();
    let wins = 0;
    for (let seed = 1; seed <= 12; seed++) {
      let s = fz({ ...tutorialStart(d), seed });
      s = fz(C.placeInDeck(s, d, s.cards[1].uid, 1).state);
      s = fz(Q.startQuest(s, d, T0, { line: 'main', n: 1 }).state);
      while (!s.quests.active.bossReady) s = fz(Q.tapMinion(s, d, T0, {}).state);
      assert.equal(s.player.stamina, 40);
      assert.equal(s.player.gold, 240 + (s.cards.length > 2 ? 0 : 0));
      const r = Q.fightBoss(s, d, T0, {});
      assert.ok(r.battle.events.length > 2);
      if (r.won) {
        wins++;
        assert.deepEqual([r.reward.type, r.reward.cardId], ['card', 'throat-cutter']);
        assert.ok(r.state.cards.some((c) => c.cardId === 'throat-cutter'));
      }
    }
    assert.ok(wins >= 6, 'Envoy + Master Brewer should beat quest 1 most of the time: ' + wins + '/12');
  });
});

test('opening fight: drawn with the real fight effects (user request 2026-10-12), the script targets on the board', () => {
  // the Worm Shaman is the defender in the top row, "You" the attacker below; p / e alone are the HP bars
  assert.deepEqual(introTarget('p'), { side: 'attacker', slot: null });
  assert.deepEqual(introTarget('e'), { side: 'defender', slot: null });
  assert.deepEqual(introTarget('p3'), { side: 'attacker', slot: 2 });
  assert.deepEqual(introTarget('e2'), { side: 'defender', slot: 1 });
  assert.equal(MISSILE_MS, 500, 'the bullet flies as long as in a real fight at 1x');
  const src = readFileSync(join(ROOT, 'src/ui/tutorial/opening.js'), 'utf8');
  assert.ok(src.includes("import { createFx, CARD_FX_CLASSES } from '../battle/fx.js'"), 'the real effect primitives');
  for (const prim of ['fx.bullet(', 'fx.hitBurst(', 'fx.playerBurst(', 'fx.flashBar(', 'fx.floatNum(', 'fx.shatter(', "['glow-attack']"]) assert.ok(src.includes(prim), prim);
  assert.ok(!src.includes('energy_sphere') && !src.includes('tf-missile'), 'the orb missiles of the first port are gone');
  const css = readFileSync(join(ROOT, 'css/tutorial.css'), 'utf8');
  assert.ok(!css.includes('.tf-missile') && !css.includes('.tf-damage'), 'their CSS too');
});
