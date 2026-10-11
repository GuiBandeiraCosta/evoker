'use strict';
/**
 * Profile model of the character screen: the stat-point spinner constraints, the change-name cleanup and the
 * avatar list. Pure and DOM-free (tests/economy-ui.test.js).
 */
import { HP_PER_POINT } from '../../game/player.js';

export const STAT_KEYS = ['stamina', 'mana', 'hp'];
const NAME_MAX = 20;
const AVATAR_COUNT = 12;

/** @returns {{stamina: number, mana: number, hp: number}} */
export function emptyAllocation() {
  return { stamina: 0, mana: 0, hp: 0 };
}

/**
 * Points allocated so far.
 * @param {{stamina?: number, mana?: number, hp?: number}} alloc
 * @returns {number}
 */
export function allocationTotal(alloc) {
  return STAT_KEYS.reduce((sum, k) => sum + Math.max(0, (alloc && alloc[k]) | 0), 0);
}

/**
 * Move one spinner by `delta`, keeping every stat >= 0 and the total <= `available`.
 * Returns a new object (the input is not mutated).
 * @param {{stamina: number, mana: number, hp: number}} alloc
 * @param {'stamina'|'mana'|'hp'} stat
 * @param {number} delta
 * @param {number} available  unspent stat points
 * @returns {{stamina: number, mana: number, hp: number}}
 */
export function adjustAllocation(alloc, stat, delta, available) {
  if (!STAT_KEYS.includes(stat)) return { ...emptyAllocation(), ...alloc };
  const cur = Math.max(0, (alloc && alloc[stat]) | 0);
  const others = allocationTotal(alloc) - cur;
  const room = Math.max(0, (available | 0) - others);
  const next = Math.max(0, Math.min(room, cur + (delta | 0)));
  return { ...emptyAllocation(), ...alloc, [stat]: next };
}

/**
 * Spinner button states and the preview of the stats after Confirm.
 * @param {{staminaMax: number, manaMax: number, hpMax: number, statPoints: number}} player
 * @param {{stamina: number, mana: number, hp: number}} alloc
 * @returns {{remaining: number, total: number, canConfirm: boolean, preview: {staminaMax: number, manaMax: number, hpMax: number}, canInc: Record<string, boolean>, canDec: Record<string, boolean>}}
 */
export function allocationPreview(player, alloc) {
  const total = allocationTotal(alloc);
  const available = Math.max(0, (player && player.statPoints) | 0);
  const remaining = Math.max(0, available - total);
  const canInc = {};
  const canDec = {};
  for (const k of STAT_KEYS) {
    canInc[k] = remaining > 0;
    canDec[k] = ((alloc && alloc[k]) | 0) > 0;
  }
  return {
    remaining,
    total,
    canConfirm: total > 0 && total <= available,
    preview: {
      staminaMax: (player.staminaMax | 0) + ((alloc && alloc.stamina) | 0),
      manaMax: (player.manaMax | 0) + ((alloc && alloc.mana) | 0),
      hpMax: (player.hpMax | 0) + ((alloc && alloc.hp) | 0) * HP_PER_POINT,
    },
    canInc,
    canDec,
  };
}

/**
 * Whether the character button needs its "!" badge.
 * @param {{statPoints?: number}} player
 * @returns {boolean}
 */
export function hasUnspentPoints(player) {
  return Boolean(player && (player.statPoints | 0) > 0);
}

/**
 * Trim and clamp a player name typed in the Change-name dialog; empty names are rejected.
 * @param {string} raw
 * @returns {{ok: boolean, name: string}}
 */
export function cleanName(raw) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  return { ok: name.length > 0, name };
}

/**
 * Card ids used as avatars (12), from data/names.json.
 * @param {{avatars?: string[]}|null|undefined} names
 * @returns {string[]}
 */
export function avatarIds(names) {
  const list = (names && Array.isArray(names.avatars)) ? names.avatars.slice(0, AVATAR_COUNT) : [];
  return list;
}
