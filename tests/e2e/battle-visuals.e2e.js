'use strict';
/**
 * Regressions on the battle screen's drawing:
 *  - 2026-10-10 "the numbers of the opponent's cards are cut": the top row's stat strip started at the card's edge
 *    and the frame overlay covered its first row. Both rows' numbers must keep a clearance from the card edge.
 *  - 2026-10-10 "cards that reflect damage disappear before they deal it": the engine logs a reflector's death
 *    before the damage it reflects; the timeline reorders them (unit: tests/battle-player.test.js). Here the real
 *    fight's event log is checked through the app's own timeline builder.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useApp, attackAndWaitForRound, waitForResult, leaveResult, skipReason, sleep, STRONG_DECK } from './harness.js';

const ctx = useApp();

/** Distance of every stat number from the near edge of its card, per row (top row: from the top; bottom: from the bottom). */
function stripClearance() {
  const rows = {};
  for (const row of ['top', 'bottom']) {
    rows[row] = Array.from(document.querySelectorAll(`.battle-row.${row} .card`)).map((card) => {
      const cr = card.getBoundingClientRect();
      return Array.from(card.querySelectorAll('.card-strip .card-stat .num')).map((n) => {
        const r = n.getBoundingClientRect();
        return { text: n.textContent, near: +(row === 'top' ? r.top - cr.top : cr.bottom - r.bottom).toFixed(1), inside: r.top >= cr.top && r.bottom <= cr.bottom };
      });
    });
  }
  return rows;
}

/** The running fight's event log through the app's timeline: bounces drawn after their reflector's death. */
async function reflectOrder() {
  const { fromEvents } = await import('/src/ui/battle/timeline.js');
  const p = window.evoker.router.current().params;
  const events = p.events || (p.battle && p.battle.events) || [];
  const steps = fromEvents(events);
  const out = { reflects: 0, deaths: 0, violations: [] };
  steps.forEach((s, i) => {
    if (s.type !== 'death') return;
    for (const d of s.deaths) {
      out.deaths += 1;
      for (const later of steps.slice(i + 1)) {
        const hits = later.hits || [];
        if (hits.some((h) => h.cause === 'reflect' && h.source && h.source.side === d.side && h.source.slot === d.slot)) out.violations.push(`${d.side}:${d.slot}`);
      }
    }
  });
  out.reflects = steps.reduce((n, s) => n + (s.hits || []).filter((h) => h.cause === 'reflect').length, 0);
  return out;
}

async function arenaFightToRound() {
  const { browser, app } = ctx;
  await browser.evaluate(() => window.evoker.goTop('arena'));
  await app.waitScreen('arena');
  await app.dismissOverlays(5);
  assert.ok(await browser.tap('.arena-offer[data-offer="0"] button[aria-label^="Attack"]'), 'arena attack button');
  await app.waitScreen('prebattle', 8000);
  await sleep(400);
  await attackAndWaitForRound(ctx);
}

test('battle cards: the stat numbers of both rows clear the card edge (opponent row was clipped)', { skip: skipReason, timeout: 180000 }, async () => {
  const { browser } = ctx;
  await ctx.freshGame({ level: 6, deck: STRONG_DECK });
  await arenaFightToRound();
  await sleep(300);
  const rows = await browser.evaluate(stripClearance);
  await ctx.shot('battle-strips');
  assert.ok(rows.top.length >= 1 && rows.bottom.length === 5, `cards on the board: ${rows.top.length} top, ${rows.bottom.length} bottom`);
  const MIN = 4;
  for (const row of ['top', 'bottom']) {
    for (const stats of rows[row]) {
      assert.equal(stats.length, 4, `${row} card has 4 stats`);
      for (const s of stats.filter((x) => x.text !== '')) {
        assert.ok(s.inside, `${row} stat "${s.text}" is inside its card`);
        assert.ok(s.near >= MIN, `${row} stat "${s.text}" is ${s.near} px from the card edge (min ${MIN})`);
      }
    }
  }
  // the two rows mirror each other: same clearance of the outer row of numbers
  const topNear = Math.min(...rows.top.flat().map((s) => s.near));
  const bottomNear = Math.min(...rows.bottom.flat().map((s) => s.near));
  assert.ok(Math.abs(topNear - bottomNear) <= 2, `outer clearance top ${topNear} px vs bottom ${bottomNear} px`);
  assert.ok(await browser.tap('.battle-skip'), 'Skip fight');
  await waitForResult(ctx);
  await leaveResult(ctx, 'arena');
  assert.deepEqual(ctx.errors(), [], 'no console errors');
});

test('a fight with dying reflectors: every reflector\'s death step comes after the step carrying its bounce', { skip: skipReason, timeout: 180000 }, async () => {
  const { browser } = ctx;
  // five unfused Lookalikes (reflect_damage, 780 hp) against a level-6 arena opponent: some die, all reflect
  await ctx.freshGame({ level: 6, deck: ['lookalike', 'lookalike', 'lookalike', 'lookalike', 'lookalike'], stage: 0, cardLevel: 1 });
  await arenaFightToRound();
  const check = await browser.evaluate(reflectOrder);
  assert.ok(check.reflects > 0, 'the fight contained reflected damage');
  assert.deepEqual(check.violations, [], `bounces drawn after the reflector's death: ${check.violations.join(', ')}`);
  const result = await waitForResult(ctx);
  assert.equal(result.ended, 'played', `the fight ended as ${result.ended}`);
  await leaveResult(ctx, 'arena');
  assert.deepEqual(ctx.errors(), [], 'no console errors');
});
