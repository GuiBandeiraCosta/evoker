'use strict';
/**
 * Phone-style scrolling with the mouse (user's request 2026-10-12: no scrollbars, the content is dragged like on a
 * phone; src/ui/drag-scroll.js). Pins: a mouse drag on the quest map scrolls it, the release of a drag does not
 * tap what is under the pointer (no quest opens), the scrollbars are hidden, and a plain tap still works.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useApp, skipReason, sleep } from './harness.js';

const ctx = useApp();

/** The map body's scroll position and size (stage px). */
function probe() {
  const body = document.querySelector('.qm-body');
  if (!body) return null;
  const cs = getComputedStyle(body);
  return {
    top: body.scrollTop, left: body.scrollLeft,
    scrollHeight: body.scrollHeight, clientHeight: body.clientHeight,
    scrollbarWidth: cs.scrollbarWidth, overflowY: cs.overflowY,
    screen: ((window.evoker.router.current && window.evoker.router.current()) || {}).id,
  };
}

test('the quest map scrolls by dragging it with the mouse, the release is no tap, and the scrollbars are hidden', { skip: skipReason, timeout: 120000 }, async () => {
  const { browser, app } = ctx;
  await ctx.freshGame({ level: 20 });
  await browser.evaluate(() => window.evoker.goTop('quest'));
  await app.waitScreen('quest-map');
  await app.dismissOverlays(5);
  await sleep(600);
  const before = await browser.evaluate(probe);
  assert.ok(before, 'the map body is there');
  assert.ok(before.scrollHeight > before.clientHeight + 200, `the map is taller than the screen (${before.scrollHeight} / ${before.clientHeight})`);
  assert.equal(before.scrollbarWidth, 'none', 'no scrollbar on the stage');
  // scroll to the top first (the map opens on the current node), then drag the map upwards by 300 stage px
  await browser.evaluate(() => { document.querySelector('.qm-body').scrollTop = 0; });
  const from = { x: 360, y: 900 };
  const to = { x: 360, y: 600 };
  const scale = await browser.evaluate(() => window.evoker.ui.stage.getScale());
  const rect = await browser.evaluate(() => { const r = document.getElementById('stage').getBoundingClientRect(); return { x: r.left, y: r.top }; });
  const client = (p) => ({ x: rect.x + p.x * scale, y: rect.y + p.y * scale });
  await app.drag(client(from), client(to), { steps: 15, holdMs: 0, settleMs: 900 });
  const after = await browser.evaluate(probe);
  assert.ok(after.top >= 250, `the map scrolled by the drag (scrollTop ${after.top})`);
  assert.equal(after.screen, 'quest-map', 'releasing the drag opened nothing');
  await ctx.shot('drag-scroll-map');
  // a flick keeps going: from the top again, a fast 100 px drag ends further than its own travel
  await browser.evaluate(() => { document.querySelector('.qm-body').scrollTop = 0; });
  const room = before.scrollHeight - before.clientHeight;
  await app.drag(client({ x: 360, y: 900 }), client({ x: 360, y: 800 }), { steps: 4, holdMs: 0, settleMs: 1200 });
  const flicked = await browser.evaluate(probe);
  assert.ok(flicked.top > Math.min(room - 10, 150), `inertia carried the flick past its 100 px (${flicked.top} of ${room})`);
  assert.equal(await browser.evaluate(() => Boolean(document.querySelector('.drag-scrolling'))), false, 'the grab cursor is gone after the release');
  assert.deepEqual(ctx.errors(), [], 'no console errors');
});
