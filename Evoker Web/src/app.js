'use strict';
/**
 * Boot: loads the data, builds the deps bundle, restores the save, creates the stage, the store, the
 * chrome, the audio player and the router, and renders the first screen. The game's clock comes from here
 * (`now`, passed to the store and to the screens as ctx.now); UI code reads Date.now() only for its own timing.
 *
 * Audio wiring (src/ui/audio.js, docs/dev/audio.md): ctx.sfx(name) / ctx.music(name) for the screens, one
 * delegated click listener on the stage for the HUD / nav / button sounds, the screen -> music table applied
 * on every navigation, the unlock / level-up popup sounds through the ctx.ui wrappers and the potion sound
 * from the save diff.
 */
import { createCardsDb } from './core/cards-db.js';
import * as stats from './core/stats.js';
import * as abilities from './core/abilities.js';
import { mulberry32 } from './core/rng.js';
import { simulateBattle } from './engine/battle.js';
import { buildSide } from './engine/battle-state.js';
import { SAVE_KEY, newGame, touch, utcDay, updatePlayer, pruneRemoved } from './game/state.js';
import { applyRegen, addGold, addGems, addPotions, addTokens, REGEN_MS, eventClock } from './game/player.js';
import { addCard, capFor } from './game/collection.js';
import { dailyRaids } from './game/pieces.js';
import { settleLeague } from './game/league.js';
import { dailyEvent, claimDaily } from './game/shop.js';
import { setUiRoot } from './ui/dom.js';
import { createRouter } from './ui/router.js';
import { createStage } from './ui/components/stage.js';
import { dialog } from './ui/components/dialog.js';
import { toast, clearToasts } from './ui/components/toast.js';
import { showLevelUp } from './ui/components/popup-levelup.js';
import { showUnlockPopups } from './ui/components/popup-unlock.js';
import { createCountdown } from './ui/components/countdown.js';
import { createDragDrop } from './ui/components/drag-drop.js';
import { cardView, defView, battleView, artUrlFor } from './ui/card-view.js';
import { createStore, parseSave, serializeSave, addDays as shiftDays, navScreen, seedFromNow } from './ui/store.js';
import { createChrome } from './ui/chrome.js';
import { screens } from './ui/screens/index.js';
import { dailyRewardIcons } from './ui/screens/daily-view.js';
import { createAudio, screenMusic, soundForClick, diffSounds, isUnlockTitle } from './ui/audio.js';

export const VERSION = '1.0.0';

/** @returns {number} */
const now = () => Date.now();

/** Audio settings before a save exists (the title music plays on the first visit). */
const DEFAULT_AUDIO_SETTINGS = Object.freeze({ sound: true, musicVolume: 0.7, fxVolume: 1 });

/** Sounds the first screens need without a load delay. */
const PRELOAD_SFX = ['ui_button_circular', 'ui_button_switch', 'ui_button_map', 'ui_button_card', 'ui_button_card_close', 'ui_use_potion', 'ui_unlock', 'quest_reward_levelup', 'ui_card_level_up'];

/**
 * Fetch and parse a JSON file.
 * @param {string} url
 * @returns {Promise<any>}
 */
async function loadJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/**
 * Read the save from localStorage (null when absent or corrupt).
 * @returns {object|null}
 */
function readSave() {
  try { return parseSave(localStorage.getItem(SAVE_KEY), now()); } catch (err) { return null; }
}

/**
 * Write the save to localStorage.
 * @param {object} state
 */
function writeSave(state) {
  try { localStorage.setItem(SAVE_KEY, serializeSave(state, now())); } catch (err) { console.warn('autosave failed', err); }
}

/**
 * Things that happen when a save is (re)opened: regen, daily reward, league settlement, piece raids.
 * Pure: returns the new state and the notices to show.
 * @param {object} state
 * @param {object} deps
 * @param {number} t
 * @returns {{state: object, notices: object[]}}
 */
export function onOpen(state, deps, t) {
  let s = applyRegen(state, t);
  const notices = [];
  const daily = claimDaily(s, t);
  s = daily.state;
  if (daily.claimed) notices.push({ type: 'daily', ...daily.reward });
  const league = s.sim && s.sim.league;
  if (league && !league.settled && league.day !== utcDay(t)) {
    const r = settleLeague(s, league, deps);
    s = r.state;
  }
  const raids = dailyRaids(s, deps, t);
  s = raids.state;
  for (const n of s.notices || []) notices.push(n);
  s = { ...s, notices: [] };
  return { state: touch(s, t), notices };
}

/**
 * Human text for a login notice.
 * @param {object} n
 * @param {object} db
 * @returns {{text: string, icon: string}|null}
 */
function noticeText(n, db) {
  const name = (id) => ((db.get(id) || {}).name || id);
  switch (n.type) {
    case 'daily': {
      const parts = [];
      if (n.gems) parts.push(`${n.gems} gems`);
      if (n.stamina) parts.push(`${n.stamina} stamina potion${n.stamina > 1 ? 's' : ''}`);
      if (n.mana) parts.push(`${n.mana} mana potion${n.mana > 1 ? 's' : ''}`);
      if (n.tokens) parts.push(`${n.count || 1} ${n.tokens} token${(n.count || 1) > 1 ? 's' : ''}`);
      return { text: `Daily reward (day ${n.day}): ${parts.join(', ')}`, icon: dailyNoticeIcon(n) };
    }
    case 'league': return { text: `League finished: rank ${n.rank}` + (n.cardId ? `, ${name(n.cardId)}` : '') + (n.gems ? `, ${n.gems} gems` : '') + (n.potions && n.potions.length ? `, ${n.potions.length} potion${n.potions.length > 1 ? 's' : ''}` : ''), icon: 'trophy' };
    case 'raid': return { text: `A piece of ${name(n.cardId)} was stolen!`, icon: 'skull' };
    default: return null;
  }
}

/** Toast icon of a daily reward: the reward's own kind (gems, potions, the pack's token), not always the gem. */
function dailyNoticeIcon(n) {
  const first = dailyRewardIcons(n)[0];
  return first ? first.icon : 'gem';
}

/** Screens that re-render in place when a new UTC day starts while they are showing (new event, daily strip). */
export const NEW_DAY_RERENDER = Object.freeze(['quest-map', 'shop', 'arena', 'league']);

async function boot() {
  const appEl = document.getElementById('app');
  const [cardsJson, quests, names] = await Promise.all([loadJson('/data/cards.json'), loadJson('/data/quests.json'), loadJson('/data/names.json')]);
  const db = createCardsDb(cardsJson);
  const deps = { db, stats, engine: { simulateBattle, buildSide }, rng: mulberry32, quests, names, abilities };

  const stage = createStage(appEl);
  setUiRoot(stage.el);

  const store = createStore({ state: readSave(), deps, now, save: writeSave });
  const app = { store, deps, goTop };
  const chrome = createChrome(app);
  store.subscribe(() => chrome.refresh());

  // Audio: settings come from the save (or the defaults before one exists); the first pointerdown / keydown
  // unlocks playback (browser autoplay policy) and starts the music requested before it.
  const audio = createAudio({
    base: '/assets/orig/sfx/',
    getSettings: () => { const s = store.get(); return s && s.settings ? s.settings : DEFAULT_AUDIO_SETTINGS; },
  });
  audio.unlock();
  audio.preload(PRELOAD_SFX);
  // HUD / nav / button clicks: ui_button_circular for buttons and the nav, ui_button_map for map nodes,
  // ui_button_card for cards, ui_button_switch for tabs and toggles (capture phase, so screens need no code).
  stage.el.addEventListener('click', (ev) => {
    const name = soundForClick(ev.target instanceof Element ? ev.target : null);
    if (name) audio.sfx(name);
  }, true);
  // Potion drunk or bought (any path: HUD bars, quest, pre-battle) -> ui_use_potion; re-apply the volumes
  // after every change so the Settings sliders and imports take effect on the playing music.
  let prevState = store.get();
  store.subscribe((s) => {
    for (const name of diffSounds(prevState, s)) audio.sfx(name);
    prevState = s;
    audio.refresh();
  });
  // Popups: feature unlocks ("Arena Unlocked!") -> ui_unlock; the player level-up dialog plays
  // quest_reward_levelup itself.
  const uiDialog = { ...dialog, alert: (o) => { if (o && isUnlockTitle(o.title)) audio.sfx('ui_unlock'); return dialog.alert(o); } };
  const sfx = (name) => audio.sfx(name);
  /** Unlock popups (view_unlocked_feature_popup) for feature ids or popup objects, remembered as seen. */
  const uiShowUnlocks = (list, o = {}) => showUnlockPopups(list, { store, sfx, ...o });
  /**
   * Level-ups: a levelUpDetails entry, a level or an array of them = the player level-up dialog(s) (comp_levelup),
   * which spend the stat points through the store and are followed by the level's unlock popups.
   */
  const uiShowLevelUp = (arg, o = {}) => showLevelUp(arg, { store, sfx, onUnlocked: (features) => uiShowUnlocks(features), ...o });
  /** One player level-up (battle-result.js showPlayerLevelUps passes {index, count} for multi-level jumps). */
  const uiShowPlayerLevelUp = (levelOrDetail, seq = {}) => uiShowLevelUp(levelOrDetail, { index: seq.index, count: seq.count });

  const ui = {
    dialog: uiDialog, toast, showLevelUp: uiShowLevelUp, showPlayerLevelUp: uiShowPlayerLevelUp, showUnlocks: uiShowUnlocks,
    createCountdown, createDragDrop, stage,
  };
  const view = { cardView, defView, battleView, artUrlFor };

  /** @type {ReturnType<typeof createRouter>} */
  let router;
  /** goTop pushes two screens in a row: hold the music switch until the final one. */
  let musicHold = false;

  /**
   * Switch the music to the current screen's track (src/ui/audio.js screenMusic); screens without an entry
   * (battle, pre-battle, booster opening, help) keep whatever plays.
   * @param {{id: string, params: object}|null} entry
   */
  function applyScreenMusic(entry) {
    if (musicHold || !entry) return;
    const m = screenMusic(entry.id, entry.params);
    if (m) audio.music(m.name, m);
  }

  /**
   * Jump to one of the six nav screens: the stack becomes ['quest-map'] or ['quest-map', screen].
   * @param {string} id  nav id or screen id
   * @param {object} [params]
   */
  async function goTop(id, params = {}) {
    const target = navScreen(id);
    if (router.busy) return;
    dialog.closeAll();
    musicHold = true;
    try {
      if (target === 'quest-map') {
        const cur = router.current();
        // Same map already at the bottom of the stack: refresh in place. A different line (a portal map) is
        // replaced by the requested one, so the nav button always returns to the main map.
        const sameParams = cur && JSON.stringify(cur.params || {}) === JSON.stringify(params || {});
        if (cur && cur.id === 'quest-map' && router.depth === 1 && sameParams) { await router.rerender(); return; }
        router.reset();
        await router.go('quest-map', params, { transition: 'fade' });
        return;
      }
      router.reset();
      await router.go('quest-map', {}, { transition: 'none' });
      await router.go(target, params, { transition: 'fade' });
    } finally {
      musicHold = false;
      applyScreenMusic(router.current());
    }
  }

  function makeCtx(base) {
    const ctx = {
      ...base,
      goTop,
      store,
      deps,
      db,
      now,
      view,
      ui,
      // the daily event on the save's clock; none while the save's tutorial runs (shop.dailyEvent)
      event: () => { const s = store.get(); return dailyEvent(eventClock(s, now()), s); },
      sfx: (name, o) => audio.sfx(name, o),
      music: (name, o) => audio.music(name, o),
      audio,
    };
    ctx.chrome = {
      mount: (opts) => chrome.mount(ctx, opts),
      refresh: () => chrome.refresh(),
    };
    return ctx;
  }

  router = createRouter({ layer: stage.layer, screens, makeCtx, transition: 'fade' });
  router.onChange(applyScreenMusic);
  router.onChange(() => clearToasts({ olderThanMs: 1500 })); // stale toasts must not cover the next screen; one raised just before navigating survives
  // Escape = the current screen's own back handler (registered by chrome.mount on the screen root, so a
  // quest abandons itself exactly like its HUD arrow does); a disabled arrow (home screen) ignores it;
  // noChrome screens (title, battle, booster opening) decide for themselves through root._onBack.
  // Dialogs and popups handle their own Escape in the capture phase and stop propagation.
  window.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || ev.defaultPrevented || router.busy) return;
    const top = stage.layer.lastElementChild;
    if (!top) return;
    if (top._onBack === null) return;
    if (typeof top._onBack === 'function') { top._onBack(); return; }
    const screen = screens[top.dataset.screen];
    if (screen && screen.noChrome) return;
    router.back();
  });

  /** The daily-reward toast on screen: a newer claim replaces it instead of stacking under it. */
  let dailyToast = null;
  /** Show login notices as toasts (staggered); one daily-reward toast at a time. */
  function showNotices(notices) {
    notices.forEach((n, i) => {
      const t = noticeText(n, db);
      if (!t) return;
      setTimeout(() => {
        if (n.type === 'daily' && dailyToast) dailyToast.dismiss();
        const el = toast(t.text, { icon: t.icon, duration: 3200, className: n.type === 'daily' ? 'toast-daily' : undefined });
        if (n.type === 'daily') dailyToast = el;
      }, 600 + i * 900);
    });
  }

  /** Run the on-open hooks on the loaded save. */
  function openSave() {
    if (!store.get()) return;
    const r = onOpen(pruneRemoved(store.get(), deps), deps, now());
    store.set(r.state);
    showNotices(r.notices);
  }
  openSave();
  // A save created later (title screen name dialog, import, debug) gets the same treatment once.
  let hadSave = store.hasSave();
  store.subscribe((s) => { if (s && !hadSave) { hadSave = true; openSave(); } if (!s) hadSave = false; });

  // A new UTC day while the game stays open: the same on-open hooks as a login (daily reward, league
  // settlement, raids), then the screens with the day's event / daily strip re-render in place.
  let openDay = utcDay(now());
  setInterval(() => {
    const day = utcDay(now());
    if (day === openDay) return;
    const later = day > openDay; // a clock set back (tests, the OS) claims nothing
    openDay = day;
    if (!later) return;
    if (!store.get()) return;
    openSave();
    const cur = router.current();
    if (cur && NEW_DAY_RERENDER.includes(cur.id) && !dialog.isOpen()) router.rerender();
  }, 1000);

  // Regen every minute while open.
  setInterval(() => { if (store.get()) store.update((s, d, t) => applyRegen(s, t)); }, REGEN_MS);
  // Autosave when the tab goes away.
  const flush = () => { const s = store.get(); if (s) writeSave(touch(s, now())); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); else if (store.get()) store.update((s, d, t) => applyRegen(s, t)); });
  window.addEventListener('beforeunload', flush);
  window.addEventListener('pagehide', flush);

  // Debug API (architecture 8.5).
  const debug = {
    giveGold: (n) => store.update((s) => addGold(s, n)),
    giveGems: (n) => store.update((s) => addGems(s, n)),
    givePotions: (stamina = 0, mana = 0) => store.update((s) => addPotions(addPotions(s, 'stamina', stamina | 0), 'mana', mana | 0)),
    // kind: neophyte | summoner | archmage | portalLow | portalHigh (the portal kinds need portalId).
    giveTokens: (kind = 'neophyte', n = 1, portalId) => store.update((s) => addTokens(s, kind, n | 0, portalId)),
    setLevel: (n) => store.update((s) => updatePlayer(s, { level: Math.max(1, Math.min(200, n | 0)), xp: 0 })),
    addCard: (cardId, stageN = 0, level = 1) => {
      let uid = null;
      store.update((s, d) => { const r = addCard(s, d, cardId, { stage: stageN, level, force: true }); uid = r.uid; return r.state; });
      return uid;
    },
    // Every owned card to the level cap of its current stage (evolution stage unchanged).
    maxCards: () => store.update((s, d) => ({ ...s, cards: s.cards.map((c) => ({ ...c, level: capFor(d, d.db.get(c.cardId), c.stage), xp: 0 })) })),
    refill: () => store.update((s) => updatePlayer(s, { stamina: s.player.staminaMax, mana: s.player.manaMax })),
    unlockQuests: (n) => store.update((s) => ({ ...s, quests: { ...s.quests, main: { ...s.quests.main, unlocked: Math.max(s.quests.main.unlocked, Math.min(100, n | 0)) } } })),
    // Every quest line beaten, one ++++ max-level copy of every card not already owned at ++++,
    // and max mana raised to the costliest possible 5-card deck (then refilled).
    unlockAll: () => store.update((s, d) => {
      const lineDone = (line) => {
        const len = line.nodes.length;
        const all = line.nodes.map((q) => q.n);
        return { unlocked: len, done: len, firstWins: all };
      };
      const portals = { ...s.quests.portals };
      for (const line of d.quests.portals || []) portals[line.id] = { ...portals[line.id], ...lineDone(line) };
      const doneMain = d.quests.main.nodes.length - s.quests.main.done;
      let next = { ...s, quests: { ...s.quests, main: { ...s.quests.main, ...lineDone(d.quests.main) }, portals } };
      next = updatePlayer(next, { questsDone: s.player.questsDone + Math.max(0, doneMain) });
      const top = new Set(next.cards.filter((c) => c.stage === 4).map((c) => c.cardId));
      for (const def of d.db.all()) {
        if (top.has(def.id)) continue;
        next = addCard(next, d, def.id, { stage: 4, level: capFor(d, def, 4), force: true }).state;
      }
      const deckMana = d.db.all().map((c) => c.mana || 0).sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0);
      const manaMax = Math.max(next.player.manaMax, deckMana);
      return updatePlayer(next, { manaMax, mana: manaMax });
    }),
    // The save's dates move back by n days; the daily event follows through daily.dayShift (player.eventClock).
    addDays: (n) => {
      const s = shiftDays(store.get(), n);
      store.set({ ...s, daily: { ...s.daily, dayShift: (Number(s.daily.dayShift) || 0) + (Number(n) || 0) } });
      openSave();
      return store.get();
    },
    // Drop the in-memory save first, otherwise the beforeunload/pagehide flush writes it back before the reload.
    reset: () => { store.set(null); try { localStorage.removeItem(SAVE_KEY); } catch (err) { /* ignore */ } location.reload(); },
    newGame: (name = 'Evoker') => { store.set(newGame(name, seedFromNow(now()), now(), deps)); return store.get(); },
  };
  window.evoker = {
    store, router, deps, db, ui, view, chrome, audio,
    go: (id, params) => router.go(id, params),
    goTop,
    state: () => store.get(),
    version: VERSION,
    debug,
  };

  // ?lab opens the Card Lab (src/ui/screens/lab.js) instead of the title: a test screen for every card's behaviour
  const wantLab = typeof location !== 'undefined' && new URLSearchParams(location.search).has('lab');
  await router.go(wantLab ? 'lab' : 'title', {}, { transition: 'none' });
  document.body.dataset.ready = '1';
}

boot().catch((err) => {
  console.error(err);
  const el = document.createElement('pre');
  el.style.cssText = 'color:#f88;padding:20px;font:14px monospace;white-space:pre-wrap';
  el.textContent = 'Evoker failed to start: ' + (err && err.stack || err);
  document.body.appendChild(el);
});
