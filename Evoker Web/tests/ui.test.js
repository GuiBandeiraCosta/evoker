'use strict';
/**
 * Unit tests for the pure parts of the UI foundation (no DOM): number formatting, slug rule,
 * countdown formatting, stage fitting, bar ratios, nav items, sprite helpers, the stitched frames and the
 * original-sprite references of the chrome, the dev server path resolver and MIME map.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmt, pad, classes, iconUrl, spriteUrl, ORIG_UI_BASE } from '../src/ui/dom.js';
import { slugify } from '../src/core/cards-db.js';
import { formatCountdown } from '../src/ui/components/countdown.js';
import { fitStage, STAGE_WIDTH, STAGE_HEIGHT } from '../src/ui/components/stage.js';
import { ratio } from '../src/ui/components/bars.js';
import { NAV_ITEMS, EXTEND_ITEMS, navIconSprite, navBadges, lockedNavItems, navLockHint } from '../src/ui/components/nav.js';
import { MAIN_SCREENS, showsBackArrow, navTarget } from '../src/ui/chrome.js';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIG = join(root, 'assets', 'orig', 'ui');

test('fmt adds thousands separators', () => {
  assert.equal(fmt(0), '0');
  assert.equal(fmt(999), '999');
  assert.equal(fmt(1000), '1,000');
  assert.equal(fmt(31700), '31,700');
  assert.equal(fmt(-1234567), '-1,234,567');
  assert.equal(fmt(12.6), '13');
  assert.equal(fmt(NaN), '-');
});

test('pad zero-pads', () => {
  assert.equal(pad(5), '05');
  assert.equal(pad(12), '12');
  assert.equal(pad(7, 3), '007');
});

test('slugify follows the shared card id rule', () => {
  assert.equal(slugify("Will-o'-the-Wisp"), 'will-o-the-wisp');
  assert.equal(slugify('Bone dragon'), 'bone-dragon');
  assert.equal(slugify('Guruk the Destroyer'), 'guruk-the-destroyer');
  assert.equal(slugify('Isilija Moonshine'), 'isilija-moonshine');
  assert.equal(slugify('  Siribia Morning Dew '), 'siribia-morning-dew');
});

test('classes normalises strings, arrays and maps', () => {
  assert.equal(classes('a'), 'a');
  assert.equal(classes(['a', false, 'b', null]), 'a b');
  assert.equal(classes({ a: true, b: false, c: 1 }), 'a c');
  assert.equal(classes(['a', ['b', { c: true }]]), 'a b c');
});

test('asset url helpers', () => {
  assert.equal(iconUrl('sword'), '/assets/ui/sword.svg');
  assert.equal(ORIG_UI_BASE, '/assets/orig/ui/');
  assert.equal(spriteUrl('badge'), '/assets/orig/ui/badge.png');
  assert.equal(spriteUrl('frames/button_default.png'), '/assets/orig/ui/frames/button_default.png');
  assert.equal(spriteUrl('popup_bg.jpg'), '/assets/orig/ui/popup_bg.jpg');
});

test('formatCountdown renders d:hh:mm:ss like the original', () => {
  assert.equal(formatCountdown(0), '0:00:00:00');
  assert.equal(formatCountdown(-5000), '0:00:00:00');
  assert.equal(formatCountdown(((8 * 24 + 20) * 3600 + 60 + 39) * 1000), '8:20:01:39');
  assert.equal(formatCountdown((23 * 3600 + 47 * 60 + 56) * 1000), '0:23:47:56');
  assert.equal(formatCountdown(999), '0:00:00:00');
});

test('fitStage letterboxes on desktop and fills the width on phones', () => {
  const desk = fitStage(1920, 1080);
  assert.ok(Math.abs(desk.scale - 1080 / STAGE_HEIGHT) < 1e-9);
  assert.equal(desk.y, 0);
  assert.ok(desk.x > 0);
  const phone = fitStage(360, 800);
  assert.ok(Math.abs(phone.scale - 360 / STAGE_WIDTH) < 1e-9);
  assert.equal(phone.x, 0);
  assert.ok(phone.y >= 0);
});

test('bar ratio clamps', () => {
  assert.equal(ratio(5, 10), 0.5);
  assert.equal(ratio(-3, 10), 0);
  assert.equal(ratio(30, 10), 1);
  assert.equal(ratio(3, 0), 0);
});

test('nav has the five original buttons with unlock levels and the extended menu', () => {
  assert.deepEqual(NAV_ITEMS.map((i) => i.id), ['league', 'arena', 'quest', 'cards', 'shop']);
  assert.equal(NAV_ITEMS.find((i) => i.id === 'league').unlockLevel, 6);
  assert.equal(NAV_ITEMS.find((i) => i.id === 'arena').unlockLevel, 4);
  // menubar_def slideBg: album, profile, options, home (left to right)
  assert.deepEqual(EXTEND_ITEMS.map((i) => i.id), ['album', 'profile', 'options', 'home']);
});

test('nav buttons map to the original menubar icon sprites (active / glow / grey)', () => {
  const files = new Set(readdirSync(ORIG));
  const expected = {
    league: 'icon_liga', arena: 'icon_pvp', quest: 'icon_map', cards: 'icon_deckedit', shop: 'icon_shop',
    album: 'icon_album', profile: 'icon_profile', options: 'icon_options', home: 'icon_home',
  };
  for (const item of [...NAV_ITEMS, ...EXTEND_ITEMS]) {
    assert.equal(item.sprite, expected[item.id]);
    for (const state of ['active', 'glow', 'grey']) {
      assert.equal(navIconSprite(item, state), `${expected[item.id]}_${state}`);
      assert.ok(files.has(`${navIconSprite(item, state)}.png`), `missing sprite ${navIconSprite(item, state)}`);
    }
  }
  for (const n of ['menubar_button_frame', 'menubar_button_fill_active', 'menubar_button_fill_inactive', 'menubar_button_locked', 'menubar_button_shop',
    'hud_bottombg01', 'bottombg_extended', 'extendmenu_arrow_up', 'extendmenu_arrow_down', 'badge', 'deck_full', 'lock_small']) {
    assert.ok(files.has(`${n}.png`), `missing sprite ${n}`);
  }
});

test('nav badges follow menubar_comp: deck_full / fusion "!" on cards, league not joined, unspent points', () => {
  const st = (o = {}) => ({ player: { level: 10, statPoints: 0, ...(o.player || {}) }, cards: o.cards || [], sim: o.sim || {} });
  const none = () => [];
  const pairs = () => [{ cardId: 'x', stage: 0, uids: ['a', 'b'] }];
  assert.equal(navBadges(null).cards, null);
  assert.equal(navBadges(st(), { fusionCandidates: none }).cards, null);
  assert.equal(navBadges(st(), { fusionCandidates: pairs }).cards, 'new');
  assert.equal(navBadges(st({ player: { level: 1 } }), { fusionCandidates: pairs }).cards, null, 'fusion opens at level 2');
  assert.equal(navBadges(st({ cards: new Array(100).fill({}) }), { fusionCandidates: pairs }).cards, 'full');
  assert.equal(navBadges(st()).league, true, 'league unlocked, not joined');
  assert.equal(navBadges(st({ sim: { leagueJoined: true } })).league, false);
  assert.equal(navBadges(st({ player: { level: 5 } })).league, false, 'league locked below 6');
  const pts = navBadges(st({ player: { statPoints: 3 } }));
  assert.equal(pts.profile, true);
  assert.equal(pts.extend, true);
  assert.equal(navBadges(st()).extend, false);
});

test('nav locks and badges follow isUnlocked: a tutorial game opens Arena after quest 8, League after quest 10', () => {
  const tut = (level, wins) => ({
    player: { level, statPoints: 0 }, cards: [], sim: {},
    tutorial: { r3: { intro: true, lost: [], seen: [], named: true, done: false } },
    quests: { main: { unlocked: wins.length + 1, done: wins.length, firstWins: wins } },
  });
  const upTo = (n) => Array.from({ length: n }, (_, i) => i + 1);
  assert.deepEqual(lockedNavItems(null), ['league', 'arena']);
  assert.deepEqual(lockedNavItems(tut(3, upTo(7))), ['league', 'arena'], 'level 3, quest 7: both locked');
  assert.deepEqual(lockedNavItems(tut(4, upTo(8))), ['league'], 'quest 8 opens the Arena');
  assert.deepEqual(lockedNavItems(tut(5, upTo(10))), [], 'quest 10 opens the League below level 6');
  assert.equal(navBadges(tut(5, upTo(10))).league, true, 'league badge once unlocked by quest 10');
  assert.equal(navBadges(tut(9, upTo(9))).league, false, 'no league badge before quest 10, whatever the level');
  // older saves (no tutorial record) keep the level table
  const old = (level) => ({ player: { level, statPoints: 0 }, cards: [], sim: {}, quests: { main: { firstWins: [] } }, tutorial: { step: 0, seen: [] } });
  assert.deepEqual(lockedNavItems(old(3)), ['league', 'arena']);
  assert.deepEqual(lockedNavItems(old(4)), ['league']);
  assert.deepEqual(lockedNavItems(old(6)), []);
  assert.equal(navLockHint(tut(3, upTo(7)), NAV_ITEMS.find((i) => i.id === 'arena')), 'Unlocks after quest 8');
  assert.equal(navLockHint(old(3), NAV_ITEMS.find((i) => i.id === 'arena')), 'Unlocks at level 4');
});

test('chrome: back arrow only off the main tabs, nav targets like the client', () => {
  for (const id of MAIN_SCREENS) assert.equal(showsBackArrow(id, { back: true }), false, id);
  assert.equal(showsBackArrow('quest-map', { back: () => {} }), false, 'the map has no back arrow');
  for (const id of ['help', 'character', 'collections', 'quest', 'prebattle']) assert.equal(showsBackArrow(id, { back: true }), true, id);
  assert.equal(showsBackArrow('card-detail', { back: true, hideNav: true }), true);
  assert.equal(showsBackArrow('help', { back: false }), false);
  assert.equal(showsBackArrow('league', { back: true }, { view: 'info' }), true, 'the league info page is pushed');
  assert.deepEqual(navTarget('quest'), { how: 'top', id: 'quest', params: {} }, 'the middle button opens the main map');
  assert.deepEqual(navTarget('home'), { how: 'top', id: 'quest', params: { feed: true } }, 'Home opens the landing page');
  assert.deepEqual(navTarget('profile'), { how: 'go', id: 'character', params: { tab: 'profile' } });
  assert.deepEqual(navTarget('options'), { how: 'go', id: 'character', params: { tab: 'settings' } });
  assert.deepEqual(navTarget('album'), { how: 'go', id: 'collections', params: {} });
  assert.deepEqual(navTarget('arena'), { how: 'top', id: 'arena', params: {} });
});

test('the stitched nine-slice frames exist with the documented slice widths', () => {
  const manifest = JSON.parse(readFileSync(join(ORIG, 'frames', 'frames.json'), 'utf8'));
  const slices = { hud_nineframe: 16, hud_nineframe_alpha: 16, ironframe: 10, glowgold: 26, glowblue: 26, glowred: 26, small_white: 12, small_yellow: 12 };
  for (const [name, slice] of Object.entries(slices)) {
    assert.ok(manifest[name], `frames.json lacks ${name}`);
    assert.equal(manifest[name].kind, 'nine');
    assert.deepEqual(manifest[name].slice, { top: slice, right: slice, bottom: slice, left: slice }, name);
    assert.ok(existsSync(join(ORIG, 'frames', `${name}.png`)), `missing frames/${name}.png`);
    const pieces = manifest[name].pieces;
    for (const pos of ['tl', 't', 'tr', 'l', 'r', 'bl', 'b', 'br']) assert.ok(pieces[pos], `${name} has no ${pos} piece`);
  }
  for (const name of ['button_default', 'button_green', 'button_danger', 'button_inactive', 'quadbutton', 'bigbutton04', 'bigbutton04_inactive', 'backbutton', 'backbutton_inactive', 'menubar_button', 'resourcebar', 'moneybar']) {
    assert.equal(manifest[name].kind, 'composite', name);
    assert.ok(existsSync(join(ORIG, 'frames', `${name}.png`)), `missing frames/${name}.png`);
  }
  assert.deepEqual(manifest.progressbar.slice, { left: 18, right: 20 });
  assert.deepEqual(manifest.progressbar_knob.slice, { left: 30, right: 20 });
});

test('every original sprite referenced by the chrome CSS and components exists', () => {
  const files = [
    'css/main.css', 'css/tokens.css',
    'css/screens/help.css', 'css/screens/league.css', 'css/screens/arena.css', 'css/screens/shop.css', 'css/screens/character.css', 'css/screens/collections.css',
    'src/ui/components/hud.js', 'src/ui/components/nav.js', 'src/ui/components/buttons.js', 'src/ui/components/dialog.js',
    'src/ui/components/popup-levelup.js', 'src/ui/components/bars.js',
    'src/ui/components/popup-unlock.js', 'css/components/levelup.css', 'css/components/unlock.css', 'css/screens/quest-map.css',
  ];
  const urlRe = /\/assets\/orig\/ui\/([\w./-]+)/g;
  const spriteRe = /sprite\('([\w./-]+)'/g;
  let count = 0;
  for (const f of files) {
    const src = readFileSync(join(root, f), 'utf8');
    for (const m of src.matchAll(urlRe)) {
      count++;
      assert.ok(existsSync(join(ORIG, m[1])), `${f} references missing sprite ${m[1]}`);
    }
    for (const m of src.matchAll(spriteRe)) {
      count++;
      const rel = /\.\w+$/.test(m[1]) ? m[1] : `${m[1]}.png`;
      assert.ok(existsSync(join(ORIG, rel)), `${f} references missing sprite ${rel}`);
    }
  }
  assert.ok(count > 80, `expected many sprite references, found ${count}`);
});

test('tokens carry the original palette and the Proxima Nova / CG Times font stacks', () => {
  const css = readFileSync(join(root, 'css', 'tokens.css'), 'utf8');
  const palette = {
    xp: '#ffd556', stamina: '#ff832f', mana: '#24d8ff', health: '#39b432', playerGold: '#d2a154', rating: '#c1d353',
    bronze: '#d47a42', silver: '#e3e3e3', gold: '#ffcf35', common: '#c8c7c7', standard: '#f3f3f3', uncommon: '#91dc52',
    rare: '#7ab0f2', heroic: '#c059bf', legendary: '#fdfab1', ultimate: '#ff0000', headlines: '#e6e6e6', beige: '#f4d59f',
    brightOrange: '#ff8014', sellGreen: '#71d703', evolveBlue: '#73beed', enhanceYellow: '#ffc553',
  };
  for (const [name, hex] of Object.entries(palette)) assert.ok(css.includes(hex), `tokens.css lacks the ${name} colour ${hex}`);
  assert.match(css, /--font-ui:\s*'Proxima Nova'/);
  assert.match(css, /--font-title:\s*'CG Times'/);
  assert.match(css, /--hud-h:\s*\d+px/);
  assert.match(css, /--nav-h:\s*\d+px/);
});

test('the chrome keeps the selectors the QA tools drive', () => {
  const hud = readFileSync(join(root, 'src/ui/components/hud.js'), 'utf8');
  for (const cls of ['hud-back', 'hud-help', 'hud-center', 'hud-res.stamina', 'hud-res.mana', 'hud-plus']) assert.ok(hud.includes(cls), `hud.js lacks .${cls}`);
  const buttons = readFileSync(join(root, 'src/ui/components/buttons.js'), 'utf8');
  for (const cls of ['attack-bar', 'attack-btn', 'tabbar', 'btn-icon']) assert.ok(buttons.includes(cls), `buttons.js lacks .${cls}`);
  const dlg = readFileSync(join(root, 'src/ui/components/dialog.js'), 'utf8');
  for (const cls of ['dialog-close', 'dialog-title', 'potion-img', 'dialog-potion']) assert.ok(dlg.includes(cls), `dialog.js lacks .${cls}`);
  const lvl = readFileSync(join(root, 'src/ui/components/popup-levelup.js'), 'utf8');
  for (const cls of ['lvl-backdrop', 'lvl-panel', 'lvl-title', 'lvl-proceed']) assert.ok(lvl.includes(cls), `popup-levelup.js lacks .${cls}`);
  const nav = readFileSync(join(root, 'src/ui/components/nav.js'), 'utf8');
  for (const cls of ['nav-btn', 'badge', 'badge-full', 'locked', 'nav-extend', 'nav-extend-panel', 'nav-catcher']) assert.ok(nav.includes(cls), `nav.js lacks .${cls}`);
});

test('every icon referenced by the components exists in assets/ui', () => {
  const dir = join(root, 'assets', 'ui');
  const files = new Set(readdirSync(dir));
  const needed = ['sword', 'heart', 'mana-drop', 'star', 'anvil', 'stamina-crystal', 'coin', 'gem', 'potion-orange',
    'potion-blue', 'trophy', 'swords', 'compass', 'cards', 'shop', 'character', 'lock', 'question', 'back', 'info',
    'close', 'magnifier', 'dollar', 'token-bronze', 'token-silver', 'token-gold', 'broken-sword', 'rings', 'circles',
    'sphere', 'skull', 'card-placeholder', 'emblem-dwarf', 'emblem-elf', 'emblem-orc', 'emblem-neutral', 'tap-hand'];
  for (const n of needed) assert.ok(files.has(n + '.svg'), `missing assets/ui/${n}.svg`);
  assert.ok(files.has('logo.png'), 'missing assets/ui/logo.png');
  for (const f of files) if (f.endsWith('.svg')) {
    const src = readFileSync(join(dir, f), 'utf8');
    assert.ok(src.startsWith('<svg'), `${f} is not an svg`);
    assert.ok(src.includes('viewBox='), `${f} has no viewBox`);
  }
});

test('dev server resolves paths inside the root only and knows the MIME types', async () => {
  const mod = await import('../tools/serve.js');
  assert.equal(mod.MIME['.mjs'], 'text/javascript; charset=utf-8');
  assert.equal(mod.MIME['.json'], 'application/json; charset=utf-8');
  assert.equal(mod.MIME['.svg'], 'image/svg+xml');
  assert.equal(mod.MIME['.jpg'], 'image/jpeg');
  assert.equal(mod.MIME['.png'], 'image/png');
  assert.ok(mod.resolvePath('/index.html').endsWith('index.html'));
  assert.ok(mod.resolvePath('/').endsWith('index.html'));
  assert.ok(mod.resolvePath('/css/main.css?x=1').endsWith('main.css'));
  assert.equal(mod.resolvePath('/../../etc/passwd'), null);
  assert.equal(mod.server.listening, false, 'importing serve.js must not start listening');
});

test('package.json scripts match the contract', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.scripts.start, 'node tools/serve.js');
  // architecture.md §1: `node --test tests/`. Node 21+ resolves the directory through tests/index.js,
  // which imports every suite (see tests/index.js).
  assert.equal(pkg.scripts.test, 'node --test tests/');
  assert.ok(existsSync(join(root, 'tests', 'index.js')));
  assert.ok(existsSync(join(root, 'index.html')));
});

test('HUD "?" icon: centred by the button flex box, not absolutely positioned (it sat in the top-left corner on the phone, 2026-10-12)', () => {
  const css = readFileSync(join(root, 'css', 'main.css'), 'utf8');
  const m = css.match(/\.hud-btn-icon \{([^}]*)\}/);
  assert.ok(m, '.hud-btn-icon rule');
  assert.ok(!/position: absolute/.test(m[1]), 'no absolute positioning inside the <button>');
  assert.ok(!/translate\(-50%/.test(m[1]), 'no transform centring');
  assert.match(m[1], /flex: none/);
  assert.match(css, /\.hud-btn \{[^}]*display: flex; align-items: center; justify-content: center;/);
  assert.match(css, /^button \{[^}]*appearance: none; -webkit-appearance: none;/m, 'buttons keep no platform theme');
  assert.match(css, /^html \{ -webkit-text-size-adjust: 100%; text-size-adjust: 100%; \}/m, 'phones must not inflate the text');
});

test('top-row card arrows are turned by 180 degrees like the client enemy cards (the Worm Shaman heal arrow pointed away from the card he healed, 2026-10-12)', () => {
  const css = readFileSync(join(root, 'css', 'cards.css'), 'utf8');
  const rule = (sel) => { const i = css.indexOf(sel + ' {'); assert.ok(i >= 0, sel); return css.slice(i, css.indexOf('}', i)); };
  // bottom row: arrows on the edge they point to
  assert.match(rule('.arrow.ownRight'), /right: 3px/);
  assert.match(rule('.card.side-bottom .arrow.left'), /left: 5px; top: 5px/);
  // top row: the overlay turned, so "right" sits on the screen's left and "left" (frontLeft) on the screen's right
  assert.match(rule('.card.side-top .arrow.ownRight'), /left: 3px/);
  assert.match(rule('.card.side-top .arrow.ownRight'), /rotate\(-90deg\)/);
  assert.match(rule('.card.side-top .arrow.ownLeft'), /right: 3px/);
  assert.match(rule('.card.side-top .arrow.left'), /right: 5px; bottom: 5px/);
  assert.match(rule('.card.side-top .arrow.right'), /left: 5px; bottom: 5px/);
});
