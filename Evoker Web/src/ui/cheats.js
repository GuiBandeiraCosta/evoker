'use strict';
/**
 * Console cheats - the "easter eggs" (user's request, 2026-10-12). Open the browser console (F12) and type
 * `cheats.help()`: every cheat is a plain function on `window.cheats` (also `window.evoker.cheats`). They are a
 * friendly layer over the debug API of app.js (architecture §8.5) and the pure game functions: everything goes
 * through `store.update`, so the save, the HUD and the open screen follow at once (the screen is re-rendered).
 * Nothing here is reachable from the game's own UI.
 */
import { updatePlayer } from '../game/state.js';
import { addGold, addGems, addPotions, STAT_POINTS_PER_LEVEL } from '../game/player.js';
import { addCard, capFor } from '../game/collection.js';
import { patchTutorial } from './tutorial/progress.js';
import { slugify } from '../core/cards-db.js';

/** "Unlimited": what the gold / gem cheats hand out when called without a number. */
export const PLENTY = 999999;
/** The potion cheat's default. */
export const MANY_POTIONS = 99;
/** God mode: stamina and mana maximum (both bars full at this). */
export const GOD_MAX = 999;

/** The cheats, in help() order: name, signature, what it does. */
export const CHEAT_LIST = Object.freeze([
  ['help', 'help()', 'this list'],
  ['gold', 'gold(n = 999999)', 'adds gold (unlimited money)'],
  ['gems', 'gems(n = 999999)', 'adds gems (unlimited gems)'],
  ['potions', 'potions(n = 99)', 'adds n stamina and n mana potions'],
  ['refill', 'refill()', 'stamina and mana back to full'],
  ['level', 'level(n)', 'sets the player level (1-200); levels gained bring their 12 stat points each'],
  ['card', "card('worm shaman', stage = 0, level = 1)", 'adds one card by name or id (stage 0-4 = base .. ++++); returns its uid'],
  ['allCards', 'allCards(stage = 4)', 'one copy of every card at that stage, at its level cap'],
  ['maxCards', 'maxCards()', 'every owned card to the level cap of its stage'],
  ['unlockAllLevels', 'unlockAllLevels()', 'opens every quest of the main line and of every portal'],
  ['skipTutorial', 'skipTutorial()', 'ends the first-session tutorial (the ranger stops guiding)'],
  ['days', 'days(n)', 'time travel: moves every clock in the save n days ahead (daily reward, league, raids)'],
  ['god', 'god()', 'all of the above: every quest beaten, every card maxed, level 200, stamina and mana 999/999, plenty of everything'],
  ['reset', 'reset()', 'wipes the save and reloads (no undo)'],
]);

/**
 * Find a card definition by id, by name (any case, spaces or dashes) or by a unique name prefix.
 * @param {{all: () => object[], get: (id: string) => object|undefined}} db
 * @param {string} query
 * @returns {object|null}
 */
export function findCard(db, query) {
  const q = String(query || '').trim();
  if (!q) return null;
  const direct = db.get(q) || db.get(slugify(q));
  if (direct) return direct;
  const needle = q.toLowerCase();
  const all = db.all();
  const exact = all.find((c) => String(c.name).toLowerCase() === needle);
  if (exact) return exact;
  const starts = all.filter((c) => String(c.name).toLowerCase().startsWith(needle));
  if (starts.length === 1) return starts[0];
  const inside = all.filter((c) => String(c.name).toLowerCase().includes(needle));
  return inside.length === 1 ? inside[0] : null;
}

/**
 * Build the cheats object.
 * @param {object} o
 * @param {{get: () => object|null, update: (fn: Function) => any}} o.store
 * @param {object} o.deps  the game deps (db, quests ...)
 * @param {{unlockAll?: Function, addDays?: Function, reset?: Function}} [o.debug]  app.js debug API for the big ones
 * @param {{rerender?: Function}} [o.router]  re-rendered after every cheat so the screen shows the change
 * @param {(msg: string, opts?: object) => void} [o.toast]
 * @param {(...args: any[]) => void} [o.log]  defaults to console.log
 * @returns {Record<string, Function>}
 */
export function createCheats({ store, deps, debug = {}, router = {}, toast = () => {}, log = (...a) => console.log(...a) }) {
  const db = deps.db;
  const needSave = () => {
    if (store.get()) return true;
    log('No game loaded yet: start (or continue) a game first.');
    return false;
  };
  const after = (msg) => {
    try { if (typeof router.rerender === 'function') router.rerender(); } catch (err) { /* a screen may refuse mid-transition */ }
    if (msg) { toast(msg); log(msg); }
  };
  const clampInt = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.trunc(n))) : dflt; };

  const cheats = {
    help() {
      log('Evoker cheats - type any of these in the console:');
      for (const [, sig, what] of CHEAT_LIST) log(`  cheats.${sig.padEnd(44)} ${what}`);
      return CHEAT_LIST.map(([name]) => name);
    },
    gold(n = PLENTY) {
      if (!needSave()) return;
      const amount = clampInt(n, 0, 1e9, PLENTY);
      store.update((s) => addGold(s, amount));
      after(`+${amount.toLocaleString()} gold`);
      return store.get().player.gold;
    },
    gems(n = PLENTY) {
      if (!needSave()) return;
      const amount = clampInt(n, 0, 1e9, PLENTY);
      store.update((s) => addGems(s, amount));
      after(`+${amount.toLocaleString()} gems`);
      return store.get().player.gems;
    },
    potions(n = MANY_POTIONS) {
      if (!needSave()) return;
      const amount = clampInt(n, 0, 1e6, MANY_POTIONS);
      store.update((s) => addPotions(addPotions(s, 'stamina', amount), 'mana', amount));
      after(`+${amount} stamina and +${amount} mana potions`);
      const p = store.get().player;
      return { stamina: p.staminaPotions, mana: p.manaPotions };
    },
    refill() {
      if (!needSave()) return;
      store.update((s) => updatePlayer(s, { stamina: s.player.staminaMax, mana: s.player.manaMax }));
      after('Stamina and mana refilled');
      const p = store.get().player;
      return { stamina: p.stamina, mana: p.mana };
    },
    level(n) {
      if (!needSave()) return;
      const lv = clampInt(n, 1, 200, 1);
      // the levels gained bring their stat points, as level-ups do (player.js), so they can be spent on the profile
      store.update((s) => updatePlayer(s, { level: lv, xp: 0, statPoints: (s.player.statPoints | 0) + Math.max(0, lv - s.player.level) * STAT_POINTS_PER_LEVEL }));
      after(`Level ${lv}`);
      return lv;
    },
    card(query, stage = 0, level = 1) {
      if (!needSave()) return;
      const def = findCard(db, query);
      if (!def) {
        log(`No card called "${query}". Names: cheats.names() lists them.`);
        return null;
      }
      const st = clampInt(stage, 0, 4, 0);
      const cap = capFor(deps, def, st);
      const lv = clampInt(level, 1, cap, 1);
      let uid = null;
      store.update((s, d) => { const r = addCard(s, d || deps, def.id, { stage: st, level: lv, force: true }); uid = r.uid; return r.state; });
      after(`${def.name}${'+'.repeat(st)} level ${lv} added`);
      return uid;
    },
    names() {
      const names = db.all().map((c) => c.name).sort();
      log(names.join(', '));
      return names;
    },
    allCards(stage = 4) {
      if (!needSave()) return;
      const st = clampInt(stage, 0, 4, 4);
      let n = 0;
      store.update((s, d) => {
        let next = s;
        for (const def of (d || deps).db.all()) { next = addCard(next, d || deps, def.id, { stage: st, level: capFor(d || deps, def, st), force: true }).state; n++; }
        return next;
      });
      after(`${n} cards added${st ? ' at ' + '+'.repeat(st) : ''}`);
      return n;
    },
    maxCards() {
      if (!needSave()) return;
      store.update((s, d) => ({ ...s, cards: s.cards.map((c) => ({ ...c, level: capFor(d || deps, (d || deps).db.get(c.cardId), c.stage), xp: 0 })) }));
      after('Every card at its level cap');
      return store.get().cards.length;
    },
    unlockAllLevels() {
      if (!needSave()) return;
      store.update((s, d) => {
        const q = (d || deps).quests;
        const portals = { ...(s.quests.portals || {}) };
        for (const line of q.portals || []) portals[line.id] = { ...(portals[line.id] || {}), unlocked: line.nodes.length };
        return { ...s, quests: { ...s.quests, main: { ...s.quests.main, unlocked: q.main.nodes.length }, portals } };
      });
      after('Every quest unlocked');
      return store.get().quests.main.unlocked;
    },
    skipTutorial() {
      if (!needSave()) return;
      store.update((s) => patchTutorial(s, { done: true, intro: false, named: true }));
      after('Tutorial finished');
      return true;
    },
    days(n = 1) {
      if (!needSave()) return;
      const d = clampInt(n, 1, 3650, 1);
      if (typeof debug.addDays === 'function') debug.addDays(d);
      after(`${d} day${d === 1 ? '' : 's'} later`);
      return d;
    },
    god() {
      if (!needSave()) return;
      if (typeof debug.unlockAll === 'function') debug.unlockAll();
      cheats.unlockAllLevels();
      cheats.level(200);
      cheats.gold();
      cheats.gems();
      cheats.potions();
      // both bars to 999 (the orange one too: unlockAll only raises the mana maximum to the costliest deck)
      store.update((s) => updatePlayer(s, { staminaMax: Math.max(s.player.staminaMax, GOD_MAX), manaMax: Math.max(s.player.manaMax, GOD_MAX) }));
      cheats.refill();
      cheats.skipTutorial();
      after('God mode: everything unlocked');
      return true;
    },
    reset() {
      if (typeof debug.reset === 'function') debug.reset();
    },
  };
  return cheats;
}
