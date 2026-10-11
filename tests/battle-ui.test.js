'use strict';
/**
 * The pure parts of the battle presentation: the post-battle flow (src/ui/screens/battle-result-model.js,
 * DECISIONS D5) and its player level-up hook, the keyframe animation sampler (src/ui/anim-player.js), the skip rule
 * of the battle screen, the boss intro title and the pre-battle deck snapshot; the playtest fixes of the fight and
 * result flow (exploration/research/round5/playtest-*.md: plain digits, the per-round player max-HP raise folded into one
 * silent step, reward token sprites and names, the piece-win loot step, the last portal quest's gold bonus); the
 * gameplay feel of exploration/research/round3/gameplay-feel.md (the lethal-blow finale, the boss piece overlay, the
 * fade-through-black transitions).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  resultKind, rewardAnimName, rewardSounds, rewardIcon, lootOf, xpEntries, levelText, entryLayout, levelUpRows,
  BANNER_MS, XP_STAGGER_MS, tokenName, lootList, pieceProgress, PIECE_CARD_MS,
} from '../src/ui/screens/battle-result-model.js';
import { showPlayerLevelUps } from '../src/ui/screens/battle-result.js';
import { sampleAnim, animSpriteUrl } from '../src/ui/anim-player.js';
import { canSkip, LOADING_MS, SKIP_FROM_QUEST, VEIL_MS } from '../src/ui/screens/battle.js';
import { bossTitle, isShowdown, BOSS_INTRO, BOSS_CARD_BOX } from '../src/ui/screens/boss-intro.js';
import { deckSnapshot } from '../src/ui/screens/prebattle.js';
import { fromEvents, lethalStep, countdownValue, FINALE } from '../src/ui/battle/timeline.js';
import { finalState, initialModel, reduceEvent } from '../src/ui/battle/model.js';
import { plainNumber } from '../src/ui/components/card.js';
import { FADE_MS } from '../src/ui/router.js';
import { vanilla, fight } from './fixtures/cards.js';

const ROOT = new URL('..', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));

/** Minimal deps: XP to the next level = 100 x level, cap 10, stats grow 10 % per level. */
const DEF = { id: 'grunt', name: 'Grunt', tribe: 'orc', base: { attack: 100, hp: 200, ability: 10 } };
const deps = {
  db: { get: (id) => (id === 'grunt' ? DEF : null) },
  stats: {
    cardXpToNext: (def, level) => 100 * level,
    capFor: () => 10,
    statsAt: (def, stage, level) => ({ attack: Math.round(def.base.attack * (1 + 0.1 * (level - 1))), hp: Math.round(def.base.hp * (1 + 0.1 * (level - 1))), ability: def.base.ability + level }),
  },
};

const start = {
  t: 'battleStart', seed: 1,
  attacker: { player: { name: 'A', hp: 5000, maxHp: 5000 }, cards: [null, null, null, null, null] },
  defender: { player: { name: 'D', hp: 5000, maxHp: 5000 }, cards: [null, null, null, null, null] },
};
const raise = (delta, slot) => ({ t: 'buff', side: 'attacker', slot: null, stat: 'maxHp', delta, permanent: false, source: { side: 'attacker', slot, effect: 'raise_player_hp' } });

describe('post-battle flow (battle-result.js)', () => {
  test('result kind, banner and XP timings follow fx_wonlost / bosscardresult', () => {
    assert.equal(resultKind('attacker', 'attacker'), 'victory');
    assert.equal(resultKind('defender', 'attacker'), 'defeat');
    assert.equal(resultKind('draw', 'attacker'), 'draw');
    assert.equal(BANNER_MS, 3660, '660 ms + 3000 ms glow (220 x 3, 1000 x 3)');
    assert.equal(XP_STAGGER_MS, 1000);
  });

  test('loot: quest rewards on a victory, PvP gold even after a defeat, nothing for a lost quest', () => {
    const card = { type: 'card', cardId: 'grunt', uid: 'c9' };
    assert.deepEqual(lootOf({ info: { won: true, reward: card } }), card);
    assert.equal(lootOf({ info: { won: false, reward: null, rewards: { gold: 0 } } }), null);
    assert.deepEqual(lootOf({ mode: 'arena', info: { won: false, rewards: { gold: 120, tournamentPoints: 0 } } }), { type: 'gold', gold: 120 });
    assert.equal(lootOf({ mode: 'league', info: { won: true, points: 150 } }), null);
    assert.equal(lootOf({ info: { reward: { type: 'none' } } }), null);
  });

  test('every reward type has its reward_comp animation, sounds and reward object', () => {
    const cases = [
      [{ type: 'gold', gold: 10 }, 'goldreward', 'quest_reward_gold', 'reward_gold'],
      [{ type: 'gems', gems: 5 }, 'gemreward', 'quest_reward_gem', 'reward_gems'],
      [{ type: 'potion', potion: 'mana' }, 'manapotion', 'quest_reward_potion', 'reward_manapotion'],
      [{ type: 'potion', potion: 'stamina' }, 'staminapotion', 'quest_reward_potion', 'reward_staminapotions'],
      [{ type: 'token', token: 'summoner' }, 'gemreward', 'quest_reward_token', 'reward_token_2'],
      [{ type: 'card', cardId: 'x' }, 'cardreward', 'quest_reward_card', null],
      [{ type: 'card', cardId: 'x', converted: true, gold: 30 }, 'goldreward', 'quest_reward_card_autosell', 'reward_gold'],
      [{ type: 'piece', cardId: 'x' }, 'cardreward', 'quest_reward_card', null],
    ];
    for (const [r, anim, sound, icon] of cases) {
      assert.equal(rewardAnimName(r), anim, r.type);
      assert.equal(rewardSounds(r).show, sound, r.type);
      assert.equal(rewardIcon(r), icon, r.type);
      assert.ok(existsSync(new URL(`assets/orig/animations/${anim}.json`, ROOT)), anim);
      assert.ok(existsSync(new URL(`assets/orig/sfx/${sound}.mp3`, ROOT)), sound);
      if (icon) assert.ok(existsSync(new URL(`assets/orig/ui/${icon}.png`, ROOT)), icon);
    }
  });

  test('XP entries: before / after per deck card, level-ups and max level', () => {
    const before = [
      { uid: 'a', cardId: 'grunt', stage: 0, level: 2, xp: 150 },
      { uid: 'b', cardId: 'grunt', stage: 0, level: 3, xp: 30 },
      { uid: 'c', cardId: 'grunt', stage: 0, level: 10, xp: 0 },
      { uid: 'd', cardId: 'missing', stage: 0, level: 1, xp: 0 },
    ];
    const state = { cards: [
      { uid: 'a', cardId: 'grunt', stage: 0, level: 3, xp: 50 },
      { uid: 'b', cardId: 'grunt', stage: 0, level: 3, xp: 130 },
      { uid: 'c', cardId: 'grunt', stage: 0, level: 10, xp: 0 },
    ] };
    const e = xpEntries(before, state, deps, [{ uid: 'a', from: 2, to: 3 }]);
    assert.equal(e.length, 3, 'unknown cards are left out');
    assert.equal(e[0].levelled, true);
    assert.deepEqual(e[0].levelUp, { uid: 'a', from: 2, to: 3 });
    assert.equal(e[0].from.ratio, 0.75);
    assert.equal(e[0].to.level, 3);
    assert.ok(Math.abs(e[0].to.ratio - 50 / 300) < 1e-9);
    assert.equal(e[1].levelled, false);
    assert.ok(e[1].to.ratio > e[1].from.ratio);
    assert.equal(e[2].to.max, true);
    assert.equal(levelText(e[1].to), 'Level 3');
    assert.equal(levelText(e[2].to), 'Level 10 (MAX)');
  });

  test('entries zigzag like scene_pvp_result_layout: left, right, left, ... 60 client units apart', () => {
    const pos = [0, 1, 2, 3, 4].map(entryLayout);
    assert.deepEqual(pos.map((p) => p.side), ['left', 'right', 'left', 'right', 'left']);
    assert.equal(pos[0].x, 135);
    assert.equal(pos[1].x, 585);
    assert.equal(pos[2].y, 640);
    assert.equal(pos[1].y - pos[0].y, 135);
  });

  test('card level-up rows: level, attack, HP and the skill value (comp_levelup_card)', () => {
    const rows = levelUpRows(deps, { cardId: 'grunt', stage: 0 }, 2, 3);
    assert.deepEqual(rows.map((r) => r.kind), ['level', 'attack', 'hp', 'skill']);
    assert.deepEqual(rows[0], { kind: 'level', from: 2, to: 3 });
    assert.deepEqual(rows[1], { kind: 'attack', from: 110, to: 120 });
    assert.deepEqual(rows[3], { kind: 'skill', from: 12, to: 13 });
  });

  test('the player level-up hook prefers ui.showPlayerLevelUp and keeps the order of the levels', async () => {
    const seen = [];
    await showPlayerLevelUps({ ui: { showPlayerLevelUp: async (lvl) => { seen.push(['player', lvl]); }, showLevelUp: async () => { seen.push(['generic']); } } }, [4, 5]);
    assert.deepEqual(seen, [['player', 4], ['player', 5]]);
    await showPlayerLevelUps({}, [3]); // no ui: nothing to show, no throw
  });
});

describe('keyframe animations (anim-player.js)', () => {
  test('goldreward: the first flash grows to 4.2x and fades out by 433 ms; sprites exist', () => {
    const anim = readJson('assets/orig/animations/goldreward.json');
    const at0 = sampleAnim(anim, 0)[0];
    assert.equal(at0.alpha, 0);
    const mid = sampleAnim(anim, 108)[0];
    assert.ok(mid.alpha > 0.4 && mid.alpha < 0.6, `alpha ${mid.alpha}`);
    assert.ok(mid.xScale > 2 && mid.xScale < 3, `scale ${mid.xScale}`);
    const end = sampleAnim(anim, 500)[0];
    assert.equal(end.alpha, 0);
    assert.equal(end.xScale, 4.2);
    assert.equal(sampleAnim(anim, 600)[0].visible, false, 'past its endVisibility');
    for (const img of anim.images) if (img.src) assert.ok(existsSync(new URL(animSpriteUrl(img.src).slice(1), ROOT)), img.src);
  });

  test('cardreward: the card template ends at 0.444 scale and fades out at the end', () => {
    const anim = readJson('assets/orig/animations/cardreward.json');
    const id = anim.templates.result - 1;
    const s = sampleAnim(anim, 2000)[id];
    assert.ok(Math.abs(s.xScale - 0.444) < 0.01);
    assert.equal(s.alpha, 1);
    assert.equal(sampleAnim(anim, 2633)[id].alpha, 0);
    assert.equal(animSpriteUrl('assets/gfx/hud/cardfx/invulnerable_effec_04.jpg'), '/assets/orig/ui/invulnerable_effec_04.png');
  });
});

describe('battle screen, boss intro, pre-battle', () => {
  test('"Skip fight" first appears at the quest-3 boss; always in PvP, replays and portals', () => {
    assert.equal(SKIP_FROM_QUEST, 3);
    assert.equal(canSkip({ mode: 'quest', quest: 1, line: 'main' }), false);
    assert.equal(canSkip({ mode: 'quest', quest: 2, line: 'main' }), false);
    assert.equal(canSkip({ mode: 'quest', quest: 3, line: 'main' }), true);
    assert.equal(canSkip({ mode: 'quest', quest: 1, line: 'the-dark-beyond' }), true);
    for (const mode of ['arena', 'pieces', 'league', 'replay']) assert.equal(canSkip({ mode }), true, mode);
    assert.ok(LOADING_MS >= 1000 && LOADING_MS <= 2000, 'Attack -> loading dim ~1.5-2 s');
  });

  test('boss intro title: "Boss Fight n", "Showdown!" for the last quest of a chapter', () => {
    const quests = readJson('data/quests.json');
    const d = { quests };
    assert.equal(bossTitle(d, 'main', 4), 'Boss Fight 4');
    // the tutorial's quests 5 and 10 are marked showdown (1.7.0 video)
    assert.equal(bossTitle(d, 'main', 5), 'Showdown!');
    assert.equal(bossTitle(d, 'main', 10), 'Showdown!');
    assert.equal(bossTitle(d, 'main', 9), 'Boss Fight 9');
    const firstEnd = quests.sections[0].to;
    assert.equal(isShowdown(d, 'main', firstEnd), true);
    assert.equal(bossTitle(d, 'main', firstEnd), 'Showdown!');
    const portal = quests.portals[0];
    assert.equal(isShowdown(d, portal.id, portal.nodes[portal.nodes.length - 1].n), true);
    assert.equal(isShowdown(d, portal.id, 1), false);
    assert.equal(isShowdown({}, 'main', 1), false);
    assert.ok(BOSS_INTRO.hold >= 2000 && BOSS_INTRO.hold <= 3500, 'auto-advances, no Continue button');
  });

  test('the pre-battle deck snapshot keeps level and XP of the deck cards in slot order', () => {
    const state = {
      deck: ['u2', null, 'u1', null, null],
      cards: [{ uid: 'u1', cardId: 'a', stage: 1, level: 4, xp: 12 }, { uid: 'u2', cardId: 'b', stage: 0, level: 2, xp: 0 }],
    };
    assert.deepEqual(deckSnapshot(state).map((c) => [c.uid, c.level, c.xp, c.stage]), [['u2', 2, 0, 0], ['u1', 4, 12, 1]]);
  });
});

describe('battle numbers (playtest-battles B2)', () => {
  test('fight numbers are plain digits like the original ("11280", "-5172")', () => {
    assert.equal(plainNumber(11280), '11280');
    assert.equal(plainNumber(-5172), '-5172');
    assert.equal(plainNumber(1103.4), '1103');
    assert.equal(plainNumber(NaN), '-');
  });
});

describe('player max-HP raises (playtest-battles B4)', () => {
  const events = [
    start,
    { t: 'roundStart', round: 1 }, raise(100, 1), raise(100, 3),
    { t: 'roundStart', round: 2 }, raise(-100, 1), raise(100, 3),
    { t: 'battleEnd', winner: 'draw', rounds: 2, attackerHp: 5200, defenderHp: 5000 },
  ];
  test('consecutive raises fold into one step with the net change; the per-round -x/+x pair is silent', () => {
    const buffs = fromEvents(events).filter((s) => s.type === 'buff');
    assert.equal(buffs.length, 2);
    assert.equal(buffs[0].delta, 200);
    assert.equal(buffs[0].events.length, 2);
    assert.equal(buffs[1].delta, 0);
    assert.ok(buffs[1].dur <= 1, 'a net-zero step takes no time');
  });
  test('the folded steps still cover every event and reduce to the final state', () => {
    const steps = fromEvents(events);
    const flat = steps.flatMap((s) => s.events);
    assert.deepEqual(flat, events);
    const model = initialModel(events);
    for (const s of steps) for (const ev of s.events) reduceEvent(model, ev);
    assert.deepEqual(model, finalState(events));
    assert.equal(model.attacker.player.maxHp, 5200);
  });
  test('card max-HP buffs are not folded', () => {
    const card = { t: 'buff', side: 'attacker', slot: 0, stat: 'maxHp', delta: 100 };
    const steps = fromEvents([start, card, { ...card }]).filter((s) => s.type === 'buff');
    assert.equal(steps.length, 2);
  });
});

describe('reward tokens (playtest-portals P2)', () => {
  test('reward_token_3 is the bronze Neophyte disc, _2 the Summoner square, _1 the Archmage hexagon', () => {
    assert.equal(rewardIcon({ type: 'token', token: 'neophyte' }), 'reward_token_3');
    assert.equal(rewardIcon({ type: 'token', token: 'summoner' }), 'reward_token_2');
    assert.equal(rewardIcon({ type: 'token', token: 'archmage' }), 'reward_token_1');
  });
  test('portal tokens have no client sprite (drawn as the shop triangle) and carry the portal token name', () => {
    assert.equal(rewardIcon({ type: 'token', token: 'portalHigh', portalId: 'p' }), null);
    assert.equal(rewardIcon({ type: 'token', token: 'portalLow', portalId: 'p' }), null);
    const deps = { quests: { main: {}, portals: [{ id: 'p', tokens: { low: { name: 'Infinite Void token' }, high: { name: 'Empyrean token' } } }] } };
    assert.equal(tokenName({ type: 'token', token: 'portalHigh', portalId: 'p' }, deps), 'Empyrean token');
    assert.equal(tokenName({ type: 'token', token: 'portalLow', portalId: 'p' }, deps), 'Infinite Void token');
    assert.equal(tokenName({ type: 'token', token: 'portalHigh', portalId: 'gone' }, deps), 'Grand portal token');
    assert.equal(tokenName({ type: 'token', token: 'neophyte' }, deps), 'Neophyte token');
  });
});

describe('loot steps (playtest-pvp 3, playtest-portals P5)', () => {
  test('a won piece fight that does not complete the card shows the piece step', () => {
    const p = { mode: 'pieces', info: { won: true, completed: false, cardId: null, hunt: { cardId: 'incubus', owned: 3, total: 4 } } };
    assert.deepEqual(lootOf(p), { type: 'piece', cardId: 'incubus' });
    assert.equal(lootOf({ mode: 'pieces', info: { won: false, completed: false, hunt: { cardId: 'incubus', owned: 2, total: 4 } } }), null);
    assert.equal(lootOf({ mode: 'pieces', info: { won: true, completed: true, uid: 'c1', cardId: 'incubus', hunt: null } }).type, 'card');
  });
  test('the last portal quest pays its 1000 gold bonus as its own coin step after the token', () => {
    const token = { type: 'token', token: 'portalHigh', portalId: 'p', count: 1 };
    const list = lootList({ info: { won: true, reward: token, bonusGold: 1000 } });
    assert.equal(list.length, 2);
    assert.equal(list[0], token);
    assert.deepEqual(list[1], { type: 'gold', gold: 1000, bonus: true });
    assert.deepEqual(lootList({ info: { won: true, reward: token, bonusGold: 0 } }), [token]);
    assert.deepEqual(lootList({ info: { won: false, reward: null } }), []);
  });
});

describe('lethal-blow finale (battle-player)', () => {
  test('the finale replaces the step that drops the loser to 0 HP or below', () => {
    const { events } = fight([vanilla('Brute', 900, 2000), null, null, null, null], [vanilla('Weakling', 10, 3000), null, null, null, null], { seed: 1, aHp: 1500, dHp: 1000 });
    const end = events.find((e) => e.t === 'battleEnd');
    assert.equal(end.endedBy, 'playerHp');
    const steps = fromEvents(events);
    const i = lethalStep(events, steps);
    assert.ok(i > 0 && i < steps.length - 1, `finale step ${i} of ${steps.length}`);
    const final = finalState(events);
    assert.ok(final.defender.player.hp <= 0, 'the defender loses on HP');
    // before the step the loser is still alive, after it at or below 0
    const before = finalState(steps.slice(0, i).flatMap((s) => s.events));
    const after = finalState(steps.slice(0, i + 1).flatMap((s) => s.events));
    assert.ok(before.defender.player.hp > 0);
    assert.ok(after.defender.player.hp <= 0);
  });

  test('no finale when the fight ends on the round limit', () => {
    const { events } = fight([vanilla('Wall', 0, 5000), null, null, null, null], [vanilla('Wall', 0, 5000), null, null, null, null], { seed: 2, aHp: 1000, dHp: 1000 });
    assert.equal(lethalStep(events), -1);
  });

  test('the count-down eases in from the shown HP to the final value (~1.8 s, reOM 68 -> -1142)', () => {
    assert.equal(FINALE.countMs, 1800);
    assert.equal(countdownValue(68, -1142, 0), 68);
    assert.equal(countdownValue(68, -1142, 1), -1142);
    const mid = countdownValue(68, -1142, 0.5);
    assert.ok(mid < 68 && mid > (68 - 1142) / 2, 'accelerates: less than half the way at half the time');
    assert.equal(countdownValue(10, -50, 2), -50);
  });

  test('invulnerable is a golden glow with sparkles, not the energy sphere', () => {
    for (const f of ['src/ui/battle-player.js', 'src/ui/battle/assets.js']) assert.ok(!/energy_sphere/.test(read(f)), `no energy sphere in ${f}`);
    const css = read('css/battle-fx.css');
    for (const s of ['glowingcard', 'newcardglow', 'parks', 'invulnerable_effec_02']) {
      assert.ok(css.includes(`/assets/orig/ui/${s}.png`), s);
      assert.ok(existsSync(new URL(`assets/orig/ui/${s}.png`, ROOT)), `${s}.png exists`);
    }
  });
});

describe('boss piece reward and flow', () => {
  test('pieceProgress reads the hunt the piece went to', () => {
    const state = { pieces: [{ cardId: 'a', owned: 1, total: 4 }, { cardId: 'armorer', owned: 2, total: 4 }] };
    assert.deepEqual(pieceProgress(state, { cardId: 'armorer', huntIndex: 1 }), { owned: 2, total: 4 });
    assert.deepEqual(pieceProgress(state, { cardId: 'armorer' }), { owned: 2, total: 4 });
    assert.equal(pieceProgress(state, { cardId: 'nope' }), null);
    assert.equal(pieceProgress(null, { cardId: 'a' }), null);
    assert.ok(PIECE_CARD_MS >= 500 && PIECE_CARD_MS <= 2000);
    assert.ok(existsSync(new URL('assets/orig/ui/card_piece_overlay_thumb.png', ROOT)));
  });

  test('the boss card flies into its slot in ~0.35 s; screens fade through black in ~0.7 s', () => {
    assert.equal(BOSS_INTRO.fly, 350);
    assert.equal(BOSS_CARD_BOX.w, 250);
    assert.ok(FADE_MS * 2 >= 600 && FADE_MS * 2 <= 800);
    assert.equal(VEIL_MS, FADE_MS);
  });
});
