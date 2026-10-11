'use strict';

/**
 * 20-card fixture catalog in the data/cards.json shape (architecture §3.1) plus a fixture cards-db.
 */

export const CAPS = {
  common: [9, 10, 11, 12, 13],
  standard: [10, 12, 14, 16, 18],
  uncommon: [11, 15, 19, 23, 27],
  rare: [12, 18, 24, 30, 36],
  heroic: [13, 21, 29, 37, 45],
  legendary: [14, 24, 34, 44, 54],
  ultimate: [15, 27, 39, 51, 63],
};

function card(id, name, tribe, rarity, mana, dirs, attack, hp, ability, set = 'main') {
  return {
    id, name, tribe, rarity, mana, dirs,
    base: { attack, hp, ability },
    caps: CAPS[rarity].slice(),
    growth: { attack: [null, null, null, null, null], hp: [null, null, null, null, null], ability: [null, null, null, null, null] },
    ability: ability == null ? null : { text: 'Does {v}.', effects: [{ type: 'strengthen', target: 'self', amount: 'value' }] },
    set,
    art: {},
    categories: [],
    sourceText: '',
  };
}

export const FIXTURE_CARDS = [
  card('envoy', 'Envoy', 'elf', 'common', 2, ['direct'], 100, 100, null),
  card('pikeman', 'Pikeman', 'dwarf', 'common', 2, ['direct'], 100, 100, null),
  card('pouch-tearer', 'Pouch Tearer', 'orc', 'common', 2, ['direct'], 100, 100, null),
  card('bone-breaker', 'Bone Breaker', 'orc', 'standard', 4, ['direct'], 200, 200, null),
  card('scout', 'Scout', 'elf', 'standard', 4, ['left', 'direct'], 200, 200, null),
  card('master-brewer', 'Master Brewer', 'dwarf', 'standard', 3, ['direct'], 100, 200, null),
  card('throat-cutter', 'Throat Cutter', 'orc', 'standard', 3, ['direct'], 200, 100, null),
  card('sister-elenia', 'Sister Elenia', 'elf', 'heroic', 18, ['direct'], 900, 1500, 600),
  card('wilderness-shaper', 'Wilderness Shaper', 'neutral', 'ultimate', 30, [], 0, 2000, 1000, 'the-dark-beyond'),
  card('arch-angel', 'Arch Angel', 'neutral', 'uncommon', 9, ['direct'], 200, 500, 400),
  card('club-swinger', 'Club Swinger', 'orc', 'uncommon', 6, ['direct'], 300, 300, null),
  card('tunnel-digger', 'Tunnel Digger', 'dwarf', 'uncommon', 9, ['direct'], 200, 300, 400),
  card('basilisk', 'Basilisk', 'neutral', 'uncommon', 9, ['direct'], 100, 500, null),
  card('rat-eater', 'Rat Eater', 'orc', 'rare', 11, ['direct'], 720, 480, null),
  card('armorer', 'Armorer', 'dwarf', 'rare', 12, ['direct'], 480, 720, 240),
  card('phoenix', 'Phoenix', 'neutral', 'rare', 13, ['direct'], 720, 480, null),
  card('guruk-the-destroyer', 'Guruk the Destroyer', 'orc', 'rare', 15, ['direct'], 600, 1080, null),
  card('dwarf-king', 'Dwarf King', 'dwarf', 'legendary', 24, ['direct'], 800, 2400, 1600),
  card('imperial-dragon', 'Imperial Dragon', 'neutral', 'legendary', 25, ['left', 'direct', 'right'], 3000, 2000, null),
  card('airborne-parasite', 'Airborne Parasite', 'neutral', 'rare', 13, ['direct'], 600, 480, 480, 'the-dark-beyond'),
  card('lich-king', 'Lich King', 'neutral', 'heroic', 1, [], 0, 100, null, 'unique-events'),
];

/**
 * Fixture cards database with the src/core/cards-db.js query API.
 * @param {object[]} [cards]
 * @returns {{get: Function, all: Function, byRarity: Function, byTribe: Function, bySet: Function, random: Function}}
 */
export function makeDb(cards = FIXTURE_CARDS) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  return {
    get: (id) => byId.get(id),
    all: () => cards.slice(),
    byRarity: (r) => cards.filter((c) => c.rarity === r),
    byTribe: (t) => cards.filter((c) => c.tribe === t),
    bySet: (s) => cards.filter((c) => c.set === s),
    random: (rng, filter) => rng.pick(filter ? cards.filter(filter) : cards),
  };
}
