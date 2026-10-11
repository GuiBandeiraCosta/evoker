'use strict';
/**
 * Regression (reported 2026-10-10): on a boss pre-battle screen, viewing any card and coming back left the boss
 * intro's card stuck big in the middle of the screen with the Attack! bar hidden (the screen was rebuilt with
 * `params.intro` still set and the flight never ran). Also pins that tapping a card opens that card's detail.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useApp, tapToBoss, skipReason, sleep } from './harness.js';

const ctx = useApp();

function probe() {
  const fly = document.querySelector('.prebattle-introcard');
  const bar = document.querySelector('.prebattle-screen .attack-bar');
  return {
    introCard: Boolean(fly),
    barHidden: bar ? bar.classList.contains('intro-hidden') : null,
    barVisible: bar ? getComputedStyle(bar).visibility !== 'hidden' && getComputedStyle(bar).opacity !== '0' : null,
    pendingSlots: document.querySelectorAll('.opp-slot.intro-pending').length,
  };
}

async function viewAndBack(sel, { own = true } = {}) {
  const { browser, app } = ctx;
  const tapped = await browser.evaluate((s) => { const el = document.querySelector(s); return el ? { uid: el.dataset.uid || null, cardId: el.dataset.cardId || null } : null; }, sel);
  assert.ok(tapped, `card ${sel} is on the screen`);
  assert.ok(await browser.tap(sel));
  await app.waitScreen('card-detail', 8000);
  const shown = await browser.evaluate(() => { const c = document.querySelector('.card-detail-screen .card'); return c ? { uid: c.dataset.uid || null, cardId: c.dataset.cardId || null } : null; });
  assert.ok(shown, 'the detail screen shows a card');
  assert.equal(shown.cardId, tapped.cardId, 'the detail shows the tapped card');
  // own cards open their instance; an opponent's card (synthetic uid such as boss-0) opens the catalog card
  if (own) assert.equal(shown.uid, tapped.uid, 'the detail shows the tapped instance');
  else assert.equal(shown.uid, null, 'an opponent card opens the catalog card, not an instance');
  await browser.evaluate(() => window.evoker.router.back());
  await app.waitScreen('prebattle', 8000);
  await sleep(1500);
  return browser.evaluate(probe);
}

test('boss pre-battle: the intro card lands, and viewing a card then coming back does not bring it back', { skip: skipReason, timeout: 120000 }, async () => {
  const { browser, app } = ctx;
  await ctx.freshGame({ extra: ['ogre', 'pegasus', 'dark-mage'] });
  await browser.evaluate(() => window.evoker.goTop('quest'));
  await app.waitScreen('quest-map');
  await app.dismissOverlays(5);
  // the map scrolls to the current node and may still show a guide bubble: tap, and retry once if the quest did not open
  for (let attempt = 0; attempt < 3; attempt++) {
    await app.dismissOverlays(3);
    await sleep(500);
    assert.ok(await browser.tap('.qm-node[data-quest="1"]'), 'quest node 1');
    try { await app.waitScreen('quest', 4000); break; } catch (err) { if (attempt === 2) throw err; }
  }
  await tapToBoss(ctx);
  await app.waitScreen('prebattle', 12000);
  await sleep(1800);
  const landed = await browser.evaluate(probe);
  assert.deepEqual(landed, { introCard: false, barHidden: false, barVisible: true, pendingSlots: 0 }, `after the intro: ${JSON.stringify(landed)}`);

  const afterDrawer = await viewAndBack('.prebattle-drawer-cards .card:nth-child(1)');
  await ctx.shot('prebattle-after-card-view');
  assert.deepEqual(afterDrawer, { introCard: false, barHidden: false, barVisible: true, pendingSlots: 0 }, `after viewing a drawer card: ${JSON.stringify(afterDrawer)}`);

  const afterOpp = await viewAndBack('.prebattle-row.opp .opp-slot .card', { own: false });
  assert.deepEqual(afterOpp, { introCard: false, barHidden: false, barVisible: true, pendingSlots: 0 }, `after viewing an opponent card: ${JSON.stringify(afterOpp)}`);

  await browser.evaluate(() => window.evoker.router.rerender());
  await sleep(1200);
  assert.deepEqual(await browser.evaluate(probe), { introCard: false, barHidden: false, barVisible: true, pendingSlots: 0 }, 'after a rerender');
  assert.deepEqual(ctx.errors(), [], 'no console errors');
});
