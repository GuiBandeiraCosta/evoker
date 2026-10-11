'use strict';

import { updatePlayer, featuresUnlockedAt, DAY_MS } from './state.js';
import {
  MAX_PLAYER_LEVEL, STAT_POINTS_PER_LEVEL, STAT_POINT_VALUE, LEVEL_UP_REWARDS, BATTLE_XP, REGEN_INTERVAL_MS,
  POTION_PRICE_GEMS, POTION_PRICE_GEMS_EVENT,
} from '../core/constants.js';

/**
 * Character: xp, level-ups and their rewards, stat points, regeneration, potions (game-design §3, §7).
 */

export const MAX_LEVEL = MAX_PLAYER_LEVEL;
export { STAT_POINTS_PER_LEVEL };
/** What one stat point buys: +30 max HP, +1 max stamina, +1 max mana. */
export const HP_PER_POINT = STAT_POINT_VALUE.hp;
export const STAMINA_PER_POINT = STAT_POINT_VALUE.stamina;
export const MANA_PER_POINT = STAT_POINT_VALUE.mana;
/** Stamina and mana regenerate by 1 every REGEN_MS. */
export const REGEN_MS = REGEN_INTERVAL_MS;

/**
 * Regenerate 1 stamina and 1 mana per full real minute since `regenAt`, up to the max.
 * Full bars still advance `regenAt` so time is never "banked".
 * @param {object} state
 * @param {number} now
 * @returns {object}
 */
export function applyRegen(state, now) {
  const p = state.player;
  const from = p.regenAt || now;
  if (now <= from) return state;
  const ticks = Math.floor((now - from) / REGEN_MS);
  if (ticks <= 0) return state;
  const stamina = Math.min(p.staminaMax, p.stamina + ticks);
  const mana = Math.min(p.manaMax, p.mana + ticks);
  return updatePlayer(state, { stamina, mana, regenAt: from + ticks * REGEN_MS });
}

/**
 * Player xp earned for one PvP fight (Arena, Pieces, League): (1.5 + 0.5 × opponent level), ×4 on a win
 * (a level-8 rival: 22 on a win, 6 on a loss). Quest boss fights give none (`QUEST_BOSS_PLAYER_XP`).
 * @param {number} opponentLevel
 * @param {boolean} won
 * @returns {number}
 */
export function playerFightXp(opponentLevel, won) {
  const { base, perOpponentLevel, winMult } = BATTLE_XP.player;
  const xp = base + perOpponentLevel * Math.max(0, opponentLevel | 0);
  return Math.round(won ? xp * winMult : xp);
}

/** Player xp of a quest boss fight (none: the XP bar does not move, playthroughs-2.md §1.3). */
export const QUEST_BOSS_PLAYER_XP = BATTLE_XP.player.questBoss;

/**
 * Card xp earned per deck card for one fight: 10 + enemy deck mana / 2, ×1.5 on a win (BATTLE_XP.card).
 * @param {number} enemyDeckMana
 * @param {boolean} won
 * @param {boolean} [infiniteWisdom]  Infinite Wisdom day doubles it
 * @returns {number}
 */
export function cardFightXp(enemyDeckMana, won, infiniteWisdom) {
  const { base, enemyManaDiv, winMult, wisdomMult } = BATTLE_XP.card;
  let xp = base + (Number(enemyDeckMana) || 0) / enemyManaDiv;
  if (won) xp *= winMult;
  if (infiniteWisdom) xp *= wisdomMult;
  return Math.round(xp);
}

/**
 * @typedef {object} LevelUpRewards
 * @property {number} level
 * @property {number} gold
 * @property {number} gems
 * @property {Array<'stamina'|'mana'>} potions  one entry per potion
 * @property {string[]} tokens                 booster token ids, one entry per token
 */

/**
 * Rewards of reaching `level` (the "Rewards" column of the level-up dialog): gold = 50 × level, plus one extra
 * repeating every 5 levels: L2 5 gems (then 50 gems at L7, L12 …), L3/L4 a stamina potion, L5 a mana potion,
 * L6 a Neophyte token (constants LEVEL_UP_REWARDS).
 * @param {number} level  the level reached (2..200)
 * @returns {LevelUpRewards}
 */
export function levelUpRewards(level) {
  const L = Math.floor(Number(level) || 0);
  const out = { level: L, gold: 0, gems: 0, potions: [], tokens: [] };
  if (L < 2) return out;
  const R = LEVEL_UP_REWARDS;
  out.gold = R.goldOverrides[L] ?? R.goldPerLevel * L;
  const extra = R.cycle[(L - 2) % R.cycle.length];
  if (extra.gems) out.gems = L === 2 ? R.firstGems : R.gems;
  if (extra.potion) out.potions.push(extra.potion);
  if (extra.token) out.tokens.push(extra.token);
  return out;
}

/**
 * @typedef {object} LevelUpDetail
 * @property {number} level            the level reached
 * @property {LevelUpRewards} rewards  already added to the save
 * @property {number} statPoints       points granted by this level-up (12)
 * @property {string[]} unlocked       features opening at this level (state.featuresUnlockedAt)
 */

/**
 * Grant the rewards of a level-up to a player record (mutates the copy it is given).
 * @param {object} p  a copy of state.player
 * @param {LevelUpRewards} r
 */
function grantLevelRewards(p, r) {
  p.gold += r.gold;
  p.gems += r.gems;
  for (const kind of r.potions) {
    if (kind === 'mana') p.manaPotions += 1; else p.staminaPotions += 1;
  }
  if (r.tokens.length) {
    const t = { ...p.tokens };
    for (const id of r.tokens) t[id] = (t[id] || 0) + 1;
    p.tokens = t;
  }
}

/**
 * Add player xp and apply every level-up: +12 stat points, stamina and mana refilled to their max, and the
 * level's rewards (`levelUpRewards`) added. The level-up dialog (comp_levelup) is fed from `levelUpDetails`;
 * its point spinners call `previewStatPoints` and its Proceed button `spendStatPoints`.
 * @param {object} state
 * @param {{stats: {playerXpToNext: (level:number)=>number}}} deps
 * @param {number} amount
 * @returns {{state: object, levelUps: number[], levelUpDetails: LevelUpDetail[], gold: number, gems: number, xp: number}}
 *   levelUps = the levels reached; gold / gems = totals granted by the level-ups
 */
export function addPlayerXp(state, deps, amount) {
  const xp = Math.max(0, Math.round(amount));
  const p = { ...state.player };
  const levelUps = [];
  const levelUpDetails = [];
  let gold = 0, gems = 0;
  if (p.level >= MAX_LEVEL) return { state, levelUps, levelUpDetails, gold, gems, xp: 0 };
  p.xp += xp;
  while (p.level < MAX_LEVEL) {
    const need = deps.stats.playerXpToNext(p.level);
    if (p.xp < need) break;
    p.xp -= need;
    p.level += 1;
    p.statPoints += STAT_POINTS_PER_LEVEL;
    p.stamina = Math.max(p.stamina, p.staminaMax);
    p.mana = Math.max(p.mana, p.manaMax);
    const rewards = levelUpRewards(p.level);
    grantLevelRewards(p, rewards);
    gold += rewards.gold;
    gems += rewards.gems;
    levelUps.push(p.level);
    levelUpDetails.push({ level: p.level, rewards, statPoints: STAT_POINTS_PER_LEVEL, unlocked: featuresUnlockedAt(p.level, state) });
  }
  if (p.level >= MAX_LEVEL) p.xp = 0;
  return { state: { ...state, player: p }, levelUps, levelUpDetails, gold, gems, xp };
}

/**
 * What a point allocation would give, without applying it (the level-up dialog's +/- spinners).
 * @param {object} state
 * @param {{stamina?: number, mana?: number, hp?: number}} alloc  points per stat
 * @returns {{ok: boolean, spent: number, pointsLeft: number, hpMax: number, staminaMax: number, manaMax: number}}
 */
export function previewStatPoints(state, alloc) {
  const p = state.player;
  const s = Math.max(0, alloc.stamina | 0), m = Math.max(0, alloc.mana | 0), h = Math.max(0, alloc.hp | 0);
  const spent = s + m + h;
  return {
    ok: spent <= p.statPoints,
    spent,
    pointsLeft: p.statPoints - spent,
    hpMax: p.hpMax + h * HP_PER_POINT,
    staminaMax: p.staminaMax + s * STAMINA_PER_POINT,
    manaMax: p.manaMax + m * MANA_PER_POINT,
  };
}

/**
 * Spend unspent stat points (1 pt = +1 stamina max, +1 mana max or +30 max HP); the current stamina and mana
 * grow with their max (client usermanager.levelUp: maxStamina += n, addStamina(n)). Pure.
 * @param {object} state
 * @param {{stamina?: number, mana?: number, hp?: number}} alloc  points per stat
 * @returns {object}
 */
export function spendStatPoints(state, alloc) {
  const pv = previewStatPoints(state, alloc);
  if (pv.spent === 0) return state;
  if (!pv.ok) throw new Error('Not enough stat points');
  const p = state.player;
  return updatePlayer(state, {
    statPoints: pv.pointsLeft,
    staminaMax: pv.staminaMax, stamina: p.stamina + (pv.staminaMax - p.staminaMax),
    manaMax: pv.manaMax, mana: p.mana + (pv.manaMax - p.manaMax),
    hpMax: pv.hpMax,
  });
}

/**
 * Id of the daily event (accepts the event object or its id).
 * @param {object|string|null} [event]
 * @returns {string|null}
 */
export function eventId(event) {
  return event && typeof event === 'object' ? event.id : (event || null);
}

/**
 * The clock the daily event follows: the real clock moved forward by the days the save skipped through
 * `debug.addDays` (`state.daily.dayShift`). addDays moves the save's own dates back instead of the clock, so
 * without the shift the event (a hash of the real UTC day) would never change with it. 0 for a normal save.
 * @param {object|null} state
 * @param {number} now
 * @returns {number}
 */
export function eventClock(state, now) {
  const shift = Number(state && state.daily && state.daily.dayShift) || 0;
  return now + shift * DAY_MS;
}

/**
 * Apply the Golden Day event (+50 % gold).
 * @param {number} gold
 * @param {object|string|null} [event]
 * @returns {number}
 */
export function goldWithEvent(gold, event) {
  return Math.round(eventId(event) === 'golden-day' ? gold * 1.5 : gold);
}

/**
 * Gem price of a potion bought from the Drink-potion dialog.
 * @param {{id?: string}|string|null} [event]  the daily event (object with id, or id string)
 * @returns {number}
 */
export function potionPrice(event) {
  return eventId(event) === 'drinking-contest' ? POTION_PRICE_GEMS_EVENT : POTION_PRICE_GEMS;
}

/**
 * Decision helper for the "Drink potion" dialog.
 * @param {object} state
 * @param {'stamina'|'mana'} kind
 * @param {number} amount  points the action needs
 * @param {object|string|null} [event]
 * @returns {{needed: boolean, kind: string, have: number, missing: number, hasPotion: boolean, potions: number, price: number, canBuy: boolean}}
 */
export function needsPotion(state, kind, amount, event) {
  const p = state.player;
  const have = kind === 'mana' ? p.mana : p.stamina;
  const potions = kind === 'mana' ? p.manaPotions : p.staminaPotions;
  const price = potionPrice(event);
  const missing = Math.max(0, amount - have);
  return { needed: missing > 0, kind, have, missing, hasPotion: potions > 0, potions, price, canBuy: p.gems >= price };
}

/**
 * Use one potion: refill the bar to its max.
 * @param {object} state
 * @param {'stamina'|'mana'} kind
 * @returns {object}
 */
export function drinkPotion(state, kind) {
  const p = state.player;
  if (kind === 'mana') {
    if (p.manaPotions <= 0) throw new Error('No mana potion');
    return updatePlayer(state, { manaPotions: p.manaPotions - 1, mana: p.manaMax });
  }
  if (p.staminaPotions <= 0) throw new Error('No stamina potion');
  return updatePlayer(state, { staminaPotions: p.staminaPotions - 1, stamina: p.staminaMax });
}

/**
 * Buy a potion for gems and drink it immediately (the dialog's second button).
 * @param {object} state
 * @param {'stamina'|'mana'} kind
 * @param {object|string|null} [event]
 * @returns {object}
 */
export function buyAndDrinkPotion(state, kind, event) {
  const price = potionPrice(event);
  if (state.player.gems < price) throw new Error('Not enough gems');
  const s = updatePlayer(state, { gems: state.player.gems - price });
  return updatePlayer(s, kind === 'mana' ? { mana: s.player.manaMax } : { stamina: s.player.staminaMax });
}

/**
 * Add potions to the inventory.
 * @param {object} state
 * @param {'stamina'|'mana'} kind
 * @param {number} count
 * @returns {object}
 */
export function addPotions(state, kind, count) {
  const p = state.player;
  return kind === 'mana'
    ? updatePlayer(state, { manaPotions: p.manaPotions + count })
    : updatePlayer(state, { staminaPotions: p.staminaPotions + count });
}

/**
 * Spend stamina (throws when short; callers check with `needsPotion` first).
 * @param {object} state
 * @param {number} amount
 * @returns {object}
 */
export function spendStamina(state, amount) {
  if (state.player.stamina < amount) throw new Error('Not enough stamina');
  return updatePlayer(state, { stamina: state.player.stamina - amount });
}

/**
 * Spend mana (throws when short).
 * @param {object} state
 * @param {number} amount
 * @returns {object}
 */
export function spendMana(state, amount) {
  if (state.player.mana < amount) throw new Error('Not enough mana');
  return updatePlayer(state, { mana: state.player.mana - amount });
}

/**
 * Add gold (never negative).
 * @param {object} state
 * @param {number} amount
 * @returns {object}
 */
export function addGold(state, amount) {
  return updatePlayer(state, { gold: Math.max(0, state.player.gold + Math.round(amount)) });
}

/**
 * Spend gold (throws when short).
 * @param {object} state
 * @param {number} amount
 * @returns {object}
 */
export function spendGold(state, amount) {
  if (state.player.gold < amount) throw new Error('Not enough gold');
  return updatePlayer(state, { gold: state.player.gold - amount });
}

/**
 * Add gems.
 * @param {object} state
 * @param {number} amount
 * @returns {object}
 */
export function addGems(state, amount) {
  return updatePlayer(state, { gems: Math.max(0, state.player.gems + Math.round(amount)) });
}

/**
 * Spend gems (throws when short).
 * @param {object} state
 * @param {number} amount
 * @returns {object}
 */
export function spendGems(state, amount) {
  if (state.player.gems < amount) throw new Error('Not enough gems');
  return updatePlayer(state, { gems: state.player.gems - amount });
}

/**
 * Add booster tokens. `portalId` is required for the portal token kinds.
 * @param {object} state
 * @param {'neophyte'|'summoner'|'archmage'|'portalLow'|'portalHigh'} kind
 * @param {number} count
 * @param {string} [portalId]
 * @returns {object}
 */
export function addTokens(state, kind, count, portalId) {
  const t = state.player.tokens;
  if (kind === 'portalLow' || kind === 'portalHigh') {
    const bag = { ...t[kind], [portalId]: (t[kind][portalId] || 0) + count };
    return updatePlayer(state, { tokens: { ...t, [kind]: bag } });
  }
  return updatePlayer(state, { tokens: { ...t, [kind]: (t[kind] || 0) + count } });
}

/**
 * Number of tokens of a kind.
 * @param {object} state
 * @param {string} kind
 * @param {string} [portalId]
 * @returns {number}
 */
export function tokenCount(state, kind, portalId) {
  const t = state.player.tokens;
  if (kind === 'portalLow' || kind === 'portalHigh') return (t[kind] && t[kind][portalId]) || 0;
  return t[kind] || 0;
}

/**
 * Change the player's name or avatar.
 * @param {object} state
 * @param {{name?: string, avatar?: number}} changes
 * @returns {object}
 */
export function editProfile(state, changes) {
  const out = {};
  if (typeof changes.name === 'string' && changes.name.trim()) out.name = changes.name.trim().slice(0, 20);
  if (Number.isInteger(changes.avatar) && changes.avatar >= 0 && changes.avatar < 12) out.avatar = changes.avatar;
  return updatePlayer(state, out);
}
