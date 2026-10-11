'use strict';
/**
 * Pure helpers of the Arena / Pieces / Replays and League screens (src/ui/screens/pvp-view.js, pvp-events.js,
 * pvp-puzzle.js): difficulty colours, league standings, puzzle geometry, replay rows and side rebuild, avatars,
 * opponent previews. No DOM.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { makeDeps } from './fixtures-game/deps.js';
import { newGame, deckMana } from '../src/game/state.js';
import { ensureOffers, fightArena, DIFFICULTIES } from '../src/game/arena.js';
import { openLeague, standings, fightLeague } from '../src/game/league.js';
import { addPiece } from '../src/game/pieces.js';
import { getSim } from '../src/game/opponents.js';
import {
  difficultyColor, offerColor, DIFFICULTY_COLORS, replayResult, replaySide, rerunReplay,
  avatarCardId, avatarUrl, opponentPreview, sidePreview, offerHp, strongestCard, historyResult, historyDate,
} from '../src/ui/screens/pvp-view.js';
import { eventBannerInfo, formatHms, DOUBLE_EVENTS, EVENT_ART } from '../src/ui/screens/pvp-events.js';
import {
  pieceGrid, pieceEdges, piecePolygon, pieceLayout, huntProgress, PIECE_SPRITES, PIECE_CARD, pieceSpriteLayout,
} from '../src/ui/screens/pvp-puzzle.js';
import { T0 } from './fixtures/real.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function fresh(opts = {}) {
  const deps = makeDeps(opts);
  let state = newGame('Tester', 4242, T0, deps);
  state = { ...state, player: { ...state.player, level: 10, gold: 100000, gems: 5000, mana: 200, manaMax: 200 } };
  return { deps, state };
}

/** Minimal stand-in for src/ui/card-view.js (which imports the DOM-free dom.js, fine in Node too). */
const fakeView = {
  defView: (def, stage, level) => ({ cardId: def.id, name: def.name, tribe: def.tribe, rarity: def.rarity, stage, level }),
  battleView: (bc, def) => ({ cardId: bc.cardId, name: def.name, hp: bc.hp, maxHp: bc.maxHp, attack: bc.attack }),
  artUrlFor: (def) => `/assets/cards/${def.id}.jpg`,
};

// ---------------------------------------------------------------- arena

test('difficulty colours follow the arena DIFFICULTIES table (green / yellow / red)', () => {
  assert.deepEqual(DIFFICULTY_COLORS, { easy: 'green', normal: 'yellow', hard: 'red' });
  for (const d of DIFFICULTIES) assert.equal(difficultyColor(d.id), d.color);
  assert.equal(difficultyColor('nope'), 'yellow');
  assert.equal(offerColor({ color: 'red', difficulty: 'easy' }), 'red');
  assert.equal(offerColor({ difficulty: 'easy' }), 'green');
  assert.equal(offerColor(null), 'yellow');
});

test('opponentPreview builds the prebattle opponent: face-down, 5 slots, hp scaled by power', () => {
  const { state, deps } = fresh();
  const s = ensureOffers(state, deps, T0).state;
  const offer = s.sim.arena.offers[2];
  const sim = getSim(s, offer.simId);
  const o = opponentPreview(sim, deps, offer.power, fakeView);
  assert.equal(o.name, sim.name);
  assert.equal(o.level, sim.level);
  assert.equal(o.faceDown, true);
  assert.equal(o.cards.length, 5);
  assert.equal(o.hp, Math.round(sim.hpMax * 1.3));
  assert.equal(o.maxHp, o.hp);
  assert.ok(o.portraitUrl === null || o.portraitUrl.startsWith('/assets/cards/'));
  const filled = o.cards.filter(Boolean);
  assert.ok(filled.length >= 1);
  for (const c of filled) {
    assert.ok(deps.db.get(c.cardId), 'card exists');
    assert.ok(c.level >= 1);
  }
  sim.deck.forEach((d, i) => { if (!d) assert.equal(o.cards[i], null); else assert.equal(o.cards[i].cardId, d.cardId); });
});

// ---------------------------------------------------------------- league

test('league standings: the attack count drops after a fight', () => {
  const { state, deps } = fresh({ winner: 'attacker' });
  let s = openLeague(state, deps, T0).state;
  const rows = standings(s, deps, T0);
  assert.equal(rows.length, 50, 'you + 49 simulated players (round 3)');
  assert.equal(rows.filter((r) => r.isPlayer).length, 1);
  const target = rows.find((r) => !r.isPlayer);
  assert.equal(target.fightsLeft, 3);
  s = fightLeague(s, deps, T0, { simId: target.id }).state;
  const after = standings(s, deps, T0);
  assert.equal(after.find((r) => r.id === target.id).fightsLeft, 2);
  assert.equal(after.find((r) => r.isPlayer).points, 150);
});

// ---------------------------------------------------------------- pieces

test('piece grid: 1 column for tiny hunts, 2 columns otherwise', () => {
  assert.deepEqual(pieceGrid(2), { cols: 1, rows: 2 });
  assert.deepEqual(pieceGrid(4), { cols: 2, rows: 2 });
  assert.deepEqual(pieceGrid(6), { cols: 2, rows: 3 });
  assert.deepEqual(pieceGrid(10), { cols: 2, rows: 5 });
  assert.deepEqual(pieceGrid(0), { cols: 1, rows: 1 });
});

test('piece edges are flat on the border and complementary between neighbours', () => {
  for (const [cols, rows] of [[1, 2], [2, 2], [2, 3], [2, 5]]) {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const e = pieceEdges(r, c, cols, rows);
      if (r === 0) assert.equal(e.top, 0);
      if (c === 0) assert.equal(e.left, 0);
      if (r === rows - 1) assert.equal(e.bottom, 0);
      if (c === cols - 1) assert.equal(e.right, 0);
      if (c < cols - 1) { assert.notEqual(e.right, 0); assert.equal(e.right, -pieceEdges(r, c + 1, cols, rows).left); }
      if (r < rows - 1) { assert.notEqual(e.bottom, 0); assert.equal(e.bottom, -pieceEdges(r + 1, c, cols, rows).top); }
    }
  }
});

test('piece polygon stays inside its padded box and knobs protrude only on knob edges', () => {
  const tab = 10;
  const p = piecePolygon(0, 0, 2, 2, 100, 140, tab); // (0,0): knob right + knob bottom, flat top/left
  assert.match(p.polygon, /^polygon\(/);
  assert.deepEqual(p.box, { x: -10, y: -10, w: 120, h: 160 });
  for (const [x, y] of p.points) {
    assert.ok(x >= 0 && x <= 120, `x ${x} in box`);
    assert.ok(y >= 0 && y <= 160, `y ${y} in box`);
  }
  assert.ok(p.points.some(([x]) => x > 110), 'knob protrudes to the right');
  assert.ok(p.points.some(([, y]) => y > 150), 'knob protrudes at the bottom');
  assert.ok(!p.points.some(([x]) => x < 10), 'flat left edge');
  assert.ok(!p.points.some(([, y]) => y < 10), 'flat top edge');
  const q = piecePolygon(0, 1, 2, 2, 100, 140, tab); // (0,1): notch left, knob bottom? (r+c odd -> notch bottom)
  assert.ok(q.points.some(([x]) => x > 10 && x < 30), 'notch cuts into the piece on the left');
  assert.ok(!q.points.some(([x]) => x < 10));
  assert.ok(!q.points.some(([, y]) => y > 150), 'notch at the bottom does not protrude');
  const flat = piecePolygon(0, 0, 1, 1, 50, 50, 5);
  assert.equal(flat.points.length, 4);
});

test('pieceLayout lights the first owned pieces and aligns the art per piece', () => {
  const layout = pieceLayout(6, 2, 120, 168);
  assert.equal(layout.length, 6);
  assert.deepEqual(layout.map((p) => p.owned), [true, true, false, false, false, false]);
  assert.deepEqual(layout.map((p) => [p.r, p.c]), [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]]);
  for (const p of layout) {
    assert.equal(p.bgX, -p.box.x);
    assert.equal(p.bgY, -p.box.y);
    assert.equal(p.box.w, 60 + 2 * 5);
    assert.equal(p.box.h, 56 + 2 * 5);
  }
  assert.equal(layout[3].box.x, 60 - 5);
  assert.equal(layout[3].box.y, 56 - 5);
  assert.equal(pieceLayout(1, 1, 60, 60, 9)[0].polygon.startsWith('polygon('), true);
});

test('huntProgress text and missing count', () => {
  assert.deepEqual(huntProgress({ owned: 2, total: 6 }), { text: '2 / 6', ratio: 2 / 6, missing: 4 });
  assert.deepEqual(huntProgress({ owned: 9, total: 6 }), { text: '6 / 6', ratio: 1, missing: 0 });
  const { state, deps } = fresh();
  const s = addPiece(state, deps, T0, 'dwarf-king').state;
  assert.equal(huntProgress(s.pieces[0]).text, '1 / 10');
});

// ---------------------------------------------------------------- replays

test('replay rows: result label', () => {
  assert.deepEqual(replayResult({ won: true, result: { winner: 'attacker' } }), { label: 'Victory', cls: 'win' });
  assert.deepEqual(replayResult({ won: false, result: { winner: 'defender' } }), { label: 'Defeat', cls: 'loss' });
  assert.deepEqual(replayResult({ won: false, result: { winner: 'draw' } }), { label: 'Draw', cls: 'draw' });
  assert.deepEqual(replayResult(null), { label: 'Defeat', cls: 'loss' });
});

test('rerunReplay rebuilds the saved sides without re-applying the tribe bonus and replays the same seed', () => {
  const { state, deps } = fresh({ winner: 'attacker' });
  const s = ensureOffers(state, deps, T0).state;
  const r = fightArena(s, deps, T0, { offerIndex: 1 });
  const rep = r.state.replays[0];
  const original = deps.engine.calls[deps.engine.calls.length - 1];
  const run = rerunReplay(rep, deps);
  const again = deps.engine.calls[deps.engine.calls.length - 1];
  assert.equal(again.seed, rep.seed);
  assert.equal(run.attacker.player.name, original.attacker.player.name);
  assert.equal(run.attacker.player.maxHp, original.attacker.player.maxHp);
  assert.equal(run.defender.player.maxHp, original.defender.player.maxHp);
  assert.deepEqual(run.attacker.cards.map((c) => c && [c.cardId, c.stage, c.level]), original.attacker.cards.map((c) => c && [c.cardId, c.stage, c.level]));
  assert.deepEqual(run.defender.cards.map((c) => c && [c.cardId, c.stage, c.level]), original.defender.cards.map((c) => c && [c.cardId, c.stage, c.level]));
  assert.equal(run.result.winner, 'attacker');
  assert.ok(Array.isArray(run.events) && run.events.length >= 2);
  const side = replaySide({ name: 'X', maxHp: 1725, cards: [null, { cardId: 'envoy', stage: 0, level: 3 }] }, deps);
  assert.equal(side.player.maxHp, 1725);
  assert.equal(side.cards.length, 5);
  assert.equal(side.cards[1].cardId, 'envoy');
  assert.equal(side.cards[0], null);
  const preview = sidePreview(side, deps, fakeView);
  assert.equal(preview.name, 'X');
  assert.equal(preview.cards.length, 5);
  assert.equal(preview.cards[1].name, 'Envoy');
  assert.equal(preview.faceDown, false);
});

// ---------------------------------------------------------------- avatars

test('avatar ids wrap around the names list and resolve to card art', () => {
  const avatars = ['a', 'b', 'c'];
  assert.equal(avatarCardId(0, avatars), 'a');
  assert.equal(avatarCardId(4, avatars), 'b');
  assert.equal(avatarCardId(-1, avatars), 'c');
  assert.equal(avatarCardId(0, []), null);
  assert.equal(avatarCardId(0, null), null);
  const { deps } = fresh();
  const url = avatarUrl(0, deps, fakeView.artUrlFor);
  assert.equal(url, `/assets/cards/${deps.names.avatars[0]}.jpg`);
  assert.equal(avatarUrl(0, { db: deps.db, names: { avatars: ['no-such-card'] } }, fakeView.artUrlFor), null);
});

// ---------------------------------------------------------------- round 5: the client's lists

test('arena rows: HP scaled like the fight, portrait = the strongest card', () => {
  const { deps, state } = fresh();
  const eo = ensureOffers(state, deps, T0);
  for (const offer of eo.offers) {
    const sim = getSim(eo.state, offer.simId);
    const prev = opponentPreview(sim, deps, offer.power, fakeView);
    assert.equal(offerHp(sim, offer.power), prev.hp, 'row HP = the HP the fight uses');
    const best = strongestCard(sim.deck, deps.db);
    assert.ok(best && deps.db.get(best.cardId));
    for (const c of sim.deck.filter(Boolean)) assert.ok(best.level >= c.level);
  }
  assert.equal(offerHp(null), 0);
  assert.equal(strongestCard([null, { cardId: 'no-such-card', level: 9 }], deps.db), null);
});

test('event banner: uppercase title / headline, x2 on the double events, art card exists, h:mm:ss timer', () => {
  const cards = JSON.parse(readFileSync(join(ROOT, 'data', 'cards.json'), 'utf8'));
  const ids = new Set((Array.isArray(cards) ? cards : cards.cards || Object.values(cards)).map((c) => c.id));
  const wisdom = eventBannerInfo({ id: 'infinite-wisdom', name: 'Infinite Wisdom', desc: 'Double card XP from every fight.' });
  assert.equal(wisdom.title, 'INFINITE WISDOM');
  assert.equal(wisdom.headline, 'DOUBLE XP FOR YOUR CARDS');
  assert.equal(wisdom.double, true);
  assert.equal(eventBannerInfo({ id: 'golden-day', name: 'Golden Day' }).double, false);
  assert.equal(eventBannerInfo(null), null);
  assert.deepEqual([...DOUBLE_EVENTS].sort(), ['double-league-points', 'infinite-wisdom']);
  for (const id of Object.values(EVENT_ART)) assert.ok(ids.has(id), `event art card ${id}`);
  assert.equal(formatHms(((1 * 60 + 6) * 60 + 8) * 1000), '1:06:08');
  assert.equal(formatHms(0), '0:00:00');
  assert.equal(formatHms(-5), '0:00:00');
  assert.equal(formatHms(26 * 3600 * 1000), '26:00:00');
});

test('original puzzle overlays: piece sprites exist, tile the 451 x 640 card, owned = outline, missing = b', () => {
  const ui = join(ROOT, 'assets', 'orig', 'ui');
  for (const [n, set] of Object.entries(PIECE_SPRITES)) {
    assert.equal(set.length, Number(n));
    for (const p of set) {
      for (const suffix of ['', 'b']) assert.ok(existsSync(join(ui, `piece${n}_${p.id}${suffix}.png`)), `piece${n}_${p.id}${suffix}`);
      assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= PIECE_CARD.w + 2 && p.y + p.h <= PIECE_CARD.h + 2, `piece${n}_${p.id} inside the card`);
    }
    // the corners of the card are covered
    assert.ok(set.some((p) => p.x === 0 && p.y === 0));
    assert.ok(set.some((p) => p.x + p.w >= PIECE_CARD.w - 1 && p.y + p.h >= PIECE_CARD.h - 1));
  }
  const l = pieceSpriteLayout(4, 1);
  assert.deepEqual(l.map((p) => p.sprite), ['piece4_1', 'piece4_2b', 'piece4_3b', 'piece4_4b']);
  assert.equal(l[0].left, 0);
  assert.ok(l[3].left > 30 && l[3].top > 45);
  assert.equal(pieceSpriteLayout(12, 3), null, 'no sprite set: clip-path pieces');
});

test('fight history entries: Won / Lost / Draw and the client date + time lines', () => {
  assert.deepEqual(historyResult({ won: true, result: { winner: 'attacker' } }), { label: 'Won', cls: 'win' });
  assert.deepEqual(historyResult({ won: false, result: { winner: 'defender' } }), { label: 'Lost', cls: 'loss' });
  assert.deepEqual(historyResult({ won: false, result: { winner: 'draw' } }), { label: 'Draw', cls: 'draw' });
  assert.deepEqual(historyDate(Date.UTC(2026, 9, 9, 14, 5, 9), true), { date: '09.10.2026', time: '14:05:09' });
  assert.deepEqual(historyDate(Date.UTC(2026, 0, 1, 0, 0, 0), true), { date: '01.01.2026', time: '00:00:00' });
});

test('arena screen follows the client list: no reroll bar, no difficulty chip, no league stake, no mana line', () => {
  const src = ['arena.js', 'arena-pieces.js', 'pvp-widgets.js'].map((f) => readFileSync(join(ROOT, 'src/ui/screens', f), 'utf8')).join('\n');
  for (const gone of ['reroll-bar', 'offer-diff', 'league-stake', 'arena-cost', 'rerollOffers', 'leagueStake']) assert.ok(!src.includes(gone), `the arena screen still has ${gone}`);
  for (const kept of ['offer-name', 'offer-level', 'offer-hp', 'offer-info', 'offer-attack', 'pieces-grid', 'piece-attack', 'replay-row', 'replay-play']) assert.ok(src.includes(kept), `the arena screen lacks ${kept}`);
  for (const sprite of ['pvp_bg_green', 'pvp_bg_orange', 'pvp_bg_red', 'hud_headeractive01', 'hud_headeridle01', 'fight_icon_active', 'hud_eyebutton01', 'attacked_icon', 'addcard_icon']) {
    assert.ok(existsSync(join(ROOT, 'assets', 'orig', 'ui', `${sprite}.png`)), sprite);
  }
});

// ---------------------------------------------------------------- files

test('screen modules and stylesheets exist and follow the conventions', () => {
  for (const f of ['src/ui/screens/arena.js', 'src/ui/screens/league.js', 'src/ui/screens/pvp-view.js', 'css/screens/arena.css', 'css/screens/league.css']) {
    assert.ok(existsSync(join(ROOT, f)), f);
  }
  for (const f of ['src/ui/screens/arena.js', 'src/ui/screens/league.js', 'src/ui/screens/arena-pieces.js', 'src/ui/screens/pvp-widgets.js']) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    assert.match(src, /^'use strict';/);
    if (!/arena-pieces|pvp-widgets/.test(f)) assert.match(src, /export function render\(ctx\)/);
    assert.ok(!/innerHTML/.test(src), `${f} has no innerHTML`);
    assert.ok(!/Date\.now\(/.test(src), `${f} uses ctx.now()`);
    assert.ok(!/Math\.random\(/.test(src), `${f} has no Math.random`);
  }
  for (const f of ['pvp-view.js', 'pvp-events.js', 'pvp-puzzle.js']) {
    const helpers = readFileSync(join(ROOT, 'src/ui/screens', f), 'utf8');
    assert.ok(!/document\.|window\./.test(helpers), `${f} is DOM-free`);
  }
  const { deps, state } = fresh();
  assert.ok(deckMana(state, deps) > 0);
});
