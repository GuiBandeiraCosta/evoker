#!/usr/bin/env node
'use strict';
/**
 * QA playtest for the PvP screens (architecture §8.4-8.6, game-design §5-6) in the 1.7.4 client's layout:
 * Arena (three opponent rows with the strongest card, level and HP, no reroll / difficulty chip / stake, info
 * popup, new opponents after the 30-minute timer, attack -> pre-battle with face-down opponent cards -> battle -> post-battle
 * flow with the gold loot, card XP bars and Proceed, gold and Tournament Points in the save, Drink-potion
 * dialog when mana is short), Pieces (the 4 x 2 grid with the original puzzle overlays, the card popup, the
 * holder popup with Fight / Reroll opponent, fight for a piece and win / lose, complete for gems, a first piece
 * from an empty slot, completion celebration), Replays (Won / Lost, date, time, info, re-watch the last fight),
 * the PvP pre-battle drag-and-drop (incl. a quest-locked deck slot) and the round-3 League: nav unlock at
 * level 6, "Join League" enter popup, standings of 50 players (you + 49) with prize icons and the d:hh:mm:ss
 * countdown, the RULES / PRIZES info screen, opponent-dependent points for Arena / piece-hunt wins once joined, three
 * league fights against the same opponent (+150 each) until the fight button locks, then next-day finish
 * popups: Bronze -> Silver -> Gold promotions (top 3) with prizes, the FINISHED timer, and a pointless Gold
 * league relegated back to Bronze.
 *
 * Set-up: a debug.newGame save raised to level 5 / 6 with gems, gold, potions and all five deck slots open
 * (`player.deckSlots`; slots open by quest progress since round 3). Fights are skipped with "Skip fight"
 * (it fades in at round 1), the result overlay is tapped through (banner, loot, card XP) and left with
 * Proceed; player level-up dialogs and unlock popups that follow are handled on the way back.
 *
 * Drives the real game in headless Edge/Chrome through tools/cdp.js with real clicks and drags; the debug
 * API (window.evoker) and dynamic imports of the game modules are used for the set-up only. Every step is
 * tolerant (a failure is recorded and the run continues) and a screenshot of each step lands in the output
 * directory (default tests/screenshots/qa-pvp/). Exits 1 when a step failed or when the page logged an error.
 *
 * Usage: node tools/qa-pvp.js [--base=http://host:port/] [--out=dir] [--headed] [--slow=ms] [--verbose]
 */
import { createQa, bindApp, screenshotDir, pageBusy, assert, sleep } from './qa-lib.js';

const PLAYER_NAME = 'QA';
const HUNT_CARD = 'arch-demon';            // Rare, 4 pieces, main set (has art)
const STRONG_CARDS = ['chimera', 'devourer', 'giant-spider', 'colossus', 'army-of-ghosts'];
const WEAK_CARD = 'envoy';

const qa = createQa({ title: 'Evoker QA - PvP', banner: 'QA PVP', defaultOut: screenshotDir('qa-pvp'), stepTimeoutMs: 90000, onFail: recover });
const { step, shot } = qa;
const app = bindApp(qa, { goSettleMs: 350, goClosesDialogs: true }); // go: stray dialogs are closed first
const {
  screenId, getState, waitScreen, waitIdle, waitSel, waitGone, count, text, texts, exists, go, back, rerender, updateState,
  patchPlayer, bootFresh, setDeck, tapDialogButton, closeDialog, dismissOverlays, recordToasts, toastMark, toastsSince, centerOf,
  resultKind,
} = app;
/** Whole-pixel centre of an element (scrolled into view). */
const center = (sel) => centerOf(sel, { scroll: true, round: true });
/** Press-move-release with the mouse between two client points (pointer events fire for drag-drop.js). */
const drag = (from, to) => app.drag(from, to, { round: true, holdMs: 0, settleMs: 0 });

/** @type {import('./cdp.js').Browser} */
let browser;

/** Open the Arena screen on a tab through the real tab button. */
async function openArena(tab = 'arena') {
  await go('goTop', 'arena');
  if (tab !== 'arena') {
    assert(await browser.tap(`.tabbar .tab[data-tab="${tab}"]`), `tab ${tab} missing`);
    await waitSel(`.${tab}-tab`);
    await sleep(300);
  }
}

/** The Attack button of arena offer `i`. */
async function attackOffer(i) {
  assert(await browser.tap(`.arena-offer[data-offer="${i}"] button[aria-label^="Attack"]`), 'attack button missing');
}

/** After a failed step: close dialogs and return to the quest map. */
async function recover() {
  if (!browser) return;
  await browser.evaluate(() => { try { window.evoker.ui.dialog.closeAll(); } catch (e) { /* ignore */ } });
  const id = await screenId().catch(() => null);
  if (id === 'battle') {
    await browser.tap('.battle-skip').catch(() => {});
    await sleep(800);
    await browser.tap('.battle-result').catch(() => {});
    await sleep(800);
  }
  await go('goTop', 'quest-map').catch(() => {});
}

/* ------------------------------------------------------------------ fight helper */

/**
 * Start a page-side recorder of the post-battle overlay (battle-result.js): the phases it went through
 * (banner / loot / card / xp / continue / levelup), the "+n" gold / gem fly-outs of the loot step, the number
 * of card XP entries, card level-up popups and full-size reward cards. Polled every 50 ms, read by readResult().
 */
async function watchResult() {
  await browser.evaluate(() => {
    clearInterval(window.__qaResTimer);
    const r = { kind: null, phases: [], fly: [], entries: 0, cardLevelUps: 0, fullcards: [] };
    window.__qaRes = r;
    window.__qaResTimer = setInterval(() => {
      const el = document.querySelector('.battle-result[data-result]');
      if (!el) return;
      r.kind = el.dataset.result;
      const ph = el.dataset.phase;
      if (ph && r.phases[r.phases.length - 1] !== ph) r.phases.push(ph);
      for (const f of el.querySelectorAll('.reward-fly')) if (!f.__qa) { f.__qa = 1; r.fly.push((f.textContent || '').trim()); }
      r.entries = Math.max(r.entries, el.querySelectorAll('.result-entry').length);
      for (const c of el.querySelectorAll('.card-levelup')) if (!c.__qa) { c.__qa = 1; r.cardLevelUps++; }
      for (const c of el.querySelectorAll('.result-fullcard')) if (!c.__qa) { c.__qa = 1; r.fullcards.push(c.getAttribute('aria-label')); }
    }, 50);
  });
}
const readResult = () => browser.evaluate(() => ({ ...window.__qaRes }));

/**
 * On the battle screen: wait for "Skip fight" (it fades in at round 1), skip, wait for the result overlay.
 * @returns {Promise<string>} the result kind (victory / defeat / draw)
 */
async function skipToResult(name, shots) {
  await browser.waitFor('Boolean(document.querySelector(".battle-skip:not(.waiting):not(.locked)"))', 20000);
  if (shots) await shot(`${name}-battle`);
  assert(await browser.tap('.battle-skip'), 'Skip fight button not found');
  const kind = await resultKind(20000);
  await sleep(400);
  if (shots) await shot(`${name}-result`);
  return kind;
}

/**
 * Tap through the post-battle overlay (banner, loot, full-size reward card, card XP bars, card level-ups)
 * until Continue / Proceed is offered, tap it, then handle the player level-up dialog(s) and unlock popups
 * until the screen `backTo` is shown. Dialogs of the destination screen (celebration, league popups) are left.
 * @returns {Promise<{continueLabel: string|null, levelDialogs: number, unlocks: string[]}>}
 */
async function leaveResult(name, backTo, shots) {
  let continueLabel = null;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const st = await browser.evaluate(() => {
      const el = document.querySelector('.battle-result[data-result]');
      const btn = document.querySelector('.result-continue');
      const stripe = btn && btn.closest('.result-stripe');
      return {
        el: Boolean(el), phase: el ? el.dataset.phase : null,
        ready: Boolean(btn && !btn.disabled && stripe && stripe.classList.contains('shown')),
        label: btn ? (btn.textContent || '').trim() : null,
      };
    });
    if (!st.el || st.phase === 'levelup') break;
    if (st.ready) {
      await sleep(300);
      if (shots) await shot(`${name}-proceed`);
      continueLabel = st.label;
      assert(await browser.tap('.result-continue'), 'Continue / Proceed button missing');
      break;
    }
    await browser.tap('.battle-result');
    await sleep(350);
  }
  let levelDialogs = 0;
  const unlocks = [];
  while (Date.now() < deadline) {
    const lvl = await browser.evaluate(() => {
      const b = document.querySelector('.dialog-backdrop.lvl-backdrop:not(.closing)');
      if (!b) return null;
      const fresh = !b.dataset.qaSeen;
      b.dataset.qaSeen = '1';
      return { intro: b.classList.contains('intro'), fresh, proceeding: b.dataset.qaProceed === '1' };
    });
    if (lvl) {
      if (lvl.fresh) levelDialogs++;
      if (lvl.intro) { await browser.tap('.lvl-backdrop'); await sleep(300); continue; }
      if (!lvl.proceeding) {
        await browser.evaluate(() => { const b = document.querySelector('.lvl-backdrop:not(.closing)'); if (b) b.dataset.qaProceed = '1'; });
        await browser.tap('.lvl-backdrop:not(.closing) .lvl-proceed');
      }
      await sleep(400);
      continue;
    }
    if (await exists('.dialog-backdrop:not(.closing) .dialog-unlock')) {
      unlocks.push(await text('.dialog-backdrop:not(.closing) .dialog-unlock .dialog-title') || '?');
      await tapDialogButton('^OK$');
      await sleep(400);
      continue;
    }
    if ((await screenId()) === backTo && !(await browser.evaluate(pageBusy))) break;
    await sleep(250);
  }
  await waitScreen(backTo, 10000);
  await sleep(300);
  return { continueLabel, levelDialogs, unlocks };
}

/**
 * From the pre-battle screen: Attack!, (potion dialog handled by `onPotion`), battle, Skip fight, tap through
 * the result overlay, Proceed, and wait for `backTo`.
 * @returns {Promise<{kind: string, phases: string[], fly: string[], entries: number, cardLevelUps: number, fullcards: string[], continueLabel: string|null, levelDialogs: number, unlocks: string[]}>}
 */
async function playFight(name, { backTo, shots = true, onPotion = null } = {}) {
  await waitScreen('prebattle');
  await sleep(400);
  if (shots) await shot(`${name}-prebattle`);
  assert(await browser.tap('.attack-bar .attack-btn'), 'Attack! button not found');
  await sleep(400);
  if (await exists('.dialog-potion')) {
    if (!onPotion) throw new Error('unexpected Drink-potion dialog');
    await onPotion();
  }
  await waitScreen('battle', 15000);
  await watchResult();
  const kind = await skipToResult(name, shots);
  const left = await leaveResult(name, backTo, shots);
  const rec = await readResult();
  return { ...rec, kind, ...left };
}

/** Gold of the loot step ("+1,234" fly-out), 0 when none. */
const flyAmount = (res) => res.fly.reduce((sum, t) => sum + (Number(String(t).replace(/[^\d]/g, '')) || 0), 0);
/** Player progress as one comparable number (level, then xp). */
const xpScore = (s) => s.player.level * 1e9 + (s.player.xp || 0);

/** Deck helpers (set-up only): five maxed strong cards / a lone level-1 Envoy in slot 2 (mana refilled). */
const strongDeck = () => setDeck(STRONG_CARDS);
const weakDeck = () => setDeck([null, WEAK_CARD, null, null, null], 0, 1);
const deckManaNow = () => browser.evaluate(async () => (await import('/src/game/state.js')).deckMana(window.evoker.state(), window.evoker.deps));
const setMana = (mana, manaPotions) => patchPlayer({ mana, manaPotions });
/** Open deck slots (round 3: they open with quest first wins; slot indices open in the order 2, 1, 3, 0, 4). */
const setDeckSlots = (deckSlots) => patchPlayer({ deckSlots });
/** Start a piece hunt for HUNT_CARD with one dropped piece. */
const addHunt = () => browser.evaluate(async (id) => {
  const pieces = await import('/src/game/pieces.js');
  window.evoker.store.update((s, d, n) => pieces.addPiece(s, d, n, id).state);
}, HUNT_CARD);

/** League helpers (set-up / expectations only). */
const leagueMult = (s) => (s.sim.league && s.sim.league.doublePoints ? 2 : 1);
/** Points that surely beat every simulated player of the current tier (simTop is a day's best, x2 on double days). */
const winningPoints = () => browser.evaluate(async () => {
  const lg = await import('/src/game/league.js');
  const s = window.evoker.state();
  return lg.tierById(s.sim.league.tier).simTop * 2 + 1000;
});
const leagueRows = () => browser.evaluate(() => Array.from(document.querySelectorAll('.league-row')).map((r) => ({
  simId: r.dataset.simId, rank: r.dataset.rank, me: r.classList.contains('me'), spent: r.classList.contains('spent'),
  rankText: (r.querySelector('.league-rank') || {}).textContent, top: Boolean(r.querySelector('.league-rank.top')),
  name: ((r.querySelector('.league-name') || {}).textContent || '').trim(),
  points: Number((r.querySelector('.league-points .num') || {}).textContent),
  prizes: r.querySelectorAll('.league-prize-item').length,
  locked: Boolean(r.querySelector('.league-fight-btn.locked')),
})));
/** "Join League" on the open enter / finish popup, then wait for the standings to settle. */
async function joinLeague() {
  assert(await tapDialogButton('^Join League$'), 'Join League button missing');
  await waitGone('.dialog-backdrop:not(.closing)');
  await waitIdle();
  await sleep(500);
}
/** Read the open league finish popup (comp_league_finish_popup). */
const finishPopup = () => browser.evaluate(() => {
  const d = document.querySelector('.dialog-backdrop:not(.closing) .dialog-league-finish');
  if (!d) return null;
  const t = (sel) => ((d.querySelector(sel) || {}).textContent || '').trim();
  return {
    title: t('.dialog-title'), headline: t('.league-popup-headline'), passed: t('.league-popup-passed'), rank: t('.league-popup-rank'),
    rewards: Array.from(d.querySelectorAll('.league-popup-rewards .league-prize-item')).map((x) => `${x.className.replace('league-prize-item', '').trim()} ${(x.textContent || '').trim()}`),
    enterText: t('.league-popup-next-label'), next: t('.league-popup-next'), button: t('.dialog-buttons .btn'),
  };
});
/**
 * Move the whole save one day back (debug.addDays re-runs the save-open hooks of src/app.js onOpen, which
 * settle an earlier day's league), open the League tab and wait for the finish popup of the settled league.
 * The next day's login reward is marked as claimed first so that it does not mix with the league prizes.
 * @returns {Promise<object>} the save just before the day change
 */
async function nextLeagueDay() {
  await go('goTop', 'arena');
  await updateState(`(s, d, n) => ({ ...s, daily: { ...s.daily, lastClaim: new Date(n + 86400000).toISOString().slice(0, 10) } })`);
  const before = await getState();
  assert(before.sim.league && !before.sim.league.settled && !before.sim.leaguePending, 'the league should still be running before the day change');
  await browser.evaluate(() => window.evoker.debug.addDays(1));
  await sleep(300);
  const opened = await getState();
  assert(opened.sim.league.settled && opened.sim.leaguePending, 'reopening the save on a new day should settle the league');
  await go('goTop', 'league');
  await waitSel('.dialog-league-finish', 6000);
  await sleep(600);
  return before;
}

/* ------------------------------------------------------------------ the scenario */

async function runScenario(base) {
  await step('boot with a fresh save', async () => {
    await bootFresh(base);
    await browser.evaluate((n) => window.evoker.debug.newGame(n), PLAYER_NAME);
    await browser.evaluate(() => { const d = window.evoker.debug; d.setLevel(5); d.giveGems(3000); d.giveGold(2000); d.givePotions(3, 2); d.refill(); });
    // Deck slots open with quest progress since round 3 (2 at start); the PvP steps need all five.
    await setDeckSlots(5);
    await recordToasts();
    let s = await getState();
    assert(s.player.level === 5 && s.player.gems >= 3000 && s.player.deckSlots === 5, 'debug set-up failed');
    // The map shows the "... Unlocked!" popups for the new level once; get them out of the way.
    await go('goTop', 'quest-map');
    await sleep(600);
    let popups = (await dismissOverlays()).length;
    assert(!(await exists('.dialog-backdrop:not(.closing)')), 'a dialog is still open after the set-up');
    assert(await exists('.nav-btn[data-nav="arena"]:not(.locked)'), 'Arena nav button should be open at level 5');
    assert(await exists('.nav-btn[data-nav="league"].locked'), 'League nav button should be locked below level 6');
    // League unlocks at level 6.
    await browser.evaluate(() => window.evoker.debug.setLevel(6));
    await go('goTop', 'arena');
    await go('goTop', 'quest-map');
    await sleep(600);
    popups += (await dismissOverlays()).length;
    assert(!(await exists('.dialog-backdrop:not(.closing)')), 'a dialog is still open after level 6');
    assert(await exists('.nav-btn[data-nav="league"]:not(.locked)'), 'League nav button should be open at level 6');
    s = await getState();
    assert(!s.sim.leagueJoined, 'a new save has not joined the league yet');
    return `level ${s.player.level}, ${s.player.gems} gems, ${s.player.manaPotions} mana potions, ${s.player.deckSlots} deck slots, ${popups} unlock popups dismissed`;
  });

  /* ================================================================= ARENA */
  let offerNamesBefore = [];
  await step('arena: three opponents like the client list (green / yellow / red, level, HP)', async () => {
    await openArena('arena');
    await sleep(500);
    await shot('arena-offers');
    assert((await count('.arena-offer')) === 3, 'expected 3 arena offers');
    const colors = await browser.evaluate(() => Array.from(document.querySelectorAll('.arena-offer')).map((e) => ['green', 'yellow', 'red'].find((c) => e.classList.contains('c-' + c)) || '?'));
    assert(colors.join(',') === 'green,yellow,red', `offer colours ${colors.join(',')}`);
    offerNamesBefore = await texts('.arena-offer .offer-name');
    assert(offerNamesBefore.every(Boolean), 'offer names missing');
    const s = await getState();
    const rows = await browser.evaluate(() => Array.from(document.querySelectorAll('.arena-offer')).map((r) => ({
      level: (r.querySelector('.offer-level .num') || {}).textContent, hp: ((r.querySelector('.offer-hp .num') || {}).textContent || '').replace(/,/g, ''),
    })));
    s.sim.arena.offers.forEach((o, i) => {
      const sim = s.sim.players.find((p) => p.id === o.simId);
      assert(rows[i].level === String(o.level), `row ${i} level ${rows[i].level}, offer ${o.level}`);
      assert(rows[i].hp === String(Math.round(sim.hpMax * (o.power || 1))), `row ${i} HP ${rows[i].hp}, sim ${sim.hpMax} x ${o.power}`);
    });
    // the client's list has none of these
    for (const gone of ['.reroll-bar', '.offer-diff', '.arena-cost', '.league-stake', '.arena-offer .stat-chip.mana']) assert(!(await exists(gone)), `${gone} should be gone`);
    const portraits = await browser.evaluate(() => Array.from(document.querySelectorAll('.arena-offer .offer-portrait img')).map((i) => i.complete && i.naturalWidth > 0));
    assert(portraits.length === 3 && portraits.every(Boolean), `strongest-card portraits broken: ${JSON.stringify(portraits)}`);
    assert((await count('.arena-offer .offer-info')) === 3 && (await count('.arena-offer .offer-attack')) === 3, 'info and attack buttons');
    const banner = await exists('.event-banner');
    if (banner) assert(/^\d+:\d\d:\d\d$/.test(await text('.event-banner .event-timer') || ''), 'event banner timer h:mm:ss');
    // HUD of a main tab: "?" alone, no back arrow
    assert(await browser.evaluate(() => document.querySelector('.hud .hud-back').hidden), 'no back arrow on the Arena tab');
    assert(await exists('.hud .hud-help'), '"?" button');
    return `${offerNamesBefore.join(', ')}; event banner ${banner ? 'shown' : 'none today'}`;
  });

  await step('arena: info popup', async () => {
    await openArena('arena');
    assert(await browser.tap('.arena-offer[data-offer="1"] .offer-info'), 'info button missing');
    await waitSel('.dialog-sim-info');
    await sleep(400);
    await shot('arena-info-popup');
    const t = await text('.dialog-sim-info');
    for (const needle of [offerNamesBefore[1], 'Level', 'Quests', 'Fights Won']) assert(t.includes(needle), `info popup lacks "${needle}"`);
    assert(await exists('.dialog-sim-info .sim-best .card'), 'best card missing in the info popup');
    assert(!(await exists('.dialog-sim-info .sim-reroll')), 'no reroll in the arena info popup');
    assert(await closeDialog(), 'close button missing');
  });

  await step('arena: info popup -> attack -> pre-battle (face-down cards)', async () => {
    await openArena('arena');
    assert(await browser.tap('.arena-offer[data-offer="0"] .offer-info'), 'info button missing');
    await waitSel('.dialog-sim-info');
    assert(await browser.tap('.dialog-sim-info .sim-actions .sim-attack'), 'attack button missing in the popup');
    await waitScreen('prebattle');
    await sleep(500);
    await shot('arena-prebattle-from-popup');
    const s = await getState();
    const offer = s.sim.arena.offers[0];
    const sim = s.sim.players.find((p) => p.id === offer.simId);
    const backs = await count('.prebattle-row.opp .card.size-back');
    const cardsInDeck = sim.deck.filter(Boolean).length;
    assert(backs === cardsInDeck, `opponent row shows ${backs} card backs, sim has ${cardsInDeck} cards`);
    assert((await count('.prebattle-row.opp .card-back img')) === backs, 'tribe emblems missing on card backs');
    const title = await text('.prebattle-name.opp');
    assert(title === sim.name, `pre-battle title "${title}" should be the opponent name "${sim.name}"`);
    assert((await text('.prebattle-name.me')) === PLAYER_NAME, 'PvP pre-battle should show the player name above the deck');
    await back('arena');
    return `${backs} card backs, title ${title}`;
  });

  await step('arena: new opponents after the 30-minute timer (no reroll button)', async () => {
    await openArena('arena');
    const before = await getState();
    await updateState(`(s, d, n) => ({ ...s, sim: { ...s.sim, arena: { ...s.sim.arena, rerollAt: n - 1 } } })`);
    await rerender();
    const after = await getState();
    assert((await count('.arena-offer')) === 3, 'still 3 offers');
    assert(after.player.gems === before.player.gems, 'new opponents are free');
    assert(after.sim.arena.rerollAt > Date.now() + 25 * 60000, 'timer rearmed to ~30 min');
    const ids = (s) => s.sim.arena.offers.map((o) => o.simId).join(',');
    assert(ids(after) !== ids(before), 'the offers should have changed');
    await shot('arena-new-opponents');
    return (await texts('.arena-offer .offer-name')).join(', ');
  });

  await step('arena: attack -> fight -> result (gold + Tournament Points)', async () => {
    await strongDeck();
    await openArena('arena');
    const before = await getState();
    const cost = await deckManaNow();
    const deckCount = before.deck.filter(Boolean).length;
    await attackOffer(0);
    const res = await playFight('arena-fight', { backTo: 'arena' });
    const after = await getState();
    const won = res.kind === 'victory';
    // PvP loot: the gold of any fight flies to the purse ("+n"), then the card XP bars, then Proceed.
    assert(res.phases.includes('loot') && res.fly.length === 1, `the loot step should show the gold (phases ${res.phases.join('>')}, fly ${res.fly.join(',')})`);
    const gold = flyAmount(res);
    assert(gold > 0 && after.player.gold === before.player.gold + gold, `gold ${before.player.gold} -> ${after.player.gold}, loot said +${gold}`);
    assert(res.phases.includes('xp') && res.entries === deckCount, `card XP step should list the ${deckCount} deck cards, saw ${res.entries}`);
    assert(res.continueLabel === 'Proceed', `PvP result should end with Proceed, got "${res.continueLabel}"`);
    assert(xpScore(after) > xpScore(before), 'the fight should give player XP');
    if (won) assert(after.player.tournamentPoints === before.player.tournamentPoints + 10, 'a win gives 10 Tournament Points');
    else assert(after.player.tournamentPoints === before.player.tournamentPoints, 'no TP on a loss');
    assert(after.player.mana === before.player.mana - cost, `mana ${before.player.mana} -> ${after.player.mana}, deck costs ${cost}`);
    assert(after.replays.length === before.replays.length + 1 && after.replays[0].mode === 'arena', 'replay not recorded');
    assert(JSON.stringify(after.sim.league) === JSON.stringify(before.sim.league), 'no league points before the player joined the league');
    assert((await count('.arena-offer')) === 3, 'offers rerolled after the fight');
    await shot('arena-after-fight');
    return `${res.kind}, +${gold} gold, phases ${res.phases.join('>')}, ${res.levelDialogs} level-up dialog(s)`;
  }, { timeoutMs: 120000 });

  /* ------------------------------------------------ not enough mana -> potion dialog */
  await step('arena: not enough mana -> Drink potion (use)', async () => {
    await setMana(0, 2);
    await openArena('arena');
    await attackOffer(1);
    await waitScreen('prebattle');
    await sleep(300);
    // the bar reads "Mana needed: deck cost / max mana" (scene_pvp_prepare) and turns red ("over") when the
    // current mana (0 here) is below the deck's cost
    const barText = await text('.mana-needed');
    const st = await getState();
    const m = /Mana needed: ([\d,]+) \/ ([\d,]+)/.exec(barText || '');
    assert(m && Number(m[2].replace(/,/g, '')) === st.player.manaMax, `mana bar "${barText}" should show the deck cost / max mana ${st.player.manaMax}`);
    assert(Number(m[1].replace(/,/g, '')) > 0, `mana bar "${barText}" should show the deck cost`);
    assert(await browser.evaluate(() => document.querySelector('.mana-needed').classList.contains('over')), 'mana bar should be red (over) with 0 mana');
    let used = false;
    const res = await playFight('arena-potion-use', {
      backTo: 'arena',
      onPotion: async () => {
        await sleep(300);
        await shot('arena-potion-dialog-use');
        const t = await text('.dialog-potion');
        assert(/Mana is too low/.test(t), `potion dialog text: ${t}`);
        assert(/2 potions/.test(t), 'potion count should read "2 potions"');
        assert(await exists('.dialog-potion .potion-img.blue'), 'mana potion should be the blue one');
        assert(await tapDialogButton('Use potion now'), '"Use potion now" button missing');
        used = true;
      },
    });
    assert(used, 'the potion dialog never appeared');
    const after = await getState();
    assert(after.player.manaPotions === 1, `mana potions should be 1, got ${after.player.manaPotions}`);
    return `${res.kind}`;
  }, { timeoutMs: 120000 });

  await step('arena: no potions -> buy for gems', async () => {
    await setMana(0, 0);
    await openArena('arena');
    const before = await getState();
    await attackOffer(1);
    let price = 0;
    const res = await playFight('arena-potion-buy', {
      backTo: 'arena', shots: false,
      onPotion: async () => {
        await sleep(300);
        await shot('arena-potion-dialog-buy');
        const t = await text('.dialog-potion');
        assert(/no Mana potions left/.test(t), `potion dialog text: ${t}`);
        const m = /Buy for (\d+)/.exec(t);
        assert(m, 'Buy button missing');
        price = Number(m[1]);
        assert(price === 40 || price === 20, `potion price ${price}`);
        assert(await tapDialogButton('Buy for'), 'Buy button not tappable');
      },
    });
    const after = await getState();
    assert(after.player.gems === before.player.gems - price, `gems ${before.player.gems} -> ${after.player.gems}, expected -${price}`);
    return `${res.kind}, paid ${price} gems`;
  }, { timeoutMs: 120000 });

  await step('arena: potion dialog cancelled stays on pre-battle', async () => {
    await setMana(0, 0);
    await openArena('arena');
    await attackOffer(2);
    await waitScreen('prebattle');
    await browser.tap('.attack-bar .attack-btn');
    await waitSel('.dialog-potion');
    assert(await closeDialog(), 'close button missing');
    await sleep(300);
    assert((await screenId()) === 'prebattle', 'should still be on the pre-battle screen');
    assert(!(await exists('.attack-bar .attack-btn[disabled]')), 'Attack! must be enabled again');
    await back('arena');
    await setMana(500, 2);
  });

  /* ------------------------------------------------ pre-battle drag and drop */
  await step('prebattle: drag a card from the drawer into the deck and out again, locked slot', async () => {
    await setMana(500, 2);
    // three open slots (indices 2, 1, 3): slot index 0 is still locked
    await setDeckSlots(3);
    await browser.evaluate(async (id) => {
      const col = await import('/src/game/collection.js');
      window.evoker.store.update((s, d) => col.setDeck(s, d, [null, s.deck.filter(Boolean)[0] || null, null, null, null]).state);
      window.evoker.debug.addCard(id, 0, 1);
    }, WEAK_CARD);
    await openArena('arena');
    await attackOffer(0);
    await waitScreen('prebattle');
    await sleep(400);
    const before = await getState();
    const locked = await browser.evaluate(() => Array.from(document.querySelectorAll('.prebattle-row.me .deck-slot.locked')).map((e) => e.dataset.slot).join(','));
    assert(locked === '0,4', `locked slots with 3 deck slots should be 0,4, got "${locked}"`);
    const from = await center('.prebattle-drawer-cards .card[data-draggable]');
    const to = await center('.prebattle-row.me .deck-slot[data-slot="2"]');
    assert(from && to, 'drawer card or slot 3 not found');
    const uid = await browser.evaluate(() => document.querySelector('.prebattle-drawer-cards .card[data-draggable]').dataset.uid);
    await drag(from, to);
    await sleep(400);
    let s = await getState();
    assert(s.deck[2] === uid, `slot 3 should hold ${uid}, deck = ${JSON.stringify(s.deck)}`);
    assert(await exists('.prebattle-row.me .deck-slot[data-slot="2"] .card'), 'card not drawn in slot 3');
    await shot('prebattle-after-drop');
    // drag the card back out (drop on the opponent name) -> removed from the deck
    const fromSlot = await center('.prebattle-row.me .deck-slot[data-slot="2"] .card');
    const outside = await center('.prebattle-name.opp');
    await drag(fromSlot, outside);
    await sleep(500);
    s = await getState();
    assert(s.deck[2] === null, `slot 3 should be empty after dropping outside, deck = ${JSON.stringify(s.deck)}`);
    // a drop on the locked slot index 0 is refused with a toast
    const tm = await toastMark();
    let fromSlot1 = await center('.prebattle-row.me .deck-slot[data-slot="1"] .card');
    let to0 = await center('.prebattle-row.me .deck-slot[data-slot="0"]');
    await drag(fromSlot1, to0);
    await sleep(400);
    s = await getState();
    assert(s.deck[1] === before.deck[1] && s.deck[0] === null, `a locked slot must refuse the card, deck = ${JSON.stringify(s.deck)}`);
    const toasts = await toastsSince(tm);
    assert(toasts.some((t) => /slot is still locked/.test(t)), `locked-slot toast missing: ${toasts.join(' | ')}`);
    await shot('prebattle-locked-slot');
    // all five slots open -> the card moves to slot index 0
    await setDeckSlots(5);
    await rerender();
    assert((await count('.prebattle-row.me .deck-slot.locked')) === 0, 'no locked slot with 5 deck slots');
    fromSlot1 = await center('.prebattle-row.me .deck-slot[data-slot="1"] .card');
    to0 = await center('.prebattle-row.me .deck-slot[data-slot="0"]');
    await drag(fromSlot1, to0);
    await sleep(400);
    s = await getState();
    assert(s.deck[0] === before.deck[1] && s.deck[1] === null, `card should have moved to slot 1, deck = ${JSON.stringify(s.deck)}`);
    await shot('prebattle-after-move');
    await back('arena');
  });

  /* ================================================================= PIECES */
  await step('pieces: start a hunt with a dropped piece (4 x 2 grid, original puzzle overlay)', async () => {
    await addHunt();
    await openArena('pieces');
    await sleep(500);
    await shot('pieces-hunt');
    assert((await count('.piece-slot')) === 8, 'expected 8 piece slots');
    assert((await count('.piece-slot.hunt')) === 1, 'expected 1 active hunt');
    assert((await count('.piece-slot.empty .piece-add')) === 7, '7 empty slots with the add button');
    assert((await count('.piece-slot.hunt .puzzle-piece')) === 4, 'rare card = 4 puzzle pieces');
    assert((await count('.piece-slot.hunt .puzzle-piece.owned')) === 1, '1 piece owned');
    const srcs = await browser.evaluate(() => Array.from(document.querySelectorAll('.piece-slot.hunt .puzzle-piece')).map((p) => p.getAttribute('src')));
    assert(srcs.join(',') === ['piece4_1', 'piece4_2b', 'piece4_3b', 'piece4_4b'].map((n) => `/assets/orig/ui/${n}.png`).join(','), `piece sprites ${srcs.join(',')}`);
    assert(await browser.evaluate(() => { const i = document.querySelector('.piece-slot.hunt .puzzle-art'); return Boolean(i && i.complete && i.naturalWidth > 0); }), 'card art under the pieces');
    assert(await exists('.piece-slot.hunt .piece-attack'), 'attack button under the card');
    // the card opens its pieces with the buy-the-rest button
    assert(await browser.tap('.piece-slot.hunt .piece-card'), 'puzzle card missing');
    await waitSel('.dialog-piece-detail');
    await sleep(300);
    await shot('pieces-card-popup');
    assert((await text('.dialog-piece-detail .dialog-title')) === 'Arch Demon', 'popup title');
    assert((await text('.dialog-piece-detail .piece-detail-count')) === '1 / 4', 'pieces count');
    assert(/Complete: \d+/.test((await texts('.dialog-piece-detail .dialog-buttons .btn')).join('|')), 'complete-for-gems button');
    assert(await closeDialog(), 'close button missing');
    return srcs.length + ' pieces';
  });

  await step('pieces: holder info popup (Fight / Reroll opponent)', async () => {
    await openArena('pieces');
    assert(await browser.tap('.piece-slot.hunt .piece-attack'), 'attack button missing');
    await waitSel('.dialog-sim-info');
    await sleep(300);
    await shot('pieces-holder-info');
    const s = await getState();
    const sim = s.sim.players.find((p) => p.id === s.pieces[0].holderId);
    assert(sim && (await text('.dialog-sim-info .sim-name')) === sim.name, 'popup shows the holder');
    assert(/Reroll opponent\s*10/.test(await text('.dialog-sim-info .sim-reroll') || ''), 'Reroll opponent for 10 gems');
    assert(await exists('.dialog-sim-info .sim-attack'), 'fight button');
    assert(await closeDialog(), 'close button missing');
    return sim.name;
  });

  /** Pieces tab: the attack button under hunt `i`, then Fight in the holder popup. Resolves with the holder name. */
  async function attackHunt(i = 0) {
    await openArena('pieces');
    assert(await browser.tap(`.piece-slot[data-slot="${i}"] .piece-attack`), 'hunt attack button missing');
    await waitSel('.dialog-sim-info');
    const name = await text('.dialog-sim-info .sim-name');
    assert(await browser.tap('.dialog-sim-info .sim-attack'), 'fight button missing in the holder popup');
    return name;
  }

  await step('pieces: lose a fight (weak deck) -> no piece, new holder', async () => {
    await weakDeck();
    const before = await getState();
    const holderName = await attackHunt(0);
    await waitScreen('prebattle');
    assert((await text('.prebattle-name.opp')) === holderName, `pre-battle title should be the holder "${holderName}"`);
    assert((await count('.prebattle-row.opp .card.size-back')) > 0, 'holder cards should be face down');
    const res = await playFight('pieces-lose', { backTo: 'arena' });
    const after = await getState();
    assert(res.kind === 'defeat', `expected a defeat with a lone Envoy, got ${res.kind}`);
    assert(!res.phases.includes('loot'), `a piece fight has no gold loot (phases ${res.phases.join('>')})`);
    assert(res.entries === 1 && res.continueLabel === 'Proceed', `card XP for the lone Envoy then Proceed (entries ${res.entries}, "${res.continueLabel}")`);
    assert(after.pieces[0].owned === before.pieces[0].owned, 'a loss must not give a piece');
    assert(after.pieces[0].holderId !== before.pieces[0].holderId, 'holder should be rerolled after a fight');
    assert(after.player.tournamentPoints === before.player.tournamentPoints, 'no TP on a loss');
    assert((await screenId()) === 'arena' && (await exists('.pieces-tab')), 'should return to the Pieces tab');
    await sleep(300);
    await shot('pieces-after-loss');
    return `${res.kind}, phases ${res.phases.join('>')}`;
  }, { timeoutMs: 120000 });

  await step('pieces: win a fight (strong deck) -> +1 piece', async () => {
    await strongDeck();
    const before = await getState();
    await attackHunt(0);
    const tm = await toastMark();
    const res = await playFight('pieces-win', { backTo: 'arena' });
    const after = await getState();
    assert(res.kind === 'victory', `expected a victory with the strong deck, got ${res.kind}`);
    assert(after.pieces[0].owned === before.pieces[0].owned + 1, 'a win must give a piece');
    assert(after.player.tournamentPoints === before.player.tournamentPoints + 10, 'piece win gives 10 TP');
    assert(res.entries === 5 && res.continueLabel === 'Proceed', `card XP of the 5 deck cards then Proceed (entries ${res.entries})`);
    await sleep(600);
    // the result flow shows the won piece (battle-result sets info.rewardShown): no second "You won a piece" toast
    const toasts = await toastsSince(tm);
    const shown = res.fullcards.length > 0 || res.phases.includes('card');
    if (shown) assert(!toasts.some((t) => /You won a piece/.test(t)), `piece shown twice: ${toasts.join(' | ')}`);
    else assert(toasts.some((t) => /You won a piece of Arch Demon/.test(t)), `"You won a piece" toast missing: ${toasts.join(' | ')}`);
    await shot('pieces-after-win');
    assert((await count('.piece-slot.hunt .puzzle-piece.owned')) === after.pieces[0].owned, 'owned pieces should match');
    return `${res.kind}, owned ${after.pieces[0].owned}/4`;
  }, { timeoutMs: 120000 });

  await step('pieces: Reroll opponent (10 gems) picks another holder', async () => {
    await openArena('pieces');
    const before = await getState();
    assert(await browser.tap('.piece-slot[data-slot="0"] .piece-attack'), 'attack button missing');
    await waitSel('.dialog-sim-info');
    assert(await browser.tap('.dialog-sim-info .sim-reroll'), 'Reroll opponent button missing');
    // the popup reopens with the new holder
    await sleep(700);
    await waitSel('.dialog-sim-info');
    await shot('pieces-rerolled-holder');
    const after = await getState();
    assert(after.player.gems === before.player.gems - 10, 'a new holder should cost 10 gems');
    assert(after.pieces[0].holderId !== before.pieces[0].holderId, 'holder should change');
    const sim = after.sim.players.find((p) => p.id === after.pieces[0].holderId);
    const name = await text('.dialog-sim-info .sim-name');
    assert(sim && sim.name === name, `the popup should show the new holder (${name} vs ${sim && sim.name})`);
    assert(await closeDialog(), 'close button missing');
    return `new holder ${name}`;
  });

  await step('pieces: last piece won -> completion celebration', async () => {
    await updateState(`(s) => ({ ...s, pieces: s.pieces.map((h, i) => (i === 0 ? { ...h, owned: h.total - 1 } : h)) })`);
    await strongDeck();
    await openArena('pieces');
    const before = await getState();
    assert((await count('.piece-slot.hunt .puzzle-piece.owned')) === 3, '3 pieces owned');
    await attackHunt(0);
    const res = await playFight('pieces-complete', { backTo: 'arena' });
    assert(res.kind === 'victory', `expected a victory, got ${res.kind}`);
    // one celebration: the result flow's full card ("Card added to set") when it showed one, else the popup
    if (res.fullcards.length) {
      await sleep(1000);
      assert(!(await exists('.dialog-celebrate')), 'the completed card was celebrated twice');
      await shot('pieces-celebration');
    } else {
      await waitSel('.dialog-celebrate');
      await sleep(700);
      await shot('pieces-celebration');
      const t = await text('.dialog-celebrate');
      assert(/Card complete/.test(t) && /Arch Demon/.test(t), 'celebration popup text');
      assert(await exists('.dialog-celebrate .celebrate-card'), 'celebration shows the card');
      assert(await tapDialogButton('Great'), 'Great! button missing');
      await waitGone('.dialog-backdrop:not(.closing)');
    }
    const after = await getState();
    assert(after.pieces.length === before.pieces.length - 1, 'completed hunt should be removed');
    assert(after.cards.some((c) => c.cardId === HUNT_CARD), 'the completed card should be in the collection');
    await sleep(300);
    assert((await count('.piece-slot.hunt')) === 0, 'grid should show no hunt');
    return `card created; result phases ${res.phases.join('>')}`;
  }, { timeoutMs: 120000 });

  await step('pieces: get a first piece from an empty slot', async () => {
    await openArena('pieces');
    const before = await getState();
    assert(before.pieces.length === 0, `expected no hunts, found ${before.pieces.length}`);
    const price = Number(((await text('.piece-slot[data-slot="0"] .piece-get')) || '').replace(/[^\d]/g, ''));
    assert(price > 0, 'gem price under the empty slot');
    assert(await browser.tap('.piece-slot[data-slot="0"] .piece-add'), 'add button missing');
    await waitSel('.dialog-backdrop:not(.closing)');
    assert(await tapDialogButton('^Buy$'), 'Buy button missing');
    await waitGone('.dialog-backdrop:not(.closing)');
    await sleep(500);
    await shot('pieces-bought-first');
    const after = await getState();
    assert(after.player.gems === before.player.gems - price, `gems should drop by ${price}`);
    assert(after.pieces.length === 1 && after.pieces[0].owned === 1, 'a new hunt with 1 piece');
    const def = await browser.evaluate((id) => window.evoker.db.get(id), after.pieces[0].cardId);
    assert(['rare', 'heroic'].includes(def.rarity), `first piece should be Rare/Heroic, got ${def.rarity}`);
    assert((await count('.piece-slot.hunt')) === 1, 'grid shows the new hunt');
    assert((await browser.evaluate(() => document.querySelector('.piece-slot.hunt').dataset.cardId)) === def.id, 'the slot shows the new card');
    return `${def.name} (${def.rarity}) for ${price} gems`;
  });

  await step('pieces: complete the card for gems -> celebration', async () => {
    await openArena('pieces');
    const before = await getState();
    assert(before.pieces.length === 1, `expected one hunt, found ${before.pieces.length}`);
    assert(await browser.tap('.piece-slot.hunt .piece-card'), 'puzzle card missing');
    await waitSel('.dialog-piece-detail');
    const label = (await texts('.dialog-piece-detail .dialog-buttons .btn')).find((l) => /Complete/.test(l)) || '';
    const m = /Complete: ([\d,]+)/.exec(label);
    assert(m, `complete label "${label}"`);
    const price = Number(m[1].replace(/,/g, ''));
    assert(await tapDialogButton('Complete'), 'Complete button missing');
    await sleep(400);
    await waitSel('.dialog-backdrop:not(.closing)');
    await shot('pieces-buy-missing-confirm');
    assert(await tapDialogButton('^Buy$'), 'Buy button missing');
    await waitSel('.dialog-celebrate');
    await sleep(600);
    await shot('pieces-buy-missing-celebration');
    assert(await tapDialogButton('Great'), 'Great! button missing');
    await waitGone('.dialog-backdrop:not(.closing)');
    const after = await getState();
    assert(after.player.gems === before.player.gems - price, `gems should drop by ${price}`);
    assert(after.pieces.length === 0, 'hunt should be gone');
    assert(after.cards.some((c) => c.cardId === before.pieces[0].cardId), 'card should be in the collection');
    return `paid ${price} gems`;
  });

  /* ================================================================= REPLAYS */
  await step('replays: fight history like the client (Won / Lost, date, time, watch)', async () => {
    await openArena('replays');
    await sleep(500);
    await shot('replays-list');
    const s = await getState();
    const n = await count('.replay-row');
    assert(n === s.replays.length && n >= 5, `expected ${s.replays.length} replay rows (at least 5), found ${n}`);
    const labels = await texts('.replay-result');
    assert(labels.every((l) => ['Won', 'Lost', 'Draw'].includes(l)), `result labels ${labels.join(',')}`);
    const dates = await texts('.replay-date');
    const times = await texts('.replay-time');
    assert(dates.every((d) => /^\d\d\.\d\d\.\d{4}$/.test(d)) && times.every((t) => /^\d\d:\d\d:\d\d$/.test(t)), `dates ${dates[0]} / times ${times[0]}`);
    const first = await text('.replay-row[data-replay="0"] .replay-name');
    assert(first === s.replays[0].defender.name, 'first row should be the last fight');
    assert((await count('.replay-row .replay-thumb img')) >= n, 'strongest-card thumbs');
    // info: the opponent's line-up
    assert(await browser.tap('.replay-row[data-replay="0"] .replay-info'), 'info button missing');
    await waitSel('.dialog-replay-info');
    assert((await count('.dialog-replay-info .card')) === s.replays[0].defender.cards.filter(Boolean).length, 'line-up in the info popup');
    assert(await closeDialog(), 'close button missing');
    return `${n} replays; newest ${first}`;
  });

  await step('replays: re-watch the last fight', async () => {
    await openArena('replays');
    const s = await getState();
    const rep = s.replays[0];
    assert(await browser.tap('.replay-row[data-replay="0"] .replay-play'), 'play button missing');
    await waitScreen('battle', 10000);
    await watchResult();
    await sleep(900);
    await shot('replay-battle');
    const oppName = await text('.battle-opp-name');
    assert(oppName === rep.defender.name, `replay opponent "${oppName}"`);
    const topCards = await count('.battle-row.top .card');
    assert(topCards === rep.defender.cards.filter(Boolean).length, 'replay shows the saved opponent line-up');
    const kind = await skipToResult('replay', true);
    const expected = rep.result.winner === 'draw' ? 'draw' : rep.won ? 'victory' : 'defeat';
    assert(kind === expected, `replay result ${kind}, recorded ${expected}`);
    const before = await getState();
    await leaveResult('replay', 'arena', false);
    const res = await readResult();
    const after = await getState();
    // a replay has no loot and no card XP: the banner leads straight back
    assert(!res.phases.includes('loot') && !res.phases.includes('xp'), `a replay must not show loot / XP (phases ${res.phases.join('>')})`);
    assert(after.replays.length === before.replays.length && after.player.gold === before.player.gold && xpScore(after) === xpScore(before), 'a replay must not change the save');
    assert(await exists('.replays-tab'), 'should come back to the Replays tab');
    return `${kind} (as recorded)`;
  }, { timeoutMs: 120000 });

  /* ================================================================= LEAGUE */
  await step('league: nav button -> enter popup (Join League)', async () => {
    await openArena('arena');
    assert(await browser.tap('.nav-btn[data-nav="league"]'), 'League nav button missing');
    await waitScreen('league');
    await waitSel('.dialog-league-enter', 6000);
    await sleep(500);
    await shot('league-enter-popup');
    const p = await browser.evaluate(() => {
      const d = document.querySelector('.dialog-league-enter');
      const t = (sel) => ((d.querySelector(sel) || {}).textContent || '').trim();
      return { title: t('.dialog-title'), headline: t('.league-popup-headline'), body: t('.league-popup'), next: t('.league-popup-next'), button: t('.dialog-buttons .btn'), close: Boolean(d.querySelector('.dialog-close')) };
    });
    assert(p.title === 'BRONZE LEAGUE', `enter popup title "${p.title}"`);
    assert(p.headline === 'Leagues Unlocked!', `enter popup headline "${p.headline}"`);
    assert(/three best players of a league advance/.test(p.body), 'enter popup should explain the promotion');
    assert(p.next === 'Bronze League' && p.button === 'Join League' && !p.close, `enter popup next "${p.next}", button "${p.button}", closable ${p.close}`);
    let s = await getState();
    assert(!s.sim.leagueJoined, 'not joined before the button');
    assert(await tapDialogButton('^Join League$'), 'Join League button missing');
    await waitGone('.dialog-backdrop:not(.closing)');
    s = await getState();
    assert(s.sim.leagueJoined === true && s.sim.leagueTier === 'bronze', `joined ${s.sim.leagueJoined}, tier ${s.sim.leagueTier}`);
    // the popup comes only once
    await go('goTop', 'league');
    await sleep(400);
    assert(!(await exists('.dialog-backdrop:not(.closing)')), 'the enter popup must not come back after joining');
    return `${p.title}: ${p.headline}`;
  });

  await step('league: standings (50 players), countdown, tier header, prizes', async () => {
    await go('goTop', 'league');
    await sleep(500);
    await shot('league-standings');
    const title = await text('.league-title');
    assert(title === 'Bronze League' && (await exists('.league-title.bronze')), `title "${title}"`);
    const cd = await text('.league-timer');
    assert(/^0:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(cd || ''), `countdown "${cd}" should be d:hh:mm:ss under one day`);
    await sleep(1300);
    const cd2 = await text('.league-timer');
    assert(cd2 !== cd, `the countdown should tick (${cd} -> ${cd2})`);
    const s = await getState();
    const lg = s.sim.league;
    assert(lg && lg.v === 3 && lg.tier === 'bronze' && lg.simIds.length === 49, `league state: ${lg && lg.simIds.length} sims, tier ${lg && lg.tier}`);
    assert(lg.endsAt - Date.now() < 86400000 && lg.endsAt > Date.now(), 'the league ends at the end of the UTC day');
    const rows = await leagueRows();
    assert(rows.length === 50, `expected 50 rows (49 players + you), got ${rows.length}`);
    const me = rows.filter((r) => r.me);
    assert(me.length === 1 && me[0].name === PLAYER_NAME && me[0].points === 0 && me[0].rankText === '-', `player row ${JSON.stringify(me[0])}`);
    assert(await exists('.league-row.me .league-fight-btn[disabled]'), 'own fight button should be disabled');
    for (let k = 1; k < rows.length; k++) assert(rows[k - 1].points >= rows[k].points, 'standings must be sorted by points');
    for (const r of rows) {
      assert(/^(\d+|-)$/.test(r.rankText), `rank text "${r.rankText}"`);
      assert((r.rankText === '-') === (r.points === 0), `rank "${r.rankText}" with ${r.points} points`);
      const rank = Number(r.rankText);
      assert(r.top === (rank >= 1 && rank <= 3), `rank ${r.rankText} top-3 mark ${r.top}`);
      // Bronze prize bands (constants LEAGUE.prizes): 1 card+mana, 2 card, 3 mana+stamina, 4 gems, 5-9 mana+stamina, 10-19 mana, 20-29 gems
      const prizes = rank === 1 || rank === 3 || (rank >= 5 && rank <= 9) ? 2 : rank >= 1 && rank <= 29 ? 1 : 0;
      assert(r.prizes === prizes, `rank ${r.rankText}: ${r.prizes} prize icons, expected ${prizes}`);
      if (!r.me) assert(!r.locked && !r.spent, `${r.name} should be fightable`);
    }
    const ranked = rows.filter((r) => r.rankText !== '-').length;
    // the list opens centred on the player's own row
    const visible = await browser.evaluate(() => {
      const list = document.querySelector('.league-list');
      const me = document.querySelector('.league-row.me');
      const a = list.getBoundingClientRect(), b = me.getBoundingClientRect();
      return b.top >= a.top - 1 && b.bottom <= a.bottom + 1;
    });
    assert(visible, 'the own row should be scrolled into view');
    const pics = await browser.evaluate(() => {
      const a = document.querySelector('.league-list').getBoundingClientRect();
      return Array.from(document.querySelectorAll('.league-row')).filter((r) => { const b = r.getBoundingClientRect(); return b.bottom > a.top && b.top < a.bottom; })
        .flatMap((r) => Array.from(r.querySelectorAll('.league-pic img'))).map((i) => i.complete && i.naturalWidth > 0);
    });
    assert(pics.length > 0 && pics.every(Boolean), `pictures broken: ${JSON.stringify(pics)}`);
    return `${title}, ${cd}, ${ranked} ranked players, ${rows.filter((r) => r.prizes).length} rows with prizes`;
  });

  await step('league: info screen (rules, prize tables)', async () => {
    await go('goTop', 'league');
    assert(await browser.tap('.league-info-btn'), 'info button missing');
    await waitScreen('league');
    await waitSel('.league-info');
    await sleep(300);
    await shot('league-info');
    const heads = await texts('.league-info-headline');
    assert(heads.join(',') === 'RULES,PRIZES', `headlines ${heads.join(',')}`);
    const rules = await text('.league-rules');
    assert(/three players with the most points advance/.test(rules) && /Bronze League/.test(rules), `rules text: ${rules}`);
    const tables = await browser.evaluate(() => Array.from(document.querySelectorAll('.league-info-league')).map((t) => ({
      tier: t.dataset.tier, name: t.querySelector('.league-info-subhead').textContent.trim(),
      rows: Array.from(t.querySelectorAll('.league-info-row')).map((r) => [r.querySelector('.league-info-rank').textContent.trim(), r.querySelector('.league-info-text').textContent.trim()]),
    })));
    assert(tables.map((t) => t.tier).join(',') === 'gold,silver,bronze', `prize tables ${tables.map((t) => t.tier).join(',')}`);
    assert(tables.map((t) => t.name).join(',') === 'Gold League,Silver League,Bronze League', 'table names');
    assert(!(await text('.league-info')).includes('Platinum'), 'there is no Platinum league any more');
    for (const t of tables) assert(t.rows.map((r) => r[0]).join(',') === '1,2,3,4,5-9,10-19,20-29', `${t.tier} ranks ${t.rows.map((r) => r[0]).join(',')}`);
    const bronze = Object.fromEntries(tables[2].rows);
    assert(bronze['1'] === '1 rare card, 5 mana potions' && bronze['4'] === '200 gems' && bronze['20-29'] === '25 gems', `bronze prizes ${JSON.stringify(bronze)}`);
    const gold = Object.fromEntries(tables[0].rows);
    assert(gold['1'] === '1 legendary card, 12 mana potions' && gold['4'] === '700 gems', `gold prizes ${JSON.stringify(gold)}`);
    // the HUD back arrow returns to the standings
    assert(await browser.tap('.hud-back'), 'HUD back arrow missing');
    await waitScreen('league');
    await waitSel('.league-row.me');
    assert(!(await exists('.league-info')), 'back should leave the info screen');
    return `${tables.length} prize tables`;
  });

  await step('league: Arena and piece-hunt wins add the shown / opponent-dependent points once joined', async () => {
    await strongDeck();
    // arena (Easy offer)
    await openArena('arena');
    let before = await getState();
    // the client's arena rows show no stake: compute what the win is worth like src/game/league.js does
    const stake = await browser.evaluate(async () => {
      const lg = await import('/src/game/league.js');
      const sh = await import('/src/game/shop.js');
      const s = window.evoker.state();
      const o = s.sim.arena.offers[0];
      const pl = await import('/src/game/player.js');
      return lg.leagueStake(s, { source: 'arena', difficulty: o.difficulty, oppLevel: o.level, event: sh.dailyEvent(pl.eventClock(s, Date.now()), s) });
    });
    assert(stake > 0, `the Easy arena win should be worth league points, got ${stake}`);
    await attackOffer(0);
    let res = await playFight('league-arena-win', { backTo: 'arena', shots: false });
    let after = await getState();
    assert(res.kind === 'victory', `expected an arena victory with the strong deck, got ${res.kind}`);
    const arenaPts = stake;
    assert(after.sim.league.points === before.sim.league.points + arenaPts, `arena win: league points ${before.sim.league.points} -> ${after.sim.league.points}, expected +${arenaPts}`);
    // piece hunt
    await addHunt();
    await strongDeck();
    before = await getState();
    await attackHunt(0);
    res = await playFight('league-pieces-win', { backTo: 'arena', shots: false });
    after = await getState();
    assert(res.kind === 'victory', `expected a piece-hunt victory, got ${res.kind}`);
    const piecePts = after.sim.league.points - before.sim.league.points;
    assert(piecePts >= 18 * leagueMult(before) && piecePts <= 48 * leagueMult(before), `piece win: league points ${before.sim.league.points} -> ${after.sim.league.points}, expected 18–48 (×${leagueMult(before)})`);
    await go('goTop', 'league');
    const mine = (await leagueRows()).find((r) => r.me);
    assert(mine.points === after.sim.league.points && /^\d+$/.test(mine.rankText), `own row ${mine.points} points rank ${mine.rankText}, state ${after.sim.league.points}`);
    await shot('league-after-arena-pieces');
    return `${after.sim.league.points} points, rank ${mine.rankText}`;
  }, { timeoutMs: 180000 });

  let leagueSimId = null;
  await step('league: three fights against the same opponent, then the button locks', async () => {
    await strongDeck();
    await go('goTop', 'league');
    leagueSimId = await browser.evaluate(() => document.querySelector('.league-row:not(.me)').dataset.simId);
    const sel = `.league-row[data-sim-id="${leagueSimId}"]`;
    const name = await text(`${sel} .league-name`);
    let points = 0;
    for (let i = 1; i <= 3; i++) {
      const before = await getState();
      await browser.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), sel);
      await sleep(200);
      assert(await browser.tap(`${sel} .league-fight-btn`), `fight button missing (fight ${i})`);
      await waitScreen('prebattle');
      if (i === 1) {
        assert((await text('.prebattle-name.opp')) === name, `pre-battle title should be the opponent "${name}"`);
        assert((await count('.prebattle-row.opp .card.size-back')) > 0, 'league opponent cards should be face down');
      }
      const tm = await toastMark();
      const res = await playFight(`league-fight-${i}`, { backTo: 'league', shots: i === 1 });
      const after = await getState();
      assert(res.kind === 'victory', `fight ${i}: expected a victory, got ${res.kind}`);
      assert(res.entries === 5 && res.continueLabel === 'Proceed', `fight ${i}: card XP of the deck then Proceed (entries ${res.entries}, "${res.continueLabel}")`);
      assert(xpScore(after) > xpScore(before), `fight ${i}: player XP`);
      const pts = 150 * leagueMult(before);
      assert(after.sim.league.points === before.sim.league.points + pts, `fight ${i}: points ${before.sim.league.points} -> ${after.sim.league.points}, expected +${pts}`);
      assert(after.sim.league.fights[leagueSimId] === i, `fight ${i}: fight counter ${after.sim.league.fights[leagueSimId]}`);
      points = after.sim.league.points;
      await sleep(400);
      const toasts = await toastsSince(tm);
      assert(toasts.some((t) => t === `+${pts} league points!`), `fight ${i}: "+${pts} league points!" toast missing: ${toasts.join(' | ')}`);
      const row = (await leagueRows()).find((r) => r.simId === leagueSimId);
      assert(row && row.locked === (i === 3), `fight ${i}: fight button locked ${row && row.locked}`);
    }
    await browser.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), sel);
    await sleep(300);
    await shot('league-after-3-fights');
    assert(await exists(`${sel}.spent .league-fight-btn.locked[aria-disabled="true"]`), 'the spent opponent row should be greyed and its button locked');
    assert((await browser.evaluate((s) => document.querySelector(`${s} .league-fight-btn img`).src, sel)).includes('fight_icon_inactive'), 'inactive fight icon');
    const rows = await leagueRows();
    const mine = rows.find((r) => r.me);
    assert(mine.points === points, `own row points ${mine.points}, state ${points}`);
    for (let k = 1; k < rows.length; k++) assert(rows[k - 1].points >= rows[k].points, 'standings must be sorted by points');
    assert(/^\d+$/.test(mine.rankText), `my rank "${mine.rankText}"`);
    // the locked button only explains why
    const tm = await toastMark();
    await browser.tap(`${sel} .league-fight-btn`);
    await sleep(500);
    assert((await screenId()) === 'league', 'a locked fight button must not leave the league');
    const toasts = await toastsSince(tm);
    assert(toasts.some((t) => /already fought this player 3 times/.test(t)), `"already fought" toast missing: ${toasts.join(' | ')}`);
    // the info popup of a spent opponent has no attack button
    await browser.tap(`${sel} .league-pic-frame`);
    await waitSel('.dialog-sim-info');
    assert((await text('.dialog-sim-info .sim-name')) === name, 'info popup of the opponent');
    assert(!(await exists('.dialog-sim-info .sim-actions')), 'spent opponent popup should have no attack button');
    await closeDialog();
    await browser.evaluate(() => document.querySelector('.league-row.me').scrollIntoView({ block: 'center' }));
    await sleep(300);
    await shot('league-my-row');
    return `${name}: 3 wins, ${points} points, rank ${mine.rankText}`;
  }, { timeoutMs: 300000 });

  await step('league: next day -> finish popup, top 3 promoted to Silver', async () => {
    await go('goTop', 'league');
    const s0 = await getState();
    assert(s0.sim.league && s0.sim.league.points >= 450, `the league should have points from the previous steps (${s0.sim.league && s0.sim.league.points})`);
    // Make the result certain: more points than any simulated Bronze player can reach.
    const points = s0.sim.league.points + await winningPoints();
    await updateState(`(s, d, n, p) => ({ ...s, sim: { ...s.sim, league: { ...s.sim.league, points: p } } })`, points);
    const before = await nextLeagueDay();
    await shot('league-finish-bronze');
    const p = await finishPopup();
    assert(p, 'finish popup missing');
    assert(p.title === 'BRONZE LEAGUE' && p.headline === 'Congratulations!' && p.passed === 'Bronze League completed', `popup head ${p.title} / ${p.headline} / ${p.passed}`);
    assert(p.rank === 'Your rank: 1', `rank line "${p.rank}"`);
    assert(p.rewards.join(',') === 'card x1,mana x5', `rewards ${p.rewards.join(',')} should be a rare card and 5 mana potions`);
    const tm = await toastMark();
    assert(p.enterText === 'Take your Reward and enter the next League:' && p.next === 'Silver League' && p.button === 'Join League', `next "${p.enterText}" "${p.next}" "${p.button}"`);
    let s = await getState();
    const hist = s.sim.leagueHistory[0];
    assert(s.sim.leaguePending && hist.tier === 'bronze' && hist.rank === 1 && hist.points === points && hist.promoted && hist.nextTier === 'silver', `history ${JSON.stringify(hist)}`);
    assert(hist.cardId && (await browser.evaluate((id) => window.evoker.db.get(id).rarity, hist.cardId)) === 'rare', 'a rare prize card');
    assert(s.cards.length === before.cards.length + 1 && s.cards.some((c) => c.cardId === hist.cardId), 'the prize card should be in the collection');
    assert(s.player.manaPotions === before.player.manaPotions + 5, `mana potions ${before.player.manaPotions} -> ${s.player.manaPotions}`);
    assert(s.player.tournamentPoints === before.player.tournamentPoints + Math.floor(points / 10), 'Tournament Points = league points / 10');
    assert(s.sim.leagueScore === (before.sim.leagueScore || 0) + points, 'league score accumulated');
    await joinLeague();
    await shot('league-silver');
    s = await getState();
    const today = new Date().toISOString().slice(0, 10);
    assert(!s.sim.leaguePending, 'the pending result is collected');
    assert(s.sim.leagueTier === 'silver' && s.sim.league.tier === 'silver' && s.sim.league.day === today && s.sim.league.points === 0 && Object.keys(s.sim.league.fights).length === 0, `a fresh Silver league (tier ${s.sim.league.tier}, day ${s.sim.league.day}, points ${s.sim.league.points})`);
    const title = await text('.league-title');
    assert(title === 'Silver League' && (await exists('.league-title.silver')), `new title "${title}"`);
    const rows = await leagueRows();
    assert(rows.length === 50 && rows.filter((r) => !r.me).every((r) => !r.locked), 'fresh standings, every opponent fightable');
    const toasts = await toastsSince(tm);
    const def = await browser.evaluate((id) => window.evoker.db.get(id).name, hist.cardId);
    assert(toasts.some((t) => t === `New card: ${def}`), `"New card: ${def}" toast missing: ${toasts.join(' | ')}`);
    return `${p.rank}, ${p.rewards.join(' + ')} (${def}); now ${title}`;
  }, { timeoutMs: 60000 });

  await step('league: Silver -> Gold, FINISHED timer, a pointless Gold league goes back to Bronze', async () => {
    // Silver: win it -> Gold
    await go('goTop', 'league');
    const points = await winningPoints();
    await updateState(`(s, d, n, p) => ({ ...s, sim: { ...s.sim, league: { ...s.sim.league, points: p } } })`, points);
    await nextLeagueDay();
    let p = await finishPopup();
    assert(p && p.title === 'SILVER LEAGUE' && p.rank === 'Your rank: 1' && p.next === 'Gold League', `silver popup ${JSON.stringify(p)}`);
    assert(p.rewards.join(',') === 'card x1,mana x7', `silver rewards ${p.rewards.join(',')} should be a heroic card and 7 mana potions`);
    await joinLeague();
    let s = await getState();
    assert(s.sim.leagueHistory[0].tier === 'silver' && s.sim.leagueHistory[0].promoted && s.sim.league.tier === 'gold', 'promoted to Gold');
    assert((await text('.league-title')) === 'Gold League' && (await exists('.league-title.gold')), 'Gold League title');
    await shot('league-gold');
    // Gold: let the timer run out on screen -> FINISHED, every fight button locked
    await updateState(`(s, d, n) => ({ ...s, sim: { ...s.sim, league: { ...s.sim.league, endsAt: n + 2500 } } })`);
    await rerender();
    await browser.waitFor(() => (document.querySelector('.league-timer') || {}).textContent === 'FINISHED', 8000);
    await sleep(1800); // the screen re-renders 1.2 s after FINISHED
    const rows = await leagueRows();
    assert(rows.filter((r) => !r.me).every((r) => r.locked), 'after FINISHED every fight button should be locked');
    assert((await text('.league-timer')) === 'FINISHED', 'timer text after the re-render');
    await shot('league-finished');
    // next day: no points -> no rank, no prize, back to Bronze
    await nextLeagueDay();
    p = await finishPopup();
    assert(p && p.title === 'GOLD LEAGUE' && p.passed === 'Gold League completed', `gold popup ${JSON.stringify(p)}`);
    const before = await getState();
    const hist = before.sim.leagueHistory[0];
    assert(hist.tier === 'gold' && hist.points === 0 && !hist.ranked && !hist.promoted && hist.nextTier === 'bronze', `history ${JSON.stringify(hist)}`);
    assert(p.rank === `Your rank: ${hist.rank}`, `rank line "${p.rank}" (place ${hist.rank} below everybody who scored)`);
    assert(p.rewards.length === 0 && p.enterText === 'Enter the next league:' && p.next === 'Bronze League', `no prize, next Bronze: ${JSON.stringify(p)}`);
    await shot('league-finish-gold');
    await joinLeague();
    s = await getState();
    assert(s.sim.leagueTier === 'bronze' && s.sim.league.tier === 'bronze', 'relegated to Bronze');
    assert((await text('.league-title')) === 'Bronze League', 'Bronze League title');
    assert(s.sim.leagueHistory.slice(0, 3).map((x) => x.tier).join(',') === 'gold,silver,bronze', 'three leagues in the history');
    await shot('league-bronze-again');
    return `Silver -> Gold (${p.title} place ${hist.rank}) -> Bronze`;
  }, { timeoutMs: 90000 });

  /* ================================================================= final */
  await step('arena after everything', async () => {
    await openArena('arena');
    await sleep(400);
    await shot('arena-final');
    assert((await count('.arena-offer')) === 3, '3 offers');
  });
}

qa.run(async (b, base) => { browser = b; await runScenario(base); });
