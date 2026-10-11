'use strict';
/**
 * Audio: the original Evoker sound effects and music loops (assets/orig/sfx, 201 MP3s recovered from the
 * 1.7.4 client) played through HTMLAudioElements.
 *
 *  - `createAudio(opts)` returns the player: `sfx(name, {volume, rate})`, `music(name|null, {loop, fade, next})`,
 *    `stopAll()`, `unlock()`, `setVolumes(music, fx, on)`, `preload([...])`.
 *  - `NAMES` maps game events (and the legacy `ctx.sfx('tap')` aliases) to the original file names; `sfx()`
 *    accepts either an alias or an original name. Arrays are variants, one is picked at random.
 *  - Sound effects use a pool per file (one element per concurrent play, capped), music is one element with
 *    a crossfade. `settings.sound` (master), `settings.musicVolume` and `settings.fxVolume` (0..1) are read
 *    through `getSettings()` on every play. Missing files fail silently and are not requested again.
 *  - Browsers refuse to play audio before the first user gesture: `unlock()` listens for the first
 *    pointerdown / keydown and restarts the music that was requested before it.
 *
 * The pure parts (`NAMES`, `resolveName`, `effectiveVolume`, `screenMusic`, `soundForClick`, `diffSounds`,
 * `isUnlockTitle`) have no DOM dependency so tests/audio.test.js runs them in Node with a fake Audio class.
 */

/** Original mix levels (audioassets.lua): everything else plays at 1. Keys are file names. */
export const GAIN = Object.freeze({
  music_intro: 0.5,
  music_introvideo_part1: 0.6,
  music_introvideo_part1end: 0.6,
  music_introvideo_part2: 0.6,
  music_buybooster: 0.5,
  music_fight_cue1: 0.4,
  music_fight_cue2: 0.4,
  atmo_fight: 0.8,
  atmo_ambient_cue1: 0.4,
  atmo_ambient_cue2: 0.4,
  atmo_ambient_cue3: 0.4,
  atmo_ambient_cue4: 0.4,
  ui_button_attack: 1,
});

/**
 * "prefix" + zero-padded numbers -> file names.
 * @param {string} prefix
 * @param {number[]} nums
 * @param {number} [pad=2]
 * @returns {string[]}
 */
function seq(prefix, nums, pad = 2) {
  return nums.map((n) => prefix + String(n).padStart(pad, '0'));
}

/**
 * Game event -> original sound (file base name without .mp3) or a list of variants.
 * Every file in assets/orig/sfx is reachable from here (tests/audio.test.js checks both directions).
 * @type {Readonly<Record<string, string|string[]>>}
 */
export const NAMES = Object.freeze({
  /* ---- UI: buttons, navigation (the client's default button sound is ui_button_circular) ---- */
  button: 'ui_button_circular',
  tap: 'ui_button_circular',
  nav: 'ui_button_circular',
  tab: 'ui_button_switch',
  toggle: 'ui_button_switch',
  map: 'ui_button_map',
  card: 'ui_button_card',
  cardShow: 'ui_button_card_showup',
  cardClose: 'ui_button_card_close',
  confirm: 'ui_button_start',
  start: 'ui_button_start',
  attack: 'ui_button_attack',
  deckSelect: 'ui_button_deckselect_click',
  deckSwipe: 'ui_button_deckselect_swipe',
  tick: 'ui_decksetup_slotselect',
  /* ---- deck editing (drag and drop on the pre-battle and Deck screens) ---- */
  cardTake: 'ui_decksetup_card_take',
  cardPlace: 'ui_decksetup_card_place',
  cardRemove: 'ui_decksetup_card_remove',
  deckFinished: 'ui_decksetup_card_place_deckfinished',
  slotSelect: 'ui_decksetup_slotselect',
  /* ---- player, cards, unlocks ---- */
  potion: 'ui_use_potion',
  unlock: 'ui_unlock',
  slotUnlock: 'ui_slot_unlock_anim',
  levelUp: 'quest_reward_levelup',
  cardLevelUp: 'ui_card_level_up',
  cardXp: ['ui_card_xpgain1', 'ui_card_xpgain2', 'ui_card_xpgain4'],
  albumShine: seq('ui_album_shine_', [1, 2, 3]),
  trainStart: 'ui_decksetup_card_enhance_pt0',
  train: 'card_enhancenew_pt2d',
  trainSkip: 'card_enhancenew_skip2',
  fuse: 'card_evolvenew_pt2',
  assemble: 'card_assemble',
  assembled: 'card_assemblenew_pt2b',
  fanfare: 'card_assemblenew_pt2b',
  gremlin: 'fight_curse',
  /* ---- quest ---- */
  questStart: 'quest_start',
  questVictory: 'quest_victory',
  enemyShow: seq('quest_enemy_showup_', [1, 2, 3, 4]),
  enemyDestroy: seq('quest_enemy_destroy_', [2, 3, 4, 7]),
  enemyDestroyDemon: seq('quest_enemy_destroy_demon_', [1, 2, 4, 5]),
  enemyDestroyDragon: seq('quest_enemy_destroy_dragon_', [1, 3, 4]),
  enemyDestroyDwarf: seq('quest_enemy_destroy_dwarf_', [1, 2, 3, 5]),
  enemyDestroyElf: seq('quest_enemy_destroy_elf_', [1, 2, 4, 5, 6]),
  enemyDestroyGhost: seq('quest_enemy_destroy_ghostlight_', [2, 3, 4, 5]),
  enemyDestroyOrc: seq('quest_enemy_destroy_orc_', [1, 2, 3, 4]),
  enemyDestroySkeleton: seq('quest_enemy_destroy_skeletor_', [1, 2, 3]),
  reward: 'quest_reward_collect',
  rewardGold: 'quest_reward_gold',
  rewardCard: 'quest_reward_card',
  rewardCardAutosell: 'quest_reward_card_autosell',
  rewardGem: 'quest_reward_gem',
  gems: 'quest_reward_gem',
  rewardPotion: 'quest_reward_potion',
  rewardToken: 'quest_reward_token',
  rewardShine: 'quest_reward_shine',
  levelUpGold: 'levelup_reward_gold',
  /* ---- shop, boosters, selling ---- */
  open: 'shop_open',
  shopOpen: 'shop_open',
  buy: 'shop_buy_gems',
  buyGold: 'shop_buy_gold',
  buyGems: 'shop_buy_gems',
  buyPotions: 'shop_buy_potions',
  buyTokens: 'shop_buy_tokens',
  buyCard: 'shop_buy_card',
  buyBig: 'shop_buy_big',
  buyStart: 'shop_buy_start',
  sell: 'shop_buy_gold',
  boosterOpen: 'booster_open',
  flip: 'shop_draw_card',
  take: 'shop_card_collect',
  shuffle: ['shop_shuffle_cards1', 'shop_shuffle_cards2', 'shop_shuffle_cards3'],
  reroll: 'shop_shuffle_cards1',
  /* ---- battle (the battle screen also plays the attack families directly by file name) ---- */
  victory: 'fight_victory_msx',
  defeat: 'fight_defeat_msx',
  nextRound: 'fight_nextround',
  death: ['fight_card_death_1', 'fight_card_death_2', 'fight_card_death_5'],
  heal: ['fight_card_heal_1', 'fight_card_heal_2', 'fight_card_heal_3'],
  healAffect: ['fight_card_heal_affect_1', 'fight_card_heal_affect_2', 'fight_card_heal_affect_3'],
  curse: 'fight_curse',
  curseAffect: 'fight_curse_affect',
  invulnerable: 'fight_invulnerability',
  raiseAttack: 'fight_raiseattack',
  resurrect: 'fight_resurrect',
  reflect: ['fight_shot_reflect1', 'fight_shot_reflect2', 'fight_shot_reflect3'],
  bonus: 'fight_bonus',
  fightRewardCard: 'fight_reward_card',
  lightningLong: 'lightning_long',
  lightningShort: 'lightning_short',
  transition: 'metallic_transition',
  attackerArcane: seq('anim_attack_attacker_arcane_', [1, 2, 3]),
  attackerBlood: seq('anim_attack_attacker_blood_', [1, 2, 3]),
  attackerClaws: seq('anim_attack_attacker_claws_', [1, 2]),
  attackerCurse: seq('anim_attack_attacker_curse_', [1, 2, 3]),
  attackerHoly: seq('anim_attack_attacker_holy_', [1]),
  attackerPoison: seq('anim_attack_attacker_poison_', [1, 2]),
  attackerStrongHit: seq('anim_attack_attacker_stronghit_', [1]),
  attackerSword: seq('anim_attack_attacker_sword_', [1, 2]),
  attackerWhirlwind: seq('anim_attack_attacker_whirlwind_', [1]),
  missile: seq('anim_attack_missile_', [1, 2, 3]),
  missileFire: seq('anim_attack_missile_fire_', [1, 2, 3]),
  missileFlash: seq('anim_attack_missile_flash_', [1, 2, 3]),
  missileIce: seq('anim_attack_missile_ice_', [1, 2, 3]),
  missileShadow: seq('anim_attack_missile_shadow_', [1, 2, 3]),
  missileShot: seq('anim_attack_missile_shot_', [1, 2, 3]),
  hit: seq('anim_attack_target_', [1, 2, 3]),
  hitArcane: seq('anim_attack_target_arcane_', [1, 2]),
  hitBlood: seq('anim_attack_target_blood_', [1, 2, 3]),
  hitClaws: seq('anim_attack_target_claws_', [1, 2]),
  hitCurse: seq('anim_attack_target_curse_', [1, 2, 3]),
  hitFire: seq('anim_attack_target_fire_', [1, 2]),
  hitFlash: seq('anim_attack_target_flash_', [1, 2]),
  hitHoly: seq('anim_attack_target_holy_', [1]),
  hitHpBar: seq('anim_attack_target_hpbar_', [1, 2, 3]),
  hitIce: seq('anim_attack_target_ice_', [1, 2]),
  hitPoison: seq('anim_attack_target_poison_', [1, 2]),
  hitShadow: seq('anim_attack_target_shadow_', [1]),
  hitShot: seq('anim_attack_target_shot_', [1, 2]),
  hitStrongHit: seq('anim_attack_target_stronghit_', [1, 2, 3]),
  hitWhirlwind: seq('anim_attack_target_whirlwind_', [1]),
  /* ---- music and ambience ---- */
  musicTitle: 'music_intro',
  musicIntro1: 'music_introvideo_part1',
  musicIntro1End: 'music_introvideo_part1end',
  musicIntro2: 'music_introvideo_part2',
  musicBoss: 'music_bossannounce',
  musicShop: 'music_buybooster',
  musicFight: ['music_fight_cue1', 'music_fight_cue2'],
  atmoMenu: 'atmo_menu',
  atmoMap: 'atmo_map_far',
  atmoFight: 'atmo_fight',
  atmoQuest: ['atmo_ambient_cue1', 'atmo_ambient_cue2', 'atmo_ambient_cue3', 'atmo_ambient_cue4'],
  silence: 'silence',
});

/** Every original file name reachable from NAMES (= the content of assets/orig/sfx). */
export const FILES = Object.freeze(Array.from(new Set(Object.values(NAMES).flat())).sort());
const KNOWN = new Set(FILES);

/**
 * Resolve an event alias or an original file name to a file base name (null when unknown).
 * @param {string} name
 * @param {() => number} [random]  picks the variant of an array entry (default Math.random)
 * @returns {string|null}
 */
export function resolveName(name, random = Math.random) {
  if (typeof name !== 'string' || !name) return null;
  const mapped = Object.prototype.hasOwnProperty.call(NAMES, name) ? NAMES[name] : null;
  if (Array.isArray(mapped)) {
    const i = Math.min(mapped.length - 1, Math.max(0, Math.floor(random() * mapped.length)));
    return mapped[i];
  }
  if (typeof mapped === 'string') return mapped;
  const base = name.endsWith('.mp3') ? name.slice(0, -4) : name;
  return KNOWN.has(base) ? base : null;
}

/**
 * Settings -> {on, music, fx} with clamped volumes (missing fields: on, 0.7, 1).
 * @param {object|null|undefined} settings
 * @returns {{on: boolean, music: number, fx: number}}
 */
export function readVolumes(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);
  return { on: s.sound === undefined ? true : Boolean(s.sound), music: num(s.musicVolume, 0.7), fx: num(s.fxVolume, 1) };
}

/**
 * Final element volume: master off -> 0; else channel volume x per-file gain x per-call factor, clamped to 0..1.
 * @param {{on: boolean, music: number, fx: number}} vol
 * @param {'music'|'fx'} channel
 * @param {string} file
 * @param {number} [factor=1]
 * @returns {number}
 */
export function effectiveVolume(vol, channel, file, factor = 1) {
  if (!vol || !vol.on) return 0;
  const chan = channel === 'music' ? vol.music : vol.fx;
  const gain = Object.prototype.hasOwnProperty.call(GAIN, file) ? GAIN[file] : 1;
  const f = typeof factor === 'number' && Number.isFinite(factor) ? factor : 1;
  const v = chan * gain * f;
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

/**
 * Which music a screen plays: `{name, loop, next}` to switch, null to leave the current music alone
 * (battle: the battle screen sets music_fight_cue1/2 itself; prebattle/booster/help keep what plays).
 * The quest ambience is one of the four cues chosen per quest (stable for a given line + number).
 * @param {string} id  screen id
 * @param {object} [params]
 * @returns {{name: string, loop: boolean, next?: string, fade?: number}|null}
 */
export function screenMusic(id, params = {}) {
  switch (id) {
    case 'title': return { name: 'music_intro', loop: true };
    case 'quest-map': return { name: 'atmo_map_far', loop: true };
    case 'quest': {
      const line = String((params && params.line) || 'main');
      let hsh = 0;
      for (let i = 0; i < line.length; i++) hsh = (hsh * 31 + line.charCodeAt(i)) >>> 0;
      const n = Math.max(1, Number(params && params.quest) || 1);
      return { name: NAMES.atmoQuest[(hsh + n - 1) % NAMES.atmoQuest.length], loop: true };
    }
    case 'boss-intro': return { name: 'music_bossannounce', loop: false, fade: 0 };
    case 'shop': return { name: 'music_buybooster', loop: false, next: 'atmo_menu' };
    case 'arena': case 'league': case 'cards': case 'card-detail': case 'collections': case 'character':
      return { name: 'atmo_menu', loop: true };
    default: return null;
  }
}

/** Click targets -> button sound (first match wins; null = the screen plays its own sound). */
const CLICK_SOUNDS = [
  ['.attack-btn, .no-sfx', null],
  ['.nav-btn', 'ui_button_circular'],
  ['.qm-node', 'ui_button_map'],
  ['.tab, .toggle, .speed-btn', 'ui_button_switch'],
  ['.card.interactive, .avatar-choice, .profile-avatar', 'ui_button_card'],
  ['.dialog-close', 'ui_button_card_close'],
  ['.btn, .hud-plus, .hud-res', 'ui_button_circular'],
];

/**
 * The HUD / nav / button click sound for a clicked element (delegated listener in src/app.js), so screens
 * need no code for the standard taps. An element (or ancestor) with `data-sfx="name"` plays that sound
 * instead (`data-sfx="none"` for silence); disabled buttons are silent.
 * @param {Element|null} target
 * @returns {string|null}
 */
export function soundForClick(target) {
  if (!target || typeof target.closest !== 'function') return null;
  const custom = target.closest('[data-sfx]');
  if (custom) {
    const v = custom.dataset && custom.dataset.sfx;
    return !v || v === 'none' ? null : v;
  }
  for (const [selector, sound] of CLICK_SOUNDS) {
    const el = target.closest(selector);
    if (!el) continue;
    if (el.disabled || (el.classList && el.classList.contains('disabled'))) return null;
    return sound;
  }
  return null;
}

/**
 * Sounds implied by a save change (store subscription in src/app.js): drinking a potion refills a bar and
 * removes a potion, buying one spends gems and refills a bar. A different save (new game, import) is ignored.
 * @param {object|null} prev
 * @param {object|null} next
 * @returns {string[]}
 */
export function diffSounds(prev, next) {
  if (!prev || !next || !prev.player || !next.player) return [];
  if (prev.createdAt !== next.createdAt || prev.seed !== next.seed) return [];
  const p = prev.player;
  const n = next.player;
  const out = [];
  const drank = (n.staminaPotions | 0) < (p.staminaPotions | 0) || (n.manaPotions | 0) < (p.manaPotions | 0);
  const bought = (n.gems | 0) < (p.gems | 0) && (n.stamina > p.stamina || n.mana > p.mana)
    && (n.staminaPotions | 0) === (p.staminaPotions | 0) && (n.manaPotions | 0) === (p.manaPotions | 0);
  if (drank || bought) out.push('ui_use_potion');
  return out;
}

/** Titles of the feature-unlock popups ("Arena Unlocked!"). */
export function isUnlockTitle(title) {
  return typeof title === 'string' && /unlocked!?$/i.test(title.trim());
}

const DEFAULT_FADE = 700;
const FADE_STEP = 50;
const MIN_REPEAT_MS = 60;

/**
 * @typedef {object} AudioOptions
 * @property {string} [base='/assets/orig/sfx/']  URL prefix of the files
 * @property {() => object} [getSettings]  returns the save's settings (sound, musicVolume, fxVolume)
 * @property {number} [maxConcurrent=8]  cap of simultaneously playing sound effects (the oldest is choked)
 * @property {any} [Audio]  constructor (default window.Audio); tests pass a fake
 * @property {EventTarget} [doc]  where unlock() listens (default document)
 * @property {() => number} [random]
 * @property {() => number} [now]
 * @property {{setInterval: Function, clearInterval: Function, setTimeout: Function, clearTimeout: Function}} [timers]
 */

/**
 * Create the audio player.
 * @param {AudioOptions} [opts]
 */
export function createAudio(opts = {}) {
  const base = opts.base || '/assets/orig/sfx/';
  const getSettings = typeof opts.getSettings === 'function' ? opts.getSettings : () => null;
  const maxConcurrent = Math.max(1, opts.maxConcurrent | 0 || 8);
  const AudioCtor = opts.Audio || (typeof Audio !== 'undefined' ? Audio : null);
  const doc = opts.doc || (typeof document !== 'undefined' ? document : null);
  const random = opts.random || Math.random;
  const now = opts.now || (() => Date.now());
  const timers = opts.timers || {
    setInterval: (f, ms) => setInterval(f, ms), clearInterval: (t) => clearInterval(t),
    setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t),
  };

  /** @type {Map<string, {free: any[], all: any[]}>} */
  const pools = new Map();
  /** @type {Set<{el: any, file: string, at: number}>} */
  const playing = new Set();
  /** @type {Map<string, number>} */
  const lastPlay = new Map();
  const missing = new Set();
  /** @type {object|null} override of getSettings() until the next refresh() */
  let override = null;
  /** @type {{file: string, name: string, el: any, factor: number, opts: object, fade: any, ending: boolean}|null} */
  let cur = null;
  /** @type {{name: string, opts: object}|null} music requested before the first gesture */
  let pending = null;
  let unlocked = false;
  let listening = false;

  const url = (file) => base + file + '.mp3';
  const volumes = () => readVolumes(override || getSettings());

  function make(file) {
    const el = new AudioCtor(url(file));
    el.preload = 'auto';
    if (typeof el.addEventListener === 'function') {
      el.addEventListener('error', () => { missing.add(file); drop(el); });
    }
    return el;
  }

  function pool(file) {
    let p = pools.get(file);
    if (!p) { p = { free: [], all: [] }; pools.set(file, p); }
    return p;
  }

  /** Forget an element whose file failed to load. */
  function drop(el) {
    for (const entry of playing) if (entry.el === el) playing.delete(entry);
    for (const p of pools.values()) {
      p.free = p.free.filter((e) => e !== el);
      p.all = p.all.filter((e) => e !== el);
    }
    if (cur && cur.el === el) { stopMusicNow(); }
  }

  function release(entry) {
    if (!playing.has(entry)) return;
    playing.delete(entry);
    const p = pool(entry.file);
    if (!p.free.includes(entry.el)) p.free.push(entry.el);
  }

  function stopEntry(entry) {
    try { entry.el.pause(); } catch (err) { /* ignore */ }
    release(entry);
  }

  /**
   * Play a sound effect.
   * @param {string} name  event alias (NAMES) or original file name
   * @param {{volume?: number, rate?: number}} [o]
   * @returns {boolean} whether it started
   */
  function sfx(name, o = {}) {
    if (!AudioCtor) return false;
    const file = resolveName(name, random);
    if (!file || missing.has(file)) return false;
    const vol = volumes();
    const level = effectiveVolume(vol, 'fx', file, o.volume);
    if (level <= 0) return false;
    const t = now();
    if (t - (lastPlay.has(file) ? lastPlay.get(file) : -Infinity) < MIN_REPEAT_MS) return false;
    lastPlay.set(file, t);
    const p = pool(file);
    let el = p.free.pop();
    if (!el && playing.size >= maxConcurrent) {
      // Cap reached: choke the oldest effect (its element goes back to its pool, so a same-file play reuses it).
      let oldest = null;
      for (const e of playing) if (!oldest || e.at < oldest.at) oldest = e;
      if (oldest) stopEntry(oldest);
      el = p.free.pop();
    }
    if (!el) {
      el = make(file);
      p.all.push(el);
      const onEnded = () => { const e = el._entry; if (e) release(e); };
      if (typeof el.addEventListener === 'function') el.addEventListener('ended', onEnded);
    }
    const entry = { el, file, at: t };
    el._entry = entry;
    el.volume = level;
    el.playbackRate = typeof o.rate === 'number' && o.rate > 0 ? o.rate : 1;
    try { el.currentTime = 0; } catch (err) { /* not loaded yet */ }
    playing.add(entry);
    let promise;
    try { promise = el.play(); } catch (err) { release(entry); return false; }
    if (promise && typeof promise.catch === 'function') promise.catch(() => release(entry));
    return true;
  }

  function musicTarget(entry) {
    return effectiveVolume(volumes(), 'music', entry.file, entry.factor);
  }

  function clearFade(entry) {
    if (entry && entry.fade) { timers.clearInterval(entry.fade); entry.fade = null; }
  }

  /** Fade an element to `to` over `ms`, then call `done`. */
  function fade(entry, from, toFn, ms, done) {
    clearFade(entry);
    if (!ms || ms <= 0) { entry.el.volume = toFn(); if (done) done(); return; }
    const steps = Math.max(1, Math.ceil(ms / FADE_STEP));
    let i = 0;
    entry.el.volume = from;
    entry.fade = timers.setInterval(() => {
      i++;
      const to = toFn();
      const v = from + (to - from) * Math.min(1, i / steps);
      entry.el.volume = Math.max(0, Math.min(1, v));
      if (i >= steps) { clearFade(entry); if (done) done(); }
    }, FADE_STEP);
  }

  function stopMusicNow() {
    if (!cur) return;
    const entry = cur;
    cur = null;
    clearFade(entry);
    try { entry.el.pause(); } catch (err) { /* ignore */ }
  }

  function fadeOutAndStop(entry, ms) {
    entry.ending = true;
    const start = typeof entry.el.volume === 'number' ? entry.el.volume : 1;
    fade(entry, start, () => 0, ms, () => { try { entry.el.pause(); } catch (err) { /* ignore */ } });
  }

  /**
   * Play (or switch to) a music track with a crossfade; `null` fades the music out.
   * @param {string|null} name  alias or file name
   * @param {{loop?: boolean, fade?: number, volume?: number, next?: string|(() => string), gap?: number}} [o]
   *   loop: default true; fade: ms (default 700); next: track to start when a one-shot ends; gap: ms before it
   * @returns {boolean} whether a new track started
   */
  function music(name, o = {}) {
    if (!AudioCtor) return false;
    const file = name == null ? null : resolveName(name, random);
    if (name != null && !file) return false;
    const ms = o.fade == null ? DEFAULT_FADE : Math.max(0, o.fade | 0);
    if (file && cur && cur.file === file && !cur.ending) {
      cur.el.loop = o.loop !== false;
      cur.factor = typeof o.volume === 'number' ? o.volume : 1;
      cur.opts = o;
      if (!cur.fade) cur.el.volume = musicTarget(cur);
      return false;
    }
    if (cur) { const old = cur; cur = null; fadeOutAndStop(old, ms); }
    pending = null;
    if (!file || missing.has(file)) return false;
    const el = make(file);
    el.loop = o.loop !== false;
    const entry = { file, name: String(name), el, factor: typeof o.volume === 'number' ? o.volume : 1, opts: o, fade: null, ending: false };
    cur = entry;
    try { el.currentTime = 0; } catch (err) { /* ignore */ }
    if (typeof el.addEventListener === 'function') {
      el.addEventListener('ended', () => onMusicEnded(entry));
    }
    let promise;
    try { promise = el.play(); } catch (err) { promise = Promise.reject(err); }
    if (promise && typeof promise.catch === 'function') {
      promise.catch(() => {
        // Autoplay refused (no gesture yet): remember it for unlock().
        if (cur === entry) { cur = null; clearFade(entry); pending = { name: entry.name, opts: o }; }
      });
    }
    fade(entry, 0, () => musicTarget(entry), ms);
    return true;
  }

  function onMusicEnded(entry) {
    if (cur !== entry || entry.el.loop) return;
    cur = null;
    clearFade(entry);
    const next = entry.opts && entry.opts.next;
    if (!next) return;
    const start = () => { if (!cur) music(typeof next === 'function' ? next() : next, { fade: 800 }); };
    const gap = entry.opts.gap | 0;
    if (gap > 0) timers.setTimeout(start, gap); else start();
  }

  /** Stop the music at once and every playing sound effect. */
  function stopAll() {
    stopMusicNow();
    pending = null;
    for (const entry of Array.from(playing)) stopEntry(entry);
  }

  /**
   * Apply volumes right away (the Settings sliders call this while dragging); the store's values take over
   * again at the next refresh().
   * @param {number} musicVolume 0..1
   * @param {number} fxVolume 0..1
   * @param {boolean} [on]  master switch (default: keep the setting)
   */
  function setVolumes(musicVolume, fxVolume, on) {
    const base = readVolumes(getSettings());
    override = {
      sound: on === undefined ? base.on : Boolean(on),
      musicVolume: typeof musicVolume === 'number' ? musicVolume : base.music,
      fxVolume: typeof fxVolume === 'number' ? fxVolume : base.fx,
    };
    applyMusicVolume();
  }

  /** Drop the setVolumes() override and re-apply the settings to the playing music. */
  function refresh() {
    override = null;
    applyMusicVolume();
  }

  function applyMusicVolume() {
    if (!cur || cur.fade || cur.ending) return;
    cur.el.volume = musicTarget(cur);
  }

  /**
   * Resume on the first pointerdown / keydown / touchstart (browser autoplay policy): the music requested
   * before the gesture starts then. Safe to call more than once.
   */
  function unlock() {
    if (!doc || listening || unlocked) return;
    listening = true;
    const events = ['pointerdown', 'keydown', 'touchstart'];
    const on = () => {
      unlocked = true;
      for (const ev of events) doc.removeEventListener(ev, on, true);
      if (pending) { const p = pending; pending = null; music(p.name, p.opts); }
    };
    for (const ev of events) doc.addEventListener(ev, on, true);
  }

  /**
   * Create (and start loading) one pooled element per name so the first play has no delay.
   * @param {string[]} names
   * @returns {number} elements created
   */
  function preload(names) {
    if (!AudioCtor) return 0;
    let n = 0;
    for (const name of names || []) {
      const file = resolveName(name, random);
      if (!file || missing.has(file)) continue;
      const p = pool(file);
      if (p.all.length) continue;
      const el = make(file);
      if (typeof el.addEventListener === 'function') el.addEventListener('ended', () => { const e = el._entry; if (e) release(e); });
      if (typeof el.load === 'function') { try { el.load(); } catch (err) { /* ignore */ } }
      p.all.push(el);
      p.free.push(el);
      n++;
    }
    return n;
  }

  /** Debug / test view. */
  function state() {
    return {
      unlocked,
      music: cur ? cur.name : null,
      musicFile: cur ? cur.file : null,
      pending: pending ? pending.name : null,
      playing: playing.size,
      pooled: Array.from(pools.values()).reduce((s, p) => s + p.all.length, 0),
      missing: Array.from(missing),
      volumes: volumes(),
    };
  }

  return { sfx, music, stopAll, unlock, setVolumes, refresh, preload, state, resolve: (name) => resolveName(name, random) };
}
