#!/usr/bin/env node
'use strict';
/**
 * QA playtest: cards & economy screens (regression test, exits 1 on any failure or console error).
 *
 * Drives the real game in headless Edge/Chrome through tools/cdp.js, the debug API (`window.evoker`,
 * architecture §8.5) for setup and real clicks / drags for the things under test. The round-3 `newGame` start
 * (Envoy + Master Brewer) is widened to the classic six-card start (tests/fixtures-game/classic.js) first:
 *   cards = the client's deck screen (80 cards: slots, "Your cards n/100", mana bar, three mode buttons, the card
 *   slider starting at its left end, swipe) → card detail from the slider (zoom, sell + confirm, deck cards unsellable)
 *   → deck mode (2 / 3 / 5 open slots by `player.deckSlots`, drag from the slider into a slot, swap, back to the
 *   slider, drop on a locked slot) → training mode (OK warnings, Training slot + 3 on the Sacrifice stack by drag,
 *   price = sum of sacrifice prices, deck-card warning, training animation with LEVEL UP) → fusion mode ("!" badge,
 *   only fusable cards, Slot 1 narrows the slider, price, fusion animation with FUSED, a deck card's slot goes to
 *   the result)
 *   → collections (locked tiles, paging, claim a completed set)
 *   → shop (gem packs from the HUD "+" and the top banner, pack banners, "Look inside" → sealed opening → 3×3
 *     grid, a pick paid by token then one by gems, "Card added to set" plate, boosters exceed the card limit,
 *     drawn card → detail, reset / new booster, "You need more Gems", potion deal)
 *   → character (avatar, name, stat points Health / Stamina / Mana + HUD, daily claim / streak / reset, settings,
 *     export, import, reset).
 *
 * Screenshots: tests/screenshots/qa-cards-economy/<nn>-<name>.png by default (old PNGs are deleted first).
 *
 * Usage: node tools/qa-cards-economy.js [--base=http://host:port/] [--out=dir] [--headed] [--slow=ms] [--verbose]
 */
import { mkdir, readdir, unlink, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createQa, bindApp, screenshotDir, assert, eq, sleep } from './qa-lib.js';

const PLAYER_NAME = 'QA';

const qa = createQa({ title: 'Evoker QA: cards & economy', banner: 'QA CARDS-ECONOMY', defaultOut: screenshotDir('qa-cards-economy'), stepTimeoutMs: 45000 });
const { OPTS, step, shot } = qa;
const app = bindApp(qa, { goSettleMs: 400 });
const {
  screenId, waitScreen, go: goScreen, back, rerender, getState, patchPlayer, debugCall, bootFresh, mustTap, mustTapText,
  dialogOpen, waitDialog, waitNoDialog, visibleToasts, centerOf, drag,
} = app; // drag: between elements (no scrolling; slider cards are transformed in place) or client points

/** @type {import('./cdp.js').Browser} */
let browser;

/** Press and release on the centre of an element (no scrolling). */
async function tapEl(selector) {
  const p = await centerOf(selector);
  await browser.clickClient(p.x, p.y);
  await sleep(250);
}

/** Tap an element that opens a dialog and wait for the dialog. */
async function openDialog(selector) {
  await mustTap(selector);
  await waitDialog();
}

/** Tap the dialog button whose label matches and wait for the dialog to close. */
async function tapDialog(pattern) {
  await mustTapText(pattern, '.dialog-buttons');
  await waitNoDialog();
}

/** Close the top dialog with its X and wait for it to go. */
async function closeX() {
  await mustTap('.dialog-backdrop:not(.closing) .dialog-close');
  await waitNoDialog();
}

/**
 * Play a cards-screen animation (`enhance` = training, `evolve` = fusion) to its end: skip part 1 with a tap,
 * read the decoration on the result card ("LEVEL UP" / "FUSED"), close with a second tap. Screenshots
 * `<name>-animation` and `<name>-animation-result` when `name` is given.
 * @returns {Promise<string|null>} the decoration text
 */
async function playCardsFx(kind, name) {
  await browser.waitFor(`Boolean(document.querySelector(".cards-fx.${kind} .anim-root"))`, 5000);
  if (name) { await sleep(1500); await shot(`${name}-animation`); }
  await browser.click(360, 640); // skip part 1
  await browser.waitFor(() => Boolean(document.querySelector('.cards-fx.waiting')), 5000);
  await sleep(300);
  const deco = await browser.evaluate(() => { const d = document.querySelector('.cards-fx .card-deco'); return d ? d.textContent.trim() : null; });
  if (name) await shot(`${name}-animation-result`);
  await browser.click(360, 640); // close
  await browser.waitFor(() => !document.querySelector('.cards-fx'), 5000);
  await sleep(400);
  return deco;
}

/** Hand a file to the settings' hidden import input (as the file picker would). */
async function setSaveFile(path) {
  const doc = await browser.send('DOM.getDocument', { depth: 1 });
  const node = await browser.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '.settings-actions input[type="file"]' });
  assert(node.nodeId, 'file input not found');
  await browser.send('DOM.setFileInputFiles', { files: [path], nodeId: node.nodeId });
}

/**
 * (page) Turn the card slider with wheel events until the card with `uid` is in front (the middle).
 * @param {string} uid
 * @returns {boolean}
 */
function pageRevealInSlider(uid) {
  const sl = document.querySelector('.card-slider');
  const card = sl && sl.querySelector(`.slider-cards > .card[data-uid="${uid}"]`);
  if (!card) return false;
  const cards = Array.from(sl.querySelectorAll('.slider-cards > .card'));
  const idx = cards.indexOf(card);
  for (let i = 0; i < 400; i++) {
    const m = /translate\(([-\d.]+)px/.exec(card.style.transform || '');
    const x = m ? Number(m[1]) : NaN;
    if (card.style.visibility !== 'hidden' && Math.abs(x) < 30) return true;
    const visible = cards.filter((c) => c.style.visibility !== 'hidden').sort((a, b) => Number(b.style.zIndex) - Number(a.style.zIndex));
    const fi = visible.length ? cards.indexOf(visible[0]) : 0;
    // far away: about one card step (20 degrees = 333 wheel px) per card; near: small steps
    const far = Math.abs(idx - fi);
    const delta = far > 1 ? Math.sign(idx - fi) * far * 300 : (idx > fi ? 1 : idx < fi ? -1 : Math.sign(x) || 1) * 40;
    sl.dispatchEvent(new WheelEvent('wheel', { deltaY: delta, bubbles: true, cancelable: true }));
  }
  return false;
}

/**
 * (page) Mark the slider card nearest the front that matches `opts` with data-qa-slider=`mark` and turn it to
 * the front. opts: { notInDeck, level1, cardId, exclude: uid[] }. Pieces never match.
 * @returns {string|null} uid
 */
function pageMarkSlider(mark, opts) {
  for (const old of document.querySelectorAll(`[data-qa-slider="${mark}"]`)) old.removeAttribute('data-qa-slider');
  const s = window.evoker.state();
  const cards = Array.from(document.querySelectorAll('.card-slider .slider-cards > .card'));
  const ok = cards.filter((c) => c.dataset.uid && !c.dataset.piece
    && (!opts.notInDeck || !s.deck.includes(c.dataset.uid))
    && (!opts.level1 || /Level 1 \//.test(c.textContent))
    && (!opts.cardId || c.dataset.cardId === opts.cardId)
    && (!opts.rarities || opts.rarities.includes(c.dataset.rarity))
    && !(opts.exclude || []).includes(c.dataset.uid));
  if (!ok.length) return null;
  const visible = cards.filter((c) => c.style.visibility !== 'hidden').sort((a, b) => Number(b.style.zIndex) - Number(a.style.zIndex));
  const fi = visible.length ? cards.indexOf(visible[0]) : 0;
  ok.sort((a, b) => Math.abs(cards.indexOf(a) - fi) - Math.abs(cards.indexOf(b) - fi));
  ok[0].setAttribute('data-qa-slider', mark);
  return ok[0].dataset.uid;
}

/** Bring a slider card to the front. */
async function revealInSlider(uid) {
  const ok = await browser.evaluate(pageRevealInSlider, uid);
  if (!ok) throw new Error(`card ${uid} could not be turned to the front of the slider`);
  await sleep(150);
}

/** Pick a slider card (see pageMarkSlider), turn it to the front and return its uid. */
async function markSlider(mark, opts) {
  const uid = await browser.evaluate(pageMarkSlider, mark, opts || {});
  if (!uid) throw new Error(`no slider card matches ${JSON.stringify(opts)}`);
  await revealInSlider(uid);
  return uid;
}

/* ------------------------------------------------------------------ the scenario */

async function runScenario(base) {
  /* ---------------------------------------------------------------- boot */
  await step('boot with a fresh save', async () => {
    await bootFresh(base);
    await waitScreen('title');
    await debugCall('newGame', PLAYER_NAME);
    await sleep(300);
    const fresh = await getState();
    eq(fresh.player.name, PLAYER_NAME, 'player name');
    eq(fresh.cards.map((c) => c.cardId).sort().join(','), 'envoy,master-brewer', 'round-3 starter cards');
    eq(fresh.player.deckSlots, 2, 'two open deck slots at the start');
    // widen to the classic start (tests/fixtures-game/classic.js): six cards, Bone Breaker / Scout / Master Brewer in slots 1–3
    await browser.evaluate(() => {
      const ev = window.evoker;
      const uid = {};
      for (const c of ev.state().cards) uid[c.cardId] = c.uid;
      for (const id of ['pikeman', 'pouch-tearer', 'bone-breaker', 'scout']) uid[id] = ev.debug.addCard(id, 0, 1);
      ev.store.update((s) => ({
        ...s,
        cards: ['envoy', 'pikeman', 'pouch-tearer', 'bone-breaker', 'scout', 'master-brewer'].map((id) => s.cards.find((c) => c.uid === uid[id])),
        deck: [null, uid['bone-breaker'], uid.scout, uid['master-brewer'], null],
        player: { ...s.player, gold: 300, staminaPotions: 2, manaPotions: 1, deckSlots: 3 },
      }));
    });
    const s = await getState();
    eq(s.cards.length, 6, 'starter cards');
    eq(s.deck.filter(Boolean).length, 3, 'starter deck');
    await debugCall('setLevel', 5);
    await debugCall('giveGold', 20000);
    return `evoker ${await browser.evaluate(() => window.evoker.version)}`;
  });

  /* ---------------------------------------------------------------- cards screen (deck mode): 80 cards, slider */
  await step('deck screen with 80 cards: slots, "Your cards" plate, mana bar, mode buttons, slider at its left end', async () => {
    const added = await browser.evaluate(() => {
      const ev = window.evoker;
      const list = ev.db.all();
      const byRarity = {};
      for (const d of list) { (byRarity[d.rarity] = byRarity[d.rarity] || []).push(d); }
      const order = ['common', 'standard', 'uncommon', 'rare', 'heroic', 'legendary', 'ultimate'];
      const ids = [];
      let i = 0;
      while (ids.length < 74) {
        const r = order[i % order.length];
        const pool = byRarity[r] || [];
        const d = pool[Math.floor(i / order.length) % pool.length];
        if (d) ids.push(d.id);
        i++;
      }
      let n = 0;
      for (const id of ids) {
        const stage = n % 7 === 6 ? 1 : 0;
        const level = 1 + (n % 5);
        ev.debug.addCard(id, stage, level);
        n++;
      }
      return n;
    });
    const s = await getState();
    eq(s.cards.length, 80, 'collection size');
    await goScreen('goTop', 'cards');
    await sleep(600);
    await shot('cards-deck-80');
    const parts = await browser.evaluate(() => ({
      tab: document.querySelector('.cards-screen').dataset.tab,
      title: document.querySelector('.cards-title').textContent.trim(),
      label: document.querySelector('.cards-pool .pool-label').textContent.trim(),
      count: document.querySelector('.cards-pool .pool-count').textContent.trim(),
      mana: document.querySelector('.cards-mana .mana-label').textContent.trim(),
      marker: Boolean(document.querySelector('.cards-mana .mana-marker')),
      modes: Array.from(document.querySelectorAll('.mode-stripe .mode-btn')).map((b) => b.dataset.tab + (b.classList.contains('active') ? '*' : '') + (b.classList.contains('locked') ? '!' : '')),
      slider: document.querySelectorAll('.card-slider .slider-cards > .card').length,
      visible: Array.from(document.querySelectorAll('.card-slider .slider-cards > .card')).filter((c) => c.style.visibility !== 'hidden').map((c) => Number(/translate\(([-\d.]+)px/.exec(c.style.transform)[1])),
      tabs: document.querySelectorAll('.tabbar, .filter-row, .sort-btn').length,
    }));
    eq(parts.tab, 'deck', 'deck mode');
    eq(parts.title, 'Your Deck', 'title');
    eq(parts.label, 'Your cards', 'plate label');
    eq(parts.count, '80/100', 'count plate (limit 100)');
    assert(/^Mana needed: \d+ \/ \d+$/.test(parts.mana), `mana bar: ${parts.mana}`);
    assert(parts.marker, 'mana marker missing');
    eq(parts.modes.join(','), 'training,deck*,fusion', 'three mode buttons, deck active (level 5: all unlocked)');
    eq(parts.tabs, 0, 'no text tabs / filters / sort button');
    eq(parts.slider, 80 - s.deck.filter(Boolean).length, 'slider holds the cards not in the deck');
    assert(parts.visible.length >= 1 && Math.min(...parts.visible) > 250, `the row starts at its left end: the first card at the right edge, nothing left of it (x ${parts.visible.join(', ')})`);
    const manas = await browser.evaluate(() => Array.from(document.querySelectorAll('.card-slider .slider-cards > .card .card-stat.mana .num')).map((n) => Number(n.textContent)));
    for (let i = 1; i < manas.length; i++) assert(manas[i] <= manas[i - 1], `slider not sorted by mana at ${i}: ${manas[i - 1]} then ${manas[i]}`);
    return `${added} cards added`;
  });

  await step('slider: a sideways swipe scrolls it, the arc puts the front card in the middle', async () => {
    const before = await browser.evaluate(() => document.querySelector('.slider-cards > .card').style.transform);
    await drag({ x: 600, y: 980 }, { x: 80, y: 990 });
    await sleep(1200);
    const parts = await browser.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.card-slider .slider-cards > .card')).filter((c) => c.style.visibility !== 'hidden');
      const pose = (c) => { const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/.exec(c.style.transform); return { x: Number(m[1]), s: Number(m[3]), z: Number(c.style.zIndex) }; };
      const ps = cards.map(pose).sort((a, b) => b.z - a.z);
      return { n: cards.length, front: ps[0], second: ps[1], ghosts: document.querySelectorAll('.drag-ghost').length };
    });
    const after = await browser.evaluate(() => document.querySelector('.slider-cards > .card').style.transform);
    assert(before !== after, 'the swipe did not move the slider');
    assert(parts.n >= 3, `several cards visible after the swipe (${parts.n})`);
    assert(Math.abs(parts.front.x) < Math.abs(parts.second.x) && parts.front.s > parts.second.s, 'front card largest and nearest the middle');
    eq(parts.ghosts, 0, 'a swipe does not pick a card up');
    eq(await screenId(), 'cards', 'a swipe does not open a card');
    await shot('cards-slider-swiped');
  });

  /* ---------------------------------------------------------------- card detail */
  let soldUid = null;
  await step('card detail: open from the slider, zoom', async () => {
    const target = await markSlider('pick', {});
    soldUid = target;
    await tapEl('[data-qa-slider="pick"]');
    await waitScreen('card-detail');
    await sleep(500);
    const cur = await browser.evaluate(() => window.evoker.router.current().params.uid);
    eq(cur, target, 'detail uid');
    const name = await browser.evaluate(() => document.querySelector('.card.size-detail .card-name').textContent.trim());
    assert(name.length > 0, 'name plate empty');
    const parts = await browser.evaluate(() => ({
      emblem: Boolean(document.querySelector('.card-emblem img')),
      rarity: document.querySelector('.card-rarity').textContent.trim(),
      pips: document.querySelectorAll('.card.size-detail .pip').length,
      lit: document.querySelectorAll('.card.size-detail .pip.lit').length,
      level: document.querySelector('.card.size-detail .card-levelbar .bar-label').textContent.trim(),
      stats: document.querySelectorAll('.card-detail-stats .stat-chip').length,
      ability: document.querySelector('.ability-text').textContent.trim(),
      actions: Array.from(document.querySelectorAll('.card-detail-actions .btn-icon')).map((b) => b.getAttribute('aria-label')),
      bodyBottom: document.querySelector('.card-detail-actions').getBoundingClientRect().bottom,
      stageBottom: document.querySelector('.screen-body').getBoundingClientRect().bottom,
    }));
    assert(parts.emblem, 'tribe emblem missing');
    assert(/^(Common|Standard|Uncommon|Rare|Heroic|Legendary|Ultimate)$/.test(parts.rarity), `rarity label: ${parts.rarity}`);
    eq(parts.pips, 5, 'five pips');
    assert(parts.lit >= 1, 'at least one lit pip');
    assert(/^Level \d+ \/ \d+$/.test(parts.level), `level bar: ${parts.level}`);
    eq(parts.stats, 3, 'ATK / HP / mana chips');
    assert(parts.ability.length > 0, 'ability text empty');
    eq(parts.actions[0], 'Zoom', 'zoom button');
    assert(/^Sell for [\d,]+ gold$/.test(parts.actions[1] || ''), `sell button label: ${parts.actions[1]}`);
    assert(parts.bodyBottom <= parts.stageBottom + 1, `actions overflow the body (${Math.round(parts.bodyBottom)} > ${Math.round(parts.stageBottom)}): the player would have to scroll to reach Zoom / Sell`);
    await shot('card-detail');
    await mustTap('.card-detail-actions .btn-icon[aria-label="Zoom"]');
    await browser.waitFor(() => Boolean(document.querySelector('.art-zoom img')), 3000);
    await sleep(500);
    const zoomOk = await browser.evaluate(() => { const i = document.querySelector('.art-zoom img'); return i && i.complete && i.naturalWidth > 0; });
    assert(zoomOk, 'zoomed art did not load');
    await shot('card-detail-zoom');
    await browser.click(360, 640);
    await browser.waitFor(() => !document.querySelector('.art-zoom:not(.closing)'), 3000);
    return name;
  });

  await step('card detail: sell with confirm (cancel, then sell)', async () => {
    const before = await getState();
    const price = Number(await browser.evaluate(() => /Sell for ([\d,]+)/.exec(document.querySelector('.card-detail-actions .btn-icon:last-child').getAttribute('aria-label'))[1].replace(/,/g, '')));
    assert(price > 0, 'sell price should be positive');
    await openDialog('.card-detail-actions .btn-icon:last-child');
    await shot('card-detail-sell-dialog');
    const text = await browser.evaluate(() => document.querySelector('.dialog-body').textContent);
    assert(/Sell .+ for [\d,]+ gold\?/.test(text), `confirm text: ${text}`);
    await tapDialog('^Cancel$');
    eq((await getState()).cards.length, 80, 'cancel keeps the card');
    eq(await screenId(), 'card-detail', 'still on the detail screen after cancel');
    await openDialog('.card-detail-actions .btn-icon:last-child');
    await mustTapText('^Sell$', '.dialog-buttons');
    await waitScreen('cards');
    const after = await getState();
    eq(after.cards.length, 79, 'card removed');
    eq(after.player.gold, before.player.gold + price, 'gold after the sale');
    assert(!after.cards.some((c) => c.uid === soldUid), 'sold uid still in the collection');
    const hudGold = await browser.evaluate(() => document.querySelector('.hud-wallet .row.gold .num').textContent.replace(/,/g, ''));
    eq(Number(hudGold), after.player.gold, 'HUD gold');
    eq(await browser.evaluate((u) => Boolean(document.querySelector(`.card-slider .card[data-uid="${u}"]`)), soldUid), false, 'sold card left the slider');
    return `+${price} gold`;
  });

  await step('card detail: cards in the deck cannot be sold', async () => {
    const uid = (await getState()).deck.find(Boolean);
    await goScreen('go', 'card-detail', { uid });
    const label = await browser.evaluate(() => document.querySelector('.card-detail-actions .btn-icon:last-child').getAttribute('aria-label'));
    eq(label, 'Cards in your deck cannot be sold', 'sell button label for a deck card');
    const chip = await browser.evaluate(() => document.querySelector('.meta-chip.deck').textContent.trim());
    eq(chip, 'In your deck', 'deck chip');
    await mustTap('.card-detail-actions .btn-icon:last-child');
    await sleep(300);
    eq(await dialogOpen(), false, 'no sell dialog for a deck card');
    const toasts = await visibleToasts();
    assert(toasts.some((t) => /cannot be sold/i.test(t)), `expected a refusal toast, got ${JSON.stringify(toasts)}`);
    await shot('card-detail-in-deck');
    eq((await getState()).cards.length, 79, 'deck card still owned');
  });

  /* ---------------------------------------------------------------- deck mode */
  await step('deck mode: locked slots with 2 / 3 / 5 open slots', async () => {
    // slots open by main-quest first wins (player.deckSlots), in the order [2, 1, 3, 0, 4]
    const lockedWith = async (open) => {
      await patchPlayer({ deckSlots: open });
      await goScreen('go', 'cards', { tab: 'deck' });
      return browser.evaluate(() => Array.from(document.querySelectorAll('.deck-row .deck-slot')).map((s) => s.classList.contains('locked') ? s.dataset.slot : null).filter((x) => x !== null));
    };
    eq((await lockedWith(2)).join(','), '0,3,4', 'locked slots with 2 open');
    await shot('deck-2-slots-locked');
    eq((await lockedWith(3)).join(','), '0,4', 'locked slots with 3 open');
    eq((await lockedWith(5)).join(','), '', 'locked slots with 5 open');
    const parts = await browser.evaluate(() => ({
      slots: document.querySelectorAll('.deck-row .deck-slot').length,
      filled: document.querySelectorAll('.deck-row .deck-slot .card').length,
      inDeckIcon: document.querySelectorAll('.deck-row .deck-slot .card.in-deck').length,
      slider: document.querySelectorAll('.card-slider .slider-cards > .card').length,
    }));
    eq(parts.slots, 5, 'five slots');
    eq(parts.filled, 3, 'starter deck has 3 cards');
    eq(parts.inDeckIcon, 3, 'deck cards carry the in-deck fan');
    eq(parts.slider, 76, 'slider shows the cards not in the deck');
    await shot('deck-5-slots');
  });

  await step('deck mode: drag a card up out of the slider into slot 1', async () => {
    const uid = await markSlider('a', {});
    await drag('[data-qa-slider="a"]', '.deck-row .deck-slot[data-slot="0"]');
    const s = await getState();
    eq(s.deck[0], uid, 'slot 0 holds the dragged card');
    const inSlot = await browser.evaluate(() => { const c = document.querySelector('.deck-row .deck-slot[data-slot="0"] .card'); return c ? c.dataset.uid : null; });
    eq(inSlot, uid, 'slot 0 re-rendered with the card');
    eq(await browser.evaluate((u) => Boolean(document.querySelector(`.card-slider .card[data-uid="${u}"]`)), uid), false, 'the card left the slider');
    const ghosts = await browser.evaluate(() => document.querySelectorAll('.drag-ghost').length);
    eq(ghosts, 0, 'no ghost left behind');
    await shot('deck-after-drop');
  });

  await step('deck mode: drag a deck card between slots (swap)', async () => {
    const before = (await getState()).deck.slice();
    await drag('.deck-row .deck-slot[data-slot="0"] .card', '.deck-row .deck-slot[data-slot="2"]');
    const after = (await getState()).deck;
    eq(after[2], before[0], 'card moved to slot 2');
    eq(after[0], before[2], 'displaced card went to slot 0');
  });

  await step('deck mode: dropping a deck card on the slider takes it out of the deck', async () => {
    const before = (await getState()).deck.slice();
    const idx = before.findIndex(Boolean);
    await drag(`.deck-row .deck-slot[data-slot="${idx}"] .card`, { x: 360, y: 1000 });
    const after = (await getState()).deck;
    eq(after[idx], null, `slot ${idx} emptied`);
    const inSlider = await browser.evaluate((u) => Boolean(document.querySelector(`.card-slider .card[data-uid="${u}"]`)), before[idx]);
    assert(inSlider, 'removed card did not return to the slider');
    await shot('deck-after-remove');
    // scroll it into view and drag it back
    await revealInSlider(before[idx]);
    await drag(`.card-slider .card[data-uid="${before[idx]}"]`, `.deck-row .deck-slot[data-slot="${idx}"]`);
    eq((await getState()).deck[idx], before[idx], 'card dragged back from the slider');
  });

  await step('deck mode: dropping on a locked slot is refused', async () => {
    await patchPlayer({ deckSlots: 3 });
    await goScreen('go', 'cards', { tab: 'deck' });
    const before = (await getState()).deck.slice();
    await markSlider('b', {});
    await drag('[data-qa-slider="b"]', '.deck-row .deck-slot[data-slot="4"]');
    const after = (await getState()).deck;
    eq(JSON.stringify(after), JSON.stringify(before), 'deck unchanged after a drop on a locked slot');
    await shot('deck-locked-drop-refused');
    await patchPlayer({ deckSlots: 5 });
  });

  await step('deck mode: tapping a card opens its detail', async () => {
    await goScreen('go', 'cards', { tab: 'deck' });
    const uid = await browser.evaluate(() => document.querySelector('.deck-row .deck-slot .card').dataset.uid);
    await tapEl('.deck-row .deck-slot .card');
    await waitScreen('card-detail');
    eq(await browser.evaluate(() => window.evoker.router.current().params.uid), uid, 'detail of the tapped deck card');
    await back('cards');
  });

  /* ---------------------------------------------------------------- training mode */
  let trainUid = null;
  let sacs = [];
  await step('training mode: the ← button, OK warnings, a card in the Training slot, 3 on the Sacrifice stack', async () => {
    await debugCall('giveGold', 200000);
    await goScreen('go', 'cards', { tab: 'deck' });
    await tapEl('.mode-btn[data-tab="training"]');
    await sleep(500);
    const head = await browser.evaluate(() => ({
      tab: document.querySelector('.cards-screen').dataset.tab,
      title: document.querySelector('.cards-title').textContent.trim(),
      labels: Array.from(document.querySelectorAll('.zone-label')).map((l) => l.textContent.trim()).join(' | '),
      cost: document.querySelector('.training-cost .num').textContent.trim(),
      slider: document.querySelectorAll('.card-slider .slider-cards > .card').length,
    }));
    eq(head.tab, 'training', 'training mode');
    eq(head.title, 'Card Training', 'title');
    eq(head.labels, 'Training slot | Sacrifice stack', 'zone labels');
    eq(head.cost, '0', 'price 0 with an empty stack');
    eq(head.slider, 79, 'every card (deck cards included) in the slider');
    await openDialog('.training-ok');
    const warn = await browser.evaluate(() => document.querySelector('.dialog-body').textContent.trim());
    eq(warn, 'Add one card to the Training slot and at least one card to the Sacrifice slot.', 'OK with nothing placed');
    await tapDialog('^OK$');
    // train target: a level-1 card that is not in the deck
    trainUid = await markSlider('t', { notInDeck: true, level1: true });
    await drag('[data-qa-slider="t"]', '.cards-zone[data-zone="train"]');
    await sleep(900);
    const inSlot = await browser.evaluate(() => { const c = document.querySelector('.cards-zone[data-zone="train"] .card'); return c ? c.dataset.uid : null; });
    eq(inSlot, trainUid, 'training slot filled');
    sacs = [];
    for (let i = 0; i < 3; i++) {
      // plain rarities only: a Rare or better on the stack raises the client's "valuable" warning (cards-helpers.js)
      const uid = await markSlider(`s${i}`, { notInDeck: true, exclude: [trainUid, ...sacs], rarities: ['common', 'standard', 'uncommon'] });
      await drag(`[data-qa-slider="s${i}"]`, '.cards-zone[data-zone="stack"]');
      sacs.push(uid);
    }
    const parts = await browser.evaluate(() => ({
      count: document.querySelector('.cards-zone[data-zone="stack"]').dataset.count,
      top: document.querySelectorAll('.cards-zone[data-zone="stack"] .card[data-draggable]').length,
      cost: Number(document.querySelector('.training-cost .num').textContent.replace(/,/g, '')),
      ready: document.querySelector('.training-ok').classList.contains('ready'),
      stackUids: Array.from(document.querySelectorAll('.cards-zone[data-zone="stack"] .card')).map((c) => c.dataset.uid),
    }));
    eq(parts.count, '3', 'stack holds 3 cards');
    eq(parts.top, 1, 'only the top card can be taken back');
    eq(parts.stackUids.join(','), sacs.join(','), 'stack order');
    // training gold = the sum of the sacrificed cards' prices (src/game/training.js trainingCost)
    const expectedCost = await browser.evaluate(async (uids) => {
      const mod = await import('/src/game/training.js');
      const s = window.evoker.state();
      return mod.trainingCost(window.evoker.deps, uids.map((u) => s.cards.find((c) => c.uid === u)));
    }, sacs);
    eq(parts.cost, expectedCost, 'gold cost = sum of sacrifice prices');
    eq(parts.ready, true, 'OK lit');
    await shot('training-ready');
    return `cost ${parts.cost} gold`;
  });

  await step('training mode: a deck card on the stack asks before it is sacrificed', async () => {
    const deckUid = (await getState()).deck.find(Boolean);
    await revealInSlider(deckUid);
    await drag(`.card-slider .card[data-uid="${deckUid}"]`, '.cards-zone[data-zone="stack"]');
    eq(await browser.evaluate(() => document.querySelector('.cards-zone[data-zone="stack"]').dataset.count), '4', 'deck card on the stack');
    await openDialog('.training-ok');
    const warn = await browser.evaluate(() => ({ text: document.querySelector('.dialog-body').innerText.trim(), buttons: Array.from(document.querySelectorAll('.dialog-buttons .btn')).map((b) => b.textContent.trim()) }));
    assert(/^Your sacrifice stack contains cards that are:\s*-.*in your deck/s.test(warn.text), `warning text: ${warn.text}`);
    eq(warn.buttons.join(','), 'Cancel,Sacrifice', 'warning buttons');
    await shot('training-deck-card-warning');
    await tapDialog('^Cancel$');
    eq((await getState()).deck.includes(deckUid), true, 'cancel keeps the deck card');
    // take it back off the stack (drag the top card out)
    await drag('.cards-zone[data-zone="stack"] .card[data-draggable]', { x: 360, y: 1000 });
    eq(await browser.evaluate(() => document.querySelector('.cards-zone[data-zone="stack"]').dataset.count), '3', 'deck card taken back');
  });

  await step('training mode: OK plays the training animation, pays gold, consumes the stack, levels the card up', async () => {
    const before = await getState();
    const cost = Number(await browser.evaluate(() => document.querySelector('.training-cost .num').textContent.replace(/,/g, '')));
    const levelFrom = before.cards.find((c) => c.uid === trainUid).level;
    await mustTap('.training-ok');
    const deco = await playCardsFx('enhance', 'training');
    const after = await getState();
    eq(after.cards.length, before.cards.length - 3, '3 cards consumed');
    eq(after.player.gold, before.player.gold - cost, 'gold paid');
    const levelTo = after.cards.find((c) => c.uid === trainUid).level;
    assert(levelTo > levelFrom, `trained card did not level up (${levelFrom} → ${levelTo})`);
    eq(deco, 'LEVEL UP', 'LEVEL UP decoration on the trained card');
    const parts = await browser.evaluate(() => ({
      count: document.querySelector('.cards-zone[data-zone="stack"]').dataset.count,
      slot: (() => { const c = document.querySelector('.cards-zone[data-zone="train"] .card'); return c ? c.dataset.uid : null; })(),
    }));
    eq(parts.count, '0', 'stack cleared after training');
    eq(parts.slot, trainUid, 'the trained card stays in the slot');
    await shot('training-after');
    return `level ${levelFrom} → ${levelTo}, -${cost} gold`;
  });

  /* ---------------------------------------------------------------- fusion mode */
  await step('fusion mode: the + button with its "!" badge, only fusable cards, Slot 1 narrows the slider', async () => {
    await browser.evaluate(() => {
      const ev = window.evoker;
      const siren = ev.db.get('siren');
      const cap = ev.deps.stats.capFor(siren, 0);
      ev.debug.addCard('siren', 0, cap);
      ev.debug.addCard('siren', 0, cap);
      ev.debug.addCard('gremlin', 0, 1);
      ev.debug.addCard('gremlin', 0, 1);
    });
    await goScreen('go', 'cards', { tab: 'deck' });
    eq(await browser.evaluate(() => Boolean(document.querySelector('.mode-btn[data-tab="fusion"] .mode-badge'))), true, 'badge on the fusion button');
    await tapEl('.mode-btn[data-tab="fusion"]');
    await sleep(500);
    const head = await browser.evaluate(() => ({
      tab: document.querySelector('.cards-screen').dataset.tab,
      title: document.querySelector('.cards-title').textContent.trim(),
      labels: Array.from(document.querySelectorAll('.zone-label')).map((l) => l.textContent.trim()).join(' | '),
      ids: Array.from(document.querySelectorAll('.card-slider .slider-cards > .card')).map((c) => c.dataset.cardId),
    }));
    eq(head.tab, 'fusion', 'fusion mode');
    eq(head.title, 'Fuse cards', 'title');
    eq(head.labels, 'Slot 1 | Slot 2', 'slot labels');
    const counts = {};
    for (const id of head.ids) counts[id] = (counts[id] || 0) + 1;
    assert(head.ids.includes('siren') && head.ids.includes('gremlin'), `pairs in the slider: ${head.ids.join(',')}`);
    assert(Object.values(counts).every((n) => n >= 2), `only cards with a partner: ${JSON.stringify(counts)}`);
    await openDialog('.fusion-ok');
    eq(await browser.evaluate(() => document.querySelector('.dialog-body').textContent.trim()), 'You need two equal cards of the same evolution state to do this.', 'OK with empty slots');
    await tapDialog('^OK$');
    await shot('fusion-empty');
    const g1 = await markSlider('g1', { cardId: 'gremlin' });
    await drag('[data-qa-slider="g1"]', '.cards-zone[data-zone="fuse1"]');
    await sleep(400);
    const narrowed = await browser.evaluate(() => Array.from(document.querySelectorAll('.card-slider .slider-cards > .card')).map((c) => c.dataset.cardId));
    assert(narrowed.length >= 1 && narrowed.every((id) => id === 'gremlin'), `slider narrowed to partners: ${narrowed.join(',')}`);
    eq(await browser.evaluate(() => document.querySelector('.fusion-cost .num').textContent.trim()), '0', 'no price with one slot');
    return `slot 1 = ${g1}`;
  });

  await step('fusion mode: Slot 2, price, OK plays the fusion animation and creates the "+" card', async () => {
    const cost = await browser.evaluate(() => window.evoker.deps.stats.fusionCost('common', 0));
    await markSlider('g2', { cardId: 'gremlin' });
    await drag('[data-qa-slider="g2"]', '.cards-zone[data-zone="fuse2"]');
    await sleep(300);
    const parts = await browser.evaluate(() => ({
      cost: Number(document.querySelector('.fusion-cost .num').textContent.replace(/,/g, '')),
      ready: document.querySelector('.fusion-ok').classList.contains('ready'),
      slots: Array.from(document.querySelectorAll('.cards-zone.fusion-slot .card')).map((c) => c.dataset.cardId).join(','),
      warnings: document.querySelectorAll('.fusion-warning, .fusion-row').length,
    }));
    eq(parts.slots, 'gremlin,gremlin', 'both slots filled');
    eq(parts.cost, cost, 'Common stage 0 fusion cost');
    eq(parts.ready, true, 'OK lit');
    eq(parts.warnings, 0, 'no recipe rows / evolve-bonus warnings');
    await shot('fusion-ready');
    const before = await getState();
    await mustTap('.fusion-ok');
    const deco = await playCardsFx('evolve', 'fusion');
    const after = await getState();
    eq(deco, 'FUSED', 'FUSED decoration on the result');
    eq(after.cards.length, before.cards.length - 1, 'two cards became one');
    eq(after.player.gold, before.player.gold - cost, 'fusion cost paid');
    const fused = after.cards.find((c) => c.cardId === 'gremlin' && c.stage === 1);
    assert(fused, 'no Gremlin+ in the collection');
    eq(fused.level, 1, 'fused card starts at level 1');
    eq(await browser.evaluate(() => document.querySelectorAll('.cards-zone.fusion-slot .card').length), 0, 'slots cleared');
    await shot('fusion-after');
    return `Gremlin+ q=${fused.evolveQuality}`;
  });

  await step('fusion mode: a deck card can be fused, the result takes its slot', async () => {
    const sirens = (await getState()).cards.filter((c) => c.cardId === 'siren' && c.stage === 0).map((c) => c.uid);
    eq(sirens.length, 2, 'two Sirens');
    await browser.evaluate((u) => window.evoker.store.update((s) => { const deck = s.deck.slice(); deck[1] = u; return { ...s, deck }; }), sirens[0]);
    await goScreen('go', 'cards', { tab: 'fusion' });
    await revealInSlider(sirens[0]);
    await drag(`.card-slider .card[data-uid="${sirens[0]}"]`, '.cards-zone[data-zone="fuse1"]');
    await revealInSlider(sirens[1]);
    await drag(`.card-slider .card[data-uid="${sirens[1]}"]`, '.cards-zone[data-zone="fuse2"]');
    await mustTap('.fusion-ok');
    await playCardsFx('evolve');
    const after = await getState();
    const fused = after.cards.find((c) => c.cardId === 'siren' && c.stage === 1);
    assert(fused, 'no Siren+');
    eq(fused.evolveQuality, 1, 'perfect quality (both at their cap)');
    eq(after.deck[1], fused.uid, 'Siren+ took the deck slot');
  });

  /* ---------------------------------------------------------------- collections */
  await step('collections: pages with locked tiles', async () => {
    await goScreen('go', 'collections', {});
    const parts = await browser.evaluate(() => ({
      name: document.querySelector('.set-name').textContent.trim(),
      index: document.querySelector('.set-index').textContent.trim(),
      progress: document.querySelector('.set-progress .bar-label').textContent.trim(),
      reward: document.querySelector('.reward-value').textContent.trim(),
      locked: document.querySelectorAll('.set-grid .card.locked').length,
      tiles: document.querySelectorAll('.set-grid .set-tile').length,
      lockIcon: Boolean(document.querySelector('.reward-box.locked img.lock')),
    }));
    eq(parts.name, 'Main Quest', 'first page');
    eq(parts.index, '(1/13)', 'page index (main, 8 portals, 4 main-line album sets)');
    eq(parts.tiles, 17, 'main set has 17 tiles');
    assert(/^\d+\/17$/.test(parts.progress), `progress: ${parts.progress}`);
    eq(parts.reward, '31700 Gems', 'reward (no thousands separator, like the client)');
    assert(parts.locked > 0, 'locked tiles expected');
    assert(parts.lockIcon, 'reward padlock missing');
    await shot('collections-main');
    await mustTap('.set-header .set-arrow:last-of-type');
    const p2 = await browser.evaluate(() => ({ name: document.querySelector('.set-name').textContent.trim(), index: document.querySelector('.set-index').textContent.trim(), progress: document.querySelector('.set-progress .bar-label').textContent.trim(), tiles: document.querySelectorAll('.set-grid .set-tile').length }));
    eq(p2.name, 'The Dark Beyond', 'second page');
    eq(p2.index, '(2/13)', 'second index');
    eq(p2.tiles, 8, 'portal set has 8 tiles');
    assert(/^[0-7]\/8$/.test(p2.progress), `portal progress: ${p2.progress}`);
    await shot('collections-dark-beyond-locked');
    await mustTap('.set-header .set-arrow:first-of-type');
    eq(await browser.evaluate(() => document.querySelector('.set-name').textContent.trim()), 'Main Quest', 'left arrow goes back');
    await mustTap('.set-header .set-arrow:first-of-type');
    eq(await browser.evaluate(() => document.querySelector('.set-index').textContent.trim()), '(13/13)', 'left arrow wraps to the last page');
    eq(await browser.evaluate(() => document.querySelector('.set-name').textContent.trim()), 'Arborearch', 'last page: the Arborearch album set');
  });

  await step('collections: a locked tile opens the catalog card', async () => {
    await mustTap('.set-grid .card.locked');
    await waitScreen('card-detail');
    const parts = await browser.evaluate(() => ({ chip: document.querySelector('.meta-chip').textContent.trim(), actions: document.querySelectorAll('.card-detail-actions .btn-icon').length }));
    eq(parts.chip, 'Catalog card', 'catalog chip');
    eq(parts.actions, 1, 'only zoom for a catalog card');
    await back('collections');
    eq(await browser.evaluate(() => document.querySelector('.set-index').textContent.trim()), '(13/13)', 'page kept after back');
  });

  await step('collections: owning all 8 set cards unlocks and claims the reward', async () => {
    await goScreen('go', 'collections', { set: 'the-dark-beyond' });
    const info = await browser.evaluate(() => {
      const ev = window.evoker;
      const line = ev.deps.quests.portals.find((p) => p.id === 'the-dark-beyond');
      for (const id of line.cards) ev.debug.addCard(id, 0, 1);
      return { cards: line.cards.length, reward: line.gemReward };
    });
    await rerender();
    const parts = await browser.evaluate(() => ({
      progress: document.querySelector('.set-progress .bar-label').textContent.trim(),
      locked: document.querySelectorAll('.set-grid .card.locked').length,
      claim: Boolean(document.querySelector('.claim-btn')),
      complete: document.querySelector('.set-reward').classList.contains('complete'),
    }));
    eq(parts.progress, '8/8', 'progress complete');
    eq(parts.locked, 0, 'no locked tile');
    eq(parts.claim, true, 'Claim button shown');
    eq(parts.complete, true, 'reward panel highlighted');
    await shot('collections-complete');
    const before = await getState();
    await mustTap('.claim-btn');
    await sleep(400);
    const after = await getState();
    eq(after.player.gems, before.player.gems + info.reward, 'gems granted');
    assert(after.collections.claimed.includes('the-dark-beyond'), 'set marked claimed');
    const box = await browser.evaluate(() => ({ claimed: Boolean(document.querySelector('.reward-box.claimed')), claim: Boolean(document.querySelector('.claim-btn')) }));
    eq(box.claimed, true, '"Claimed" box');
    eq(box.claim, false, 'Claim button gone');
    const hudGems = await browser.evaluate(() => document.querySelector('.hud-wallet .row.gems .num').textContent.replace(/,/g, ''));
    eq(Number(hudGems), after.player.gems, 'HUD gems');
    await shot('collections-claimed');
    return `+${info.reward} gems`;
  });

  /* ---------------------------------------------------------------- shop */
  /** Wait until the booster screen shows its grid (sealed opening and dealing finished). */
  const waitBoosterGrid = async () => {
    await waitScreen('booster-open', 8000);
    await browser.waitFor(() => {
      const g = document.querySelector('.booster-grid');
      return Boolean(g && g.querySelectorAll('.booster-cell').length === 9 && !g.classList.contains('sealed') && !g.classList.contains('dealing') && !g.classList.contains('discarding') && !document.querySelector('.booster-intro'));
    }, 10000);
    await sleep(300);
  };
  /** Settle a revealed booster card (tap the layer) and wait until it sits face up in its cell. */
  const settleReveal = async () => {
    await sleep(450); // the settle tap is armed 350 ms after the reveal
    await browser.click(360, 640);
    await browser.waitFor(() => !document.querySelector('.booster-reveal'), 5000);
    await sleep(300);
  };
  /** Face-down cells of the grid with their cost overlay. */
  const boosterCells = () => browser.evaluate(() => Array.from(document.querySelectorAll('.booster-grid .booster-cell')).map((c) => ({
    index: c.dataset.index,
    back: c.classList.contains('booster-back'),
    drawn: c.classList.contains('drawn'),
    cost: c.querySelector('.booster-cost') ? (c.querySelector('.booster-cost').classList.contains('token') ? 'token' : 'gems') + ':' + c.querySelector('.booster-cost .num').textContent.trim() : null,
  })));
  const topBar = () => browser.evaluate(() => ({
    gems: document.querySelector('.booster-res.gems .num').textContent.trim(),
    tokens: document.querySelector('.booster-res.tokens .num').textContent.trim(),
  }));
  /** Today's gem price of one pick (pickGems, halved on "Get the Best Cards" days). */
  const pickPrice = (id) => browser.evaluate(async (b) => {
    const mod = await import('/src/game/shop.js');
    const pl = await import('/src/game/player.js');
    const s = window.evoker.state();
    return { price: mod.boosterPrice(b, mod.dailyEvent(pl.eventClock(s, Date.now()), s)), base: mod.BOOSTERS[b].pickGems };
  }, id);

  await step('shop: gem packs (HUD "+" and top banner), pack banners with Look inside', async () => {
    // the HUD green "+" opens the shop with the gem packs
    await mustTap('.hud-plus');
    await waitScreen('shop', 8000);
    await waitDialog();
    const packs = await browser.evaluate(() => Array.from(document.querySelectorAll('.dialog.gem-shop .gem-pack')).map((p) => p.dataset.pack + ':' + p.querySelector('.gem-pack-amount .num').textContent.replace(/,/g, '')));
    eq(packs.join(' '), 'apprentice:500 wanderer:1000 hero:3500 treasure:10000 vault:20000', 'gem packs');
    await shot('shop-gem-packs');
    await closeX();
    eq(await screenId(), 'shop', 'still on the shop');
    const s = await getState();
    const parts = await browser.evaluate(() => ({
      topbanner: (document.querySelector('.shop-topbanner') || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim(),
      banners: Array.from(document.querySelectorAll('.pack-banner[data-booster]')).map((b) => ({
        id: b.dataset.booster,
        portal: b.dataset.portal || '',
        pre: b.classList.contains('pre'),
        title: b.querySelector('.pack-title').textContent.trim(),
        look: b.querySelector('.pack-look') ? b.querySelector('.pack-look').textContent.trim() : null,
        soon: b.querySelector('.pack-soon') ? b.querySelector('.pack-soon').textContent.replace(/\s+/g, ' ').trim() : null,
        timer: b.querySelector('.pack-timer') ? b.querySelector('.pack-timer').textContent.replace(/\s+/g, ' ').trim() : null,
        fan: b.querySelectorAll('.pack-art-slice').length,
        squares: b.querySelectorAll('.pack-squares .pack-square').length,
        tokens: b.querySelector('.pack-tokens').classList.contains('has'),
        num: b.querySelector('.pack-tokens .num') ? b.querySelector('.pack-tokens .num').textContent.replace(/,/g, '').trim() : '',
      })),
      link: Boolean(document.querySelector('.shop-link')),
    }));
    assert(/Need more Tokens\? ?Visit the Shop!/.test(parts.topbanner), `top banner: ${parts.topbanner}`);
    // 2016 shop order: Neophyte, the running portal's two packs, the next portal's two (coming soon), Summoner, Archmage
    eq(parts.banners.map((b) => b.id).join(','), 'neophyte,portalLow,portalHigh,portalLow,portalHigh,summoner,archmage', 'pack banners in order');
    const cur = parts.banners[1].portal;
    const nxt = parts.banners[3].portal;
    assert(cur && nxt && cur !== nxt && parts.banners[2].portal === cur && parts.banners[4].portal === nxt, `portals: ${cur} / ${nxt}`);
    for (const b of parts.banners.slice(1, 3)) assert(!b.pre && b.look === 'Look inside' && /^Offer ends in ?\d+:\d\d:\d\d:\d\d$/.test(b.timer || ''), `${b.title}: ${b.timer}`);
    for (const b of parts.banners.slice(3, 5)) assert(b.pre && !b.look && /^Coming soon: ?\d+:\d\d:\d\d:\d\d$/.test(b.soon || ''), `${b.title}: ${b.soon}`);
    const mains = [parts.banners[0], parts.banners[5], parts.banners[6]];
    const titles = { neophyte: 'Neophyte Pack', summoner: "Summoner's Pack", archmage: "Archmage's Pack" };
    const bases = { neophyte: 50, summoner: 350, archmage: 975 };
    const notes = [];
    for (const b of mains) {
      eq(b.title, titles[b.id], `${b.id} title`);
      eq(b.look, 'Look inside', `${b.id} Look inside button`);
      assert(b.fan >= 1, `${b.id}: no showcase cards`);
      assert(b.squares >= 3, `${b.id}: "May contain" squares ${b.squares}`);
      const { price, base } = await pickPrice(b.id);
      eq(base, bases[b.id], `${b.id} gem price per pick`);
      const tokens = (s.player.tokens && s.player.tokens[b.id]) || 0;
      if (tokens > 0) { eq(b.tokens, true, `${b.id} shows its tokens`); eq(b.num, String(tokens), `${b.id} token count`); }
      else { eq(b.tokens, false, `${b.id} without tokens`); eq(b.num, '', `${b.id} shows no price (the grid does)`); }
      notes.push(`${b.id} ${b.num || price + ' gems/pick'}`);
    }
    // a coming-soon pack cannot be opened
    await mustTap('.pack-banner.pre');
    await sleep(500);
    eq(await screenId(), 'shop', 'a coming-soon pack stays closed');
    notes.push(`${parts.banners[1].title}/${parts.banners[2].title} now, ${parts.banners[3].title}/${parts.banners[4].title} soon`);
    eq(parts.link, true, 'set collections link');
    await shot('shop');
    // the top banner opens the same gem packs
    await openDialog('.shop-topbanner');
    eq(await browser.evaluate(() => document.querySelectorAll('.dialog.gem-shop .gem-pack').length), 5, 'gem packs from the top banner');
    await closeX();
    return notes.join(', ');
  });

  let neoPrice = 50;
  let setPlate = null;
  await step('shop: Look inside a Neophyte pack → opening, 3×3 grid, a pick paid with a token (over the card limit)', async () => {
    await debugCall('giveGems', 500);
    await browser.evaluate(() => window.evoker.store.update((s) => ({ ...s, player: { ...s.player, tokens: { ...s.player.tokens, neophyte: 1 } } })));
    // fill the collection to the limit: boosters still add their cards (they may exceed the 100-card limit)
    await browser.evaluate(() => {
      const ev = window.evoker;
      while (ev.state().cards.length < 100) ev.debug.addCard('gremlin', 0, 1);
    });
    await goScreen('goTop', 'shop');
    const row = await browser.evaluate(() => ({ has: document.querySelector('.pack-banner[data-booster="neophyte"] .pack-tokens').classList.contains('has'), num: document.querySelector('.pack-banner[data-booster="neophyte"] .pack-tokens .num').textContent.trim() }));
    eq(row.has && row.num, '1', 'banner shows 1 token');
    neoPrice = (await pickPrice('neophyte')).price;
    await mustTap('.pack-banner[data-booster="neophyte"] .pack-look');
    await waitScreen('booster-open', 8000);
    await sleep(500);
    const sealed = await browser.evaluate(() => Boolean(document.querySelector('.booster-intro')) || document.querySelector('.booster-grid').classList.contains('sealed'));
    eq(sealed, true, 'a new booster plays the sealed opening first');
    await shot('booster-opening');
    await waitBoosterGrid();
    const s0 = await getState();
    eq(s0.player.tokens.neophyte, 1, 'entering is free (paid per pick)');
    const b0 = s0.boosters && s0.boosters.neophyte;
    assert(b0 && b0.opened && b0.cards.length === 9 && b0.drawn.length === 0, `booster in the save: ${JSON.stringify(b0)}`);
    const cells = await boosterCells();
    eq(cells.length, 9, 'nine cells');
    eq(cells.filter((c) => c.back).length, 9, 'nine face-down cards');
    eq(cells.map((c) => c.cost).join(' '), Array(9).fill('token:1').join(' '), 'each pick costs 1 token');
    const layout = await browser.evaluate(() => {
      const stage = document.querySelector('#stage').getBoundingClientRect();
      const cs = Array.from(document.querySelectorAll('.booster-cell'));
      const rows = new Set(cs.map((c) => Math.round(c.getBoundingClientRect().top)));
      const cols = new Set(cs.map((c) => Math.round(c.getBoundingClientRect().left)));
      return {
        rows: rows.size, cols: cols.size,
        clipped: cs.filter((b) => { const r = b.getBoundingClientRect(); return r.left < stage.left - 1 || r.right > stage.right + 1 || r.top < stage.top - 1 || r.bottom > stage.bottom + 1; }).length,
        name: document.querySelector('.booster-name').textContent.trim(),
        nav: Boolean(document.querySelector('.screen[data-screen="booster-open"] .nav')),
        reset: Boolean(document.querySelector('.booster-reset')),
      };
    });
    eq(`${layout.rows}x${layout.cols}`, '3x3', 'grid layout');
    eq(layout.clipped, 0, 'cells clipped by the stage edge');
    eq(layout.name, 'Neophyte Pack', 'pack name');
    eq(layout.nav, false, 'no nav on the booster screen');
    eq(layout.reset, true, 'new-booster button');
    eq((await topBar()).tokens, '1', 'top bar token count');
    await shot('booster-grid');
    // make the card at position 3 one that is new to its collection set, so the "Card added to set" plate shows
    setPlate = await browser.evaluate(async () => {
      const ev = window.evoker;
      const mod = await import('/src/game/shop.js');
      const s = ev.state();
      for (const set of mod.setCollections(s, ev.deps)) {
        const miss = set.cards.find((c) => !c.owned && ev.db.get(c.cardId));
        if (!miss) continue;
        const prog = mod.setProgressFor(s, ev.deps, miss.cardId);
        ev.store.update((st) => {
          const b = st.boosters.neophyte;
          const cards = b.cards.slice();
          cards[3] = miss.cardId;
          return { ...st, boosters: { ...st.boosters, neophyte: { ...b, cards } } };
        });
        return { cardId: miss.cardId, name: prog.name, count: `${prog.owned + 1}/${prog.total}` };
      }
      return null;
    });
    assert(setPlate, 'no collection set with a missing card');
    const before = await getState();
    await mustTap('.booster-cell[data-index="3"]');
    await browser.waitFor(() => Boolean(document.querySelector('.booster-reveal .card.size-detail')), 5000);
    await sleep(800);
    const reveal = await browser.evaluate(() => ({
      name: document.querySelector('.booster-reveal .card-name').textContent.trim(),
      shade: Boolean(document.querySelector('.booster-shade')),
      art: (() => { const i = document.querySelector('.booster-reveal .card-art img'); return Boolean(i && i.complete && i.naturalWidth > 0); })(),
      plate: document.querySelector('.booster-setplate') ? {
        label: document.querySelector('.booster-setplate-label').textContent.trim(),
        name: document.querySelector('.booster-setplate-name').textContent.trim(),
        count: document.querySelector('.booster-setplate-count').textContent.trim(),
      } : null,
    }));
    const after = await getState();
    eq(after.player.tokens.neophyte, 0, 'token consumed');
    eq(after.player.gems, before.player.gems, 'no gems paid for a token pick');
    eq(after.cards.length, before.cards.length + 1, 'card added past the 100-card limit');
    assert(after.cards.some((c) => c.cardId === setPlate.cardId), 'drawn card not in the collection');
    eq(reveal.name, (await browser.evaluate((id) => window.evoker.db.get(id).name, setPlate.cardId)), 'revealed card');
    eq(reveal.shade, true, 'shade behind the revealed card');
    assert(reveal.art, 'revealed art did not load');
    assert(reveal.plate, 'no "Card added to set" plate');
    eq(reveal.plate.label, 'Card added to set:', 'plate label');
    eq(reveal.plate.name, setPlate.name, 'plate set name');
    eq(reveal.plate.count, setPlate.count, 'plate set count');
    const toasts = await visibleToasts();
    assert(!toasts.some((t) => /Collection full/.test(t)), `boosters must not convert cards: ${JSON.stringify(toasts)}`);
    await shot('booster-reveal-setplate');
    await settleReveal();
    const cells2 = await boosterCells();
    eq(cells2[3].drawn, true, 'cell 3 face up');
    eq(await browser.evaluate(() => Boolean(document.querySelector('.booster-cell[data-index="3"] .booster-face img'))), true, 'face-up art in the cell');
    eq(cells2.filter((c) => c.back).map((c) => c.cost).join(' '), Array(8).fill(`gems:${neoPrice}`).join(' '), 'out of tokens: picks cost gems');
    eq((await topBar()).tokens, '0', 'top bar token count after the pick');
    await shot('booster-after-token-pick');
    return `${reveal.name} → ${setPlate.name} ${setPlate.count}, ${after.cards.length} cards`;
  });

  await step('shop: second pick paid with gems', async () => {
    const before = await getState();
    await mustTap('.booster-cell[data-index="5"]');
    await browser.waitFor(() => Boolean(document.querySelector('.booster-reveal .card.size-detail')), 5000);
    await sleep(600);
    const after = await getState();
    eq(after.player.gems, before.player.gems - neoPrice, 'gems paid');
    eq(after.player.tokens.neophyte, 0, 'no token used');
    eq(after.cards.length, before.cards.length + 1, 'card added');
    eq(after.boosters.neophyte.drawn.join(','), '3,5', 'drawn positions saved');
    await shot('booster-reveal-gems');
    await settleReveal();
    eq((await topBar()).gems, String(after.player.gems), 'top bar gems');
    eq((await boosterCells()).filter((c) => c.drawn).length, 2, 'two cards face up');
    return `-${neoPrice} gems`;
  });

  await step('shop: a drawn card opens its detail, the booster is kept between visits', async () => {
    const cardId = (await getState()).boosters.neophyte.cards[5];
    await mustTap('.booster-cell[data-index="5"]');
    await waitScreen('card-detail');
    eq(await browser.evaluate(() => window.evoker.router.current().params.cardId), cardId, 'detail of the drawn card');
    await shot('booster-drawn-card-detail');
    await back('booster-open');
    await sleep(500);
    const parts = await browser.evaluate(() => ({ intro: Boolean(document.querySelector('.booster-intro')), sealed: document.querySelector('.booster-grid').classList.contains('sealed') }));
    eq(parts.intro || parts.sealed, false, 'no opening for an already opened booster');
    const cells = await boosterCells();
    eq(cells.filter((c) => c.drawn).map((c) => c.index).join(','), '3,5', 'drawn cards kept');
  });

  await step('shop: reset → "open a new booster?" → a fresh sealed booster', async () => {
    const seq = (await getState()).boosters.neophyte.seq;
    // closing the warning keeps the booster
    await openDialog('.booster-reset');
    const text = await browser.evaluate(() => document.querySelector('.dialog-backdrop:not(.closing) .dialog').textContent.trim());
    assert(/Do you want to open a new booster\?/.test(text), `warning text: ${text}`);
    await shot('booster-reset-warning');
    await closeX();
    eq((await getState()).boosters.neophyte.seq, seq, 'closing the warning keeps the booster');
    eq((await boosterCells()).filter((c) => c.drawn).length, 2, 'drawn cards still shown');
    // OK discards the rest and seals a new booster
    await openDialog('.booster-reset');
    await tapDialog('^Ok$');
    await browser.waitFor(() => Boolean(document.querySelector('.booster-intro')) || document.querySelector('.booster-grid').classList.contains('sealed'), 5000);
    await waitBoosterGrid();
    const b = (await getState()).boosters.neophyte;
    eq(b.seq, seq + 1, 'new booster sequence');
    eq(b.drawn.length, 0, 'nothing drawn yet');
    eq(b.opened, true, 'opened after the intro');
    const cells = await boosterCells();
    eq(cells.filter((c) => c.back).length, 9, 'nine face-down cards again');
    eq(cells[0].cost, `gems:${neoPrice}`, 'priced in gems (no token left)');
    await shot('booster-new');
    await mustTap('.booster-backbtn');
    await waitScreen('shop', 8000);
    // make room in the collection again (keep the deck cards and the first 70 others)
    await browser.evaluate(() => window.evoker.store.update((s) => {
      const keep = [];
      for (const c of s.cards) if (s.deck.includes(c.uid) || keep.length < 70) keep.push(c);
      return { ...s, cards: keep };
    }));
    return `seq ${seq} → ${b.seq}`;
  });

  await step('shop: cannot afford → "You need more Gems" popup', async () => {
    await patchPlayer({ gems: 10, tokens: { neophyte: 0, summoner: 0, archmage: 0, portalLow: {}, portalHigh: {} } });
    await goScreen('goTop', 'shop');
    const banner = await browser.evaluate(() => ({ none: document.querySelector('.pack-banner[data-booster="archmage"] .pack-tokens').classList.contains('none') }));
    eq(banner.none, true, 'archmage banner shows no tokens');
    await mustTap('.pack-banner[data-booster="archmage"]');
    await waitBoosterGrid();
    const before = await getState();
    await openDialog('.booster-cell[data-index="0"]');
    const text = await browser.evaluate(() => document.querySelector('.dialog-backdrop:not(.closing) .dialog').textContent.replace(/\s+/g, ' ').trim());
    assert(/You need more Gems to get a booster card!/.test(text), `popup: ${text}`);
    await shot('booster-not-enough-gems');
    await mustTapText('^Get more', '.dialog-buttons');
    await browser.waitFor(() => Boolean(document.querySelector('.dialog-backdrop:not(.closing) .dialog.gem-shop')), 5000);
    await sleep(250);
    await closeX();
    const after = await getState();
    eq(after.player.gems, 10, 'nothing paid');
    eq(after.cards.length, before.cards.length, 'no card drawn');
    eq(after.boosters.archmage.drawn.length, 0, 'booster untouched');
    eq((await boosterCells())[0].back, true, 'cell still face down');
    await mustTap('.booster-backbtn');
    await waitScreen('shop', 8000);
    await debugCall('giveGems', 2000);
  });

  await step('shop: Great Potion Deal (event day) — buy 3 potions for 60 gems', async () => {
    // find a day whose event is the potion deal and move the save's event clock there (daily.dayShift, the
    // shift debug.addDays accumulates; the page clock stays real so no new day starts)
    const offset = await browser.evaluate(async () => {
      const mod = await import('/src/game/shop.js');
      const ev = window.evoker;
      window.__qaDayShift = ev.state().daily.dayShift || 0;
      for (let d = 0; d < 40; d++) {
        const t = Date.now() + (window.__qaDayShift + d) * 86400000;
        const ev2 = mod.dailyEvent(t, ev.state());
        if (ev2 && ev2.id === 'great-potion-deal') {
          ev.store.update((s) => ({ ...s, daily: { ...s.daily, dayShift: window.__qaDayShift + d } }));
          return d;
        }
      }
      return -1;
    });
    assert(offset >= 0, 'no Great Potion Deal day found within 40 days');
    try {
    await debugCall('giveGems', 500);
    await goScreen('goTop', 'shop');
    const parts = await browser.evaluate(() => ({
      deal: Boolean(document.querySelector('.shop-deal')),
      name: document.querySelector('.shop-deal .shop-name') ? document.querySelector('.shop-deal .shop-name').textContent.trim() : null,
      price: document.querySelector('.shop-deal .shop-price') ? document.querySelector('.shop-deal .shop-price').textContent.trim() : null,
    }));
    eq(parts.deal, true, 'deal panel');
    eq(parts.name, 'Great Potion Deal', 'deal name');
    eq(parts.price, '60', 'deal price');
    await shot('shop-potion-deal');
    const before = await getState();
    await openDialog('.shop-deal .btn');
    await tapDialog('^Buy$');
    await sleep(400);
    const after = await getState();
    eq(after.player.gems, before.player.gems - 60, 'gems paid');
    eq(after.player.staminaPotions, before.player.staminaPotions + 2, '+2 stamina potions');
    eq(after.player.manaPotions, before.player.manaPotions + 1, '+1 mana potion');
    const again = await browser.evaluate(() => Boolean(document.querySelector('.shop-deal')));
    eq(again, false, 'deal offered once per day');
    await shot('shop-potion-deal-bought');
    return `offset ${offset} days`;
    } finally {
      // restore the event clock whatever happened
      await browser.evaluate(() => { const ev = window.evoker; if (window.__qaDayShift != null) ev.store.update((s) => ({ ...s, daily: { ...s.daily, dayShift: window.__qaDayShift } })); });
    }
  });

  /* ---------------------------------------------------------------- character */
  await step('character: profile', async () => {
    // the profile (playerinfo_screen) is a pushed screen: the HUD's level / stamina / mana bar opens it
    await goScreen('go', 'character', { tab: 'profile' });
    const parts = await browser.evaluate(() => ({
      name: document.querySelector('.pi-name').textContent.trim(),
      avatar: Boolean(document.querySelector('.pi-avatar img')),
      best: Boolean(document.querySelector('.pi-best-card img')) && !document.querySelector('.pi-best-card.empty'),
      bars: document.querySelectorAll('.pi-bar').length,
      cards: Array.from(document.querySelectorAll('.pi-fact')).map((s) => s.textContent.trim().replace(/\s+/g, ' ')),
      points: Boolean(document.querySelector('.stat-points')),
      support: Boolean(document.querySelector('.pi-support')),
    }));
    eq(parts.name, PLAYER_NAME, 'name plate');
    assert(parts.avatar, 'avatar image missing');
    assert(parts.best, 'best card missing');
    eq(parts.bars, 4, 'level / stamina / mana / health bars');
    const s = await getState();
    assert(parts.cards.some((c) => new RegExp(`Your cards ?${s.cards.length}/100`).test(c)), `"Your cards n/100" missing: ${parts.cards.join(' | ')}`);
    eq(parts.points, false, 'no stat-point panel without points');
    eq(parts.support, true, 'Support button');
    await shot('character-profile');
  });

  await step('character: change avatar', async () => {
    await openDialog('.pi-avatar');
    const n = await browser.evaluate(() => document.querySelectorAll('.avatar-grid .avatar-choice').length);
    eq(n, 12, 'twelve avatars');
    await shot('character-avatar-picker');
    await mustTap('.avatar-grid .avatar-choice:nth-child(3)');
    await waitNoDialog();
    eq((await getState()).player.avatar, 2, 'avatar index saved');
    await waitScreen('character');
    const src = await browser.evaluate(() => document.querySelector('.pi-avatar img').getAttribute('src'));
    const expected = await browser.evaluate(() => window.evoker.view.artUrlFor(window.evoker.db.get(window.evoker.deps.names.avatars[2]), 0));
    eq(src, expected, 'avatar image updated');
  });

  await step('character: change name', async () => {
    await mustTap('.pi-name'); // the name plate opens the change-name dialog
    await waitDialog();
    await browser.evaluate(() => { const i = document.querySelector('.dialog-backdrop input'); i.focus(); i.select(); });
    await browser.send('Input.insertText', { text: 'QA Tester' });
    await shot('character-change-name');
    await tapDialog('^OK$');
    await waitScreen('character');
    eq((await getState()).player.name, 'QA Tester', 'name saved');
    eq(await browser.evaluate(() => document.querySelector('.pi-name').textContent.trim()), 'QA Tester', 'name plate updated');
  });

  await step('character: stat points spinners + confirm update the HUD', async () => {
    await patchPlayer({ statPoints: 12 });
    await rerender();
    const before = (await getState()).player;
    const badge = await browser.evaluate(() => Boolean(document.querySelector('.nav-btn[data-nav="extend"] .badge')) && Boolean(document.querySelector('.nav-btn[data-nav="profile"] .badge')));
    eq(badge, true, 'extend-arrow and Profile badges with unspent points');
    eq(await browser.evaluate(() => document.querySelector('.stat-points-left').textContent.trim()), '12 left', 'points shown');
    eq(await browser.evaluate(() => Array.from(document.querySelectorAll('.stat-row')).map((r) => r.dataset.stat).join(',')), 'hp,stamina,mana', 'row order Health, Stamina, Mana');
    for (let i = 0; i < 2; i++) await mustTap('.stat-row[data-stat="stamina"] .spin.inc');
    await mustTap('.stat-row[data-stat="mana"] .spin.inc');
    for (let i = 0; i < 3; i++) await mustTap('.stat-row[data-stat="hp"] .spin.inc');
    await mustTap('.stat-row[data-stat="hp"] .spin.dec');
    const preview = await browser.evaluate(() => ({
      left: document.querySelector('.stat-points-left').textContent.trim(),
      stamina: document.querySelector('.stat-row[data-stat="stamina"] .stat-next').textContent.trim(),
      mana: document.querySelector('.stat-row[data-stat="mana"] .stat-next').textContent.trim(),
      hp: document.querySelector('.stat-row[data-stat="hp"] .stat-next').textContent.trim(),
      add: Array.from(document.querySelectorAll('.stat-add')).map((a) => a.textContent.trim()).join(','),
      confirm: document.querySelector('.stat-points-actions .btn').disabled,
    }));
    eq(preview.left, '7 left', 'remaining points');
    eq(preview.add, '2,2,1', 'allocation (rows Health, Stamina, Mana)');
    eq(preview.stamina, String(before.staminaMax + 2), 'stamina preview');
    eq(preview.mana, String(before.manaMax + 1), 'mana preview');
    eq(preview.hp.replace(/,/g, ''), String(before.hpMax + 60), 'hp preview');
    eq(preview.confirm, false, 'Confirm enabled');
    await browser.evaluate(() => { document.querySelector('.stat-points').scrollIntoView({ block: 'end' }); });
    await sleep(200);
    await shot('character-stat-points');
    await mustTapText('^Confirm$', '.stat-points-actions');
    await sleep(500);
    const after = (await getState()).player;
    eq(after.statPoints, 7, 'points left');
    eq(after.staminaMax, before.staminaMax + 2, 'stamina max');
    eq(after.manaMax, before.manaMax + 1, 'mana max');
    eq(after.hpMax, before.hpMax + 60, 'hp max');
    const hud = await browser.evaluate(() => ({ stamina: document.querySelector('.hud-res.stamina .val').textContent.trim(), mana: document.querySelector('.hud-res.mana .val').textContent.trim() }));
    eq(hud.stamina, `${after.stamina}/${after.staminaMax}`, 'HUD stamina');
    eq(hud.mana, `${after.mana}/${after.manaMax}`, 'HUD mana');
    const bars = await browser.evaluate(() => Array.from(document.querySelectorAll('.pi-bar .pi-bar-text')).map((b) => b.textContent.trim()));
    const stam = await browser.evaluate(() => document.querySelector('.pi-bar[data-stat="stamina"] .pi-bar-text').textContent.trim());
    eq(stam.replace(/,/g, ''), `${after.stamina}/${after.staminaMax}`, `profile stamina bar (${bars.join(' | ')})`);
    await shot('character-stat-points-confirmed');
    // spend the rest so the badge clears
    for (let i = 0; i < 7; i++) await mustTap('.stat-row[data-stat="mana"] .spin.inc');
    await mustTapText('^Confirm$', '.stat-points-actions');
    await sleep(400);
    eq((await getState()).player.statPoints, 0, 'all points spent');
    eq(await browser.evaluate(() => Boolean(document.querySelector('.nav-btn[data-nav="profile"] .badge'))), false, 'profile badge cleared');
    // the extend arrow keeps a "!" only for the album's new set cards (shop.albumNewCards)
    const albumNew = await browser.evaluate(async () => (await import('/src/game/shop.js')).albumNewCards(window.evoker.state(), window.evoker.deps).length > 0);
    eq(await browser.evaluate(() => Boolean(document.querySelector('.nav-btn[data-nav="extend"] .badge'))), albumNew, 'extend badge = album news only');
  });

  /* ---------------------------------------------------------------- daily rewards */
  await step('daily: a new game pays no reward on its first day, the calendar starts tomorrow', async () => {
    await goScreen('go', 'character', { tab: 'daily' });
    const parts = await browser.evaluate(() => ({
      cells: document.querySelectorAll('.daily-cell').length,
      streak: document.querySelector('.daily-streak .num').textContent.trim(),
      claimedToday: Boolean(document.querySelector('.daily-cell.claimed-today[data-day="1"]')),
      btn: document.querySelector('.daily-head .btn').textContent.trim(),
      disabled: document.querySelector('.daily-head .btn').disabled,
      event: Boolean(document.querySelector('.daily-event')),
    }));
    eq(parts.cells, 21, '21-day calendar');
    eq(parts.streak, '0', 'streak 0 on the first day');
    eq(parts.claimedToday, false, 'nothing claimed on the first day');
    eq(parts.btn, 'Come back tomorrow', 'button text');
    eq(parts.disabled, true, 'button disabled');
    eq(parts.event, true, 'event banner');
    await shot('daily-day1');
  });

  await step('daily: claim day 2 with the button', async () => {
    // pretend day 1 was claimed yesterday (the login hook would otherwise claim it automatically)
    await browser.evaluate(async () => {
      const mod = await import('/src/game/shop.js');
      const st = await import('/src/game/state.js');
      window.evoker.store.update((s) => ({ ...s, daily: { ...s.daily, streak: 1, lastClaim: mod.previousDay(st.utcDay(Date.now())) } }));
    });
    await rerender();
    const parts = await browser.evaluate(() => ({ btn: document.querySelector('.daily-head .btn').textContent.trim(), today: document.querySelector('.daily-cell.today') ? document.querySelector('.daily-cell.today').dataset.day : null }));
    eq(parts.btn, 'Claim reward', 'claim button');
    eq(parts.today, '2', 'day 2 highlighted');
    await shot('daily-day2-claimable');
    const before = await getState();
    await openDialog('.daily-head .btn');
    const text = await browser.evaluate(() => document.querySelector('.dialog').textContent);
    assert(/Day 2 reward/.test(text) && /1 Mana \+ 1 Stamina potions/.test(text), `reward dialog: ${text.slice(0, 120)}`);
    await shot('daily-day2-popup');
    await tapDialog('^Great!$');
    await waitScreen('character');
    const after = await getState();
    eq(after.daily.streak, 2, 'streak 2');
    eq(after.player.manaPotions, before.player.manaPotions + 1, '+1 mana potion');
    eq(after.player.staminaPotions, before.player.staminaPotions + 1, '+1 stamina potion');
    const cell = await browser.evaluate(() => ({ claimed: Boolean(document.querySelector('.daily-cell.claimed-today[data-day="2"]')), btn: document.querySelector('.daily-head .btn').textContent.trim(), streak: document.querySelector('.daily-streak .num').textContent.trim() }));
    eq(cell.claimed, true, 'day 2 claimed');
    eq(cell.btn, 'Claimed today', 'button after claim');
    eq(cell.streak, '2', 'streak shown');
  });

  await step('daily: addDays(1) continues the streak, addDays(2) resets it', async () => {
    const before = await getState();
    await debugCall('addDays', 1);
    await sleep(300);
    let s = await getState();
    eq(s.daily.streak, 3, 'streak 3 after one day');
    eq(s.player.gems, before.player.gems + 40, 'day 3 reward: 40 gems');
    await goScreen('go', 'character', { tab: 'daily' });
    eq(await browser.evaluate(() => document.querySelector('.daily-streak .num').textContent.trim()), '3', 'streak 3 shown');
    eq(await browser.evaluate(() => document.querySelectorAll('.daily-cell.claimed').length), 2, 'days 1–2 claimed');
    await shot('daily-streak-3');
    await debugCall('addDays', 2);
    await sleep(300);
    s = await getState();
    eq(s.daily.streak, 1, 'streak reset after a missed day');
    await goScreen('go', 'character', { tab: 'daily' });
    const parts = await browser.evaluate(() => ({ streak: document.querySelector('.daily-streak .num').textContent.trim(), today: Boolean(document.querySelector('.daily-cell.claimed-today[data-day="1"]')), claimed: document.querySelectorAll('.daily-cell.claimed').length }));
    eq(parts.streak, '1', 'streak 1 shown');
    eq(parts.today, true, 'day 1 claimed again');
    eq(parts.claimed, 0, 'calendar restarted');
    await shot('daily-streak-reset');
  });

  /* ---------------------------------------------------------------- settings */
  await step('settings: speed and raids toggle', async () => {
    await goScreen('go', 'character', { tab: 'settings' });
    await shot('settings');
    // the battle speed sits on the client's preset slider (one stop per speed)
    await browser.evaluate(() => {
      const input = document.querySelector('.setting-row[data-setting="speed"] .preset-slider');
      const labels = Array.from(document.querySelectorAll('.setting-row[data-setting="speed"] .opt-presets span')).map((s) => s.textContent.trim());
      input.value = String(labels.indexOf('2×'));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(300);
    eq((await getState()).settings.speed, 2, 'speed saved');
    eq(await browser.evaluate(() => document.querySelector('.setting-row[data-setting="speed"] .opt-presets span.on').textContent.trim()), '2×', '2× marked');
    await mustTap('.setting-row[data-setting="raids"] .toggle');
    eq((await getState()).settings.raids, false, 'raids off');
    eq(await browser.evaluate(() => document.querySelector('.setting-row[data-setting="raids"] .toggle').getAttribute('aria-checked')), 'false', 'toggle aria');
    await mustTap('.setting-row[data-setting="reducedMotion"] .toggle');
    eq((await getState()).settings.reducedMotion, true, 'reduced motion on');
    eq(await browser.evaluate(() => document.documentElement.dataset.reducedMotion), '1', 'html flag');
    await mustTap('.setting-row[data-setting="reducedMotion"] .toggle');
    await shot('settings-changed');
  });

  const downloadDir = join(OPTS.out, 'downloads');
  let exportedPath = null;
  await step('settings: export save downloads a JSON file', async () => {
    await mkdir(downloadDir, { recursive: true });
    for (const f of await readdir(downloadDir)) await unlink(join(downloadDir, f));
    await browser.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true }).catch(() => browser.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir }));
    await mustTapText('^Export save$', '.settings-actions');
    const deadline = Date.now() + 8000;
    let files = [];
    while (Date.now() < deadline) {
      files = (await readdir(downloadDir)).filter((f) => f.endsWith('.json'));
      if (files.length) break;
      await sleep(200);
    }
    assert(files.length === 1, `expected one downloaded .json, got ${files.join(',')}`);
    exportedPath = join(downloadDir, files[0]);
    assert(/^evoker-save-\d{4}-\d{2}-\d{2}\.json$/.test(files[0]), `file name: ${files[0]}`);
    const json = JSON.parse(await readFile(exportedPath, 'utf8'));
    const s = await getState();
    eq(json.player.name, s.player.name, 'exported name');
    eq(json.cards.length, s.cards.length, 'exported cards');
    const toasts = await visibleToasts();
    assert(toasts.some((t) => /exported/i.test(t)), `toast: ${JSON.stringify(toasts)}`);
    return files[0];
  });

  await step('settings: import save replaces the progress after a confirm', async () => {
    assert(exportedPath, 'no exported file to import');
    const json = JSON.parse(await readFile(exportedPath, 'utf8'));
    json.player.name = 'Imported';
    json.player.gold = 777;
    const importPath = join(downloadDir, 'import.json');
    await writeFile(importPath, JSON.stringify(json));
    await setSaveFile(importPath);
    await waitDialog();
    const text = await browser.evaluate(() => document.querySelector('.dialog').textContent);
    assert(/Replace your current progress with "Imported"/.test(text), `confirm text: ${text.slice(0, 160)}`);
    await shot('settings-import-confirm');
    await tapDialog('^Import$');
    await waitScreen('character');
    const s = await getState();
    eq(s.player.name, 'Imported', 'imported name');
    eq(s.player.gold, 777, 'imported gold');
    eq(await browser.evaluate(() => document.querySelector('.hud-wallet .row.gold .num').textContent), '777', 'HUD gold after import');
    // a broken file is rejected
    const badPath = join(downloadDir, 'bad.json');
    await writeFile(badPath, '{"nope": true}');
    await goScreen('go', 'character', { tab: 'settings' });
    await setSaveFile(badPath);
    await waitDialog();
    const bad = await browser.evaluate(() => document.querySelector('.dialog').textContent);
    assert(/Import failed/.test(bad), `bad import dialog: ${bad.slice(0, 120)}`);
    await tapDialog('^OK$');
    eq((await getState()).player.name, 'Imported', 'bad file did not replace the save');
  });

  await step('settings: reset progress needs two confirms, then starts over', async () => {
    await mustTapText('^Reset progress$', '.settings-actions');
    await waitDialog();
    await tapDialog('^Cancel$');
    eq((await getState()).player.name, 'Imported', 'cancel keeps the save');
    await mustTapText('^Reset progress$', '.settings-actions');
    await waitDialog();
    const t1 = await browser.evaluate(() => document.querySelector('.dialog-title').textContent.trim());
    eq(t1, 'Reset progress', 'first dialog');
    await mustTapText('^Reset$', '.dialog-buttons');
    await waitDialog();
    const t2 = await browser.evaluate(() => document.querySelector('.dialog-title').textContent.trim());
    eq(t2, 'Are you sure?', 'second dialog');
    await shot('settings-reset-second-confirm');
    await mustTapText('^Yes, reset$', '.dialog-buttons');
    await browser.waitFor('document.body && document.body.dataset.ready === "1" && window.evoker && window.evoker.state() === null', 15000);
    await waitScreen('title');
    const saved = await browser.evaluate(() => localStorage.getItem('evoker.save.v1'));
    eq(saved, null, 'localStorage cleared');
    await shot('after-reset-title');
  });
}

qa.run(async (b, base) => { browser = b; await runScenario(base); });
