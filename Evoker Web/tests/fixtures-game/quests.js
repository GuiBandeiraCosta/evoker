'use strict';

/**
 * Small quests dataset in the data/quests.json shape, built from fixture card ids.
 */

const mainBand = (q) => q <= 10 ? { rarities: ['common', 'standard'], levels: [1, 3], stages: [0, 0] }
  : q <= 30 ? { rarities: ['standard', 'uncommon'], levels: [2, 8], stages: [0, 0] }
  : q <= 60 ? { rarities: ['uncommon', 'rare'], levels: [5, 14], stages: [0, 0] }
  : q <= 90 ? { rarities: ['rare', 'heroic'], levels: [10, 26], stages: [1, 2] }
  : { rarities: ['heroic', 'legendary'], levels: [20, 34], stages: [2, 2] };
// Round 3 bands (src/core/constants.js QUEST_STAMINA_PER_TAP / QUEST_GOLD_PER_TAP).
const perTap = (q) => q === 1 ? 2 : q <= 5 ? 3 : q <= 10 ? 4 : q <= 30 ? 5 : q <= 70 ? 6 : 7;
const goldPerTap = (q) => q === 1 ? 6 : q <= 5 ? 18 : q <= 10 ? 24 : q <= 30 ? 30 : q <= 70 ? 33 : 36;
const portalBand = (n) => n <= 8 ? { rarities: ['uncommon', 'rare'], levels: [8, 18], stages: [0, 0] }
  : n <= 17 ? { rarities: ['rare', 'heroic'], levels: [14, 30], stages: [1, 1] }
  : { rarities: ['heroic', 'legendary'], levels: [24, 44], stages: [2, 2] };

const MAIN_BOSSES = { 1: 'throat-cutter', 33: 'tunnel-digger', 34: 'rat-eater', 35: 'basilisk', 54: 'phoenix', 57: 'armorer', 72: 'guruk-the-destroyer', 99: 'dwarf-king', 100: 'imperial-dragon' };
const MAIN_STAGE = { 54: 1, 57: 1, 72: 2, 99: 2, 100: 2 };

export function makeMain(count = 100) {
  const nodes = [];
  for (let q = 1; q <= count; q++) {
    const tap = perTap(q);
    const figures = q === 1 ? 5 : Math.min(22, 6 + Math.floor(q / 6));
    nodes.push({
      n: q, section: Math.min(6, Math.ceil(q / 17)), boss: MAIN_BOSSES[q] || null, bossStage: MAIN_STAGE[q] || 0,
      bossHp: q === 1 ? 250 : 1500 + 90 * q, bossCards: q === 1 ? 1 : 4, band: mainBand(q),
      staminaPerTap: tap, figures, stamina: figures * tap, goldPerFigure: goldPerTap(q),
      ...(q === 1 ? { bossCardIds: ['throat-cutter'], bossName: 'Worm Shaman', rewardCard: 'throat-cutter', endGold: 10, burstChance: 0 } : {}),
      token: q <= 30 ? 'neophyte' : q <= 70 ? 'summoner' : 'archmage', pieceRarity: q >= 71 ? 'legendary' : q >= 31 ? 'heroic' : null,
    });
  }
  return { id: 'main', name: 'Main Quest', cards: ['dwarf-king', 'imperial-dragon', 'sister-elenia'], gemReward: 31700, nodes };
}

export function makePortal(id, name, cards, gemReward, bossIds) {
  const nodes = [];
  for (let n = 1; n <= 25; n++) {
    const spf = 6 + Math.floor((n - 1) / 2);
    nodes.push({
      n, boss: bossIds[(n - 1) % bossIds.length], bossStage: n <= 8 ? 0 : n <= 17 ? 1 : 2, bossHp: 3965 + 260 * (n - 1), bossCards: 4,
      band: portalBand(n), staminaPerTap: spf, figures: 12, stamina: 12 * spf, goldPerFigure: 34 + 3 * (n - 1),
      token: n <= 8 ? 'low' : 'high', pieceRarity: n <= 8 ? 'rare' : n <= 17 ? 'heroic' : 'legendary', highTokenFirstWin: n === 25,
    });
  }
  return { id, name, cards, gemReward, tokens: { low: { name: 'Low token', gems: 100 }, high: { name: 'High token', gems: 1000 } }, nodes };
}

export const FIXTURE_QUESTS = {
  version: 1,
  sections: [],
  main: makeMain(100),
  portalRotationDays: 7,
  portals: [
    makePortal('the-dark-beyond', 'The Dark Beyond', ['airborne-parasite', 'wilderness-shaper'], 4600, ['airborne-parasite', 'wilderness-shaper']),
    makePortal('dragon-hunt', 'Dragon Hunt', ['phoenix', 'imperial-dragon'], 5000, ['phoenix', 'imperial-dragon']),
    makePortal('dwarven-rage', 'Dwarven Rage', ['armorer', 'dwarf-king'], 4000, ['armorer', 'dwarf-king']),
  ],
};
