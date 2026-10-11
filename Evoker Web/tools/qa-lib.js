'use strict';
/**
 * Shared harness of the browser scripts (tools/smoke.js, tools/qa-*.js; architecture §8.6).
 *
 *   const qa = createQa({ title: 'Evoker QA: x', banner: 'QA X', defaultOut: screenshotDir('qa-x') });
 *   const { step, shot } = qa;
 *   const app = bindApp(qa);                     // window.evoker / DOM / pointer helpers bound to qa.browser
 *   qa.run(async (browser, base) => { ... await step('name', async () => { ...; await shot('name'); }); });
 *
 * `run` parses nothing itself (createQa reads the command line: --base, --out, --headed, --slow, --verbose),
 * deletes the old PNGs of the output folder, serves the project in-process (tools/serve.js on a free port) unless
 * --base is given, launches Edge/Chrome through tools/cdp.js (always with an absolute temporary profile), runs the
 * scenario, prints the step table plus the page's console errors and exits 1 when a step failed or the page logged
 * an error. Every step is tolerant: a failure is recorded with a FAIL screenshot and the run continues.
 */
import { mkdir, readdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, findBrowser, sleep } from './cdp.js';
import { server as devServer } from './serve.js';

export { sleep };

/** Project root. */
export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Default screenshot folder of a script: tests/screenshots[/sub]. */
export const screenshotDir = (sub = '') => join(ROOT, 'tests', 'screenshots', sub);

/* ------------------------------------------------------------------ small utilities */

/** @param {string} s */
export function log(s) { process.stdout.write(s + '\n'); }
/** @param {number} n */
export const pad = (n) => String(n).padStart(2, '0');
/** @param {string} s */
export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** @param {any} cond @param {string} msg */
export function assert(cond, msg) { if (!cond) throw new Error(msg); }
/** Strict equality with a readable message. */
export function eq(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/**
 * Command-line options shared by every script.
 * @param {string} defaultOut  screenshot folder when --out is not given
 * @param {string[]} [argv]
 * @returns {{base: string|null, out: string, headed: boolean, slow: number, verbose: boolean}}
 */
export function parseArgs(defaultOut, argv = process.argv.slice(2)) {
  const arg = (name, def) => {
    const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (!hit) return def;
    const i = hit.indexOf('=');
    return i === -1 ? true : hit.slice(i + 1);
  };
  return {
    base: arg('base', null),
    out: resolve(String(arg('out', defaultOut))),
    headed: Boolean(arg('headed', false)),
    slow: Number(arg('slow', 0)) || 0,
    verbose: Boolean(arg('verbose', false)),
  };
}

/**
 * Serve the project root in this process (tools/serve.js's server on a free port of 127.0.0.1).
 * @returns {Promise<{base: string, kill: () => void}>}
 */
export async function startServer() {
  await new Promise((ok, fail) => {
    devServer.once('error', fail);
    devServer.listen(0, '127.0.0.1', () => { devServer.off('error', fail); ok(); });
  });
  const { port } = /** @type {import('node:net').AddressInfo} */ (devServer.address());
  return {
    base: `http://127.0.0.1:${port}/`,
    kill: () => { try { devServer.closeAllConnections(); devServer.close(); } catch { /* ignore */ } },
  };
}

/* ------------------------------------------------------------------ the run */

/**
 * @typedef {object} QaOptions
 * @property {string} title              first line of the header ("Evoker QA: core loop")
 * @property {string} banner             final line prefix ("QA CORE LOOP" -> "QA CORE LOOP PASSED")
 * @property {string} defaultOut         screenshot folder when --out is not given
 * @property {number} [stepTimeoutMs]    default timeout of a step (60 s)
 * @property {boolean} [dedupeFailShots] one FAIL screenshot per distinct page state (screen id + body children)
 * @property {() => Promise<void>} [onFail] runs after a failed step (e.g. get back to a sane screen)
 */

/**
 * Create a run: options, step / shot bookkeeping and the main entry point.
 * @param {QaOptions} o
 */
export function createQa(o) {
  const OPTS = parseArgs(o.defaultOut);
  const stepTimeoutMs = o.stepTimeoutMs || 60000;
  /** @type {{name: string, status: 'PASS'|'FAIL', ms: number, note: string}[]} */
  const results = [];
  let shotIndex = 0;
  let lastFailKey = null;

  const qa = {
    OPTS,
    results,
    /** @type {import('./cdp.js').Browser|null} */
    browser: null,
    step,
    shot,
    run,
  };

  /** Save a numbered screenshot `<nn>-<slug>.png`. @param {string} name */
  async function shot(name) {
    const path = join(OPTS.out, `${pad(++shotIndex)}-${slug(name)}.png`);
    await qa.browser.screenshot(path);
    return path;
  }

  async function failShot(name) {
    const browser = qa.browser;
    if (!browser) return;
    try {
      if (o.dedupeFailShots) {
        const key = await browser.evaluate(() => `${(window.evoker && window.evoker.router && window.evoker.router.current() || {}).id || ''}|${document.body ? document.body.children.length : 0}`).catch(() => 'n/a');
        if (key === lastFailKey) return;
        lastFailKey = key;
      }
      await browser.screenshot(join(OPTS.out, `${pad(++shotIndex)}-FAIL-${slug(name)}.png`));
    } catch { /* ignore */ }
  }

  /**
   * Run one step; failures are recorded (with a screenshot) and never abort the run.
   * @param {string} name
   * @param {() => Promise<string|void>} fn  may return a note
   * @param {{timeoutMs?: number}} [so]
   */
  async function step(name, fn, so = {}) {
    const started = Date.now();
    const timeoutMs = so.timeoutMs || stepTimeoutMs;
    let timer;
    try {
      const note = await Promise.race([
        fn(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`step timed out after ${timeoutMs} ms`)), timeoutMs); }),
      ]);
      results.push({ name, status: 'PASS', ms: Date.now() - started, note: note ? String(note) : '' });
      log(`  PASS  ${name}${note ? `  (${note})` : ''}`);
    } catch (err) {
      const message = (err && err.message) || String(err);
      results.push({ name, status: 'FAIL', ms: Date.now() - started, note: message.split('\n')[0].slice(0, 200) });
      log(`  FAIL  ${name}: ${message.split('\n')[0]}`);
      if (OPTS.verbose && err && err.stack) log(err.stack);
      await failShot(name);
      if (o.onFail) { try { await o.onFail(); } catch { /* ignore */ } }
    } finally {
      clearTimeout(timer);
    }
    if (OPTS.slow) await sleep(OPTS.slow);
  }

  /** Print the step table and the console errors; returns the exit code. */
  function report() {
    const browser = qa.browser;
    const errors = browser ? browser.errors() : [];
    const warnings = browser ? browser.console().filter((m) => m.level === 'warning') : [];
    const failed = results.filter((r) => r.status === 'FAIL');
    const width = Math.max(10, ...results.map((r) => r.name.length));
    log('\nStep'.padEnd(width + 3) + 'Status  Time     Note');
    log('-'.repeat(width + 2) + '  ------  -------  ' + '-'.repeat(40));
    for (const r of results) log(`${r.name.padEnd(width + 2)}  ${r.status.padEnd(6)}  ${String(r.ms + ' ms').padStart(7)}  ${r.note}`);
    log('');
    log(`${results.length - failed.length}/${results.length} steps passed, ${shotIndex} screenshots in ${OPTS.out}`);
    if (warnings.length) log(`${warnings.length} console warning(s)` + (OPTS.verbose ? ':\n  ' + warnings.map((m) => m.text).join('\n  ') : ' (run with --verbose to list them)'));
    if (errors.length) {
      log(`${errors.length} console error(s) / exception(s):`);
      for (const m of errors.slice(0, 30)) log(`  [${m.kind}] ${m.text}${m.url ? `  (${m.url}${m.line ? ':' + m.line : ''})` : ''}`);
      if (errors.length > 30) log(`  ... and ${errors.length - 30} more`);
    } else log('No console errors.');
    const code = failed.length || errors.length ? 1 : 0;
    log(`\n${o.banner} ${code ? 'FAILED' : 'PASSED'}`);
    return code;
  }

  /**
   * Main entry point: serve, launch, run the scenario, report, exit.
   * @param {(browser: import('./cdp.js').Browser, base: string) => Promise<void>} scenario
   */
  async function run(scenario) {
    const executable = findBrowser();
    if (!executable) {
      log('No Edge/Chrome found. Set EVOKER_BROWSER to the executable path.');
      process.exit(2);
    }
    await mkdir(OPTS.out, { recursive: true });
    for (const f of await readdir(OPTS.out)) if (f.endsWith('.png')) await unlink(join(OPTS.out, f));

    let server = null;
    let base = OPTS.base;
    let code = 1;
    try {
      if (!base) { server = await startServer(); base = server.base; }
      log(`${o.title}\n  server   ${base}\n  browser  ${executable}\n  output   ${OPTS.out}\n`);
      qa.browser = await launch({ headless: !OPTS.headed });
      await scenario(qa.browser, base);
    } catch (err) {
      results.push({ name: 'harness', status: 'FAIL', ms: 0, note: (err && err.message) || String(err) });
      log(`  FAIL  harness: ${(err && err.stack) || err}`);
    } finally {
      code = report();
      if (qa.browser) { try { await qa.browser.close(); } catch { /* ignore */ } }
      if (server) server.kill();
    }
    process.exit(code);
  }

  return qa;
}

/* ------------------------------------------------------------------ page functions (run inside the browser) */

/** Current screen id from the router (or the DOM before the router exists). */
export function pageScreenId() {
  const ev = window.evoker;
  const cur = ev && ev.router && ev.router.current && ev.router.current();
  if (cur && cur.id) return cur.id;
  const screens = document.querySelectorAll('.screen[data-screen]');
  return screens.length ? screens[screens.length - 1].dataset.screen : null;
}

/** Whether the router is between screens. */
export function pageBusy() {
  const ev = window.evoker;
  return Boolean(ev && ev.router && ev.router.busy);
}

/** Whether `sel` exists and has a size. */
function pageVisible(sel) {
  const el = document.querySelector(sel);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/**
 * Mark an element whose text matches `pattern` (regex source, case-insensitive) with data-qa="1".
 * Default: the deepest visible match, lifted to its clickable ancestor (buttons and tappable plates preferred).
 * buttonsOnly: the first visible, enabled button / [role=button] / .btn.
 */
function pageMarkByText(pattern, within, buttonsOnly) {
  for (const old of document.querySelectorAll('[data-qa]')) old.removeAttribute('data-qa');
  const re = new RegExp(pattern, 'i');
  const scope = within ? document.querySelector(within) : document;
  if (!scope) return false;
  if (buttonsOnly) {
    const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const hit = Array.from(scope.querySelectorAll('button, [role="button"], .btn')).find((el) => re.test((el.textContent || '').trim()) && shown(el) && !el.disabled);
    if (!hit) return false;
    hit.setAttribute('data-qa', '1');
    return true;
  }
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && st.pointerEvents !== 'none' && Number(st.opacity) !== 0;
  };
  const all = Array.from(scope.querySelectorAll('button, [role="button"], a, .btn, .plate, .tap, .tap-continue, .attack-bar, div, span, p'));
  const matches = all.filter((el) => re.test((el.textContent || '').trim()) && visible(el));
  if (!matches.length) return false;
  // deepest match wins (closest to the text), but prefer a clickable ancestor when the match is plain text
  let best = matches[matches.length - 1];
  for (const m of matches) if (m.contains(best) && m !== best && m.matches('button, [role="button"], .btn')) best = m;
  const clickable = best.closest('button, [role="button"], .btn') || best;
  clickable.setAttribute('data-qa', '1');
  return true;
}

/**
 * Mark what is in the way with data-qa="1": a dialog (its last enabled button; the level-up dialog is one), optionally
 * the post-battle overlay (`results`) and generic popups / "Tap to continue" plates (`generic`).
 * @returns {string|null} the kind marked
 */
function pageFindOverlay(results, generic) {
  for (const old of document.querySelectorAll('[data-qa]')) old.removeAttribute('data-qa');
  const dlg = document.querySelector('.dialog-backdrop:not(.closing)');
  if (dlg) {
    const btn = Array.from(dlg.querySelectorAll('.dialog-buttons .btn:not([disabled])')).pop() || dlg.querySelector('.dialog-close');
    if (btn) { btn.setAttribute('data-qa', '1'); return 'dialog'; }
  }
  if (results) {
    const res = document.querySelector('.battle-result');
    if (res) { res.setAttribute('data-qa', '1'); return 'result'; }
  }
  if (generic) {
    const re = /tap to continue|continue|ok|close|collect|claim/i;
    const candidates = Array.from(document.querySelectorAll('.popup, .result, .battle-result, .overlay, .modal, [class*="popup"], [class*="result"], [class*="overlay"]'));
    for (const c of candidates) {
      const r = c.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const btn = Array.from(c.querySelectorAll('button, .btn, [role="button"], .tap, [class*="tap"]')).find((b) => re.test(b.textContent || ''));
      const target = btn || (re.test(c.textContent || '') ? c : null);
      if (target) { target.setAttribute('data-qa', '1'); return 'popup'; }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ driver helpers */

/**
 * Helpers bound to `qa.browser` (read at call time, so they can be created before the browser exists): the debug
 * API, DOM queries, taps, dialogs, toasts, pointer drags and the quest / battle flows the scripts share.
 * @param {{browser: import('./cdp.js').Browser|null}} qa
 * @param {{goSettleMs?: number, goClosesDialogs?: boolean, overlays?: {results?: boolean, generic?: boolean}}} [opts]
 *   goSettleMs: pause after `go` (default 400); goClosesDialogs: close stray dialogs before `go`;
 *   overlays: what `dismissOverlays` also dismisses besides dialogs (the level-up dialog included).
 */
export function bindApp(qa, opts = {}) {
  const goSettleMs = opts.goSettleMs ?? 400;
  const overlays = opts.overlays || {};
  /** @returns {import('./cdp.js').Browser} */
  const b = () => qa.browser;

  /* --- window.evoker --- */
  const screenId = () => b().evaluate(pageScreenId);
  const waitIdle = (timeoutMs = 8000) => b().waitFor(`!(${pageBusy})()`, timeoutMs);

  /** Wait until the router shows `id` and has finished its transition. */
  async function waitScreen(id, timeoutMs = 10000) {
    try {
      await b().waitFor(`(${pageScreenId})() === ${JSON.stringify(id)} && !(${pageBusy})()`, timeoutMs);
    } catch (err) {
      const current = await screenId().catch(() => '?');
      const hasEvoker = await b().evaluate(() => Boolean(window.evoker)).catch(() => false);
      throw new Error(`screen "${id}" not reached within ${timeoutMs} ms (current: ${current}${hasEvoker ? '' : ', window.evoker missing - app did not boot'})`);
    }
    await sleep(150);
  }

  /** Navigate through the debug API ('go' pushes, 'goTop' jumps to a nav screen) and wait for the screen. */
  async function go(how, id, params) {
    await waitIdle();
    if (opts.goClosesDialogs) await b().evaluate(() => { try { window.evoker.ui.dialog.closeAll(); } catch (e) { /* ignore */ } });
    await b().evaluate((h, i, p) => {
      const ev = window.evoker;
      if (!ev) throw new Error('window.evoker is missing');
      return h === 'goTop' ? ev.goTop(i, p || {}) : ev.go(i, p || {});
    }, how, id, params || null);
    await waitScreen(id, 10000);
    await sleep(goSettleMs);
  }

  /** Re-render the current screen (after a store change made through the debug API). */
  async function rerender() {
    await b().evaluate(() => window.evoker.router.rerender());
    await waitIdle();
    await sleep(350);
  }

  /** Router back (the HUD arrow's handler); waits for screen `id` when given. */
  async function back(id) {
    await b().evaluate(() => window.evoker.router.back());
    if (id) await waitScreen(id);
  }

  /** @returns {Promise<any>} the save (null without one) */
  const getState = () => b().evaluate(() => (window.evoker && window.evoker.state ? window.evoker.state() : null));
  /** Replace top-level fields of the save through the store (set-up only). */
  const patchState = (patch) => b().evaluate((p) => { window.evoker.store.update((s) => ({ ...s, ...p })); return true; }, patch);
  /** Replace fields of state.player through the store (set-up only). */
  const patchPlayer = (patch) => b().evaluate((p) => { window.evoker.store.update((s) => ({ ...s, player: { ...s.player, ...p } })); return true; }, patch);
  /** Apply a state change through the store; `fnSource` runs in the page as (state, deps, now, ...args). */
  const updateState = (fnSource, ...args) => b().evaluate((src, a) => {
    const fn = (0, eval)(`(${src})`);
    return window.evoker.store.update((s, d, n) => fn(s, d, n, ...a));
  }, fnSource, args);
  /** Call a window.evoker.debug helper. */
  const debugCall = (name, ...args) => b().evaluate((n, a) => {
    const d = window.evoker && window.evoker.debug;
    if (!d || typeof d[n] !== 'function') throw new Error(`window.evoker.debug.${n} is missing`);
    return d[n](...a);
  }, name, args);

  /** Load `base` with an empty localStorage and wait for the app to boot. */
  async function bootFresh(base) {
    await b().navigate(base);
    await b().evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* ignore */ } });
    await b().navigate(base);
    await b().waitFor('document.body && document.body.dataset.ready === "1"', 20000);
  }

  /**
   * Add the cards (null = empty slot) and put them in the deck (slots in order); mana is raised so any deck can
   * attack (set-up only).
   * @returns {Promise<(string|null)[]>} the uids
   */
  function setDeck(ids, stage = 4, level = 54) {
    return b().evaluate(async (deck, st, lv) => {
      const col = await import('/src/game/collection.js');
      const state = await import('/src/game/state.js');
      const uids = deck.map((id) => (id ? window.evoker.debug.addCard(id, st, lv) : null));
      window.evoker.store.update((s, d) => col.setDeck(state.updatePlayer(s, { manaMax: Math.max(s.player.manaMax, 500), mana: 500 }), d, uids).state);
      return uids;
    }, ids, stage, level);
  }

  /* --- quest and battle flows --- */
  /**
   * Tap a live minion of the quest landscape that has finished walking in (a new wave slides in over 700 ms; a
   * click computed during the slide misses it).
   * @returns {Promise<boolean>} false without a minion
   */
  async function hitMinion() {
    await b().waitFor(`(() => {
      for (const old of document.querySelectorAll('[data-qa-minion]')) old.removeAttribute('data-qa-minion');
      const el = Array.from(document.querySelectorAll('button.quest-minion:not(.slain)'))
        .find((m) => !m.classList.contains('enter') && getComputedStyle(m).transform === 'none');
      if (!el) return false;
      el.setAttribute('data-qa-minion', '1');
      return true;
    })()`, 6000);
    return b().tap('[data-qa-minion="1"]');
  }

  /** Tap the first live minion and wait until the quest progressed (or a dialog opened). */
  async function tapMinionOnce() {
    const before = await getState();
    const done = before.quests.active ? before.quests.active.figuresDone : -1;
    assert(await hitMinion(), 'no minion in the landscape');
    await b().waitFor(`(() => { const a = window.evoker.state().quests.active; return (a && a.figuresDone !== ${done}) || document.querySelector('.dialog-backdrop:not(.closing)') ? 1 : 0; })()`, 6000);
    await sleep(450);
  }

  /** Tap through the active quest until the boss intro opens (refills stamina, closes dialogs). */
  async function tapToBoss(maxTaps = 40) {
    for (let i = 0; i < maxTaps; i++) {
      await dismissOverlays(3);
      const s = await getState();
      if (!s.quests.active || s.quests.active.bossReady) break;
      if (s.player.stamina < 10) await debugCall('refill');
      await tapMinionOnce();
    }
    await dismissOverlays(3);
    const s = await getState();
    assert(s.quests.active && s.quests.active.bossReady, 'boss not ready');
    await waitScreen('boss-intro', 8000);
  }

  /** Wait for the post-battle result popup; resolves with its kind (victory / defeat / draw). */
  async function resultKind(timeoutMs = 10000) {
    await b().waitFor('document.querySelector(".battle-result[data-result]")', timeoutMs);
    return b().evaluate(() => document.querySelector('.battle-result').dataset.result);
  }

  /**
   * Leave the post-battle result popup: tap through loot / full-size card / card level-ups (a tap on
   * `.battle-result` only skips the current step), then press Continue / Proceed.
   * @returns {Promise<string[]>} what was tapped
   */
  async function finishResult(timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs;
    const seen = [];
    while (Date.now() < deadline) {
      const kind = await b().evaluate(() => {
        for (const old of document.querySelectorAll('[data-qa]')) old.removeAttribute('data-qa');
        const res = document.querySelector('.battle-result');
        if (!res) return 'gone';
        const mark = (el, k) => { el.setAttribute('data-qa', '1'); return k; };
        const clu = res.querySelector('.card-levelup:not(.closing)');
        if (clu) return mark(clu, 'card-levelup');
        const btn = res.querySelector('.result-stripe.shown .result-continue:not([disabled])');
        if (btn) return mark(btn, 'continue');
        const full = res.querySelector('.result-fullcard:not(.closing)');
        if (full) return mark(full, 'fullcard');
        return mark(res, 'skip');
      });
      if (kind === 'gone') return seen;
      await b().tap('[data-qa="1"]');
      seen.push(kind);
      if (kind === 'continue') return seen;
      await sleep(500);
    }
    throw new Error(`result popup did not reach Continue (${seen.join(',')})`);
  }

  /* --- DOM --- */
  const text = (sel) => b().evaluate((s) => { const el = document.querySelector(s); return el ? (el.textContent || '').trim() : null; }, sel);
  const texts = (sel) => b().evaluate((s) => Array.from(document.querySelectorAll(s)).map((e) => (e.textContent || '').trim()), sel);
  const count = (sel) => b().evaluate((s) => document.querySelectorAll(s).length, sel);
  const exists = (sel) => b().evaluate((s) => Boolean(document.querySelector(s)), sel);
  /** Wait until a selector exists and has a size. */
  const waitSel = (sel, timeoutMs = 8000) => b().waitFor(`(${pageVisible})(${JSON.stringify(sel)})`, timeoutMs);
  const waitGone = (sel, timeoutMs = 8000) => b().waitFor(`!document.querySelector(${JSON.stringify(sel)})`, timeoutMs);

  /**
   * Tap an element whose text matches `pattern` with a real mouse click (see pageMarkByText).
   * @param {string} pattern regex source
   * @param {string} [within] container selector
   * @param {{buttonsOnly?: boolean}} [o]
   * @returns {Promise<boolean>}
   */
  async function tapText(pattern, within, o = {}) {
    const found = await b().evaluate(pageMarkByText, pattern, within || null, Boolean(o.buttonsOnly));
    if (!found) return false;
    await b().tap('[data-qa="1"]');
    await b().evaluate(() => { for (const el of document.querySelectorAll('[data-qa]')) el.removeAttribute('data-qa'); });
    return true;
  }
  /** Tap the first element matching any of the selectors; returns the selector that matched. */
  async function tapAny(selectors) {
    for (const sel of selectors) if (await b().tap(sel)) return sel;
    return null;
  }
  async function mustTap(selector) {
    if (!(await b().tap(selector))) throw new Error(`no element matches ${selector}`);
    await sleep(250);
  }
  async function mustTapText(pattern, within) {
    if (!(await tapText(pattern, within))) throw new Error(`no visible element with text /${pattern}/${within ? ` inside ${within}` : ''}`);
    await sleep(250);
  }

  /* --- dialogs, popups, toasts --- */
  const dialogOpen = () => exists('.dialog-backdrop:not(.closing)');
  async function waitDialog(timeoutMs = 5000) {
    await b().waitFor(() => Boolean(document.querySelector('.dialog-backdrop:not(.closing) .dialog')), timeoutMs);
    await sleep(250);
  }
  async function waitNoDialog(timeoutMs = 5000) {
    await b().waitFor(() => !document.querySelector('.dialog-backdrop:not(.closing)'), timeoutMs);
    await sleep(250);
  }
  /** Tap the button of the top dialog whose label matches the pattern. */
  async function tapDialogButton(pattern) {
    const ok = await b().evaluate((p) => {
      const re = new RegExp(p, 'i');
      const dlg = Array.from(document.querySelectorAll('.dialog-backdrop:not(.closing)')).pop();
      if (!dlg) return false;
      const btn = Array.from(dlg.querySelectorAll('.btn')).find((x) => re.test(x.textContent || ''));
      if (!btn) return false;
      for (const old of document.querySelectorAll('[data-qa]')) old.removeAttribute('data-qa');
      btn.setAttribute('data-qa', '1');
      return true;
    }, pattern);
    if (!ok) return false;
    await b().tap('[data-qa="1"]');
    return true;
  }
  /** Close the top dialog with its X. */
  async function closeDialog() {
    if (await b().tap('.dialog-backdrop:not(.closing) .dialog-close')) { await waitGone('.dialog-backdrop:not(.closing)'); return true; }
    return false;
  }
  /**
   * Dismiss whatever popup is in the way (dialogs with their last button: unlock popups after setLevel, notices,
   * the level-up dialog...) until nothing is left (max `rounds`); returns what was dismissed.
   */
  async function dismissOverlays(rounds = 6) {
    const dismissed = [];
    for (let i = 0; i < rounds; i++) {
      const kind = await b().evaluate(pageFindOverlay, Boolean(overlays.results), Boolean(overlays.generic));
      if (!kind) break;
      await b().tap('[data-qa="1"]');
      dismissed.push(kind);
      await sleep(400);
    }
    return dismissed;
  }
  /** Toasts on screen now. */
  const visibleToasts = () => b().evaluate(() => Array.from(document.querySelectorAll('.toast:not(.leaving)')).map((t) => t.textContent.trim()));
  /**
   * Record every toast the page shows (toasts last ~2.2 s; a recorder makes the checks independent of timing).
   * Install once after boot; a reload drops it.
   */
  async function recordToasts() {
    await b().evaluate(() => {
      if (window.__qaToastObs) return;
      window.__qaToasts = [];
      const obs = new MutationObserver((muts) => {
        for (const m of muts) {
          for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            const list = n.matches('.toast') ? [n] : Array.from(n.querySelectorAll('.toast'));
            for (const t of list) window.__qaToasts.push((t.textContent || '').trim());
          }
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      window.__qaToastObs = obs;
    });
  }
  const toastMark = () => b().evaluate(() => (window.__qaToasts || []).length);
  const toastsSince = (mark) => b().evaluate((m) => (window.__qaToasts || []).slice(m), mark);

  /* --- pointer --- */
  /**
   * Client-space centre of an element.
   * @param {string} sel
   * @param {{scroll?: boolean, round?: boolean}} [o]  scroll: scrollIntoView first; round: whole pixels
   */
  async function centerOf(sel, o = {}) {
    const pt = await b().evaluate((s, scroll) => {
      const el = document.querySelector(s);
      if (!el) return null;
      if (scroll) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, sel, Boolean(o.scroll));
    if (!pt) throw new Error(`no element matches ${sel}`);
    return o.round ? { x: Math.round(pt.x), y: Math.round(pt.y) } : pt;
  }

  /**
   * Real mouse drag (pointer events fire for drag-drop.js): press on `from`, move in `steps`, wait `holdMs`,
   * run `beforeRelease`, release on `to`, wait `settleMs`. `from` / `to` are selectors (centre, no scrolling)
   * or client points.
   * @param {string|{x: number, y: number}} from
   * @param {string|{x: number, y: number}} to
   * @param {{steps?: number, round?: boolean, holdMs?: number, settleMs?: number, beforeRelease?: () => Promise<void>}} [o]
   */
  async function drag(from, to, o = {}) {
    const { steps = 12, holdMs = 60, settleMs = 350 } = o;
    const a = typeof from === 'string' ? await centerOf(from) : from;
    const z = typeof to === 'string' ? await centerOf(to) : to;
    const px = o.round ? Math.round : (v) => v;
    const mouse = (type, x, y, extra) => b().send('Input.dispatchMouseEvent', { type, x: px(x), y: px(y), button: 'left', ...extra });
    await mouse('mouseMoved', a.x, a.y, { button: 'none' });
    await mouse('mousePressed', a.x, a.y, { clickCount: 1 });
    for (let i = 1; i <= steps; i++) {
      await mouse('mouseMoved', a.x + (z.x - a.x) * (i / steps), a.y + (z.y - a.y) * (i / steps), { buttons: 1 });
      await sleep(16);
    }
    if (holdMs) await sleep(holdMs);
    if (o.beforeRelease) await o.beforeRelease();
    await mouse('mouseReleased', z.x, z.y, { clickCount: 1 });
    if (settleMs) await sleep(settleMs);
  }

  return {
    screenId, waitIdle, waitScreen, go, rerender, back, getState, patchState, patchPlayer, updateState, debugCall, bootFresh, setDeck,
    text, texts, count, exists, waitSel, waitGone, tapText, tapAny, mustTap, mustTapText,
    dialogOpen, waitDialog, waitNoDialog, tapDialogButton, closeDialog, dismissOverlays,
    visibleToasts, recordToasts, toastMark, toastsSince, centerOf, drag,
    hitMinion, tapMinionOnce, tapToBoss, resultKind, finishResult,
  };
}
