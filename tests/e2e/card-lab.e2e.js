'use strict';
/**
 * The Card Lab (src/ui/screens/lab.js, opened with ?lab): a test screen for every card's behaviour in combat.
 * Added 2026-10-10 on request. Guards: the lab opens from the URL, picking a card builds the scenario around it
 * (card in the middle of the own row, two allies, five opponents), Fight! runs the real battle screen, and the
 * engine's event log is listed afterwards.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useApp, waitForResult, leaveResult, skipReason, sleep } from './harness.js';

const ctx = useApp();

/** Pick a card in a <select> the way a user would (value + change event). */
function pick(sel, value) {
  const el = document.querySelector(sel);
  if (!el) return false;
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el.value === value;
}

test('?lab opens the Card Lab; a picked card gets allies and opponents, fights on the real battle screen and lists the log', { skip: skipReason, timeout: 180000 }, async () => {
  const { browser, app } = ctx;
  await browser.navigate(`${ctx.base}?lab`);
  await browser.waitFor('document.body && document.body.dataset.ready === "1"', 20000);
  await app.waitScreen('lab', 10000);
  assert.ok(await browser.evaluate(pick, '.lab-card', 'will-o-the-wisp'), 'the card select takes Will-o\'-the-Wisp');
  await sleep(200);
  const setup = await browser.evaluate(() => ({
    ability: document.querySelector('.lab-ability').textContent,
    own: Array.from(document.querySelectorAll('.lab-row[data-side="own"] .lab-slot-card')).map((s) => s.value),
    opp: Array.from(document.querySelectorAll('.lab-row[data-side="opp"] .lab-slot-card')).map((s) => s.value),
    test: document.querySelector('.lab-row[data-side="own"] .lab-slot.test .lab-slot-num')?.textContent,
  }));
  assert.match(setup.ability, /reflect|damage/i, `ability text shown: "${setup.ability}"`);
  assert.equal(setup.own[2], 'will-o-the-wisp', 'the tested card sits in the middle of the own row');
  assert.ok(setup.own[1] && setup.own[3] && setup.own[1] === setup.own[3], `allies on both sides (${setup.own.join(', ')})`);
  assert.ok(setup.opp.every(Boolean) && setup.opp.length === 5, `five opponents (${setup.opp.join(', ')})`);
  assert.equal(setup.test, '3', 'the tested slot is marked');

  // an ability that needs allies: they are the targets, nothing else changes
  assert.ok(await browser.evaluate(pick, '.lab-card', 'arch-angel'));
  await sleep(200);
  const angel = await browser.evaluate(() => Array.from(document.querySelectorAll('.lab-row[data-side="own"] .lab-slot-card')).map((s) => s.value));
  assert.equal(angel[2], 'arch-angel');
  assert.ok(angel.filter(Boolean).length === 5, 'Arch Angel has neighbours to raise');

  assert.ok(await browser.evaluate(pick, '.lab-card', 'will-o-the-wisp'));
  await sleep(200);
  assert.ok(await browser.tap('.lab-fight'), 'Fight! button');
  await app.waitScreen('battle', 15000);
  await browser.waitFor('Boolean(document.querySelector(".battle-round.shown"))', 15000);
  await browser.waitFor('Boolean(document.querySelector(".battle-skip:not(.waiting)"))', 15000);
  assert.ok(await browser.tap('.battle-skip'), 'the lab fight can be skipped');
  await waitForResult(ctx);
  await leaveResult(ctx, 'lab');
  const log = await browser.evaluate(() => ({ head: document.querySelector('.lab-log-head').textContent, lines: document.querySelectorAll('.lab-log-lines li').length, text: document.querySelector('.lab-log-lines').textContent }));
  await ctx.shot('card-lab-after-fight');
  assert.match(log.head, /^Last fight: /, log.head);
  assert.ok(log.lines > 5, `the engine log is listed (${log.lines} lines)`);
  assert.match(log.text, /reflect|Will-o/i, 'the log mentions the tested card or its reflect');
  assert.deepEqual(ctx.errors(), [], 'no console errors');
});

test('the effect showcase lists every effect type and Show runs the fight of that effect', { skip: skipReason, timeout: 180000 }, async () => {
  const { browser, app } = ctx;
  await browser.navigate(`${ctx.base}?lab`);
  await browser.waitFor('document.body && document.body.dataset.ready === "1"', 20000);
  await app.waitScreen('lab', 10000);
  const rows = await browser.evaluate(() => Array.from(document.querySelectorAll('.lab-effect')).map((r) => ({ type: r.dataset.type, name: r.querySelector('.lab-effect-name').textContent, look: r.querySelector('.lab-effect-look').textContent.length })));
  assert.ok(rows.length >= 22, `${rows.length} effect rows`);
  assert.ok(rows.every((r) => r.type && r.name && r.look > 20), 'every row is named and explained');
  assert.ok(await browser.tap('.lab-effect[data-type="reflect_damage"] .lab-effect-show'), 'Show on reflect damage');
  await app.waitScreen('battle', 15000);
  await browser.waitFor('Boolean(document.querySelector(".battle-skip:not(.waiting)"))', 15000);
  await sleep(2500);
  assert.ok(await browser.tap('.battle-skip'));
  await waitForResult(ctx);
  await leaveResult(ctx, 'lab');
  const after = await browser.evaluate(() => ({ effect: (document.querySelector('.lab-log-effect') || {}).textContent || '', card: document.querySelector('.lab-card').value, middle: document.querySelectorAll('.lab-row[data-side="own"] .lab-slot-card')[2].value }));
  assert.equal(after.card, 'lookalike');
  assert.equal(after.middle, 'lookalike');
  assert.ok(after.effect.includes('reflect_damage fired in round'), after.effect);
  assert.deepEqual(ctx.errors(), [], 'no console errors');
});
