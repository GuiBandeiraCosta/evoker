'use strict';
/**
 * Tests for the audio module's pure parts (src/ui/audio.js) with a fake Audio class and fake timers:
 * the NAMES map against the files in assets/orig/sfx, name resolution, volume math, the sound-effect pool
 * limits, music crossfades and one-shots, the autoplay unlock, the screen -> music table, the delegated
 * click sounds, the save-diff sounds, the Settings volume helpers and the intro texts against loca_en.json.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import {
  NAMES, FILES, GAIN, resolveName, readVolumes, effectiveVolume, screenMusic, soundForClick, diffSounds,
  isUnlockTitle, createAudio,
} from '../src/ui/audio.js';
import { INTRO_LORE, SKIP_INTRO } from '../src/ui/tutorial/opening.js';
import {
  normalizeVolumes, sliderToVolume, volumeToSlider, clampVolume, DEFAULT_VOLUMES, normalizeSettings,
} from '../src/ui/screens/settings-view.js';
import { defaultState, migrate } from '../src/game/state.js';
import { classicGame } from './fixtures-game/classic.js';
import { T0 } from './fixtures/real.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------------------------------------------------------------- fakes */

class FakeAudio {
  static instances = [];
  static reject = false;
  constructor(src) {
    this.src = src; this.volume = 1; this.playbackRate = 1; this.currentTime = 0; this.paused = true;
    this.loop = false; this.preload = ''; this.listeners = {}; this.plays = 0; this.loads = 0;
    FakeAudio.instances.push(this);
  }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  emit(type) { for (const fn of (this.listeners[type] || []).slice()) fn({ type }); }
  play() { this.plays++; if (FakeAudio.reject) return Promise.reject(new Error('NotAllowedError')); this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  load() { this.loads++; }
  end() { this.paused = true; this.emit('ended'); }
  fail() { this.emit('error'); }
}

function fakeTimers() {
  let t = 0;
  let id = 0;
  const timers = new Map();
  return {
    now: () => t,
    setInterval: (fn, ms) => { const i = ++id; timers.set(i, { fn, ms, at: t + ms, repeat: true }); return i; },
    clearInterval: (i) => timers.delete(i),
    setTimeout: (fn, ms) => { const i = ++id; timers.set(i, { fn, ms, at: t + ms, repeat: false }); return i; },
    clearTimeout: (i) => timers.delete(i),
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [i, tm] of timers) if (tm.at <= end && (!next || tm.at < next[1].at)) next = [i, tm];
        if (!next) break;
        const [i, tm] = next;
        t = tm.at;
        if (tm.repeat) tm.at = t + tm.ms; else timers.delete(i);
        tm.fn();
      }
      t = end;
    },
    pending: () => timers.size,
  };
}

function fakeDoc() {
  const listeners = {};
  return {
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener: (type, fn) => { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
    fire: (type) => { for (const fn of (listeners[type] || []).slice()) fn({ type }); },
    count: (type) => (listeners[type] || []).length,
  };
}

function makeAudio(settings = { sound: true, musicVolume: 0.7, fxVolume: 1 }, extra = {}) {
  FakeAudio.instances = [];
  FakeAudio.reject = false;
  const timers = fakeTimers();
  const doc = fakeDoc();
  const audio = createAudio({ Audio: FakeAudio, timers, now: timers.now, random: () => 0, doc, getSettings: () => settings, maxConcurrent: 4, ...extra });
  return { audio, timers, doc, settings };
}

/** Element stand-in for soundForClick: class-only selectors plus [data-sfx]. */
function fakeEl(classes, opts = {}) {
  const el = {
    classList: { contains: (c) => classes.includes(c) },
    disabled: Boolean(opts.disabled),
    dataset: opts.dataset || {},
    parent: opts.parent || null,
  };
  const matches = (sel) => sel.split(',').some((part) => {
    const p = part.trim();
    if (p === '[data-sfx]') return el.dataset.sfx !== undefined;
    const cls = p.split('.').filter(Boolean);
    return cls.length > 0 && cls.every((c) => classes.includes(c));
  });
  el.closest = (sel) => (matches(sel) ? el : (el.parent ? el.parent.closest(sel) : null));
  return el;
}

/* ---------------------------------------------------------------- NAMES */

test('NAMES references every file in assets/orig/sfx and nothing else', () => {
  const onDisk = readdirSync(join(ROOT, 'assets/orig/sfx')).filter((f) => f.endsWith('.mp3')).map((f) => f.slice(0, -4)).sort();
  assert.ok(onDisk.length >= 200, `expected the 201 original sounds, found ${onDisk.length}`);
  const missing = FILES.filter((f) => !onDisk.includes(f));
  const unmapped = onDisk.filter((f) => !FILES.includes(f));
  assert.deepEqual(missing, [], 'NAMES entries without a file');
  assert.deepEqual(unmapped, [], 'files not reachable from NAMES');
  for (const file of Object.keys(GAIN)) assert.ok(onDisk.includes(file), `GAIN entry ${file} exists`);
  // the events the task names and the legacy ctx.sfx aliases used by the screens
  for (const key of ['tap', 'reroll', 'gremlin', 'buy', 'fanfare', 'victory', 'defeat', 'flip', 'take', 'sell', 'train', 'fuse', 'tick', 'confirm', 'reward', 'gems', 'attack', 'open', 'potion', 'unlock', 'levelUp', 'cardLevelUp']) {
    assert.ok(NAMES[key], `alias ${key}`);
  }
  assert.equal(NAMES.nav, 'ui_button_circular');
  assert.equal(NAMES.map, 'ui_button_map');
  assert.equal(NAMES.card, 'ui_button_card');
  assert.equal(NAMES.tab, 'ui_button_switch');
  assert.equal(NAMES.potion, 'ui_use_potion');
  assert.equal(NAMES.levelUp, 'quest_reward_levelup');
  assert.equal(NAMES.unlock, 'ui_unlock');
});

test('resolveName: aliases, variants, original names, unknown', () => {
  assert.equal(resolveName('tap'), 'ui_button_circular');
  assert.equal(resolveName('ui_button_attack'), 'ui_button_attack');
  assert.equal(resolveName('ui_button_attack.mp3'), 'ui_button_attack');
  assert.equal(resolveName('death', () => 0), 'fight_card_death_1');
  assert.equal(resolveName('death', () => 0.99), 'fight_card_death_5');
  assert.equal(resolveName('death', () => 1.5), 'fight_card_death_5', 'clamped');
  assert.equal(resolveName('nope'), null);
  assert.equal(resolveName('../etc/passwd'), null);
  assert.equal(resolveName(''), null);
  assert.equal(resolveName(null), null);
});

/* ---------------------------------------------------------------- volume math */

test('readVolumes and effectiveVolume: master switch, channel, per-file gain, clamping', () => {
  assert.deepEqual(readVolumes(undefined), { on: true, music: 0.7, fx: 1 });
  assert.deepEqual(readVolumes({ sound: false, musicVolume: 2, fxVolume: -1 }), { on: false, music: 1, fx: 0 });
  assert.deepEqual(readVolumes({ sound: 1, musicVolume: 'x', fxVolume: NaN }), { on: true, music: 0.7, fx: 1 });
  const on = { on: true, music: 0.7, fx: 0.5 };
  assert.equal(effectiveVolume(on, 'fx', 'ui_button_circular'), 0.5);
  assert.equal(effectiveVolume(on, 'fx', 'ui_button_circular', 0.5), 0.25);
  assert.equal(effectiveVolume(on, 'fx', 'ui_button_circular', 3), 1, 'clamped to 1');
  assert.equal(effectiveVolume(on, 'fx', 'ui_button_circular', NaN), 0.5, 'bad factor ignored');
  assert.equal(effectiveVolume(on, 'music', 'music_intro'), 0.35, 'music_intro plays at 0.5 in the client');
  assert.equal(effectiveVolume(on, 'music', 'atmo_menu'), 0.7);
  assert.equal(effectiveVolume({ ...on, on: false }, 'music', 'atmo_menu'), 0);
  assert.equal(effectiveVolume(null, 'fx', 'x'), 0);
});

test('Settings volume helpers: defaults, clamping, slider conversions; normalizeSettings keeps its shape', () => {
  assert.deepEqual(DEFAULT_VOLUMES, { musicVolume: 0.7, fxVolume: 1 });
  assert.deepEqual(normalizeVolumes(undefined), { musicVolume: 0.7, fxVolume: 1 });
  assert.deepEqual(normalizeVolumes({ musicVolume: '0.25', fxVolume: 9 }), { musicVolume: 0.25, fxVolume: 1 });
  assert.deepEqual(normalizeVolumes({ musicVolume: -3, fxVolume: 'loud' }), { musicVolume: 0, fxVolume: 1 });
  assert.equal(clampVolume(0.123456, 0), 0.12);
  assert.equal(clampVolume(null, 0.4), 0.4);
  assert.equal(sliderToVolume(37), 0.37);
  assert.equal(sliderToVolume('100'), 1);
  assert.equal(sliderToVolume(250), 1);
  assert.equal(sliderToVolume('x'), 0);
  assert.equal(volumeToSlider(0.7), 70);
  assert.equal(volumeToSlider(1.7), 100);
  for (const n of [0, 1, 37, 70, 100]) assert.equal(volumeToSlider(sliderToVolume(n)), n);
  assert.deepEqual(Object.keys(normalizeSettings({ musicVolume: 0.2 })), ['sound', 'speed', 'raids', 'reducedMotion']);
});

test('state: the save carries musicVolume / fxVolume; pre-audio saves get audio on', () => {
  const d = defaultState(T0, 1).settings;
  assert.equal(d.musicVolume, 0.7);
  assert.equal(d.fxVolume, 1);
  assert.equal(d.sound, true);
  const fresh = classicGame('A', 5, T0);
  assert.deepEqual(migrate(JSON.parse(JSON.stringify(fresh)), T0).settings, fresh.settings);
  const old = migrate({ seed: 3, player: { name: 'Old' }, cards: [], settings: { sound: false, speed: 2, raids: false, reducedMotion: true } }, T0);
  assert.deepEqual(old.settings, { sound: true, musicVolume: 0.7, fxVolume: 1, speed: 2, raids: false, reducedMotion: true });
  const muted = migrate({ seed: 3, player: { name: 'Quiet' }, cards: [], settings: { sound: false, musicVolume: 0.2, fxVolume: 0.5 } }, T0);
  assert.equal(muted.settings.sound, false, 'a real choice is kept');
  assert.equal(muted.settings.musicVolume, 0.2);
  assert.equal(migrate({ seed: 1, player: {} }, T0).settings.musicVolume, 0.7);
});

/* ---------------------------------------------------------------- sound effects */

test('sfx: pool per file, concurrency cap chokes the oldest, ended elements are reused', () => {
  const { audio, timers } = makeAudio();
  for (let i = 0; i < 6; i++) { assert.equal(audio.sfx('tap'), true, `play ${i}`); timers.advance(100); }
  assert.equal(FakeAudio.instances.length, 4, 'never more elements than the cap');
  assert.equal(audio.state().playing, 4);
  // plays 5 and 6 choked the two oldest effects and reused their elements
  assert.deepEqual(FakeAudio.instances.map((a) => a.plays), [2, 2, 1, 1]);
  assert.ok(FakeAudio.instances.every((a) => !a.paused), 'the four newest plays are running');
  assert.ok(FakeAudio.instances.every((a) => a.src === '/assets/orig/sfx/ui_button_circular.mp3'));
  for (const a of FakeAudio.instances) a.end();
  assert.equal(audio.state().playing, 0);
  timers.advance(100);
  audio.sfx('tap');
  assert.equal(FakeAudio.instances.length, 4, 'a free element is taken from the pool');
  assert.equal(audio.state().playing, 1);
  assert.equal(audio.state().pooled, 4);
});

test('sfx: volume and rate, repeat guard, master off, unknown names, missing files', () => {
  const settings = { sound: true, musicVolume: 0.7, fxVolume: 0.5 };
  const { audio, timers } = makeAudio(settings);
  assert.equal(audio.sfx('ui_button_attack', { volume: 0.5, rate: 1.5 }), true);
  const el = FakeAudio.instances[0];
  assert.equal(el.volume, 0.25);
  assert.equal(el.playbackRate, 1.5);
  assert.equal(audio.sfx('ui_button_attack'), false, 'same sound within 60 ms is dropped');
  timers.advance(61);
  assert.equal(audio.sfx('ui_button_attack'), true);
  assert.equal(audio.sfx('nope'), false);
  settings.sound = false;
  timers.advance(100);
  assert.equal(audio.sfx('tap'), false, 'master off');
  assert.equal(FakeAudio.instances.length, 2, 'no element created while off');
  settings.sound = true;
  settings.fxVolume = 0;
  assert.equal(audio.sfx('tap'), false, 'fx volume 0');
  settings.fxVolume = 1;
  timers.advance(100);
  assert.equal(audio.sfx('ui_unlock'), true);
  const missing = FakeAudio.instances[FakeAudio.instances.length - 1];
  missing.fail();
  assert.deepEqual(audio.state().missing, ['ui_unlock']);
  timers.advance(100);
  assert.equal(audio.sfx('ui_unlock'), false, 'a missing file is never requested again');
  assert.equal(FakeAudio.instances.length, 3);
});

test('sfx: a rejected play() releases the element', async () => {
  const { audio } = makeAudio();
  FakeAudio.reject = true;
  assert.equal(audio.sfx('tap'), true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(audio.state().playing, 0);
});

/* ---------------------------------------------------------------- music */

test('music: fade in, crossfade to the next track, same track is a no-op, null fades out', () => {
  const { audio, timers } = makeAudio();
  assert.equal(audio.music('music_intro'), true);
  const a = FakeAudio.instances[0];
  assert.equal(a.loop, true);
  assert.equal(a.volume, 0, 'starts silent');
  timers.advance(700);
  assert.equal(a.volume, 0.35, '0.7 x the client gain of 0.5');
  assert.equal(audio.state().music, 'music_intro');
  assert.equal(audio.music('music_intro'), false, 'already playing');
  assert.equal(FakeAudio.instances.length, 1);
  assert.equal(audio.music('atmo_map_far', { fade: 400 }), true);
  const b = FakeAudio.instances[1];
  timers.advance(200);
  assert.ok(a.volume > 0 && a.volume < 0.35, `old track fading: ${a.volume}`);
  assert.ok(b.volume > 0 && b.volume < 0.7, `new track rising: ${b.volume}`);
  assert.equal(a.paused, false);
  timers.advance(200);
  assert.equal(a.paused, true, 'old track stopped after the fade');
  assert.equal(b.volume, 0.7);
  assert.equal(audio.state().music, 'atmo_map_far');
  audio.music(null, { fade: 100 });
  timers.advance(100);
  assert.equal(b.paused, true);
  assert.equal(audio.state().music, null);
  assert.equal(audio.music('nope'), false);
});

test('music: one-shots end by themselves and can chain a follow-up track', () => {
  const { audio, timers } = makeAudio();
  audio.music('music_bossannounce', { loop: false, fade: 0 });
  const boss = FakeAudio.instances[0];
  assert.equal(boss.loop, false);
  assert.equal(boss.volume, 0.7);
  boss.end();
  assert.equal(audio.state().music, null);
  audio.music('music_buybooster', { loop: false, next: 'atmo_menu', fade: 0 });
  const shop = FakeAudio.instances[1];
  shop.end();
  assert.equal(audio.state().music, 'atmo_menu');
  timers.advance(800);
  assert.equal(FakeAudio.instances[2].volume, 0.7);
  audio.music('music_buybooster', { loop: false, next: () => 'atmo_map_far', gap: 500, fade: 0 });
  FakeAudio.instances[3].end();
  assert.equal(audio.state().music, null, 'waits for the gap');
  timers.advance(500);
  assert.equal(audio.state().music, 'atmo_map_far');
});

test('music: setVolumes applies at once, refresh() returns to the settings, missing file stops silently', () => {
  const settings = { sound: true, musicVolume: 0.7, fxVolume: 1 };
  const { audio, timers } = makeAudio(settings);
  audio.music('atmo_menu', { fade: 0 });
  const el = FakeAudio.instances[0];
  assert.equal(el.volume, 0.7);
  audio.setVolumes(0.2, 1);
  assert.equal(el.volume, 0.2);
  audio.setVolumes(0.5, 1, false);
  assert.equal(el.volume, 0, 'master off through setVolumes');
  audio.refresh();
  assert.equal(el.volume, 0.7);
  settings.sound = false;
  audio.refresh();
  assert.equal(el.volume, 0);
  assert.equal(el.paused, false, 'the music keeps running silently so switching on is instant');
  settings.sound = true;
  audio.music('music_intro', { fade: 0 });
  const bad = FakeAudio.instances[1];
  bad.fail();
  assert.equal(audio.state().music, null);
  assert.deepEqual(audio.state().missing, ['music_intro']);
  assert.equal(audio.music('music_intro'), false);
  timers.advance(1000);
});

test('music: autoplay refusal is remembered and replayed by unlock() on the first gesture', async () => {
  const { audio, doc } = makeAudio();
  FakeAudio.reject = true;
  audio.unlock();
  assert.equal(doc.count('pointerdown'), 1);
  assert.equal(doc.count('keydown'), 1);
  audio.music('music_intro');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(audio.state().music, null);
  assert.equal(audio.state().pending, 'music_intro');
  FakeAudio.reject = false;
  doc.fire('pointerdown');
  assert.equal(audio.state().unlocked, true);
  assert.equal(audio.state().music, 'music_intro');
  assert.equal(audio.state().pending, null);
  assert.equal(doc.count('pointerdown'), 0, 'listeners removed');
  assert.equal(doc.count('keydown'), 0);
  audio.unlock();
  assert.equal(doc.count('pointerdown'), 0, 'no second set of listeners once unlocked');
});

test('stopAll stops the music and every effect; preload creates one pooled element per name', () => {
  const { audio, timers } = makeAudio();
  assert.equal(audio.preload(['tap', 'ui_unlock', 'tap', 'nope']), 2);
  assert.equal(FakeAudio.instances.length, 2);
  assert.equal(FakeAudio.instances[0].loads, 1);
  audio.sfx('tap');
  assert.equal(FakeAudio.instances.length, 2, 'the preloaded element is used');
  timers.advance(100);
  audio.sfx('ui_unlock');
  audio.music('atmo_menu', { fade: 0 });
  assert.equal(audio.state().playing, 2);
  audio.stopAll();
  assert.equal(audio.state().playing, 0);
  assert.equal(audio.state().music, null);
  assert.ok(FakeAudio.instances.every((a) => a.paused));
});

test('createAudio without an Audio constructor is inert', () => {
  const audio = createAudio({ Audio: null, doc: null });
  assert.equal(audio.sfx('tap'), false);
  assert.equal(audio.music('atmo_menu'), false);
  assert.equal(audio.preload(['tap']), 0);
  audio.unlock();
  audio.stopAll();
});

/* ---------------------------------------------------------------- wiring helpers */

test('screenMusic: the screen -> track table', () => {
  assert.deepEqual(screenMusic('title'), { name: 'music_intro', loop: true });
  assert.deepEqual(screenMusic('quest-map', { line: 'main' }), { name: 'atmo_map_far', loop: true });
  assert.equal(screenMusic('boss-intro').name, 'music_bossannounce');
  assert.equal(screenMusic('boss-intro').loop, false);
  assert.deepEqual(screenMusic('shop'), { name: 'music_buybooster', loop: false, next: 'atmo_menu' });
  for (const id of ['arena', 'league', 'cards', 'card-detail', 'collections', 'character']) assert.equal(screenMusic(id).name, 'atmo_menu', id);
  for (const id of ['battle', 'prebattle', 'booster-open', 'help', 'unknown']) assert.equal(screenMusic(id), null, id);
  const cues = new Set();
  for (let n = 1; n <= 8; n++) {
    const m = screenMusic('quest', { line: 'main', quest: n });
    assert.ok(NAMES.atmoQuest.includes(m.name), m.name);
    assert.equal(m.loop, true);
    assert.deepEqual(screenMusic('quest', { line: 'main', quest: n }), m, 'stable per quest');
    cues.add(m.name);
  }
  assert.equal(cues.size, 4, 'all four cues are used across the first quests');
  assert.ok(NAMES.atmoQuest.includes(screenMusic('quest', {}).name), 'missing params fall back');
});

test('soundForClick: nav, map nodes, cards, tabs, buttons, opt-outs and data-sfx', () => {
  assert.equal(soundForClick(fakeEl(['nav-btn', 'quest'])), 'ui_button_circular');
  assert.equal(soundForClick(fakeEl(['qm-node', 'current'])), 'ui_button_map');
  assert.equal(soundForClick(fakeEl(['card', 'interactive'])), 'ui_button_card');
  assert.equal(soundForClick(fakeEl(['card'])), null, 'a static card is silent');
  assert.equal(soundForClick(fakeEl(['tab', 'active'])), 'ui_button_switch');
  assert.equal(soundForClick(fakeEl(['toggle'])), 'ui_button_switch');
  assert.equal(soundForClick(fakeEl(['btn', 'btn-green'])), 'ui_button_circular');
  assert.equal(soundForClick(fakeEl(['hud-plus'])), 'ui_button_circular');
  assert.equal(soundForClick(fakeEl(['dialog-close', 'btn'])), 'ui_button_card_close');
  assert.equal(soundForClick(fakeEl(['btn', 'attack-btn'])), null, 'the pre-battle screen plays ui_button_attack itself');
  assert.equal(soundForClick(fakeEl(['btn'], { disabled: true })), null);
  assert.equal(soundForClick(fakeEl(['icon'], { parent: fakeEl(['btn']) })), 'ui_button_circular', 'bubbles up to the button');
  assert.equal(soundForClick(fakeEl(['btn'], { dataset: { sfx: 'shop_open' } })), 'shop_open');
  assert.equal(soundForClick(fakeEl(['btn'], { dataset: { sfx: 'none' } })), null);
  assert.equal(soundForClick(fakeEl(['quest-minion'])), null, 'minion hits belong to the quest screen');
  assert.equal(soundForClick(null), null);
  assert.equal(soundForClick({}), null);
});

test('diffSounds: drinking or buying a potion, never for another save or a reward', () => {
  const s = classicGame('A', 1, T0);
  const player = (patch) => ({ ...s, player: { ...s.player, ...patch } });
  assert.deepEqual(diffSounds(s, player({ staminaPotions: 1, stamina: 50 })), ['ui_use_potion']);
  assert.deepEqual(diffSounds(player({ mana: 3 }), player({ manaPotions: 0, mana: 50 })), ['ui_use_potion']);
  assert.deepEqual(diffSounds(player({ gems: 100, stamina: 2 }), player({ gems: 60, stamina: 50 })), ['ui_use_potion'], 'bought and drunk');
  assert.deepEqual(diffSounds(s, player({ staminaPotions: 3 })), [], 'a reward adds potions');
  assert.deepEqual(diffSounds(player({ gems: 100 }), player({ gems: 60 })), [], 'spending gems alone');
  assert.deepEqual(diffSounds(s, { ...player({ staminaPotions: 0 }), seed: 2 }), [], 'another save');
  assert.deepEqual(diffSounds(null, s), []);
  assert.deepEqual(diffSounds(s, null), []);
});

test('isUnlockTitle', () => {
  assert.equal(isUnlockTitle('Arena Unlocked!'), true);
  assert.equal(isUnlockTitle('Card Training Unlocked!'), true);
  assert.equal(isUnlockTitle('League Unlocked'), true);
  assert.equal(isUnlockTitle('Day 3 reward'), false);
  assert.equal(isUnlockTitle(undefined), false);
});

/* ---------------------------------------------------------------- texts */

test('intro lore, name prompt and skip label come from exploration/apk/data/loca_en.json', () => {
  const loca = JSON.parse(readFileSync(join(ROOT, 'exploration/apk/data/loca_en.json'), 'utf8'));
  const keys = Object.keys(loca);
  const valueFor = (prefix) => {
    const key = keys.find((k) => k.startsWith(prefix));
    assert.ok(key, `loca key starting with "${prefix}"`);
    return { key, value: loca[key] };
  };
  const once = valueFor('Once');
  const eldest = valueFor('But the eldest');
  const omens = valueFor('But dark omens');
  assert.equal(INTRO_LORE.length, 3);
  assert.equal(INTRO_LORE[0], once.value);
  // the dump cuts the long values at 70 characters: ours continue them
  assert.ok(INTRO_LORE[1].startsWith(eldest.value), INTRO_LORE[1]);
  assert.ok(INTRO_LORE[2].startsWith(omens.value), INTRO_LORE[2]);
  assert.ok(INTRO_LORE[1].length > eldest.value.length && INTRO_LORE[2].length > omens.value.length);
  assert.equal(SKIP_INTRO, 'Skip intro');
});
