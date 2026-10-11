'use strict';
/**
 * Battle playback assets (pure): the sprites drawn additively and the original sound names (file stems of
 * assets/orig/sfx) with their seeded variant picker. Sprite URLs come from dom.spriteUrl (assets/orig/ui).
 */
import { pad } from '../dom.js';

/** Sprites the client blended additively (painted on black): drawn through a luminance mask (battle-fx.css). */
export const ADDITIVE_SPRITES = Object.freeze([
  'blast', 'blast2', 'fire1', 'fire2', 'invulnerable_effec_02', 'invulnerable_effec_03', 'invulnerable_effec_04',
  'stun_effect08', 'spell', 'Spell_Circle2', 'Spell_Circle4', 'Spell_Circle5', 'fx_glow', 'white_glow', 'dust', 'sparks',
]);
const ADDITIVE = new Set(ADDITIVE_SPRITES);

/**
 * Is a sprite drawn through the luminance mask (battle-fx.css .add)?
 * @param {string} name
 * @returns {boolean}
 */
export function isAdditive(name) {
  return ADDITIVE.has(name);
}

const variants = (stem, n, padded = true) => Array.from({ length: n }, (_, i) => `${stem}${padded ? pad(i + 1) : i + 1}`);

/** Attack sounds (file stems of assets/orig/sfx) per tribe: wind-up, projectile, impact. */
export const TRIBE_SOUNDS = Object.freeze({
  orc: { windup: variants('anim_attack_attacker_blood_', 3), missile: variants('anim_attack_missile_shadow_', 3), impact: variants('anim_attack_target_blood_', 3) },
  elf: { windup: variants('anim_attack_attacker_arcane_', 3), missile: variants('anim_attack_missile_flash_', 3), impact: variants('anim_attack_target_arcane_', 2) },
  dwarf: { windup: ['anim_attack_attacker_stronghit_01'], missile: variants('anim_attack_missile_shot_', 3), impact: variants('anim_attack_target_stronghit_', 3) },
  neutral: { windup: variants('anim_attack_attacker_sword_', 2), missile: variants('anim_attack_missile_fire_', 3), impact: variants('anim_attack_target_fire_', 2) },
});

/** The other battle sounds (file stems of assets/orig/sfx), each a list of interchangeable variants. */
export const SOUNDS = Object.freeze({
  playerHit: variants('anim_attack_target_hpbar_', 3),
  bolt: variants('anim_attack_missile_flash_', 3),
  abilityImpact: variants('anim_attack_target_flash_', 2),
  poison: variants('anim_attack_target_poison_', 2),
  kill: variants('anim_attack_target_claws_', 2),
  heal: variants('fight_card_heal_', 3, false),
  healAffect: variants('fight_card_heal_affect_', 3, false),
  death: ['fight_card_death_1', 'fight_card_death_2', 'fight_card_death_5'],
  reflect: variants('fight_shot_reflect', 3, false),
  invulnerable: ['fight_invulnerability'],
  revive: ['fight_resurrect'],
  raiseAttack: ['fight_raiseattack'],
  curse: ['fight_curse'],
  curseAffect: ['fight_curse_affect'],
  nextRound: ['fight_nextround'],
  victory: ['fight_victory_msx'],
  defeat: ['fight_defeat_msx'],
  bonus: ['fight_bonus'],
  rewardCard: ['fight_reward_card'],
});

/**
 * Attack sound set of a tribe (unknown tribes sound neutral).
 * @param {string} [tribe]
 * @returns {{windup: string[], missile: string[], impact: string[]}}
 */
export function tribeSounds(tribe) {
  return TRIBE_SOUNDS[String(tribe || '').toLowerCase()] || TRIBE_SOUNDS.neutral;
}

/**
 * Deterministic picker of sound (or value) variants: a small LCG seeded with the battle seed.
 * @param {number} seed
 * @returns {(list: any[]) => any} picks one entry of a list (null for an empty list)
 */
export function createPicker(seed) {
  let s = (Number(seed) >>> 0) || 0x9e3779b9;
  return (list) => {
    if (!Array.isArray(list) || !list.length) return null;
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return list[(s >>> 8) % list.length];
  };
}
