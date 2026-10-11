'use strict';
/**
 * Regression (reported 2026-10-10): "the game skips the fight to the end" in the League. A league fight must play
 * its rounds on the battle screen - ROUND 1 shown, the result only after the playback - and end as 'played', not
 * 'skipped' (the battle screen's data-ended hook), with no console exception (an exception during playback is
 * what jumps a fight to the result). A skipped fight shows its result within ~0.1 s of ROUND 1; a played one
 * takes at least the first attack (~1.5 s), or the lethal-blow finale (~1.7 s) when the first blow already ends it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useApp, attackAndWaitForRound, waitForResult, leaveResult, skipReason, sleep, STRONG_DECK } from './harness.js';

const ctx = useApp();
/** Below this a fight did not play at all (a skip shows the result ~0.1 s after ROUND 1). */
const MIN_PLAY_MS = 800;

/** The decks the report was made with: post-2016 cards with their own event types. */
const DECKS = [
  ['dark-mage', 'sentinel', 'cursed-stag', 'mountain-yeti', 'thief-of-time'],
  ['raptorial-fungus', 'lightning-spirit', 'colossus', 'bone-dragon', 'djinn'],
];

async function joinLeague() {
  const { browser, app } = ctx;
  await browser.evaluate(() => window.evoker.goTop('arena'));
  await app.waitScreen('arena');
  await app.dismissOverlays(5);
  assert.ok(await browser.tap('.nav-btn[data-nav="league"]'), 'League nav button');
  await app.waitScreen('league');
  await app.waitSel('.dialog-league-enter', 6000);
  assert.ok(await app.tapDialogButton('^Join League$'), 'Join League button');
  await app.waitGone('.dialog-backdrop:not(.closing)');
  await sleep(400);
}

async function leagueFight() {
  const { browser, app } = ctx;
  await browser.evaluate(() => window.evoker.goTop('league'));
  await app.waitScreen('league');
  await sleep(600);
  await app.dismissOverlays(3);
  assert.ok(await browser.tap('.league-row:not(.me) .league-fight-btn:not(.locked)'), 'a fightable league row');
  await app.waitScreen('prebattle', 8000);
  await sleep(500);
  await attackAndWaitForRound(ctx);
  const result = await waitForResult(ctx);
  await leaveResult(ctx, 'league');
  return result;
}

test('a league fight plays its rounds and ends as played, not skipped', { skip: skipReason, timeout: 300000 }, async () => {
  await ctx.freshGame({ level: 6, deck: STRONG_DECK });
  await joinLeague();
  const first = await leagueFight();
  assert.equal(first.ended, 'played', `fight 1 ended as ${first.ended}`);
  assert.ok(first.ms >= MIN_PLAY_MS, `fight 1 showed its result after only ${first.ms} ms`);
  for (const [i, deck] of DECKS.entries()) {
    await ctx.setDeck(deck);
    const r = await leagueFight();
    assert.equal(r.ended, 'played', `fight with deck ${i + 1} (${deck.join(', ')}) ended as ${r.ended}`);
    assert.ok(r.ms >= MIN_PLAY_MS, `fight with deck ${i + 1} showed its result after only ${r.ms} ms`);
  }
  assert.deepEqual(ctx.errors().map((e) => `[${e.kind}] ${e.text}`), [], 'no console errors during the fights');
});
