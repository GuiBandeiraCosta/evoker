'use strict';
/**
 * Zero-dependency Chrome DevTools Protocol driver (architecture §8.6).
 *
 * Launches the installed Edge or Chrome headless with `--remote-debugging-port`, connects to the page
 * target with Node 22's global WebSocket and exposes a tiny automation API:
 *
 *   const browser = await launch();
 *   await browser.navigate('http://127.0.0.1:8080/');
 *   const two = await browser.evaluate('1 + 1');
 *   await browser.waitFor('document.body.dataset.ready === "1"', 10000);
 *   await browser.click(360, 900);          // stage coordinates (720 x 1280 logical px)
 *   await browser.tap('.btn.attack-btn');   // centre of an element
 *   await browser.screenshot('tests/screenshots/01-title.png');
 *   console.log(browser.console());         // captured console messages, exceptions and log entries
 *   await browser.close();
 *
 * Only Node built-ins are used (child_process, net, fs, os, path, fetch, WebSocket). Works with
 * Windows paths containing spaces because the browser is spawned without a shell.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';

/** Default stage size (logical px) used to convert stage coordinates. */
export const STAGE_WIDTH = 720;
export const STAGE_HEIGHT = 1280;

/** Candidate browser locations, first match wins (after the EVOKER_BROWSER env variable). */
export const BROWSER_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ...(process.env.LOCALAPPDATA ? [
    join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    join(process.env.LOCALAPPDATA, 'Microsoft/Edge/Application/msedge.exe'),
  ] : []),
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

/**
 * Find an installed Chromium-based browser: `EVOKER_BROWSER` first, then Edge, then Chrome.
 * @returns {string|null} absolute path of the executable, or null when none is installed
 */
export function findBrowser() {
  const env = process.env.EVOKER_BROWSER;
  if (env && existsSync(env)) return env;
  for (const candidate of BROWSER_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Ask the OS for a free TCP port.
 * @returns {Promise<number>}
 */
export function freePort() {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = /** @type {import('node:net').AddressInfo} */ (srv.address());
      srv.close(() => resolvePort(address.port));
    });
  });
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll the DevTools HTTP endpoint until the browser answers.
 * @param {number} port
 * @param {number} timeoutMs
 * @param {() => boolean} [dead]  returns true when the process already exited
 */
async function waitForDevTools(port, timeoutMs, dead) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    if (dead && dead()) throw new Error('Browser process exited before DevTools came up');
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return await res.json();
    } catch (err) {
      lastErr = err;
    }
    await sleep(100);
  }
  throw new Error(`DevTools endpoint on port ${port} did not answer within ${timeoutMs} ms` + (lastErr ? `: ${lastErr.message}` : ''));
}

/**
 * Find (or create) a page target and return its WebSocket URL.
 * @param {number} port
 * @returns {Promise<{id: string, webSocketDebuggerUrl: string}>}
 */
async function findPageTarget(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  let page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) {
    // Chrome >= 94 wants PUT for /json/new.
    let res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
    if (!res.ok) res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`);
    page = await res.json();
  }
  if (!page || !page.webSocketDebuggerUrl) throw new Error('No page target found');
  return page;
}

/**
 * Remove a directory, retrying because Windows keeps browser profile files locked for a moment.
 * @param {string} dir
 */
async function removeDir(dir) {
  for (let i = 0; i < 8; i++) {
    try {
      await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
      return true;
    } catch {
      await sleep(250);
    }
  }
  return false;
}

/**
 * Describe a Runtime.RemoteObject / exception for messages.
 * @param {any} obj
 * @returns {string}
 */
function describeRemote(obj) {
  if (!obj) return '';
  if (obj.type === 'string') return obj.value;
  if (obj.value !== undefined) return typeof obj.value === 'object' ? JSON.stringify(obj.value) : String(obj.value);
  if (obj.unserializableValue !== undefined) return String(obj.unserializableValue);
  if (obj.description) return obj.description;
  return obj.type || '';
}

/**
 * @typedef {object} ConsoleMessage
 * @property {'console'|'exception'|'log'} kind   console API call, uncaught exception, or browser log entry (network, security…)
 * @property {string} level                      'log' | 'info' | 'warning' | 'error' | 'debug' | …
 * @property {string} text
 * @property {string} [url]
 * @property {number} [line]
 * @property {number} ts
 */

/**
 * @typedef {object} LaunchOptions
 * @property {boolean} [headless=true]
 * @property {number} [width=720]
 * @property {number} [height=1280]
 * @property {number} [port]           remote debugging port (default: a free port)
 * @property {string} [browser]        executable path (default: findBrowser())
 * @property {string[]} [args]         extra command line flags
 * @property {number} [timeoutMs=20000] time to wait for DevTools to answer
 * @property {number} [stageWidth=720] logical stage width used by click()
 * @property {number} [stageHeight=1280]
 * @property {string} [stageSelector='#stage']
 */

/**
 * @typedef {object} Browser
 * @property {number} port
 * @property {string} executable
 * @property {import('node:child_process').ChildProcess} process
 * @property {(method: string, params?: object) => Promise<any>} send
 * @property {(event: string, fn: (params: any) => void) => () => void} on
 * @property {(url: string, opts?: {timeoutMs?: number}) => Promise<void>} navigate
 * @property {(expression: string|Function, ...args: any[]) => Promise<any>} evaluate
 * @property {(expression: string|Function, timeoutMs?: number, intervalMs?: number) => Promise<any>} waitFor
 * @property {(x: number, y: number) => Promise<void>} click
 * @property {(x: number, y: number) => Promise<void>} clickClient
 * @property {(selector: string) => Promise<boolean>} tap
 * @property {(text: string) => Promise<void>} type
 * @property {(key: string) => Promise<void>} press
 * @property {(path: string, opts?: {fullPage?: boolean}) => Promise<string>} screenshot
 * @property {() => ConsoleMessage[]} console
 * @property {() => ConsoleMessage[]} errors
 * @property {() => void} clearConsole
 * @property {() => Promise<void>} close
 */

/**
 * Launch a headless browser and connect to its first page.
 * @param {LaunchOptions} [opts]
 * @returns {Promise<Browser>}
 */
export async function launch(opts = {}) {
  const headless = opts.headless !== false;
  const width = opts.width || STAGE_WIDTH;
  const height = opts.height || STAGE_HEIGHT;
  const port = opts.port || await freePort();
  const executable = opts.browser || findBrowser();
  if (!executable) throw new Error('No Chromium-based browser found (set EVOKER_BROWSER to the executable path)');
  const stageWidth = opts.stageWidth || STAGE_WIDTH;
  const stageHeight = opts.stageHeight || STAGE_HEIGHT;
  const stageSelector = opts.stageSelector || '#stage';

  const profileDir = await mkdtemp(join(tmpdir(), 'evoker-cdp-'));
  const args = [
    ...(headless ? ['--headless=new'] : []),
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-translate',
    '--mute-audio',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    `--window-size=${width},${height}`,
    ...(opts.args || []),
    'about:blank',
  ];
  const proc = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let exited = false;
  let stderr = '';
  proc.on('exit', () => { exited = true; });
  if (proc.stderr) proc.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-4000); });

  let ws = null;
  try {
    await waitForDevTools(port, opts.timeoutMs || 20000, () => exited);
    const page = await findPageTarget(port);
    ws = await openSocket(page.webSocketDebuggerUrl);
  } catch (err) {
    try { proc.kill(); } catch { /* ignore */ }
    await removeDir(profileDir);
    throw new Error(`${err.message}${stderr ? `\n--- browser stderr ---\n${stderr}` : ''}`);
  }

  /** @type {Map<number, {resolve: Function, reject: Function, method: string}>} */
  const pending = new Map();
  /** @type {Map<string, Set<(params: any) => void>>} */
  const listeners = new Map();
  /** @type {ConsoleMessage[]} */
  const messages = [];
  let nextId = 1;
  let closed = false;

  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(String(ev.data)); } catch { return; }
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}${msg.error.data ? ` (${msg.error.data})` : ''}`));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method) {
      const set = listeners.get(msg.method);
      if (set) for (const fn of set) { try { fn(msg.params); } catch (err) { console.error(err); } }
    }
  });
  ws.addEventListener('close', () => {
    closed = true;
    for (const [, p] of pending) p.reject(new Error(`${p.method}: connection closed`));
    pending.clear();
  });
  ws.addEventListener('error', () => { /* surfaced by close */ });

  /**
   * Send a protocol command.
   * @param {string} method
   * @param {object} [params]
   * @returns {Promise<any>}
   */
  function send(method, params = {}) {
    if (closed) return Promise.reject(new Error(`${method}: connection closed`));
    const id = nextId++;
    return new Promise((resolveMsg, reject) => {
      pending.set(id, { resolve: resolveMsg, reject, method });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Subscribe to a protocol event.
   * @param {string} event
   * @param {(params: any) => void} fn
   * @returns {() => void} unsubscribe
   */
  function on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event)?.delete(fn);
  }

  /**
   * Wait for one occurrence of an event.
   * @param {string} event
   * @param {number} timeoutMs
   * @param {(params: any) => boolean} [filter]
   * @returns {Promise<any>}
   */
  function once(event, timeoutMs, filter) {
    return new Promise((resolveEv, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error(`Timed out after ${timeoutMs} ms waiting for ${event}`)); }, timeoutMs);
      const off = on(event, (params) => {
        if (filter && !filter(params)) return;
        clearTimeout(timer);
        off();
        resolveEv(params);
      });
    });
  }

  // Console / exception / log capture.
  on('Runtime.consoleAPICalled', (p) => {
    const text = (p.args || []).map(describeRemote).join(' ');
    const frame = p.stackTrace && p.stackTrace.callFrames && p.stackTrace.callFrames[0];
    messages.push({ kind: 'console', level: p.type === 'warning' ? 'warning' : p.type, text, url: frame?.url, line: frame?.lineNumber, ts: Date.now() });
  });
  on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails || {};
    const text = d.exception ? describeRemote(d.exception) : d.text || 'Uncaught exception';
    messages.push({ kind: 'exception', level: 'error', text: `${d.text && d.exception ? `${d.text} ` : ''}${text}`, url: d.url, line: d.lineNumber, ts: Date.now() });
  });
  on('Log.entryAdded', (p) => {
    const e = p.entry || {};
    messages.push({ kind: 'log', level: e.level, text: `[${e.source}] ${e.text}`, url: e.url, line: e.lineNumber, ts: Date.now() });
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  try { await send('Console.enable'); } catch { /* deprecated domain; ignore */ }
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

  /**
   * Navigate and wait for the load event.
   * @param {string} url
   * @param {{timeoutMs?: number}} [o]
   */
  async function navigate(url, o = {}) {
    const timeoutMs = o.timeoutMs || 30000;
    const loaded = once('Page.loadEventFired', timeoutMs);
    const res = await send('Page.navigate', { url });
    if (res.errorText) { loaded.catch(() => {}); throw new Error(`Navigation to ${url} failed: ${res.errorText}`); }
    await loaded;
  }

  /**
   * Build the expression for evaluate(): a string is used as-is, a function is invoked with JSON args.
   * @param {string|Function} expression
   * @param {any[]} args
   */
  function toExpression(expression, args) {
    if (typeof expression === 'function') {
      return `(${expression.toString()})(${args.map((a) => JSON.stringify(a) ?? 'undefined').join(', ')})`;
    }
    return String(expression);
  }

  /**
   * Evaluate an expression (or call a function with JSON-serialisable args) in the page and return its value.
   * Promises are awaited. Throws when the page code throws.
   * @param {string|Function} expression
   * @param {...any} args
   * @returns {Promise<any>}
   */
  async function evaluate(expression, ...args) {
    const res = await send('Runtime.evaluate', {
      expression: toExpression(expression, args),
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      const text = d.exception ? describeRemote(d.exception) : d.text;
      throw new Error(`evaluate failed: ${text}`);
    }
    return res.result ? res.result.value : undefined;
  }

  /**
   * Poll an expression until it is truthy; resolves with the value.
   * @param {string|Function} expression
   * @param {number} [timeoutMs=10000]
   * @param {number} [intervalMs=100]
   * @returns {Promise<any>}
   */
  async function waitFor(expression, timeoutMs = 10000, intervalMs = 100) {
    const deadline = Date.now() + timeoutMs;
    let lastErr = null;
    for (;;) {
      try {
        const v = await evaluate(expression);
        if (v) return v;
        lastErr = null;
      } catch (err) {
        lastErr = err;
      }
      if (Date.now() >= deadline) {
        const label = typeof expression === 'function' ? expression.toString().slice(0, 120) : String(expression).slice(0, 120);
        throw new Error(`waitFor timed out after ${timeoutMs} ms: ${label}${lastErr ? ` (last error: ${lastErr.message})` : ''}`);
      }
      await sleep(intervalMs);
    }
  }

  /**
   * Dispatch a mouse click at viewport (client) coordinates.
   * @param {number} x
   * @param {number} y
   */
  async function clickClient(x, y) {
    const base = { x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 };
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: base.x, y: base.y, button: 'none' });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
  }

  /**
   * Click at stage coordinates (720 x 1280 logical px): converted through the #stage bounding rect
   * and its scale. Without a stage element the coordinates are used as client coordinates.
   * @param {number} x
   * @param {number} y
   */
  async function click(x, y) {
    const pt = await evaluate((sel, sx, sy, sw) => {
      const el = document.querySelector(sel);
      if (!el) return { x: sx, y: sy };
      const r = el.getBoundingClientRect();
      const scale = r.width ? r.width / sw : 1;
      return { x: r.left + sx * scale, y: r.top + sy * scale };
    }, stageSelector, x, y, stageWidth);
    await clickClient(pt.x, pt.y);
  }

  /**
   * Click the centre of the first element matching a CSS selector (scrolled into view first).
   * @param {string} selector
   * @returns {Promise<boolean>} false when no element matches
   */
  async function tap(selector) {
    const pt = await evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, selector);
    if (!pt) return false;
    await clickClient(pt.x, pt.y);
    return true;
  }

  /**
   * Type text into the focused element.
   * @param {string} text
   */
  async function type(text) {
    await send('Input.insertText', { text: String(text) });
  }

  /**
   * Press a single key (Enter, Escape, Tab, Backspace, or a printable character).
   * @param {string} key
   */
  async function press(key) {
    const codes = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
    const code = codes[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
    const common = { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
    await send('Input.dispatchKeyEvent', { type: key.length === 1 ? 'keyDown' : 'rawKeyDown', ...common, text: key === 'Enter' ? '\r' : (key.length === 1 ? key : undefined) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
  }

  /**
   * Save a PNG screenshot of the viewport.
   * @param {string} path
   * @param {{fullPage?: boolean}} [o]
   * @returns {Promise<string>} the absolute path written
   */
  async function screenshot(path, o = {}) {
    const abs = resolve(path);
    await mkdir(dirname(abs), { recursive: true });
    const params = { format: 'png', captureBeyondViewport: Boolean(o.fullPage) };
    const res = await send('Page.captureScreenshot', params);
    await writeFile(abs, Buffer.from(res.data, 'base64'));
    return abs;
  }

  /** Close the page and the browser process, then delete the temporary profile. */
  async function close() {
    if (!closed) {
      try { await Promise.race([send('Browser.close'), sleep(1500)]); } catch { /* ignore */ }
    }
    closed = true;
    try { ws.close(); } catch { /* ignore */ }
    if (!exited) {
      try { proc.kill(); } catch { /* ignore */ }
      const deadline = Date.now() + 5000;
      while (!exited && Date.now() < deadline) await sleep(50);
      if (!exited && process.platform === 'win32') {
        try { spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* ignore */ }
        await sleep(300);
      }
    }
    await removeDir(profileDir);
  }

  return {
    port,
    executable,
    process: proc,
    profileDir,
    send,
    on,
    navigate,
    evaluate,
    waitFor,
    click,
    clickClient,
    tap,
    type,
    press,
    screenshot,
    console: () => messages.slice(),
    errors: () => messages.filter((m) => m.level === 'error'),
    clearConsole: () => { messages.length = 0; },
    close,
  };
}

/**
 * Open a WebSocket and wait until it is connected.
 * @param {string} url
 * @returns {Promise<WebSocket>}
 */
function openSocket(url) {
  return new Promise((resolveWs, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolveWs(ws), { once: true });
    ws.addEventListener('error', () => reject(new Error(`WebSocket connection to ${url} failed`)), { once: true });
  });
}
