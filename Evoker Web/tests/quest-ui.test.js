'use strict';
/**
 * Unit tests for the pure helpers of the quest-map / quest / boss-intro screens that use the original
 * artwork: map layout selection and node coordinates, minion tribe / sprite / backdrop choice, reward
 * sprites, the presence of the generated assets (assets/orig/map, minions, portraits,
 * exploration/apk/data/prepackaged-map.json), and the quest tap / wave-end / card-drop timings of
 * exploration/research/round3/gameplay-feel.md.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import {
  worldForLine, nodeCoords, fitNodes, nodePos, PORTAL_MAPS, CLOUDS, MAP_SCALE, NODE_STEP, MAP_TOP, MAP_VIEW_H,
  mapScale,
} from '../src/ui/screens/quest-map-layout.js';
import { mapBanner, runningPortal } from '../src/ui/screens/quest-portal.js';
import { isFeedView } from '../src/ui/screens/quest-feed.js';
import {
  questTribe, minionSprite, backdropFor, rewardSprite, burstInfo, tapFeedback, miniDeck, PERFECT, DESTROY_SOUNDS,
  MINION_COUNTS, MINION_SLOTS, goldSteps, GOLD_SHOWER, CARD_DROP, TAP_FX,
} from '../src/ui/screens/quest-model.js';
import { newTutorialGame, hintFor } from '../src/ui/tutorial/progress.js';
import { line as tutorialLine } from '../src/ui/tutorial/lines.js';
import { NAMES } from '../src/ui/audio.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ quest map */

const fakeLayout = {
  maps: [
    { index: 0, width: 5236, height: 1790, nodes: Array.from({ length: 100 }, (_, i) => ({ x: 100 + i * 50, y: 300 })), strips: [] },
    { index: 1, width: 2250, height: 2488, nodes: [], strips: [] },
    { index: 2, width: 1500, height: 2954, nodes: [], strips: [] },
    { index: 3, width: 1570, height: 1794, nodes: [], strips: [] },
    { index: 4, width: 2000, height: 1230, nodes: [], strips: [] },
    { index: 5, width: 372, height: 1652, nodes: [], strips: [] },
  ],
};
const portals = ['the-dark-beyond', 'dawn-of-eternity', 'desert-twilight', 'divine-peace', 'dragon-hunt', 'dread-empress', 'dwarven-rage', 'dying-dreams'];

test('worldForLine: main map first, themed portals, others cycle through the portal maps, tiny maps ignored', () => {
  assert.equal(worldForLine(fakeLayout, 'main').index, 0);
  assert.equal(worldForLine(fakeLayout, 'desert-twilight', portals).index, PORTAL_MAPS['desert-twilight']);
  assert.equal(worldForLine(fakeLayout, 'dragon-hunt', portals).index, PORTAL_MAPS['dragon-hunt']);
  const cycled = portals.filter((p) => !PORTAL_MAPS[p]).map((p) => worldForLine(fakeLayout, p, portals).index);
  assert.ok(cycled.every((i) => i >= 1 && i <= 4), `cycled portal maps: ${cycled}`);
  assert.ok(new Set(cycled).size > 1, 'the un-themed portals spread over several maps');
  assert.equal(worldForLine(null, 'main'), null);
  assert.equal(worldForLine({ maps: [] }, 'main'), null);
  assert.equal(worldForLine({ maps: [{ index: 0, width: 372, height: 1652 }] }, 'main'), null);
});

test('nodeCoords: uses the painted sockets when there are enough, else a serpentine inside the map', () => {
  const main = fakeLayout.maps[0];
  const pts = nodeCoords(main, 100);
  assert.equal(pts.length, 100);
  assert.deepEqual(pts[0], { x: 100, y: 300 });
  const portal = fakeLayout.maps[2];
  const fallback = nodeCoords(portal, 25);
  assert.equal(fallback.length, 25);
  for (const p of fallback) {
    assert.ok(p.x >= 0 && p.x <= portal.width, `x inside ${p.x}`);
    assert.ok(p.y >= 0 && p.y <= portal.height, `y inside ${p.y}`);
  }
  // consecutive nodes are never on top of each other
  for (let i = 1; i < fallback.length; i++) {
    const d = Math.hypot(fallback[i].x - fallback[i - 1].x, fallback[i].y - fallback[i - 1].y);
    assert.ok(d > 40, `spacing ${d} between ${i - 1} and ${i}`);
  }
  // too few sockets: the serpentine takes over entirely
  const partial = { width: 2000, height: 1000, nodes: [{ x: 1, y: 1 }] };
  assert.equal(nodeCoords(partial, 10).length, 10);
  assert.notDeepEqual(nodeCoords(partial, 10)[0], { x: 1, y: 1 });
});

test('fitNodes: drops the straightest-through nodes or spreads extra nodes over the longest segments', () => {
  const chain = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 80 }, { x: 300, y: 0 }, { x: 400, y: 0 }];
  // 100,0 lies exactly on the line 0,0 -> 200,80? no: 200,80 deviates most, so a drop removes 100,0 or 300,0
  const four = fitNodes(chain, 4);
  assert.equal(four.length, 4);
  assert.deepEqual(four[0], { x: 0, y: 0 });
  assert.deepEqual(four[3], { x: 400, y: 0 });
  assert.ok(four.some((p) => p.x === 200 && p.y === 80), 'the bend is kept');
  const seven = fitNodes(chain, 7);
  assert.equal(seven.length, 7);
  assert.deepEqual(seven[0], { x: 0, y: 0 });
  assert.deepEqual(seven[6], { x: 400, y: 0 });
  // the two longest segments (0-1 and 3-4 are 100 long, 1-2 and 2-3 are 128 long) got the midpoints
  assert.ok(seven.some((p) => p.x === 150 && p.y === 40));
  assert.ok(seven.some((p) => p.x === 250 && p.y === 40));
  assert.deepEqual(fitNodes(chain, 5), chain);
  assert.equal(fitNodes([{ x: 1, y: 1 }], 3).length, 1);
  // several extra nodes on one long segment are spread evenly (thirds), not stacked midpoints
  const long = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 700, y: 0 }];
  assert.deepEqual(fitNodes(long, 5).map((p) => p.x), [0, 200, 400, 600, 700]);
  // nodeCoords uses the chain when it covers at least 70 % of the quests
  assert.equal(nodeCoords({ width: 1000, height: 500, nodes: chain }, 6).length, 6);
  assert.deepEqual(nodeCoords({ width: 1000, height: 500, nodes: chain }, 6)[0], { x: 0, y: 0 });
});

test('fallback painting keeps the old winding path', () => {
  for (let i = 0; i < 100; i++) {
    const p = nodePos(i);
    assert.ok(p.x >= 100 && p.x <= 620);
    assert.equal(p.y, MAP_TOP + i * NODE_STEP);
  }
  assert.ok(MAP_SCALE > 0.3 && MAP_SCALE <= 1);
  assert.equal(CLOUDS.length, 3);
  for (const c of CLOUDS) assert.ok(existsSync(join(root, 'assets/orig/ui', c.file)), c.file);
});

test('the map fills the screen down to the nav: never drawn shorter than the viewport, every shipped map included', () => {
  assert.equal(MAP_VIEW_H, 1280 - 118 - 136);
  assert.equal(mapScale({ width: 5236, height: 1790 }), MAP_SCALE);
  assert.ok(Math.abs(mapScale({ width: 2000, height: 1000 }) * 1000 - MAP_VIEW_H) < 1e-6);
  assert.equal(mapScale(null), MAP_SCALE);
  const layout = JSON.parse(readFileSync(join(root, 'assets/orig/map/layout.json'), 'utf8'));
  for (const m of layout.maps) assert.ok(Math.round(m.height * mapScale(m)) >= MAP_VIEW_H, `map ${m.index}`);
  const css = readFileSync(join(root, 'css/screens/quest-map.css'), 'utf8');
  assert.ok(!/qm-spacer|qm-archive/.test(css), 'no dark spacer under the map, no archive button');
});

test('map banner: the running portal with its countdown on the main map (tap enters it), the portal itself on its map; no archive', () => {
  const quests = JSON.parse(readFileSync(join(root, 'data/quests.json'), 'utf8'));
  const deps = { quests };
  const T = Date.UTC(2026, 9, 7, 12);
  const week = (quests.portalRotationDays || 7) * 86400000;
  const state = { createdAt: T, quests: { main: { unlocked: 1 }, portals: {}, manualPortal: null } };
  const [p0, p1, p2] = quests.portals;
  const run = runningPortal(state, deps, T + 1000);
  assert.deepEqual([run.portalId, run.name, run.endsAt], [p0.id, p0.name, T + week]);
  assert.deepEqual(run.next, { portalId: p1.id, name: p1.name, startsAt: T + week });
  assert.equal(runningPortal(state, deps, T + week + 1).portalId, p1.id);
  assert.deepEqual(mapBanner(state, deps, T + 1000, 'main'), { name: p0.name, portalId: p0.id, endsAt: T + week, target: p0.id });
  assert.deepEqual(mapBanner(state, deps, T + 1000, p0.id), { name: p0.name, portalId: p0.id, endsAt: T + week, target: null });
  // an ended (or not yet started) portal's map: its name, no countdown, nothing to enter
  assert.deepEqual(mapBanner(state, deps, T + 1000, p2.id), { name: p2.name, portalId: p2.id, endsAt: null, target: null });
  // a manual portal from the removed Portal archive is ignored
  const manual = { ...state, quests: { ...state.quests, manualPortal: p2.id } };
  assert.equal(mapBanner(manual, deps, T + 1000, 'main').target, p0.id);
  assert.equal(mapBanner(state, { quests: { ...quests, portals: [] } }, T, 'main'), null);
});

test('the Quest tab opens the map; the feed only on request (login / home button)', () => {
  assert.equal(isFeedView({}), false);
  assert.equal(isFeedView({ feed: true }), true);
  for (const f of ['quest-map', 'quest-map-layout', 'quest-portal', 'quest-feed']) {
    const src = readFileSync(join(root, `src/ui/screens/${f}.js`), 'utf8');
    assert.ok(!/qm-archive|setManualPortal|button\('Portal archive/.test(src), `the Portal archive is gone (${f}.js)`);
  }
});

test('the stitched maps and their layout exist and are consistent', () => {
  const file = join(root, 'assets/orig/map/layout.json');
  assert.ok(existsSync(file), 'assets/orig/map/layout.json (run exploration/tools/build-map.py)');
  const layout = JSON.parse(readFileSync(file, 'utf8'));
  assert.ok(layout.maps.length >= 5, 'main map + 4 portal maps');
  const main = layout.maps[0];
  assert.equal(main.cols, 21);
  assert.equal(main.rows, 7);
  assert.equal(main.width, 5236);
  assert.equal(main.height, 1790);
  for (const m of layout.maps) {
    assert.ok(m.strips.length >= 1, `map ${m.index} strips`);
    for (const s of m.strips) {
      assert.ok(s.w <= 4096 && s.h <= 4096, `strip ${s.file} within 4096 px`);
      assert.ok(existsSync(join(root, 'assets/orig/map', s.file)), s.file);
    }
    for (const n of m.nodes) assert.ok(n.x >= 0 && n.x <= m.width && n.y >= 0 && n.y <= m.height);
    assert.equal(Object.keys(m.tiles).length, m.cols * m.rows, `map ${m.index} fully tiled`);
  }
});

test('every quest sits on its own painted socket: one hand-checked socket per quest, none left over or stacked', () => {
  const layout = JSON.parse(readFileSync(join(root, 'assets/orig/map/layout.json'), 'utf8'));
  const quests = JSON.parse(readFileSync(join(root, 'data/quests.json'), 'utf8'));
  const counts = new Set(quests.portals.map((p) => p.nodes.length));
  assert.deepEqual([...counts], [25], 'all portals have 25 quests');
  layout.maps.forEach((m, i) => {
    const count = i === 0 ? quests.main.nodes.length : 25;
    assert.equal(m.route, 'hand-checked', `map ${i} route`);
    assert.equal(m.nodes.length, count, `map ${i}: one socket per quest`);
    assert.deepEqual(m.extraSockets, [], `map ${i}: no painted socket left empty`);
    // the screen uses the sockets as they are (no inserted or dropped nodes)
    assert.deepEqual(nodeCoords(m, count), m.nodes.map((n) => ({ x: n.x, y: n.y })));
    for (let a = 0; a < m.nodes.length; a++) {
      for (let b = a + 1; b < m.nodes.length; b++) {
        const d = Math.hypot(m.nodes[a].x - m.nodes[b].x, m.nodes[a].y - m.nodes[b].y);
        assert.ok(d >= 100, `map ${i}: quests ${a + 1} and ${b + 1} only ${Math.round(d)} map px apart`);
      }
    }
  });
});

/* ------------------------------------------------------------------ quest screen */

const db = {
  get: (id) => ({ 'pouch-tearer': { id, tribe: 'orc' }, basilisk: { id, tribe: 'neutral' }, 'dwarf-king': { id, tribe: 'dwarf' }, loremaster: { id, tribe: 'elf' } }[id]),
};

test('questTribe follows the fixed boss, else cycles by quest number', () => {
  assert.equal(questTribe({ db }, { n: 1, boss: 'pouch-tearer' }), 'orc');
  assert.equal(questTribe({ db }, { n: 35, boss: 'basilisk' }), 'neutral');
  assert.equal(questTribe({ db }, { n: 2, boss: null }), 'dwarf');
  assert.equal(questTribe({ db }, { n: 3, boss: null }), 'elf');
  assert.equal(questTribe({ db }, { n: 5, boss: 'unknown-card' }), 'orc');
  assert.equal(questTribe({ db }, null), 'neutral');
});

test('minionSprite points at the copied cut-outs, one file per tribe and number', () => {
  const dir = join(root, 'assets/orig/minions');
  assert.ok(existsSync(dir), 'assets/orig/minions (run exploration/tools/classify-prepackaged.py)');
  const files = readdirSync(dir).filter((f) => f.endsWith('.png'));
  assert.equal(files.length, 17);
  for (const tribe of Object.keys(MINION_COUNTS)) {
    for (let k = 0; k < MINION_COUNTS[tribe] * 2; k++) {
      const url = minionSprite(tribe, k);
      assert.ok(url.startsWith('/assets/orig/minions/'), url);
      assert.ok(existsSync(join(root, url.slice(1))), url);
    }
  }
  assert.equal(minionSprite('nope', 0), '/assets/orig/minions/neutral-1.png');
  assert.equal(minionSprite('orc', 4), '/assets/orig/minions/orc-1.png');
  assert.equal(MINION_SLOTS.length, 5);
  for (const s of MINION_SLOTS) assert.ok(s.x > 60 && s.x < 660 && s.y > 400 && s.y < 800 && s.s > 0.5 && s.s < 1.5);
});

test('backdrop: the peaceful village for the first half of the main quest, the burned one later and in portals', () => {
  assert.equal(backdropFor('main', { section: 1 }), 'normal');
  assert.equal(backdropFor('main', { section: 3 }), 'normal');
  assert.equal(backdropFor('main', { section: 4 }), 'burned');
  assert.equal(backdropFor('dragon-hunt', { section: 1 }), 'burned');
  for (const f of ['village_normal_bg', 'village_burned_bg', 'village_normal_birds', 'village_normal_eb1', 'village_normal_eb2', 'hud_tapfeedback01', 'hud_tapindicator01', 'hud_explosion01', 'hud_explosion02', 'hud_explosion03', 'quest_money', 'shaman_portrait', 'reward_glow_yellow', 'fx_boss_light', 'fx_glow_map', 'hud_bigbutton04_frame', 'hud_bigbutton04_fill']) {
    assert.ok(existsSync(join(root, 'assets/orig/ui', f + '.png')), f);
  }
});

test('reward sprites and burst captions', () => {
  assert.equal(rewardSprite({ type: 'gold', gold: 10 }), '/assets/orig/ui/reward_gold.png');
  assert.equal(rewardSprite({ type: 'gems', gems: 10 }), '/assets/orig/ui/reward_gems.png');
  assert.equal(rewardSprite({ type: 'potion', potion: 'mana' }), '/assets/orig/ui/reward_manapotion.png');
  assert.equal(rewardSprite({ type: 'potion', potion: 'stamina' }), '/assets/orig/ui/reward_staminapotions.png');
  assert.equal(rewardSprite({ type: 'token', token: 'archmage' }), '/assets/orig/ui/reward_token_1.png');
  assert.equal(rewardSprite({ type: 'token', token: 'summoner' }), '/assets/orig/ui/reward_token_2.png');
  assert.equal(rewardSprite({ type: 'token', token: 'neophyte' }), '/assets/orig/ui/reward_token_3.png');
  assert.equal(rewardSprite({ type: 'card', cardId: 'x' }), '/assets/orig/ui/reward_cardslots.png');
  for (const r of [{ type: 'gold', gold: 1 }, { type: 'gems', gems: 1 }, { type: 'potion', potion: 'mana' }, { type: 'potion', potion: 'stamina' }, { type: 'token', token: 'neophyte' }, { type: 'card' }]) {
    assert.ok(existsSync(join(root, rewardSprite(r).slice(1))), rewardSprite(r));
  }
  assert.equal(burstInfo({ type: 'gold', gold: 1234 }).title, '+1,234 gold');
  assert.equal(burstInfo({ type: 'card' }).icon, 'cards');
});

/**
 * The tutorial line the quest screen shows (drawn by the tutorial overlay, src/ui/tutorial/manager.js), or null.
 * @param {object} state
 * @param {string} line
 * @param {number} n
 * @returns {string|null}
 */
function questGuideLine(state, line, n) {
  const active = state && state.quests && state.quests.active;
  const quest = active && active.line === line && active.n === n ? active : { line, n, figuresDone: 0 };
  const hint = hintFor(state, { id: 'quest', params: { line, quest: n } }, { quest });
  const ln = hint.text ? tutorialLine(hint.text) : null;
  return ln ? ln.text : null;
}

test('quest guide lines come from the tutorial: the ranger at the start of quest 1, the Shaman on quest 5, none for old saves', () => {
  const t0 = Date.UTC(2026, 9, 8);
  const fresh = newTutorialGame(7, t0);
  const at = (n, figuresDone) => ({ ...fresh, quests: { ...fresh.quests, active: { line: 'main', n, figuresDone } } });
  assert.equal(questGuideLine(at(1, 0), 'main', 1), "The Shaman's orcs are in our way! Smite them!");
  // 1.7.0 (tutorial-v2.md §1.2): the line stays until the first tap; no "Puny minions" (2014 client only)
  assert.equal(questGuideLine(at(1, 1), 'main', 1), null);
  assert.equal(questGuideLine(at(1, 3), 'main', 1), null);
  assert.equal(questGuideLine(at(2, 0), 'main', 2), null);
  assert.equal(questGuideLine(at(1, 0), 'dragon-hunt', 1), null);
  const q5 = { ...at(5, 0), quests: { ...fresh.quests, main: { unlocked: 5, done: 4, firstWins: [1, 2, 3, 4] }, active: { line: 'main', n: 5, figuresDone: 0 } } };
  assert.equal(questGuideLine(q5, 'main', 5), 'No more running. This time I will either crush you or die trying!');
  // a save from before the tutorial port (no tutorial.r3) never shows lines, and nothing says "Morden"
  const legacy = { ...fresh, tutorial: { step: 0, seen: [] }, quests: { ...fresh.quests, active: { line: 'main', n: 1, figuresDone: 0 } } };
  assert.equal(questGuideLine(legacy, 'main', 1), null);
  for (const st of [at(1, 0), at(1, 1), q5]) assert.doesNotMatch(String(questGuideLine(st, 'main', st.quests.active.n)), /Morden/);
});

test('tap feedback: PERFECT on every paid tap, the tap gold floats up, a burst adds a coin shower with its own number', () => {
  assert.equal(PERFECT, 'PERFECT');
  assert.deepEqual(tapFeedback({ perfect: true, tapGold: 6, burst: 0, gold: 6 }), { perfect: true, tapText: '+6', burstText: null, coinShower: false });
  assert.deepEqual(tapFeedback({ perfect: true, tapGold: 30, burst: 135, gold: 165 }), { perfect: true, tapText: '+30', burstText: '+135', coinShower: true });
  assert.deepEqual(tapFeedback({ perfect: false, tapGold: 0, burst: 0 }), { perfect: false, tapText: null, burstText: null, coinShower: false });
  assert.deepEqual(tapFeedback(null), { perfect: false, tapText: null, burstText: null, coinShower: false });
  assert.equal(tapFeedback({ perfect: true, tapGold: 1200 }).tapText, '+1,200');
  // the client's coin animations and the destroy sounds exist
  for (const a of ['fight_coineffect', 'goldreward']) assert.ok(existsSync(join(root, `assets/orig/animations/${a}.json`)), a);
  for (const alias of Object.values(DESTROY_SOUNDS)) assert.ok(NAMES[alias], alias);
});

test('miniDeck: five slots with the deck card art, closed slots locked', () => {
  const fresh = newTutorialGame(11, Date.UTC(2026, 9, 8));
  const db = { get: (id) => ({ id, art: { 0: `${id}.jpg` } }) };
  const art = (def, stage) => `/art/${def.id}/${stage}`;
  const slots = miniDeck(fresh, db, art);
  assert.equal(slots.length, 5);
  assert.deepEqual(slots.map((x) => x.locked), [true, false, false, true, true], 'slots 2 and 3 open at the start');
  assert.equal(slots[2].cardId, 'envoy');
  assert.equal(slots[2].art, '/art/envoy/0');
  assert.equal(slots[1].cardId, null);
});

/* ------------------------------------------------------------------ boss intro */

test('exploration/apk/data/prepackaged-map.json classifies every prepackaged image', () => {
  const file = join(root, 'exploration/apk/data/prepackaged-map.json');
  assert.ok(existsSync(file), 'run exploration/tools/classify-prepackaged.py');
  const map = JSON.parse(readFileSync(file, 'utf8'));
  const entries = Object.values(map);
  assert.equal(entries.length, 719);
  const kinds = {};
  for (const e of entries) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
  assert.equal(kinds.minion, 17);
  assert.equal(kinds.portrait, 15);
  assert.equal(kinds.card, 12);
  assert.ok(kinds.tile >= 405, `tiles ${kinds.tile}`);
  for (const e of entries) {
    if (e.kind === 'minion' || e.kind === 'portrait') {
      assert.ok(['dwarf', 'elf', 'orc', 'neutral'].includes(e.tribe), e.file);
      assert.ok(e.label && e.label !== 'unknown', e.file);
      assert.ok(e.sprite);
    }
  }
});

const read = (rel) => readFileSync(join(root, rel), 'utf8');

describe('quest tap, coin shower and card drop (quest.js)', () => {
  test('the HUD gold steps up in 3-4 steps at the wave end', () => {
    assert.ok(GOLD_SHOWER.steps >= 3 && GOLD_SHOWER.steps <= 4);
    assert.deepEqual(goldSteps(8459, 9479, 4), [8714, 8969, 9224, 9479]);
    assert.deepEqual(goldSteps(100, 100), []);
    assert.deepEqual(goldSteps(10, 12, 4), [11, 12], 'no repeated values');
    assert.ok(GOLD_SHOWER.steps * GOLD_SHOWER.stepMs <= 1300, 'within the ~1.3 s shower');
  });

  test('timings follow reOM: minion gone in ~0.13 s, card drop ~2.4 s with a 1 s hold', () => {
    assert.ok(TAP_FX.vanishMs <= 150);
    assert.equal(CARD_DROP.hold, 1000);
    const total = CARD_DROP.glint + CARD_DROP.flash + CARD_DROP.reveal + CARD_DROP.hold + CARD_DROP.fly;
    assert.ok(total >= 2000 && total <= 2800, `card drop ${total} ms`);
  });

  test('the card drop is no dialog any more', () => {
    for (const f of ['src/ui/screens/quest.js', 'src/ui/screens/quest-fx.js']) {
      const js = read(f);
      assert.ok(!/dialog\.open\(/.test(js), `no modal on the quest screen (${f})`);
      assert.ok(!/Great!/.test(js), f);
    }
  });
});
