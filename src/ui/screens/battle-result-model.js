'use strict';
/**
 * The pure part of the post-battle flow (src/ui/screens/battle-result.js, no DOM): the client's timings, the
 * result kind, the loot of a fight with its animation / sprite / sounds, the card XP bar entries and their
 * layout, the card level-up rows and the pieces of a hunt.
 */
import { capFor } from '../../game/collection.js';
import { questLine } from '../../game/quests.js';

/** fx_wonlost timings (ms): banner zoom, glow start, glow expansion; the flow continues at their sum. */
export const BANNER = Object.freeze({ zoom: 900, glowStart: 660, glow: 3000, blur: 1200, fade: 2100 });
export const BANNER_MS = BANNER.glowStart + BANNER.glow;
/** Card XP sequence (bosscardresult): one card per second, 500 ms fade, 150 ms bar tween. */
export const XP_STAGGER_MS = 1000;
export const XP_FADE_MS = 500;
export const XP_BAR_MS = 150;
/** reward_comp: animation speed, earliest tap that stops the animation. */
export const REWARD_SPEED = 1.2;
export const REWARD_TAP_AFTER_MS = 2000;
/** new_card_notify_comp: slide in (inOutExpo 1200 ms), hold 3 s, slide out (1200 ms). */
export const SETPLATE_MS = Object.freeze({ in: 1200, hold: 3000, out: 1200 });
/** The full card with the puzzle overlay after a card piece (ms, or until tapped). */
export const PIECE_CARD_MS = 1500;
/** comp_levelup_card: each step of the chain. */
export const LEVELUP_STEP_MS = 500;

/** Stage px per client unit (720 / 320) and the stage centre. */
const U = 2.25;
export const CX = 360;
export const CY = 640;

/**
 * Result kind for the player.
 * @param {string} winner  'attacker' | 'defender' | 'draw'
 * @param {string} playerSide
 * @returns {'victory'|'defeat'|'draw'}
 */
export function resultKind(winner, playerSide) {
  if (winner === 'draw' || !winner) return 'draw';
  return winner === playerSide ? 'victory' : 'defeat';
}

/** Keyframe animation per reward type (reward_comp). */
export function rewardAnimName(reward) {
  if (!reward) return null;
  switch (reward.type) {
    case 'gold': return 'goldreward';
    case 'gems': return 'gemreward';
    case 'potion': return reward.potion === 'mana' ? 'manapotion' : 'staminapotion';
    case 'token': return 'gemreward';
    case 'card': return reward.converted ? 'goldreward' : 'cardreward';
    case 'piece': return 'cardreward';
    default: return null;
  }
}

/**
 * The reward object reward_comp shows in the middle of its animation (the coin pile, gem heap, potion, token).
 * @param {object} reward
 * @returns {string|null} sprite stem in assets/orig/ui
 */
export function rewardIcon(reward) {
  if (!reward) return null;
  switch (reward.type) {
    case 'gold': return 'reward_gold';
    case 'gems': return 'reward_gems';
    case 'potion': return reward.potion === 'mana' ? 'reward_manapotion' : 'reward_staminapotions';
    // reward_token_1 = the gold hexagon (Archmage), _2 = the silver square (Summoner), _3 = the bronze disc
    // (Neophyte); the portal tokens were server images: drawn as the shop's triangle instead (null here)
    case 'token': return PORTAL_TOKENS.includes(reward.token) ? null : `reward_token_${{ neophyte: 3, summoner: 2, archmage: 1 }[reward.token] || 3}`;
    case 'card': return reward.converted ? 'reward_gold' : null;
    default: return null;
  }
}

/** Token kinds of the portal packs (no client sprite). */
const PORTAL_TOKENS = ['portalLow', 'portalHigh'];

/**
 * Name of a token reward: "Neophyte token", or the portal's own token name ("Empyrean token").
 * @param {object} reward  `{ type: 'token', token, portalId? }`
 * @param {object} [deps]  { quests }
 * @returns {string}
 */
export function tokenName(reward, deps) {
  const kind = reward && reward.token;
  if (PORTAL_TOKENS.includes(kind)) {
    let line = null;
    try { line = deps && reward.portalId ? questLine(deps, reward.portalId) : null; } catch (err) { line = null; }
    const t = line && line.tokens && line.tokens[kind === 'portalHigh' ? 'high' : 'low'];
    if (t && t.name) return t.name;
    return kind === 'portalHigh' ? 'Grand portal token' : 'Portal token';
  }
  const names = { neophyte: 'Neophyte', summoner: 'Summoner', archmage: 'Archmage' };
  return `${names[kind] || 'Neophyte'} token`;
}

/** Reward sounds (reward_comp playRewardAnimation / playRewardTakenAnimation). */
export function rewardSounds(reward) {
  const t = reward && reward.type;
  if (t === 'gold') return { show: 'quest_reward_gold', taken: 'quest_reward_collect' };
  if (t === 'gems') return { show: 'quest_reward_gem', taken: 'quest_reward_collect' };
  if (t === 'potion') return { show: 'quest_reward_potion', taken: 'quest_reward_collect' };
  if (t === 'token') return { show: 'quest_reward_token', taken: 'quest_reward_collect' };
  if (t === 'card' && reward.converted) return { show: 'quest_reward_card_autosell', taken: 'quest_reward_collect' };
  if (t === 'card' || t === 'piece') return { show: 'quest_reward_card', taken: 'quest_reward_collect' };
  return { show: null, taken: null };
}

/**
 * The loot of a fight for the reward step, from the fight info (quest boss, arena, pieces), or null.
 * @param {object} p  battle screen params
 * @returns {object|null}  a reward object of src/game/rewards.js shape
 */
export function lootOf(p) {
  const info = (p && p.info) || {};
  const r = info.reward && info.reward.type ? info.reward : (p && p.rewards && p.rewards.type ? p.rewards : null);
  if (r && r.type !== 'none') return r;
  const bag = info.rewards && typeof info.rewards === 'object' ? info.rewards : (p && p.rewards && typeof p.rewards === 'object' && !Array.isArray(p.rewards) ? p.rewards : {});
  if (info.completed && info.uid && info.cardId) return { type: 'card', cardId: info.cardId, uid: info.uid, completed: true };
  // a won piece fight that did not complete the card (src/game/pieces.js fightHolder: `hunt` = the hunt after
  // the stolen piece): the piece step
  if (info.won && !info.completed && info.hunt && info.hunt.cardId) return { type: 'piece', cardId: info.hunt.cardId };
  if (Number(bag.gold) > 0) return { type: 'gold', gold: Number(bag.gold) };
  if (Number(bag.gems) > 0) return { type: 'gems', gems: Number(bag.gems) };
  return null;
}

/**
 * Every loot step of a fight, in order: the fight's reward (lootOf), then the last portal quest's 1000 gold
 * bonus (`info.bonusGold`, src/game/quests.js) as its own coin step.
 * @param {object} p  battle screen params
 * @returns {object[]}
 */
export function lootList(p) {
  const info = (p && p.info) || {};
  const out = [];
  const main = lootOf(p);
  if (main) out.push(main);
  const bonus = Number(info.bonusGold) || 0;
  if (bonus > 0) out.push({ type: 'gold', gold: bonus, bonus: true });
  return out;
}

/**
 * XP bar entries of the deck cards: level and XP before and after the fight.
 * @param {{uid: string, cardId: string, stage: number, level: number, xp: number}[]} before  deck snapshot
 * @param {object|null} state  save after the fight
 * @param {object} deps
 * @param {{uid: string, from: number, to: number}[]} [levelUps]
 * @returns {{uid: string, cardId: string, stage: number, name: string, from: object, to: object, levelled: boolean, levelUp: object|null}[]}
 */
export function xpEntries(before, state, deps, levelUps = []) {
  const out = [];
  for (const b of before || []) {
    if (!b) continue;
    const def = deps && deps.db ? deps.db.get(b.cardId) : null;
    if (!def) continue;
    const now = state && state.cards ? state.cards.find((c) => c.uid === b.uid) : null;
    const after = now || b;
    const cap = capFor(deps, def, after.stage | 0);
    const capBefore = capFor(deps, def, b.stage | 0);
    const bar = (level, xp, max, stage) => {
      const atMax = level >= max;
      const need = atMax ? 0 : deps.stats.cardXpToNext(def, level, stage);
      return { level, xp: atMax ? 0 : xp, need, max: atMax, ratio: atMax || !(need > 0) ? 0 : Math.max(0, Math.min(1, xp / need)) };
    };
    const lu = (levelUps || []).find((x) => x.uid === b.uid) || null;
    const from = bar(b.level, b.xp, capBefore, b.stage | 0);
    const to = bar(after.level, Number(after.xp) || 0, cap, after.stage | 0);
    out.push({ uid: b.uid, cardId: b.cardId, stage: after.stage | 0, name: def.name, from, to, levelled: to.level > from.level, levelUp: lu || (to.level > from.level ? { uid: b.uid, from: from.level, to: to.level } : null) });
  }
  return out;
}

/**
 * Label of an XP bar ("Level #level#" / "Level #level# (MAX)").
 * @param {{level: number, max: boolean}} bar
 * @returns {string}
 */
export function levelText(bar) {
  return bar.max ? `Level ${bar.level} (MAX)` : `Level ${bar.level}`;
}

/**
 * Position of card entry i (0-based) of the result screen (scene_pvp_result_layout): rows at -120, -60, 0, 60,
 * 120 client units from the centre; entries 1, 3, 5 have the card left (-100) and the bar right of it,
 * entries 2 and 4 the card right (+100) and the bar left of it.
 * @param {number} i
 * @returns {{x: number, y: number, side: 'left'|'right'}}  card centre in stage px
 */
export function entryLayout(i) {
  const right = i % 2 === 1;
  return { x: Math.round(CX + (right ? 100 : -100) * U), y: Math.round(CY + (-120 + 60 * i) * U), side: right ? 'right' : 'left' };
}

/**
 * Rows of the card level-up popup: level, attack, HP and (when the card has an ability value) skill.
 * @param {object} deps
 * @param {{cardId: string, stage: number, evolveQuality?: number}} inst
 * @param {number} from
 * @param {number} to
 * @returns {{kind: 'level'|'attack'|'hp'|'skill', from: number, to: number}[]}
 */
export function levelUpRows(deps, inst, from, to) {
  const def = deps.db.get(inst.cardId);
  if (!def) return [{ kind: 'level', from, to }];
  const q = typeof inst.evolveQuality === 'number' ? inst.evolveQuality : 1;
  const a = deps.stats.statsAt(def, inst.stage | 0, from, q);
  const b = deps.stats.statsAt(def, inst.stage | 0, to, q);
  const rows = [{ kind: 'level', from, to }, { kind: 'attack', from: a.attack, to: b.attack }, { kind: 'hp', from: a.hp, to: b.hp }];
  if (a.ability != null && b.ability != null && (a.ability || b.ability)) rows.push({ kind: 'skill', from: a.ability, to: b.ability });
  return rows;
}

/**
 * Pieces of the hunt a piece reward went to: `{owned, total}` (the overlay of the full card), or null.
 * @param {object|null} state  save after the fight
 * @param {{cardId: string, huntIndex?: number}} reward
 * @returns {{owned: number, total: number}|null}
 */
export function pieceProgress(state, reward) {
  const hunts = state && Array.isArray(state.pieces) ? state.pieces : [];
  const hunt = Number.isInteger(reward && reward.huntIndex) && hunts[reward.huntIndex] && hunts[reward.huntIndex].cardId === reward.cardId
    ? hunts[reward.huntIndex] : hunts.find((p) => p && reward && p.cardId === reward.cardId);
  if (!hunt || !(hunt.total > 0)) return null;
  return { owned: Math.max(0, Math.min(hunt.total, hunt.owned | 0)), total: hunt.total | 0 };
}
