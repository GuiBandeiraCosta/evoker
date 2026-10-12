'use strict';
/**
 * src/ui/drag-scroll.js: phone-style mouse scrolling (user's request 2026-10-12: no scrollbars, the content is
 * dragged like on a phone). The pure parts and the wiring here; the gesture itself in tests/e2e/drag-scroll.e2e.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrollAxes, flickVelocity, inertiaStep, FRICTION, MIN_VELOCITY, DRAG_THRESHOLD, OWN_GESTURE_SELECTOR } from '../src/ui/drag-scroll.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(join(root, rel), 'utf8');

test('scrollAxes: only overflow auto/scroll with content past the box scrolls', () => {
  const m = { overflowX: 'hidden', overflowY: 'auto', scrollWidth: 720, clientWidth: 720, scrollHeight: 2000, clientHeight: 1000 };
  assert.deepEqual(scrollAxes(m), { x: false, y: true });
  assert.deepEqual(scrollAxes({ ...m, scrollHeight: 1000 }), { x: false, y: false }, 'nothing to scroll');
  assert.deepEqual(scrollAxes({ ...m, overflowY: 'hidden' }), { x: false, y: false }, 'overflow hidden never scrolls');
  assert.deepEqual(scrollAxes({ ...m, overflowY: 'clip' }), { x: false, y: false }, 'overflow clip never scrolls (Cards screen)');
  assert.deepEqual(scrollAxes({ overflowX: 'auto', overflowY: 'auto', scrollWidth: 3000, clientWidth: 720, scrollHeight: 3000, clientHeight: 1000 }), { x: true, y: true }, 'the world map');
  assert.deepEqual(scrollAxes({ overflowX: 'scroll', overflowY: 'hidden', scrollWidth: 1500, clientWidth: 720, scrollHeight: 180, clientHeight: 180 }), { x: true, y: false }, 'the pre-battle drawer');
});

test('flickVelocity: the move inside the last 100 ms, px per ms; nothing from a held pointer', () => {
  assert.deepEqual(flickVelocity([]), { vx: 0, vy: 0 });
  assert.deepEqual(flickVelocity([{ t: 0, x: 0, y: 0 }]), { vx: 0, vy: 0 });
  const v = flickVelocity([{ t: 0, x: 0, y: 500 }, { t: 50, x: 0, y: 450 }, { t: 100, x: 0, y: 400 }]);
  assert.equal(v.vx, 0);
  assert.equal(v.vy, -1, 'one px per ms upwards');
  // samples older than the window are ignored: a slow start then a fast flick measures the flick
  const flick = flickVelocity([{ t: 0, x: 0, y: 0 }, { t: 500, x: 0, y: 10 }, { t: 550, x: 0, y: 60 }, { t: 600, x: 0, y: 110 }]);
  assert.equal(flick.vy, 1);
  // a pointer that stopped before release: the last samples do not move
  const held = flickVelocity([{ t: 0, x: 0, y: 0 }, { t: 100, x: 0, y: 100 }, { t: 200, x: 0, y: 100 }, { t: 300, x: 0, y: 100 }]);
  assert.equal(held.vy, 0);
});

test('inertiaStep: x0.95 per 16 ms frame (the client slider rule), a flick travels 320 v px in all', () => {
  assert.equal(FRICTION, 0.95);
  const one = inertiaStep(1, 16);
  assert.ok(Math.abs(one.v - 0.95) < 1e-9);
  assert.ok(Math.abs(one.dist - 16) < 1e-9, 'the first frame covers v x 16 px');
  let v = 2, total = 0, n = 0;
  while (Math.abs(v) >= MIN_VELOCITY && n < 10000) { const s = inertiaStep(v, 16); total += s.dist; v = s.v; n++; }
  assert.ok(Math.abs(total - 320 * 2) < 320 * 2 * 0.02, `total ${total.toFixed(1)} px for a 2 px/ms flick`);
  assert.ok(n > 60 && n < 120, `${n} frames, about 1.5 s`);
  // a frame twice as long covers the same distance as two frames
  const a = inertiaStep(1, 32);
  const b1 = inertiaStep(1, 16);
  const b2 = inertiaStep(b1.v, 16);
  assert.ok(Math.abs(a.dist - (b1.dist + b2.dist)) < 1e-9);
  assert.ok(Math.abs(a.v - b2.v) < 1e-9);
});

test('wiring: installed on the stage, scrollbars hidden on the stage, the drawer swipes sideways, the slider keeps its own gesture', () => {
  assert.ok(DRAG_THRESHOLD >= 4 && DRAG_THRESHOLD <= 10);
  assert.match(read('src/app.js'), /installDragScroll\(stage\.el, \{ getScale: stage\.getScale \}\)/);
  const css = read('css/main.css');
  assert.match(css, /#stage \* \{ scrollbar-width: none; \}/);
  assert.match(css, /#stage \*::-webkit-scrollbar \{ display: none;/);
  assert.match(css, /\.drag-scrolling[^{]*\{[^}]*cursor: grabbing/);
  assert.ok(OWN_GESTURE_SELECTOR.includes('.card-slider'), 'the Cards carousel has its own swipe');
  // the pre-battle drawer: a sideways move on a drawer card scrolls the drawer, an upward move picks the card up
  assert.match(read('src/ui/screens/prebattle.js'), /shouldStart: \(info, dx, dy\) => info\.from !== null \|\| !isSwipe\(dx, dy\)/);
});
