#!/usr/bin/env node
'use strict';
/**
 * QA playtest of the core loop (regression test, exit 1 on failure).
 *
 * Drives the real game in headless Edge/Chrome through tools/cdp.js with real clicks, drags and key
 * presses, uses `window.evoker` (architecture §8.5) only for set-up and assertions, and writes a screenshot
 * of every step to tests/screenshots/qa-core-loop/ (or --out).
 *
 * The first-session tutorial (opening fight, name prompt, ranger lines) is not driven here: after a title-screen
 * boot check the save is created with `debug.newGame` (no tutorial record = tutorial finished) and the starting
 * collection is built explicitly (Envoy + Master Brewer + Pikeman, Pouch Tearer, Bone Breaker, Scout).
 *
 * Covered: title boot → the Quest tab opens the main map → landing feed on request (Escape does nothing) → map
 * via the Main Quest banner (root of the tab: Escape stays) → quest 1 (2 stamina + 6 gold per tap, player level-up dialog from the tap XP with +/- and Proceed,
 * Card Fusing unlock popup, card drop, Drink potion dialog: use / refuse / buy with gems, end-of-quest coin
 * shower) → boss intro (auto-advance) → pre-battle drag-and-drop within the two open slots + locked-slot refusal
 * → Attack! → battle at 1x / 2x (no Skip on quest 1, Escape ignored) → result popup (tap = skip a step,
 * Continue) → replay a beaten quest → quest 2 boss first win → "Card Slot Unlocked!" popup → Escape on a quest
 * → quest 3 boss with Skip fight → portal banner → portal map (no Portal archive) → quest 31 boss with a forced card-piece
 * reward (lava theme, Escape skips) → pre-battle with the Mana-needed bar + Drink mana potion → help pages →
 * reload persistence.
 *
 * Random rolls are made deterministic by searching (in Node, with the same pure game functions and data the
 * app uses) for a save seed that produces the wanted outcome, then injecting it through the debug store.
 *
 * Usage: node tools/qa-core-loop.js [--base=http://host:port/] [--out=dir] [--headed] [--slow=ms] [--verbose]
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createQa, bindApp, screenshotDir, ROOT, log, assert, sleep } from './qa-lib.js';

import { createCardsDb } from '../src/core/cards-db.js';
import * as stats from '../src/core/stats.js';
import * as abilities from '../src/core/abilities.js';
import { mulberry32 } from '../src/core/rng.js';
import { simulateBattle } from '../src/engine/battle.js';
import { buildSide } from '../src/engine/battle-state.js';
import { tapMinion, fightBoss } from '../src/game/quests.js';
import { potionPrice, goldWithEvent } from '../src/game/player.js';
import { dailyEvent } from '../src/game/shop.js';

const PLAYER_NAME = 'Tester';
/** Cards added to the new save's Envoy + Master Brewer (the pre-round-3 starter collection). */
const EXTRA_CARDS = ['pikeman', 'pouch-tearer', 'bone-breaker', 'scout'];
const STRONG_DECK = ['colossus', 'chimera', 'army-of-ghosts', 'astral-navigator', 'bloodsoaked-totem'];

const qa = createQa({ title: 'Evoker QA: core loop', banner: 'QA CORE LOOP', defaultOut: screenshotDir('qa-core-loop') });
const { OPTS, step, shot } = qa;
const app = bindApp(qa, { overlays: { results: true } });
const {
  screenId, waitScreen, getState, patchState, patchPlayer, debugCall, bootFresh, text: textOf, count, exists, dismissOverlays,
  hitMinion, tapMinionOnce, tapToBoss, resultKind, finishResult,
} = app;
/** Tap the first visible, enabled button whose text matches. */
const tapText = (pattern, within) => app.tapText(pattern, within, { buttonsOnly: true });
/** Real mouse drag between two elements (whole pixels, 80 ms hold before the release). */
const drag = (from, to, o = {}) => app.drag(from, to, { round: true, holdMs: 80, settleMs: 300, ...o });

/** @type {import('./cdp.js').Browser} */
let browser;
/** Node-side deps (same data and pure functions as the app) for seed searches. */
let deps;

/** A live (not yet hit) minion in the landscape. */
const MINION = 'button.quest-minion:not(.slain)';
/** The main map (100 nodes) is rendered and the router idle. */
const MAIN_MAP_READY = 'document.querySelectorAll(".qm-node").length === 100 && !window.evoker.router.busy';
/** Today's daily event (the same clock as the app). */
const event = () => dailyEvent(Date.now());

/** The nav's Quest tab: always the main map, also from a portal map. */
async function toMainMap() {
  await browser.evaluate(() => window.evoker.goTop('quest'));
  await browser.waitFor(MAIN_MAP_READY, 8000);
}

/**
 * Pick a save seed that wins the pending boss fight (`want` filters the fightBoss result), inject it, Attack!
 * and wait for the battle screen.
 * @returns {Promise<number>} the seed
 */
async function attackWinning(what, want, max) {
  const seed = bossWinSeed(await getState(), event(), want, max);
  assert(seed, `no seed wins ${what}`);
  await patchState({ seed });
  assert(await browser.tap('.attack-bar .attack-btn'), 'Attack! missing');
  await waitScreen('battle', 10000);
  return seed;
}

/** Wait for the Drink-potion dialog, let it settle and screenshot it. */
async function potionDialog(shotName, settleMs) {
  await browser.waitFor('document.querySelector(".dialog-potion")', 5000);
  await sleep(settleMs);
  await shot(shotName);
}

/** Wait for a "... Unlocked!" popup and screenshot it; resolves with its title. */
async function unlockPopup(shotName) {
  await browser.waitFor('document.querySelector(".dialog-backdrop .dialog.dialog-unlock")', 5000);
  await sleep(400);
  await shot(shotName);
  return textOf('.dialog-unlock .dialog-title');
}

/** OK on the unlock popup. */
async function closeUnlockPopup() {
  assert(await tapText('^ok$', '.dialog-unlock'), 'OK missing');
  await browser.waitFor('!document.querySelector(".dialog-backdrop:not(.closing)")', 4000);
}

/** The first win seed for the active quest's boss (`want` filters the resolveBoss result). */
function bossWinSeed(state, event, want = () => true, max = 3000) {
  return findSeed(state, (st) => { const r = fightBoss(st, deps, Date.now(), { event }); return r.won && want(r); }, max);
}

/** Search a save seed (Node side, same pure functions as the app) that makes `fn(state)` truthy. */
function findSeed(state, fn, max = 3000) {
  for (let seed = 1; seed <= max; seed++) {
    try { if (fn({ ...state, seed })) return seed; } catch (err) { if (OPTS.verbose) log('    seed ' + seed + ': ' + err.message); }
  }
  return null;
}

async function loadDeps() {
  const read = async (p) => JSON.parse(await readFile(join(ROOT, p), 'utf8'));
  const [cards, quests, names] = await Promise.all([read('data/cards.json'), read('data/quests.json'), read('data/names.json')]);
  return { db: createCardsDb(cards), stats, engine: { simulateBattle, buildSide }, rng: mulberry32, quests, names, abilities };
}

/* ------------------------------------------------------------------ the scenario */
async function runScenario(base) {
  /* ---------- 1. boot + title, then a debug save (the first-session tutorial is not driven here) ---------- */
  await step('boot with a clean save', async () => {
    await bootFresh(base);
    await waitScreen('title');
    await sleep(500);
    await shot('title');
    assert(await exists('.title-screen .title-tap'), 'no "Tap to continue" on the title screen');
    assert((await getState()) === null, 'a clean boot should have no save');
    return `evoker ${await browser.evaluate(() => window.evoker.version)}`;
  });

  await step('new game (debug save) + starter collection', async () => {
    await browser.evaluate((name) => { window.evoker.debug.newGame(name); return true; }, PLAYER_NAME);
    let s = await getState();
    assert(s && s.player.name === PLAYER_NAME, `name is ${s && s.player.name}`);
    assert(s.cards.length === 2 && s.player.deckSlots === 2, `new save: ${s.cards.length} cards, ${s.player.deckSlots} slots`);
    assert(!(s.tutorial && s.tutorial.r3), 'a debug save must not carry a tutorial record');
    // no daily reward on a new game's first day (the calendar starts tomorrow, like the 1.7.0 video)
    assert(s.player.gold === 200 && s.player.staminaPotions === 0 && s.daily.streak === 0, `gold ${s.player.gold}, stamina potions ${s.player.staminaPotions}, streak ${s.daily.streak} (no day-1 reward)`);
    const uids = {};
    for (const id of EXTRA_CARDS) uids[id] = await debugCall('addCard', id, 0, 1);
    const envoy = s.cards.find((c) => c.cardId === 'envoy').uid;
    await patchState({ deck: [null, uids['bone-breaker'], envoy, null, null] });
    s = await getState();
    assert(s.cards.length === 6, `collection has ${s.cards.length} cards`);
    await toMainMap();
    return `${s.cards.map((c) => c.cardId).join(', ')}; deck ${s.deck.map((u) => u || '-').join(',')}`;
  });

  /* ---------- 2. landing feed + map ---------- */
  await step('landing feed (banners, Escape does nothing)', async () => {
    // the Quest tab itself is the main map; the feed is the login page (title -> {feed: true})
    assert(await exists('.qm-map') && !(await exists('.qm-feed')), 'the Quest tab should open the main map');
    await browser.evaluate(() => window.evoker.goTop('quest', { feed: true }));
    await browser.waitFor('document.querySelector(".qm-feed") && !window.evoker.router.busy', 5000);
    await sleep(600);
    await shot('landing-feed');
    const kinds = await browser.evaluate(() => Array.from(document.querySelectorAll('.qm-feed .feed-banner')).map((b) => b.dataset.feed));
    for (const k of ['daily', 'quest', 'portal', 'shop']) assert(kinds.includes(k), `feed banner ${k} missing: ${kinds}`);
    const sub = await textOf('.feed-quest .feed-sub');
    assert(/Green Valley - Quest 1/.test(sub || ''), `quest banner: ${sub}`);
    assert(await browser.evaluate(() => { const b = document.querySelector('.hud .hud-back'); return !b || b.disabled || b.hidden; }), 'the back arrow should be disabled on the feed');
    assert(!(await exists('.qm-bubble')), 'no ranger line without a tutorial record');
    await browser.press('Escape');
    await sleep(500);
    assert((await screenId()) === 'quest-map' && (await exists('.qm-feed')), 'Escape on the feed navigated away');
    return kinds.join(', ');
  });

  await step('feed -> map (Main Quest banner); the main map is the tab root (Escape stays)', async () => {
    assert(await browser.tap('.feed-quest'), 'Main Quest banner missing');
    await browser.waitFor('document.querySelector(".qm-map") && !window.evoker.router.busy', 8000);
    await sleep(700);
    await shot('quest-map');
    assert(await exists('.qm-banner'), 'portal banner missing');
    const cd = await textOf('.qm-countdown');
    assert(cd && /^\d+:\d\d:\d\d:\d\d$/.test(cd), `countdown text: ${cd}`);
    assert(!(await exists('.qm-archive')), 'the Portal archive button should be gone');
    assert(await exists('.qm-banner.tappable[data-target]'), 'the main map banner should enter the running portal');
    assert(await exists('.qm-node.current[data-quest="1"]'), 'quest 1 is not the current node');
    assert(await exists('.qm-current .qm-rune'), 'rune circle missing');
    assert((await count('.qm-node')) === 100, 'expected 100 nodes');
    assert(!(await exists('.qm-bubble')), 'no ranger line without a tutorial record');
    // the map fills the screen down to the nav (no dark spacer under it)
    const fill = await browser.evaluate(() => { const b = document.querySelector('.qm-body'); const m = document.querySelector('.qm-map'); return { map: m.offsetHeight, body: b.clientHeight, spacer: Boolean(document.querySelector('.qm-spacer')) }; });
    assert(fill.map >= fill.body && !fill.spacer, `map ${fill.map} px for a ${fill.body} px viewport`);
    assert(await browser.evaluate(() => { const b = document.querySelector('.hud .hud-back'); return !b || b.disabled || b.hidden; }), 'the main map is the root of the tab');
    await browser.press('Escape');
    await sleep(500);
    assert((await screenId()) === 'quest-map' && (await exists('.qm-node[data-quest="1"]')), 'Escape on the main map should stay');
    return `portal countdown ${cd}`;
  });

  /* ---------- 3. quest 1 ---------- */
  await step('open quest 1 from the map', async () => {
    assert(await browser.tap('.qm-node[data-quest="1"]'), 'node 1 not found');
    await waitScreen('quest');
    await sleep(400);
    await shot('quest-1');
    const s = await getState();
    assert(s.quests.active && s.quests.active.n === 1, 'quest 1 is not active');
    assert(s.quests.active.figuresTotal === 5, `quest 1 should have 5 minions, has ${s.quests.active.figuresTotal}`);
    assert((await count(MINION)) >= 2, 'no minions in the landscape');
    assert(/0%/.test(await textOf('.quest-progress .bar-label')), 'progress should start at 0%');
    assert((await count('.quest-minideck .qmd-slot.locked')) === 3, 'minideck should show 3 locked slots');
    return `${s.quests.active.figuresTotal} figures in ${s.quests.active.waves.length} waves`;
  });

  await step('tap a minion (2 stamina, 6 gold, hit flash, progress bar)', async () => {
    const before = await getState();
    assert(await hitMinion(), 'no minion to tap');
    await sleep(120);
    await shot('quest-hit');
    await browser.waitFor('window.evoker.state().quests.active.figuresDone === 1', 5000);
    await sleep(500);
    const s = await getState();
    assert(s.player.stamina === before.player.stamina - 2, `stamina ${before.player.stamina} -> ${s.player.stamina} (2 per tap on quest 1)`);
    const tapGold = goldWithEvent(6, event());
    assert(s.player.gold === before.player.gold + tapGold, `gold ${before.player.gold} -> ${s.player.gold} (6 per tap on quest 1, event ${event() && event().id})`);
    assert(s.player.xp === before.player.xp + 2, `player xp ${before.player.xp} -> ${s.player.xp} (1 per stamina)`);
    const pct = await textOf('.quest-progress .bar-label');
    assert(/20%/.test(pct), `progress label: ${pct}`);
    const hud = await textOf('.hud .hud-res.stamina .val');
    assert(hud === `${s.player.stamina}/${s.player.staminaMax}`, `HUD stamina: ${hud}`);
    return `stamina ${s.player.stamina}, gold ${s.player.gold}, progress ${pct}`;
  });

  await step('player level-up dialog (tap XP): +/- points, Proceed', async () => {
    const need = stats.playerXpToNext(1);
    await patchPlayer({ xp: need - 1 });
    const before = await getState();
    assert(await hitMinion(), 'no minion to tap');
    await browser.waitFor('document.querySelector(".lvl-backdrop .lvl-panel")', 6000);
    await sleep(150);
    await shot('levelup-ribbon');
    // a tap during the "Level Up" ribbon skips it
    await browser.tap('.lvl-backdrop .lvl-title');
    await sleep(300);
    assert(!(await browser.evaluate(() => document.querySelector('.lvl-backdrop').classList.contains('intro'))), 'tap did not skip the ribbon');
    assert((await textOf('.lvl-title')) === 'Level up!', 'title');
    assert((await textOf('.lvl-reached')) === 'Reached level 2', `reached: ${await textOf('.lvl-reached')}`);
    assert((await textOf('.lvl-points-left')) === '12' && (await textOf('.lvl-points-total')) === '/12', `points: ${await textOf('.lvl-points-left')}${await textOf('.lvl-points-total')}`);
    assert((await textOf('.lvl-coins-amount')) === '100', `gold reward: ${await textOf('.lvl-coins-amount')}`);
    assert(await exists('.lvl-special-img.gems'), 'level 2 should show the gems reward');
    const val = (a) => textOf(`.lvl-attr[data-attr="${a}"] .lvl-attr-value`);
    const p0 = before.player;
    assert((await val('hp')) === String(p0.hpMax) && (await val('stamina')) === String(p0.staminaMax) && (await val('mana')) === String(p0.manaMax), 'start values');
    const btn = (a, kind) => `.lvl-attr[data-attr="${a}"] .lvl-btn.${kind}`;
    await browser.tap(btn('hp', 'plus'));
    await browser.tap(btn('hp', 'plus'));
    await browser.tap(btn('stamina', 'plus'));
    await browser.tap(btn('hp', 'minus'));
    await sleep(200);
    assert((await textOf('.lvl-points-left')) === '10', `points left after +,+,+,-: ${await textOf('.lvl-points-left')}`);
    assert((await val('hp')) === String(p0.hpMax + 30), `hp value ${await val('hp')}`);
    assert((await val('stamina')) === String(p0.staminaMax + 1), `stamina value ${await val('stamina')}`);
    assert(await browser.evaluate(() => document.querySelector('.lvl-attr[data-attr="mana"] .lvl-btn.minus').disabled), 'mana minus should be disabled');
    await shot('levelup-points');
    // the final split = the placed points + the client's even distribution of the rest
    const final = await browser.evaluate(async () => (await import('/src/ui/components/popup-levelup.js')).autoDistribute(10, { hp: 1, stamina: 1, mana: 0 }));
    assert(await browser.tap('.lvl-backdrop .lvl-proceed'), 'Proceed missing');
    await sleep(800);
    await shot('levelup-countup');
    await browser.waitFor('!document.querySelector(".lvl-backdrop")', 8000);
    const s = await getState();
    assert(s.player.level === 2, `level ${s.player.level}`);
    assert(s.player.statPoints === 0, `stat points after Proceed: ${s.player.statPoints}`);
    assert(s.player.hpMax === p0.hpMax + 30 * final.hp && s.player.staminaMax === p0.staminaMax + final.stamina && s.player.manaMax === p0.manaMax + final.mana,
      `max values ${s.player.hpMax}/${s.player.staminaMax}/${s.player.manaMax}, expected +${final.hp}/+${final.stamina}/+${final.mana} points`);
    assert(s.player.gold === p0.gold + goldWithEvent(6, event()) + 100 && s.player.gems === p0.gems + 5, `level rewards: gold ${p0.gold} -> ${s.player.gold}, gems ${p0.gems} -> ${s.player.gems}`);
    // then the level's unlock popup
    const title = await unlockPopup('unlock-fusion');
    assert(title === 'Card Fusing Unlocked!', `unlock popup: ${title}`);
    await closeUnlockPopup();
    const after = await getState();
    assert((after.tutorial.seen || []).includes('fusion'), `seen: ${after.tutorial.seen}`);
    return `split hp+${final.hp} stamina+${final.stamina} mana+${final.mana}; ${title}`;
  });

  await step('wave reward: card drop (forced seed)', async () => {
    await browser.waitFor('!window.evoker.router.busy && document.querySelector(' + JSON.stringify(MINION) + ')', 5000);
    const s = await getState();
    assert(s.quests.active.figuresDone === 2 && s.quests.active.waveIndex === 0, `quest progress: ${s.quests.active.figuresDone} done, wave ${s.quests.active.waveIndex}`);
    const seed = findSeed(s, (st) => tapMinion(st, deps, Date.now(), { event: event() }).reward?.type === 'card');
    assert(seed, 'no seed produced a card drop');
    await patchState({ seed });
    assert(await hitMinion(), 'no minion to tap');
    // no dialog: the glowing card appears on the scene, holds ~1 s, flies into the minideck (gameplay-feel §1)
    await browser.waitFor('document.querySelector(".quest-drop .qd-card")', 6000);
    await sleep(700);
    await shot('card-drop');
    const msg = await browser.evaluate(() => document.querySelector('.quest-drop .qd-card').getAttribute('aria-label'));
    assert(/^new card: /i.test(msg || ''), `card drop label: ${msg}`);
    assert(!(await exists('.dialog-backdrop:not(.closing)')), 'the card drop must not open a dialog');
    await browser.waitFor('!document.querySelector(".quest-drop")', 6000);
    await sleep(300);
    const after = await getState();
    assert(after.cards.length === s.cards.length + 1, `collection should have ${s.cards.length + 1} cards, has ${after.cards.length}`);
    assert(after.quests.active.waveIndex === 1, 'wave 2 should have started');
    return `seed ${seed}: ${msg}`;
  });

  await step('stamina short: Drink potion -> use', async () => {
    await patchPlayer({ stamina: 1, staminaPotions: 2 });
    const before = await getState();
    assert(await hitMinion(), 'no minion to tap');
    await potionDialog('drink-potion-use', 400);
    const msg = await textOf('.dialog-potion .msg');
    assert(/stamina is too low/i.test(msg || ''), `dialog text: ${msg}`);
    const plate = await textOf('.dialog-potion .potion-count');
    assert(plate === `${before.player.staminaPotions} potion${before.player.staminaPotions === 1 ? '' : 's'}`, `potion count plate: ${plate}`);
    assert(await tapText('use potion now', '.dialog-potion'), 'Use potion now missing');
    await browser.waitFor(`window.evoker.state().quests.active.figuresDone === ${before.quests.active.figuresDone + 1}`, 6000);
    await sleep(500);
    const s = await getState();
    assert(s.player.staminaPotions === before.player.staminaPotions - 1, 'potion was not consumed');
    assert(s.player.stamina === s.player.staminaMax - 2, `stamina after refill + tap: ${s.player.stamina} (max ${s.player.staminaMax})`);
    return `potions ${before.player.staminaPotions} -> ${s.player.staminaPotions}, stamina ${s.player.stamina}/${s.player.staminaMax}`;
  });

  await step('stamina short, no potions: refuse, then buy with gems (coin shower)', async () => {
    await patchPlayer({ stamina: 1, staminaPotions: 0, gems: 0 });
    const before = await getState();
    assert(await hitMinion(), 'no minion to tap');
    await potionDialog('drink-potion-buy-disabled', 400);
    const disabled = await browser.evaluate(() => { const b = document.querySelector('.dialog-potion .btn-green'); return b ? b.disabled : null; });
    assert(disabled === true, `Buy button should be disabled without gems (got ${disabled})`);
    assert(await browser.tap('.dialog-potion .dialog-close'), 'close (X) button missing');
    await sleep(400);
    let s = await getState();
    assert(s.quests.active.figuresDone === before.quests.active.figuresDone, 'refusing must not progress the quest');
    assert(!(await exists('.dialog-backdrop:not(.closing)')), 'dialog still open after X');
    await patchPlayer({ gems: 100 });
    // the last tap of quest 1 always pays the +10 end gold (coin shower); pick a seed without a card drop
    s = await getState();
    const refilled = (st) => ({ ...st, player: { ...st.player, stamina: st.player.staminaMax } });
    const seed = findSeed(s, (st) => tapMinion(refilled(st), deps, Date.now(), { event: event() }).reward?.type === 'gold');
    assert(seed, 'no seed ends the quest without a card drop');
    await patchState({ seed });
    assert(await hitMinion(), 'no minion to tap');
    await potionDialog('drink-potion-buy', 300);
    assert(await tapText('buy for', '.dialog-potion'), 'Buy button missing');
    // the wave's gold arrives as the coin shower with the HUD counter stepping up
    await browser.waitFor('document.querySelector(".quest-coinfx.shower")', 3000);
    await shot('gold-burst');
    s = await getState();
    const price = potionPrice(event());
    assert(s.player.gems === 100 - price, `gems after buying for ${price}: ${s.player.gems}`);
    assert(s.player.gold === before.player.gold + goldWithEvent(6, event()) + goldWithEvent(10, event()), `gold ${before.player.gold} -> ${s.player.gold} (6 per tap + 10 end gold)`);
    assert(s.quests.active.bossReady, 'all waves should be cleared');
    return `potion ${price} gems (${event().id}); gems 100 -> ${s.player.gems}, gold ${before.player.gold} -> ${s.player.gold}`;
  });

  /* ---------- 4. boss ---------- */
  await step('boss intro (auto-advance)', async () => {
    await waitScreen('boss-intro', 8000);
    const t0 = Date.now();
    await sleep(900);
    await shot('boss-intro');
    assert((await textOf('.boss-title')) === 'Boss Fight 1', `banner text: ${await textOf('.boss-title')}`);
    const name = await textOf('.boss-name');
    const want = deps.db.get('throat-cutter').name;
    assert(name === want, `boss name: ${name} (want ${want})`);
    assert(!(await exists('.boss-continue')), 'the boss intro has no Continue button any more');
    await waitScreen('prebattle', 8000);
    const waited = Date.now() - t0;
    assert(waited >= 1500, `the intro advanced too early (${waited} ms)`);
    return `${name}, advanced after ~${Math.round(waited / 100) / 10} s`;
  });

  await step('pre-battle layout (quest)', async () => {
    await sleep(500);
    await shot('prebattle-quest');
    assert((await count('.prebattle-row.opp .deck-slot .card')) === 2, `boss row should show 2 cards, shows ${await count('.prebattle-row.opp .deck-slot .card')}`);
    assert((await count('.prebattle-row.me .deck-slot .card')) === 2, 'player row should show 2 cards');
    const locked = await browser.evaluate(() => Array.from(document.querySelectorAll('.prebattle-row.me .deck-slot.locked')).map((e) => e.dataset.slot).join(','));
    assert(locked === '0,3,4', `locked slots: ${locked} (only slots 2 and 3 are open at the start)`);
    const s = await getState();
    const drawer = await count('.prebattle-drawer-cards .card');
    assert(drawer === s.cards.length - 2, `drawer should hold the ${s.cards.length - 2} cards not in the deck, holds ${drawer}`);
    const manaHidden = await browser.evaluate(() => document.querySelector('.mana-needed').classList.contains('hidden'));
    assert(manaHidden, 'the mana bar should be hidden for quests');
    assert(await exists('.attack-bar .attack-btn'), 'Attack! button missing');
    assert(!(await exists('.prebattle-name.me')), 'quest pre-battles show no player name');
    return 'rows, locks, drawer ok';
  });

  await step('drag: swap the two deck cards', async () => {
    const before = (await getState()).deck.slice();
    await drag('.prebattle-row.me .deck-slot[data-slot="1"] .card', '.prebattle-row.me .deck-slot[data-slot="2"]');
    const after = (await getState()).deck;
    assert(after[1] === before[2] && after[2] === before[1], `deck not swapped: ${before} -> ${after}`);
    return `${before[1]}<->${before[2]}`;
  });

  await step('drag: deck card out to the drawer (ghost)', async () => {
    const before = (await getState()).deck.slice();
    const drawer0 = await count('.prebattle-drawer-cards .card');
    await drag('.prebattle-row.me .deck-slot[data-slot="2"] .card', '.prebattle-drawer-cards', {
      beforeRelease: async () => {
        await shot('prebattle-dragging');
        assert(await exists('.drag-ghost'), 'no drag ghost while dragging');
      },
    });
    const after = (await getState()).deck;
    assert(after[2] === null, `slot 3 should be empty: ${after}`);
    assert((await count('.prebattle-drawer-cards .card')) === drawer0 + 1, 'drawer should hold one more card');
    return `removed ${before[2]}`;
  });

  await step('drag: drawer card into the empty slot', async () => {
    const drawer0 = await count('.prebattle-drawer-cards .card');
    const uid = await browser.evaluate(() => document.querySelector('.prebattle-drawer-cards .card').dataset.uid);
    await drag('.prebattle-drawer-cards .card', '.prebattle-row.me .deck-slot[data-slot="2"]');
    const after = (await getState()).deck;
    assert(after[2] === uid, `slot 3 should hold ${uid}: ${after}`);
    assert((await count('.prebattle-drawer-cards .card')) === drawer0 - 1, 'drawer should hold one card less');
    return `placed ${uid}`;
  });

  await step('drag: locked slot refuses (toast)', async () => {
    const before = (await getState()).deck.slice();
    await drag('.prebattle-drawer-cards .card', '.prebattle-row.me .deck-slot[data-slot="0"]');
    const after = (await getState()).deck;
    assert(after.join() === before.join(), 'deck changed by a drop on a locked slot');
    const toast = await browser.evaluate(() => Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent).join(' | '));
    assert(/slot is still locked/i.test(toast), `expected a lock toast, got: ${toast}`);
    await sleep(600);
    await shot('prebattle-after-drags');
    return toast.trim();
  });

  await step('Attack! (forced win)', async () => `seed ${await attackWinning('the quest-1 boss fight')}`);

  await step('battle playback 1x (no Skip on quest 1, Escape ignored)', async () => {
    await browser.waitFor('document.querySelector(".battle-round.shown") || document.querySelector(".battle-result")', 10000);
    await shot('battle-1x');
    const round = await textOf('.battle-round');
    assert(/^ROUND \d+$/.test(round || ''), `round label: ${round}`);
    assert((await textOf('.battle-opp-name')) === 'Worm Shaman', `opponent name: ${await textOf('.battle-opp-name')}`);
    assert((await textOf('.battle-my-name')) === PLAYER_NAME, 'player name');
    assert((await count('.battle-row.top .battle-slot .card')) >= 2 && (await count('.battle-row.bottom .battle-slot .card')) >= 2, 'both rows should show 2 cards');
    assert(await exists('.battle-skip.locked'), 'Skip fight should be locked before the quest-3 boss');
    assert((await textOf('.battle-speed')) === '1x', 'speed should start at 1x');
    const hpTexts = await browser.evaluate(() => Array.from(document.querySelectorAll('.battle-hp .bar-label')).map((e) => e.textContent));
    assert(hpTexts.length === 2 && hpTexts.every((t) => /\d+ \/ \d+/.test(t)), `hp bars: ${hpTexts}`);
    await browser.press('Escape');
    await sleep(300);
    assert((await screenId()) === 'battle', 'Escape left the fight');
    return `${round}, hp ${hpTexts.join(' ; ')}`;
  });

  await step('battle playback 2x -> result popup', async () => {
    if (!(await exists('.battle-result'))) {
      assert(await browser.tap('.battle-speed'), 'speed button missing');
      assert((await textOf('.battle-speed')) === '2x', 'speed label should read 2x');
      await sleep(500);
      await shot('battle-2x');
    }
    const kind = await resultKind(90000);
    assert(kind === 'victory', `result: ${kind}`);
    await sleep(1200);
    await shot('battle-result-banner');
    // the Throat Cutter soul card is the first-win loot: shown full size until tapped
    await browser.waitFor('document.querySelector(".battle-result .result-fullcard, .battle-result .reward-card")', 15000);
    await sleep(400);
    await shot('battle-result-card');
    // a tap on the popup only skips the current step; leaving needs Continue
    await browser.tap('.battle-result');
    await sleep(400);
    assert((await screenId()) === 'battle', 'a tap on the result popup left the battle');
    const steps = await finishResult();
    await waitScreen('quest-map', 10000);
    await sleep(800);
    const s = await getState();
    assert(s.quests.main.unlocked === 2 && s.quests.main.firstWins.includes(1), `quest 2 should be unlocked: ${JSON.stringify(s.quests.main)}`);
    assert(s.cards.some((c) => c.cardId === 'throat-cutter'), 'the Throat Cutter reward is missing');
    await shot('quest-map-after-win');
    assert(await exists('.qm-node.done[data-quest="1"]'), 'node 1 should be done (blue)');
    assert(await exists('.qm-node.current[data-quest="2"]'), 'node 2 should be current');
    assert(!(await exists('.dialog-unlock')), 'no unlock popup is due after quest 1');
    return `taps: ${steps.join(' > ')}`;
  }, { timeoutMs: 150000 });

  /* ---------- 5. replay, quest 2 (card slot), Escape ---------- */
  await step('replay a beaten quest, then back', async () => {
    assert(await browser.tap('.qm-node[data-quest="1"]'), 'node 1 missing');
    await waitScreen('quest');
    await sleep(400);
    let s = await getState();
    assert(s.quests.active && s.quests.active.n === 1 && s.quests.active.figuresDone === 0, 'replay did not start quest 1');
    await shot('quest-replay');
    assert(await browser.tap('.hud .hud-back'), 'back button missing');
    await waitScreen('quest-map');
    s = await getState();
    assert(s.quests.active === null, 'leaving an untouched quest should clear it');
    assert(await exists('.qm-map'), 'back should return to the map, not the feed');
    return 'replay started and abandoned';
  });

  await step('quest 2 boss first win -> "Card Slot Unlocked!"', async () => {
    await debugCall('refill');
    assert(await browser.tap('.qm-node[data-quest="2"]'), 'node 2 missing');
    await waitScreen('quest');
    const s0 = await getState();
    const st0 = s0.player.stamina;
    await tapMinionOnce();
    const s1 = await getState();
    assert(s1.player.stamina === st0 - 3, `quest 2 should cost 3 stamina per tap (${st0} -> ${s1.player.stamina})`);
    await tapToBoss();
    assert((await textOf('.boss-title')) === 'Boss Fight 2', `banner: ${await textOf('.boss-title')}`);
    // a tap on the intro skips the wait
    const t0 = Date.now();
    await browser.tap('.boss-stage');
    await waitScreen('prebattle', 5000);
    assert(Date.now() - t0 < 2500, 'tapping the intro did not advance it early');
    const seed = await attackWinning('the quest-2 boss fight');
    await browser.waitFor('document.querySelector(".battle-speed")', 5000);
    await browser.tap('.battle-speed');
    await resultKind(90000);
    await finishResult();
    // the popup follows the win (on the map at the latest)
    await browser.waitFor('document.querySelector(".dialog-backdrop .dialog.dialog-unlock") || ((window.evoker.router.current() || {}).id === "quest-map" && !window.evoker.router.busy)', 10000);
    const title = await unlockPopup('unlock-cardslot');
    const text = await textOf('.dialog-unlock .unlock-text');
    assert(title === 'Card Slot Unlocked!', `popup title: ${title}`);
    assert(text === 'Your deck can now hold 3 cards.', `popup text: ${text}`);
    await closeUnlockPopup();
    await waitScreen('quest-map', 10000);
    const after = await getState();
    assert(after.player.deckSlots === 3, `deckSlots: ${after.player.deckSlots}`);
    assert((after.tutorial.seen || []).includes('cardslot3'), `seen: ${after.tutorial.seen}`);
    assert(await exists('.qm-node.current[data-quest="3"]'), 'node 3 should be current');
    // remembered: a re-render of the map does not show it again
    await browser.evaluate(() => window.evoker.router.rerender());
    await sleep(1200);
    assert(!(await exists('.dialog-unlock')), 'the card slot popup was shown twice');
    return `seed ${seed}; ${title} ${text}`;
  }, { timeoutMs: 180000 });

  await step('Escape on the quest screen = back (abandons an untouched quest)', async () => {
    assert(await browser.tap('.qm-node[data-quest="3"]'), 'node 3 missing');
    await waitScreen('quest');
    await browser.press('Escape');
    await waitScreen('quest-map', 5000);
    const s = await getState();
    assert(s.quests.active === null, 'Escape left the quest active (back handler not used)');
    assert(await exists('.qm-map'), 'Escape on a quest should return to the map');
    return 'ok';
  });

  await step('Escape on the main map stays; the feed (on request) shows quest 3', async () => {
    await browser.press('Escape');
    await sleep(500);
    assert((await screenId()) === 'quest-map' && (await exists('.qm-map')), 'Escape on the main map navigated away');
    await browser.evaluate(() => window.evoker.goTop('quest', { feed: true }));
    await browser.waitFor('document.querySelector(".qm-feed") && !window.evoker.router.busy', 5000);
    await browser.press('Escape');
    await sleep(500);
    assert((await screenId()) === 'quest-map' && (await exists('.qm-feed')), 'Escape on the feed navigated away');
    const sub = await textOf('.feed-quest .feed-sub');
    assert(/Quest 3/.test(sub || ''), `feed quest banner: ${sub}`);
    assert(await browser.tap('.feed-quest'), 'Main Quest banner missing');
    await browser.waitFor('document.querySelector(".qm-node[data-quest=\\"3\\"]") && !window.evoker.router.busy', 8000);
    return sub;
  });

  await step('quest 3 boss: Skip fight -> result', async () => {
    await debugCall('refill');
    // the slot opened by quest 2 (index 3) takes the Throat Cutter won on quest 1
    const s0 = await getState();
    const tc = s0.cards.find((c) => c.cardId === 'throat-cutter');
    assert(tc, 'Throat Cutter missing');
    const deck = s0.deck.slice();
    if (!deck.includes(tc.uid)) deck[3] = tc.uid;
    await patchState({ deck });
    assert(await browser.tap('.qm-node[data-quest="3"]'), 'node 3 missing');
    await waitScreen('quest');
    assert((await count('.quest-minideck .qmd-slot.locked')) === 2 && (await count('.quest-minideck .qmd-slot.filled')) === 3, 'minideck should show 3 cards and 2 locked slots');
    await tapToBoss();
    await waitScreen('prebattle', 8000);
    assert((await count('.prebattle-row.me .deck-slot.locked')) === 2, 'three slots should be open after quest 2');
    const seed = await attackWinning('the quest-3 boss fight');
    await browser.waitFor('document.querySelector(".battle-skip:not(.waiting):not(.locked)") || document.querySelector(".battle-result")', 15000);
    await shot('battle-skip-offered');
    assert(await browser.tap('.battle-skip'), 'Skip missing');
    const kind = await resultKind();
    assert(kind === 'victory', `result: ${kind}`);
    await sleep(700);
    await shot('battle-result-skip');
    assert((await count('.battle-row .card-wrap:not(.dying) .card')) <= 10, 'rows corrupt after skip');
    await finishResult();
    await waitScreen('quest-map', 10000);
    await dismissOverlays(3);
    assert((await getState()).quests.main.unlocked === 4, 'quest 4 should be unlocked');
    return `seed ${seed}, ${kind}`;
  }, { timeoutMs: 150000 });

  /* ---------- 6. portals ---------- */
  await step('portal banner below level 8: the "Portals" popup, no portal map', async () => {
    const lvl = (await getState()).player.level;
    assert(lvl < 8, `expected a low level here: ${lvl}`);
    assert(await browser.tap('.qm-banner'), 'banner missing');
    await browser.waitFor('document.querySelector(".dialog-backdrop:not(.closing) .dialog-title")', 5000);
    const title = await textOf('.dialog-backdrop:not(.closing) .dialog-title');
    const body = await textOf('.dialog-backdrop:not(.closing) .dialog-body');
    assert(title === 'Portals' && body === 'Reach user level 8 to enter portals.', `popup: ${title} / ${body}`);
    await shot('portal-locked');
    assert(await browser.tap('.dialog-backdrop:not(.closing) .dialog-buttons .btn'), 'OK button missing');
    await sleep(500);
    assert(!(await exists('.qm-map.portal')) && (await count('.qm-node')) === 100, 'still on the main map');
    await patchPlayer({ level: 8 });
    return `level ${lvl}: ${title}`;
  });

  await step('portal banner -> portal map -> back to main (no Portal archive)', async () => {
    const s = await getState();
    const name = await textOf('.qm-banner-name');
    const target = await browser.evaluate(() => document.querySelector('.qm-banner').dataset.target);
    assert(target && name, `banner: ${name} -> ${target}`);
    assert(await browser.tap('.qm-banner'), 'banner missing');
    await browser.waitFor('document.querySelector(".qm-map.portal") && !window.evoker.router.busy', 8000);
    await sleep(600);
    await shot('portal-map');
    assert((await count('.qm-node')) === 25, 'a portal has 25 nodes');
    assert((await textOf('.qm-banner-name')) === name, `the portal map names its portal: ${await textOf('.qm-banner-name')}`);
    assert(/^\d+:\d\d:\d\d:\d\d$/.test((await textOf('.qm-banner .qm-countdown')) || ''), 'the portal map shows the countdown');
    assert(!(await exists('.qm-banner.tappable')) && !(await exists('.qm-archive')), 'nothing to choose on the portal map');
    assert(await exists('.qm-node.current[data-quest="1"]'), 'portal node 1 should be current');
    await browser.press('Escape');
    await browser.waitFor(MAIN_MAP_READY, 8000);
    // the nav's map button always leads to the main map, also from a portal map
    assert(await browser.tap('.qm-banner'), 'banner missing');
    await browser.waitFor('document.querySelector(".qm-map.portal") && !window.evoker.router.busy', 8000);
    await toMainMap();
    return `${name} (${s.quests.manualPortal ? 'manual portal ignored' : 'scheduled'})`;
  });

  await step('an ended portal reached by a direct route shows the main map instead', async () => {
    const cur = await browser.evaluate(() => document.querySelector('.qm-banner').dataset.target);
    const ids = await browser.evaluate(() => window.evoker.deps.quests.portals.map((p) => p.id));
    const other = ids.find((id) => id !== cur);
    assert(other, 'no other portal');
    await browser.evaluate((id) => window.evoker.router.go('quest-map', { line: id }), other);
    await browser.waitFor(MAIN_MAP_READY, 8000);
    assert(!(await exists('.qm-map.portal')), 'the ended portal map must not open');
    assert(await exists('.qm-banner.tappable[data-target]'), 'the main map with the running portal banner');
    await toMainMap();
    return other;
  });

  /* ---------- 7. quest 31 (lava theme, piece reward) ---------- */
  await step('debug: level 40, quests to 31, strong deck (old unlocks marked silently)', async () => {
    await debugCall('setLevel', 40);
    await debugCall('unlockQuests', 31);
    await patchPlayer({ manaMax: 200, mana: 200, deckSlots: 5 });
    const uids = [];
    for (const id of STRONG_DECK) uids.push(await debugCall('addCard', id, 4, 50));
    await patchState({ deck: uids });
    await debugCall('refill');
    await toMainMap();
    // features that opened more than a level ago (arena 4, training 5, league 6) get no popup any more
    await sleep(1200);
    assert(!(await exists('.dialog-backdrop:not(.closing)')), `unexpected popup: ${await textOf('.dialog-backdrop .dialog-title')}`);
    const s = await getState();
    assert(s.quests.main.unlocked === 31 && s.player.level === 40, 'debug set-up failed');
    const seen = s.tutorial.seen || [];
    for (const f of ['fusion', 'arena', 'training', 'league', 'cardslot3']) assert(seen.includes(f), `${f} not marked seen: ${seen}`);
    await sleep(1200);
    assert(!(await exists('.dialog-backdrop:not(.closing)')), `unexpected popup on the map: ${await textOf('.dialog-backdrop .dialog-title')}`);
    return `seen ${seen.join(',')}; deck ${uids.join(',')}`;
  });

  await step('quest 31: tap through 10 minions (refills)', async () => {
    assert(await browser.tap('.qm-node[data-quest="31"]'), 'node 31 missing');
    await waitScreen('quest');
    await sleep(400);
    await shot('quest-31');
    assert(/Shadow Swamp 31/.test(await textOf('.quest-title')), `title: ${await textOf('.quest-title')}`);
    const s0 = await getState();
    assert(s0.quests.active.figuresTotal === 10, `quest 31 minions: ${s0.quests.active.figuresTotal}`);
    await tapMinionOnce();
    const s1 = await getState();
    assert(s1.player.stamina === s0.player.stamina - 6, `quest 31 should cost 6 stamina per tap (${s0.player.stamina} -> ${s1.player.stamina})`);
    await tapToBoss();
    await sleep(800);
    await shot('boss-intro-31');
    assert((await textOf('.boss-title')) === 'Boss Fight 31', `banner text: ${await textOf('.boss-title')}`);
    const bossName = await textOf('.boss-name');
    assert(bossName, 'boss name plate missing');
    await waitScreen('prebattle', 8000);
    return `boss ${bossName}`;
  }, { timeoutMs: 120000 });

  await step('pre-battle 31 (lava) -> forced card-piece win', async () => {
    await sleep(500);
    await shot('prebattle-31-lava');
    const theme = await browser.evaluate(() => document.querySelector('.screen[data-screen="prebattle"]').dataset.theme);
    assert(theme === 'lava', `theme: ${theme}`);
    assert((await count('.prebattle-row.me .deck-slot .card')) === 5, 'deck should show 5 cards');
    assert((await count('.prebattle-row.opp .deck-slot .card')) === 5, 'boss row should show 5 cards');
    assert((await count('.prebattle-row.me .deck-slot.locked')) === 0, 'all 5 slots should be open');
    const seed = await attackWinning('quest 31 with a piece reward', (r) => r.reward && r.reward.type === 'piece', 4000);
    await sleep(900);
    await shot('battle-31-lava');
    assert((await browser.evaluate(() => document.querySelector('.screen[data-screen="battle"]').dataset.theme)) === 'lava', 'battle theme should be lava');
    // Escape never leaves a running fight: it skips to the result
    await browser.press('Escape');
    await resultKind();
    assert((await screenId()) === 'battle', 'Escape left the battle screen');
    await browser.waitFor('document.querySelector(".battle-result .reward-card.piece, .battle-result .result-fullcard")', 15000);
    await sleep(600);
    await shot('battle-31-result-piece');
    await finishResult();
    await waitScreen('quest-map', 10000);
    await sleep(500);
    await dismissOverlays(3);
    const after = await getState();
    assert(after.pieces.length === 1, `pieces: ${after.pieces.length}`);
    assert(after.quests.main.unlocked === 32, 'quest 32 should be unlocked');
    return `seed ${seed}; piece of ${after.pieces[0].cardId}`;
  }, { timeoutMs: 90000 });

  /* ---------- 8. pre-battle with the mana bar ---------- */
  await step('pre-battle with Mana needed bar + Drink mana potion', async () => {
    await patchPlayer({ mana: 0, manaPotions: 1 });
    await browser.evaluate(() => {
      const ev = window.evoker;
      const defs = ['scout', 'pikeman', 'envoy'].map((id) => ev.db.get(id));
      const opponent = { name: 'Rival Evoker', level: 3, hp: 1500, maxHp: 1500, faceDown: true, cards: [null, ...defs.map((d) => ev.view.defView(d, 0, 1)), null] };
      return ev.go('prebattle', {
        mode: 'arena', title: 'Rival Evoker', opponent, manaCost: 10,
        fight: () => ({ battle: { events: [], result: { winner: 'draw' } }, rewards: [{ icon: 'coin', label: '12 gold' }] }),
        onDone: () => ev.goTop('quest'),
      });
    });
    await waitScreen('prebattle');
    await sleep(500);
    await shot('prebattle-arena-mana');
    const manaHidden = await browser.evaluate(() => document.querySelector('.mana-needed').classList.contains('hidden'));
    assert(!manaHidden, 'mana bar should be visible for PvP');
    // "Mana needed: deck cost / max mana" (scene_pvp_prepare), red ("over") while the current mana (0) is short
    const label = await textOf('.mana-needed .bar-label');
    const maxMana = (await getState()).player.manaMax;
    const lm = /^Mana needed: ([\d,]+) \/ ([\d,]+)$/.exec(label || '');
    assert(lm && Number(lm[2].replace(/,/g, '')) === maxMana && Number(lm[1].replace(/,/g, '')) > 0, `mana label: ${label} (max mana ${maxMana})`);
    assert(await browser.evaluate(() => document.querySelector('.mana-needed').classList.contains('over')), 'mana bar should be red with 0 mana');
    assert((await count('.prebattle-row.opp .card.size-back')) === 3, 'opponent cards should be face down');
    assert((await textOf('.prebattle-name.me')) === PLAYER_NAME, 'PvP pre-battles show the player name');
    assert(await browser.tap('.attack-bar .attack-btn'), 'Attack! missing');
    await potionDialog('drink-mana-potion', 300);
    assert(/mana is too low/i.test((await textOf('.dialog-potion .msg')) || ''), 'mana dialog text');
    assert(await tapText('use potion now', '.dialog-potion'), 'Use potion now missing');
    await waitScreen('battle', 8000);
    const kind = await resultKind(8000);
    assert(kind === 'draw', `result: ${kind}`);
    await sleep(300);
    await shot('battle-result-draw');
    const steps = await finishResult();
    await waitScreen('quest-map', 8000);
    const s = await getState();
    assert(s.player.manaPotions === 0, 'mana potion not consumed');
    return `${label}; draw result (${steps.join(' > ')})`;
  });

  /* ---------- 9. help ---------- */
  await step('help pages (? button, topic links, Escape back)', async () => {
    assert(await browser.tap('.hud .hud-help'), 'help button missing');
    await waitScreen('help');
    await sleep(400);
    await shot('help-quest-map');
    assert((await textOf('.help-body .screen-title')) === 'Quest map', `help title: ${await textOf('.help-body .screen-title')}`);
    assert((await count('.help-text p')) >= 2, 'help paragraphs missing');
    assert(await tapText('^battle$', '.help-topic-list'), 'Battle topic link missing');
    await waitScreen('help');
    await sleep(300);
    assert((await textOf('.help-body .screen-title')) === 'Battle', 'help topic did not change');
    await shot('help-battle');
    await browser.press('Escape');
    await waitScreen('quest-map', 5000);
    return 'ok';
  });

  /* ---------- 10. reload persistence ---------- */
  await step('reload keeps the save', async () => {
    const before = await getState();
    await browser.navigate(base);
    await browser.waitFor('document.body && document.body.dataset.ready === "1"', 20000);
    await waitScreen('title');
    await browser.tap('.title-screen');
    await waitScreen('quest-map', 8000);
    await sleep(600);
    await shot('after-reload');
    const after = await getState();
    const canon = (v) => JSON.stringify(v, (key, val) => (val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, val[k]])) : val));
    const same = (k, a, b) => assert(canon(a) === canon(b), `${k} changed across reload: ${canon(a)} -> ${canon(b)}`);
    same('name', before.player.name, after.player.name);
    same('level', before.player.level, after.player.level);
    same('gold', before.player.gold, after.player.gold);
    same('gems', before.player.gems, after.player.gems);
    same('deck', before.deck, after.deck);
    same('deckSlots', before.player.deckSlots, after.player.deckSlots);
    same('cards', before.cards.map((c) => c.uid), after.cards.map((c) => c.uid));
    same('quests.main', before.quests.main, after.quests.main);
    same('pieces', before.pieces.map((p) => p.cardId), after.pieces.map((p) => p.cardId));
    same('statPoints', before.player.statPoints, after.player.statPoints);
    same('tutorial.seen', before.tutorial.seen, after.tutorial.seen);
    // a returning player lands on the Quest tab's feed (client landingpage); the map resumes behind Main Quest
    assert(await exists('.feed-quest'), 'login should land on the Quest-tab feed');
    assert(await browser.tap('.feed-quest'), 'Main Quest banner missing');
    await sleep(900);
    assert(await exists('.qm-node.current[data-quest="32"]'), 'map should resume at quest 32');
    return `level ${after.player.level}, ${after.cards.length} cards, quest ${after.quests.main.unlocked}`;
  });
}

qa.run(async (b, base) => {
  browser = b;
  deps = await loadDeps();
  await runScenario(base);
});
