'use strict';
/**
 * Regressions around a fight that ends on a player's HP (reported 2026-10-10, League vs Imara, quest 3, the lab):
 *  - "the cards just disappear and the game says I win": the killing step used to be replaced by the finale, so
 *    the blow was never seen and the board vanished with the loser's bar still full;
 *  - "even if an attack takes the opponent below zero, follow the order of attacks until the end": the attacks
 *    after the killing blow were skipped. The engine finishes the round, so the playback must draw every attack
 *    of that round, with the bars going negative on the hits;
 *  - the victory presentation (starburst, then banner) begins only once the numbers are final, and the surviving
 *    cards stay on the board (no wipe).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useApp, attackAndWaitForRound, leaveResult, skipReason, sleep, STRONG_DECK } from './harness.js';

const ctx = useApp();

/** Installed once ROUND 1 shows: records round-label changes, missiles, the finale starburst and the banner. */
function installWatcher() {
  const w = { t0: performance.now(), rounds: [], bullets: [], burstAt: null, hpAtBurst: null, bannerAt: null, hpAtBanner: null, cardsAtBanner: null };
  const label = () => { const el = document.querySelector('.battle-hp-row.opp .bar-label'); return el ? el.textContent.trim() : null; };
  const now = () => Math.round(performance.now() - w.t0);
  const roundEl = document.querySelector('.battle-round');
  w.rounds.push({ t: now(), text: roundEl ? roundEl.textContent : '' });
  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1 || !n.classList) continue;
        if (n.classList.contains('bullet')) w.bullets.push(now());
        if (w.burstAt === null && n.classList.contains('fx-sprite') && String(n.style.getPropertyValue('--img')).includes('white_glow') && n.style.getPropertyValue('--w').trim() === '560px') { w.burstAt = now(); w.hpAtBurst = label(); }
        if (w.bannerAt === null && (n.classList.contains('wonlost') || n.classList.contains('battle-result') || n.querySelector('.wonlost, .battle-result'))) { w.bannerAt = now(); w.hpAtBanner = label(); w.cardsAtBanner = document.querySelectorAll('.battle-row .card').length; }
      }
    }
    const text = roundEl ? roundEl.textContent : '';
    if (w.rounds[w.rounds.length - 1].text !== text) w.rounds.push({ t: now(), text });
  });
  obs.observe(document.querySelector('.screen[data-screen="battle"]'), { childList: true, subtree: true, characterData: true });
  window.__e2eWatch = w;
  return true;
}

const hpOf = (text) => Number(String(text || '').split('/')[0].replace(/[^\d-]/g, ''));

test('a fight that ends on a lethal blow plays every attack of its last round, then the starburst and the banner, cards still on the board', { skip: skipReason, timeout: 240000 }, async () => {
  const { browser, app } = ctx;
  await ctx.freshGame({ level: 6, deck: STRONG_DECK });
  await browser.evaluate(() => window.evoker.goTop('arena'));
  await app.waitScreen('arena');
  await app.dismissOverlays(5);
  assert.ok(await browser.tap('.arena-offer[data-offer="0"] button[aria-label^="Attack"]'), 'arena attack button');
  await app.waitScreen('prebattle', 8000);
  await sleep(400);
  await attackAndWaitForRound(ctx);
  await browser.evaluate(installWatcher);
  await browser.waitFor('Boolean(document.querySelector(".battle-result, .wonlost"))', 90000);
  await sleep(300);
  const w = await browser.evaluate(() => window.__e2eWatch);
  // the engine's own account of the last round: how it ended and how many missiles its attacks fire
  const engine = await browser.evaluate(() => {
    const p = window.evoker.router.current().params;
    const ev = p.events || (p.battle && p.battle.events) || [];
    const end = ev.find((x) => x.t === 'battleEnd');
    const lastRound = end ? end.rounds : 0;
    let round = 0; let missiles = 0; let lethalSeen = false; let attacksAfterLethal = 0;
    for (const e of ev) {
      if (e.t === 'roundStart') round = e.round;
      if (round !== lastRound) continue;
      if (e.t === 'attack') { missiles += (e.targets || []).length; if (lethalSeen) attacksAfterLethal += 1; }
      if (e.t === 'damage' && (e.slot === null || e.slot === undefined) && e.hp <= 0) lethalSeen = true;
    }
    return { endedBy: end && end.endedBy, defenderHp: end && end.defenderHp, lastRound, missiles, attacksAfterLethal };
  });
  await ctx.shot('lethal-finale-end');
  assert.equal(engine.endedBy, 'playerHp', `this set-up should end on a lethal blow (ended by ${engine.endedBy})`);
  assert.ok(w.burstAt !== null, 'the finale starburst appeared');
  const lastRound = w.rounds.filter((r) => r.t <= w.burstAt).pop();
  assert.match(lastRound.text, new RegExp(`ROUND ${engine.lastRound}`), `the last round drawn is the engine's last round (${lastRound.text} vs ${engine.lastRound})`);
  const drawn = w.bullets.filter((t) => t >= lastRound.t && t <= w.burstAt).length;
  assert.equal(drawn, engine.missiles, `every attack of the last round is drawn (${drawn} missiles drawn, ${engine.missiles} in the log; ${engine.attacksAfterLethal} attacks come after the killing blow)`);
  assert.equal(hpOf(w.hpAtBurst), engine.defenderHp, `at the starburst the loser's HP label is final (label "${w.hpAtBurst}", final ${engine.defenderHp})`);
  assert.ok(w.bannerAt !== null && w.bannerAt >= w.burstAt, 'the banner follows the starburst');
  assert.equal(hpOf(w.hpAtBanner), engine.defenderHp, `at the banner the loser's HP label is final (label "${w.hpAtBanner}")`);
  assert.ok(w.cardsAtBanner >= 1, `the cards left alive stay on the board through the victory (${w.cardsAtBanner} on the board at the banner)`);
  await leaveResult(ctx, 'arena');
  assert.deepEqual(ctx.errors(), [], 'no console errors');
});
