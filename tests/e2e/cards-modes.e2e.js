'use strict';
/**
 * Regression (reported 2026-10-11): the tutorial's ranger stood at the bottom left of the Cards screen in its
 * training ("sacrifice") and fusion ("merge") modes for every player, tutorial or not. The guide belongs to
 * the tutorial overlay only; outside a tutorial line no portrait may be on the deck screen in any mode.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useApp, skipReason, sleep } from './harness.js';

const ctx = useApp();

function probe() {
  const imgs = Array.from(document.querySelectorAll('.cards-screen img'))
    .filter((img) => /guide|ranger|portrait/i.test(img.getAttribute('src') || '') || img.classList.contains('cards-guide'));
  return {
    tab: document.querySelector('.cards-screen')?.dataset.tab || null,
    guides: imgs.length,
    tutorialBox: Boolean(document.querySelector('.tut-text')),
  };
}

test('cards screen: no tutorial ranger in the training or fusion mode of a finished-tutorial game', { skip: skipReason, timeout: 120000 }, async () => {
  const { browser, app } = ctx;
  await ctx.freshGame({ level: 10, extra: ['ogre', 'ogre', 'pegasus', 'pegasus'] });
  await browser.evaluate(() => window.evoker.go('cards', { tab: 'deck' }));
  await app.waitScreen('cards', 8000);
  await app.dismissOverlays(3);
  for (const mode of ['training', 'fusion', 'deck']) {
    assert.ok(await browser.tap(`.mode-btn[data-tab="${mode}"]`), `${mode} mode button`);
    await sleep(500);
    const seen = await browser.evaluate(probe);
    await ctx.shot(`cards-mode-${mode}`);
    assert.equal(seen.tab, mode, `the ${mode} mode is shown`);
    assert.equal(seen.tutorialBox, false, `no tutorial line in ${mode} mode`);
    assert.equal(seen.guides, 0, `no guide portrait in ${mode} mode`);
  }
  assert.deepEqual(ctx.errors(), [], 'no console errors');
});
