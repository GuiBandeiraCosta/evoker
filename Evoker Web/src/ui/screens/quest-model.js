'use strict';
/**
 * The pure part of the quest screen (quest.js): minion tribe, sprites and slots, the backdrop, reward sprites and
 * captions, the tap / coin shower / card drop timings, the HUD gold steps, the minideck and the portal block.
 */
import { fmt, spriteUrl } from '../dom.js';
import { deckCards, slotUnlocked } from '../../game/state.js';
import { resolveMapLine } from './quest-portal.js';

/** quest_enemy_destroy_* per minion tribe (src/ui/audio.js aliases). */
export const DESTROY_SOUNDS = Object.freeze({ orc: 'enemyDestroyOrc', dwarf: 'enemyDestroyDwarf', elf: 'enemyDestroyElf', neutral: 'enemyDestroy' });

/** Base URL of the minion cut-outs. */
const MINION_BASE = '/assets/orig/minions/';

/** Minion cut-outs per tribe in assets/orig/minions (<tribe>-<n>.png, see exploration/tools/classify-prepackaged.py). */
export const MINION_COUNTS = { dwarf: 3, elf: 3, orc: 4, neutral: 7 };

/** Where the minions stand in the landscape (stage px inside the arena; x = centre, y = feet, s = scale). */
export const MINION_SLOTS = [
  { x: 118, y: 612, s: 0.94 },
  { x: 262, y: 672, s: 1.02 },
  { x: 408, y: 628, s: 0.96 },
  { x: 552, y: 690, s: 1.06 },
  { x: 652, y: 606, s: 0.9 },
];

/** Minion sprite size at scale 1 (the 245x383 cut-outs drawn at 0.56). */
export const MINION_W = 137;
export const MINION_H = 214;

/**
 * Tribe of the minions of a quest: the fixed boss's tribe when there is one, else a band-dependent pick
 * that cycles with the quest number.
 * @param {object} deps
 * @param {object} quest
 * @returns {'dwarf'|'elf'|'orc'|'neutral'}
 */
export function questTribe(deps, quest) {
  if (!quest) return 'neutral';
  const def = quest.boss && deps.db ? deps.db.get(quest.boss) : null;
  if (def && MINION_COUNTS[def.tribe]) return def.tribe;
  const cycle = ['orc', 'dwarf', 'elf', 'neutral'];
  return cycle[Math.max(0, (quest.n | 0) - 1) % cycle.length];
}

/**
 * Sprite URL of minion number `seed` of a tribe (deterministic variety).
 * @param {string} tribe
 * @param {number} seed
 * @returns {string}
 */
export function minionSprite(tribe, seed = 0) {
  const t = MINION_COUNTS[tribe] ? tribe : 'neutral';
  const n = (Math.abs(seed | 0) % MINION_COUNTS[t]) + 1;
  return `${MINION_BASE}${t}-${n}.png`;
}

/**
 * Backdrop variant: the peaceful village for the first three sections of the main quest, the burned one
 * for the dark half of the world and every portal.
 * @param {string} line
 * @param {object|null} quest
 * @returns {'normal'|'burned'}
 */
export function backdropFor(line, quest) {
  if (line !== 'main') return 'burned';
  return quest && (quest.section | 0) >= 4 ? 'burned' : 'normal';
}

/**
 * Original reward sprite for a reward (assets/orig/ui/reward_*.png).
 * @param {object} reward
 * @returns {string}
 */
export function rewardSprite(reward) {
  switch (reward && reward.type) {
    case 'gold': return spriteUrl('reward_gold');
    case 'gems': return spriteUrl('reward_gems');
    case 'potion': return spriteUrl(reward.potion === 'mana' ? 'reward_manapotion' : 'reward_staminapotions');
    case 'token': {
      const tier = reward.token || reward.tier || '';
      const n = /archmage|high|gold/i.test(tier) ? 1 : /summoner|silver/i.test(tier) ? 2 : 3;
      return spriteUrl(`reward_token_${n}`);
    }
    case 'card':
    case 'piece':
    default: return spriteUrl('reward_cardslots');
  }
}

/**
 * Icon/title for a reward burst (toasts and the burst caption).
 * @param {object} reward
 * @returns {{icon: string, title: string}}
 */
export function burstInfo(reward) {
  switch (reward && reward.type) {
    case 'gold': return { icon: 'coin', title: `+${fmt(reward.gold)} gold` };
    case 'card': return { icon: 'cards', title: 'A new card!' };
    case 'gems': return { icon: 'gem', title: `+${fmt(reward.gems)} gems` };
    case 'potion': return { icon: reward.potion === 'mana' ? 'potion-blue' : 'potion-orange', title: 'A potion!' };
    case 'token': return { icon: 'token-bronze', title: 'A booster token!' };
    default: return { icon: 'star', title: '' };
  }
}

/** The client's tap-rating label (loca "PERFECT"). */
export const PERFECT = 'PERFECT';
/** Tap feedback timings (ms, reOM @ 0:30.8): the minion is gone after `vanishMs`, the slash fades after
 * `slashMs`, "PERFECT" holds `perfectMs`, the white tap number floats `numberMs`. */
export const TAP_FX = Object.freeze({ vanishMs: 130, slashMs: 450, perfectMs: 900, numberMs: 900 });
/** Wave-end coin shower (reOM @ 4:46: ~1.3 s of tumbling coins, the HUD gold counting up in 3-4 steps). Shortened to
 * ~0.8 s on the user's request (2026-10-12: the next minions should come faster); the coins still tumble. */
export const GOLD_SHOWER = Object.freeze({ ms: 800, steps: 4, stepMs: 150 });
/** The HUD gold after a tap: a short count-up to the new value (steps x ms). */
export const TAP_GOLD_COUNT = Object.freeze({ steps: 3, stepMs: 60 });
/** Card drop on the scene (reOM @ 0:28-0:31, 1:28-1:45): glint, white flash -> card, hold, fly to the minideck,
 * then the next wave fades in from silhouettes (ms). The videos: glint 600, hold 1000, wave-in 900; tightened on the
 * user's request (2026-10-12) so the next minions are tappable sooner. */
export const CARD_DROP = Object.freeze({ glint: 400, flash: 250, reveal: 250, hold: 700, fly: 250, waveIn: 450 });

/**
 * The values the held HUD gold steps through at a wave's end: `n` roughly even steps from `from` to `to`
 * (the last one exactly `to`; none when nothing changed).
 * @param {number} from
 * @param {number} to
 * @param {number} [n=GOLD_SHOWER.steps]
 * @returns {number[]}
 */
export function goldSteps(from, to, n = GOLD_SHOWER.steps) {
  const a = Math.round(Number(from) || 0);
  const b = Math.round(Number(to) || 0);
  if (a === b) return [];
  const k = Math.max(1, n | 0);
  const out = [];
  for (let i = 1; i <= k; i++) {
    const v = i === k ? b : Math.round(a + (b - a) * i / k);
    if (v !== out[out.length - 1]) out.push(v);
  }
  return out;
}

/**
 * What one tap shows (pure): the PERFECT label, the tap's gold, the bonus burst.
 * @param {{perfect?: boolean, tapGold?: number, burst?: number}} info  tapMinion result
 * @returns {{perfect: boolean, tapText: string|null, burstText: string|null, coinShower: boolean}}
 */
export function tapFeedback(info) {
  const tap = Math.max(0, Number(info && info.tapGold) || 0);
  const burst = Math.max(0, Number(info && info.burst) || 0);
  return {
    perfect: Boolean(info && info.perfect),
    tapText: tap > 0 ? `+${fmt(tap)}` : null,
    burstText: burst > 0 ? `+${fmt(burst)}` : null,
    coinShower: burst > 0,
  };
}

/**
 * The minideck (comp_minideck): the five deck slots with each card's art, padlocks on closed slots.
 * @param {object} state
 * @param {object} db
 * @param {(def: object, stage: number) => string|null} artUrlFor
 * @returns {{index: number, locked: boolean, cardId: string|null, art: string|null}[]}
 */
export function miniDeck(state, db, artUrlFor) {
  const cards = deckCards(state);
  return [0, 1, 2, 3, 4].map((i) => {
    const inst = cards[i];
    const def = inst ? db.get(inst.cardId) : null;
    return { index: i, locked: !slotUnlocked(state, i), cardId: def ? def.id : null, art: def ? artUrlFor(def, inst.stage) : null };
  });
}

/**
 * Why a quest of `line` may not be played now: 'closed' when it belongs to a portal that is not the running one
 * (the 7-day rotation moved on), 'level' for a portal below the portal level (quest-portal.js PORTAL_LEVEL, the
 * "Reach user level 8 to enter portals." gate), null for the main line and the running portal.
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @param {string} line
 * @returns {'closed'|'level'|null}
 */
export function portalBlock(state, deps, now, line) {
  if (!line || line === 'main') return null;
  return resolveMapLine(state, deps, now, line).reason;
}
