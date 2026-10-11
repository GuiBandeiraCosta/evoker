'use strict';
/**
 * Tests for the zero-dependency CDP driver (tools/cdp.js) and the shared QA harness (tools/qa-lib.js). The
 * launch tests are skipped when no Edge/Chrome is installed so the suite stays green on machines without a browser.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findBrowser, freePort, launch, BROWSER_CANDIDATES } from '../tools/cdp.js';
import { parseArgs, pad, slug, startServer, bindApp, ROOT } from '../tools/qa-lib.js';

const browserPath = findBrowser();
const skipReason = browserPath ? false : 'no Edge/Chrome installed (set EVOKER_BROWSER)';

test('findBrowser returns an existing executable path (Edge, then Chrome, or EVOKER_BROWSER)', (t) => {
  if (!browserPath) {
    t.skip(skipReason);
    return;
  }
  assert.equal(typeof browserPath, 'string');
  assert.ok(existsSync(browserPath), `exists: ${browserPath}`);
  assert.ok(process.env.EVOKER_BROWSER === browserPath || BROWSER_CANDIDATES.includes(browserPath));
  const edge = BROWSER_CANDIDATES.find((p) => /msedge/i.test(p) && existsSync(p));
  if (edge && !process.env.EVOKER_BROWSER) assert.match(browserPath, /msedge/i, 'Edge is preferred over Chrome');
});

test('freePort hands out a usable port number', async () => {
  const port = await freePort();
  assert.ok(Number.isInteger(port) && port > 0 && port < 65536);
});

test('launch + navigate(data:) + evaluate + click + screenshot + close', { skip: skipReason }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'evoker-cdp-test-'));
  const browser = await launch({ width: 720, height: 1280 });
  try {
    assert.equal(browser.executable, browserPath);
    const html = '<!doctype html><title>cdp test</title><body style="margin:0"><div id="stage" style="width:720px;height:1280px">'
      + '<button id="b" style="position:absolute;left:100px;top:200px;width:120px;height:60px" onclick="window.clicked=(window.clicked||0)+1">Go</button></div>';
    await browser.navigate('data:text/html,' + encodeURIComponent(html));
    assert.equal(await browser.evaluate('1 + 1'), 2);
    assert.equal(await browser.evaluate(() => document.title), 'cdp test');
    assert.equal(await browser.evaluate((a, b) => a + b, 2, 3), 5);
    assert.equal(await browser.evaluate('Promise.resolve("async")'), 'async');
    await assert.rejects(browser.evaluate('throw new Error("nope")'), /nope/);

    const size = await browser.evaluate(() => [innerWidth, innerHeight]);
    assert.deepEqual(size, [720, 1280]);

    await browser.click(160, 230);               // stage coordinates inside the button
    assert.equal(await browser.evaluate('window.clicked'), 1);
    assert.equal(await browser.tap('#b'), true);
    assert.equal(await browser.evaluate('window.clicked'), 2);
    assert.equal(await browser.tap('#does-not-exist'), false);

    const png = join(dir, 'shot.png');
    const written = await browser.screenshot(png);
    assert.ok(existsSync(written));
    const bytes = readFileSync(written);
    assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG');
    assert.ok(bytes.length > 1000);
  } finally {
    const profile = browser.profileDir;
    await browser.close();
    assert.ok(!existsSync(profile), 'temporary profile removed');
    rmSync(dir, { recursive: true, force: true });
  }
});

test('waitFor polls until truthy and times out otherwise', { skip: skipReason }, async () => {
  const browser = await launch();
  try {
    await browser.navigate('data:text/html,<title>w</title><p>x</p>');
    await browser.evaluate('setTimeout(() => { window.ready = "yes"; }, 150)');
    assert.equal(await browser.waitFor('window.ready', 3000), 'yes');
    await assert.rejects(browser.waitFor('window.never', 300, 50), /timed out/);
  } finally {
    await browser.close();
  }
});

test('console messages, uncaught exceptions and log entries are captured', { skip: skipReason }, async () => {
  const browser = await launch();
  try {
    await browser.navigate('data:text/html,<title>c</title><p>x</p>');
    browser.clearConsole();
    await browser.evaluate('console.log("hello", 42); console.warn("careful"); console.error("bad thing")');
    await browser.evaluate('setTimeout(() => { throw new Error("kaboom"); }, 0)');
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && !browser.console().some((m) => m.kind === 'exception')) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const msgs = browser.console();
    const texts = msgs.map((m) => m.text);
    assert.ok(texts.includes('hello 42'), `log captured: ${JSON.stringify(texts)}`);
    assert.ok(msgs.some((m) => m.level === 'warning' && m.text === 'careful'));
    assert.ok(msgs.some((m) => m.level === 'error' && m.kind === 'console' && m.text === 'bad thing'));
    assert.ok(msgs.some((m) => m.kind === 'exception' && /kaboom/.test(m.text)), `exception captured: ${JSON.stringify(texts)}`);
    const errors = browser.errors();
    assert.equal(errors.length, 2);
    browser.clearConsole();
    assert.equal(browser.console().length, 0);
  } finally {
    await browser.close();
  }
});

test('qa-lib: command-line options, pad, slug', () => {
  const def = join(ROOT, 'tests', 'screenshots', 'x');
  assert.deepEqual(parseArgs(def, []), { base: null, out: def, headed: false, slow: 0, verbose: false });
  const o = parseArgs(def, ['--base=http://h:1/', '--out=rel/dir', '--headed', '--slow=250', '--verbose']);
  assert.equal(o.base, 'http://h:1/');
  assert.ok(o.out.endsWith(join('rel', 'dir')) && o.out !== 'rel/dir', 'out is resolved to an absolute path');
  assert.equal(o.headed, true);
  assert.equal(o.slow, 250);
  assert.equal(o.verbose, true);
  assert.equal(pad(3), '03');
  assert.equal(pad(123), '123');
  assert.equal(slug('Battle result → back (Quest 3)!'), 'battle-result-back-quest-3');
});

test('qa-lib: startServer serves the project in-process on a free port', async () => {
  const server = await startServer();
  try {
    assert.match(server.base, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    const res = await fetch(server.base);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /<html/i);
  } finally {
    server.kill();
  }
});

test('qa-lib: drag presses, moves in steps and releases on the target centre', { skip: skipReason }, async () => {
  const browser = await launch({ width: 720, height: 1280 });
  try {
    const html = '<!doctype html><body style="margin:0">'
      + '<div id="a" style="position:absolute;left:100px;top:100px;width:100px;height:50px"></div>'
      + '<div id="b" style="position:absolute;left:401px;top:601px;width:100px;height:51px"></div>'
      + '<button id="ok" style="position:absolute;left:10px;top:900px;width:80px;height:40px" onclick="window.ok=1">Go on</button>'
      + '<script>window.ev=[];for(const t of ["pointerdown","pointermove","pointerup"])addEventListener(t,(e)=>ev.push([t,e.clientX,e.clientY]));</script>';
    await browser.navigate('data:text/html,' + encodeURIComponent(html));
    const app = bindApp({ browser });
    assert.deepEqual(await app.centerOf('#b'), { x: 451, y: 626.5 });
    assert.deepEqual(await app.centerOf('#b', { round: true }), { x: 451, y: 627 });
    await assert.rejects(app.centerOf('#none'), /no element matches #none/);
    await app.drag('#a', '#b', { settleMs: 0 });
    const ev = await browser.evaluate('window.ev');
    assert.deepEqual(ev.find((e) => e[0] === 'pointerdown'), ['pointerdown', 150, 125]);
    assert.deepEqual(ev[ev.length - 1].slice(1), [451, 626.5]);
    assert.equal(ev[ev.length - 1][0], 'pointerup');
    assert.equal(ev.filter((e) => e[0] === 'pointermove').length >= 12, true);
    assert.equal(await app.tapText('^go on$', null, { buttonsOnly: true }), true);
    assert.equal(await browser.evaluate('window.ok'), 1);
    assert.equal(await app.tapText('^nothing$'), false);
  } finally {
    await browser.close();
  }
});
