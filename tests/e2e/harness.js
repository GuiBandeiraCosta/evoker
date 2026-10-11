'use strict';
/**
 * Shared harness of the end-to-end regression suite (tests/e2e/*.e2e.js, `npm run test:e2e`).
 *
 * One file = one browser: `useApp()` serves the project in-process, launches headless Edge/Chrome through the
 * zero-dependency driver (tools/cdp.js) and binds the QA helpers (tools/qa-lib.js bindApp) in node:test
 * before/after hooks. Without an installed browser every test is skipped, not failed (same rule as
 * tests/cdp.test.js). Screenshots go to tests/screenshots/e2e/.
 *
 * Every test here guards a bug that was reported once: say which, with the date, in the test name or a comment,
 * and drive the thing under test with real input (tap / drag) - the debug API (window.evoker.debug) is for set-up.
 */
import { before, after } from 'node:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { findBrowser, launch } from '../../tools/cdp.js';
import { startServer, bindApp, ROOT, sleep } from '../../tools/qa-lib.js';

export { sleep };

/** False when a browser is available, else the reason to skip (`test(name, { skip: skipReason }, fn)`). */
export const skipReason = findBrowser() ? false : 'no Edge/Chrome installed (set EVOKER_BROWSER)';

/** Folder of the suite's screenshots. */
export const SHOTS = join(ROOT, 'tests', 'screenshots', 'e2e');

/** Five maxed cards without special event types: a deck that wins the early content. */
export const STRONG_DECK = ['chimera', 'devourer', 'giant-spider', 'colossus', 'army-of-ghosts'];

/**
 * Serve + launch once for the calling test file.
 * @param {{goSettleMs?: number, goClosesDialogs?: boolean}} [opts]  bindApp options
 * @returns {{browser: import('../../tools/cdp.js').Browser|null, base: string|null, app: ReturnType<typeof bindApp>|null,
 *   errors: () => object[], shot: (name: string) => Promise<string>, freshGame: (o?: object) => Promise<void>,
 *   setDeck: (ids: string[], stage?: number, level?: number) => Promise<string[]>}}
 */
export function useApp(opts = {}) {
  const ctx = {
    browser: null,
    base: null,
    app: null,
    errors: () => (ctx.browser ? ctx.browser.errors() : []),
    shot: (name) => ctx.browser.screenshot(join(SHOTS, `${name}.png`)),
    freshGame,
    setDeck,
  };
  let server = null;

  before(async () => {
    if (skipReason) return;
    await mkdir(SHOTS, { recursive: true });
    server = await startServer();
    ctx.base = server.base;
    ctx.browser = await launch({ headless: process.env.E2E_HEADED !== '1' });
    // bindApp reads qa.browser lazily, so the context object itself serves as the "qa" handle
    ctx.app = bindApp(ctx, { goSettleMs: 350, goClosesDialogs: true, ...opts });
  });

  after(async () => {
    if (ctx.browser) { try { await ctx.browser.close(); } catch { /* ignore */ } }
    if (server) server.kill();
  });

  /**
   * A fresh save: new game, optional player level, gold, all five deck slots, a deck of `deck` card ids at
   * `stage`/`level` and `extra` cards (stage 0, level 1) outside the deck. Unlock popups are dismissed.
   * @param {{level?: number, gold?: number, deck?: string[], stage?: number, cardLevel?: number, extra?: string[]}} [o]
   */
  async function freshGame(o = {}) {
    const { app, browser } = ctx;
    await app.bootFresh(ctx.base);
    await browser.evaluate((n) => window.evoker.debug.newGame(n), 'E2E');
    await browser.evaluate((level, gold) => {
      const d = window.evoker.debug;
      if (level > 1) d.setLevel(level);
      if (gold) d.giveGold(gold);
      d.refill();
    }, o.level || 1, o.gold == null ? 2000 : o.gold);
    await app.patchPlayer({ deckSlots: 5 });
    if (o.extra && o.extra.length) {
      await browser.evaluate((ids) => { for (const id of ids) window.evoker.debug.addCard(id, 0, 1); }, o.extra);
    }
    if (o.deck && o.deck.length) await setDeck(o.deck, o.stage == null ? 4 : o.stage, o.cardLevel == null ? 54 : o.cardLevel);
    await app.dismissOverlays(5);
  }

  /** Add the cards and put them in the deck (qa-lib `setDeck`); mana is raised so any deck can attack. */
  function setDeck(ids, stage = 4, level = 54) {
    return ctx.app.setDeck(ids, stage, level);
  }

  return ctx;
}

/**
 * Tap through the active quest's minions until the boss intro opens (refills stamina, closes dialogs).
 * @param {ReturnType<typeof useApp>} ctx
 */
export const tapToBoss = (ctx, maxTaps = 40) => ctx.app.tapToBoss(maxTaps);

/**
 * From a pre-battle screen: Attack!, then wait for the battle screen and its "ROUND 1".
 * @param {ReturnType<typeof useApp>} ctx
 */
export async function attackAndWaitForRound(ctx) {
  const { browser, app } = ctx;
  if (!await browser.tap('.attack-bar .attack-btn')) throw new Error('Attack! button missing');
  await app.waitScreen('battle', 15000);
  await browser.waitFor('Boolean(document.querySelector(".battle-round.shown"))', 15000);
}

/**
 * Wait for the fight's result overlay; returns how the fight ended ('played' | 'skipped', the battle screen's
 * test hook) and the ms the battle screen was up before the result.
 * @param {ReturnType<typeof useApp>} ctx
 * @param {number} [timeoutMs]
 */
export async function waitForResult(ctx, timeoutMs = 90000) {
  const t0 = Date.now();
  await ctx.browser.waitFor('Boolean(document.querySelector(".battle-result, .wonlost"))', timeoutMs);
  const ended = await ctx.browser.evaluate(() => { const r = document.querySelector('.screen[data-screen="battle"]'); return r ? r.dataset.ended || null : null; });
  return { ended, ms: Date.now() - t0 };
}

/**
 * Leave the result overlay (tap through loot / card level-ups / Continue) until the screen `backTo` shows; the
 * level-up / unlock popups that follow are dismissed.
 * @param {ReturnType<typeof useApp>} ctx
 * @param {string} backTo
 */
export async function leaveResult(ctx, backTo) {
  await ctx.app.finishResult();
  await ctx.app.waitScreen(backTo, 10000);
  await ctx.app.dismissOverlays(3);
}
