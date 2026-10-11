/**
 * @file Game-wide constants: rarities, tribes, level caps, growth multipliers and every
 * economy number from docs/design/game-design.md and exploration/research/evoker-research-brief.md.
 * Pure data, no imports, safe for both the browser and Node. Sections: cards · progression · unlocks · economy ·
 * quests · PvP.
 */

/* ----------------------------------------------------------------------------------------------
 * Cards: fusion stages and stat growth, rarities, tribes, directions, sets, card XP, training
 * -------------------------------------------------------------------------------------------- */
/** Highest fusion stage (0 = unfused, 4 = "++++"). */
export const MAX_STAGE = 4;

/** Fusion level-1 reset factor: stage-s level-1 stat = base × 1.15^s (architecture §3.2). */
export const FUSION_RESET_FACTOR = 1.15;

/** When a wiki cap value is below the stage's level-1 value, the cap is forced to level-1 × this. */
export const BAD_CAP_FACTOR = 1.3;

/**
 * Within a stage a stat grows as start + (cap − start) × t^GROWTH_EXPONENT, t = (level−1)/(cap−1).
 * Fitted on 21 mid-level card faces read from 2016–17 videos (rms error 0.3 %, exploration/research/round3/cardstats.md).
 */
export const GROWTH_EXPONENT = 1.1;

/**
 * Evolve bonus q = EVOLVE_BONUS.base + EVOLVE_BONUS.span × avg(level / cap) of the two fused cards. Round 5: the 1.7.0
 * tutorial video fuses two low-level Throat-Cutters and the result counts up to 230 / 115 = base × 1.15 (q = 1; the
 * 211 / 111 read earlier was a frame of the count-up), so the level of the inputs does not lower the result: q = 1
 * for every new fusion. Instances fused before round 5 keep their stored evolveQuality.
 */
export const EVOLVE_BONUS = Object.freeze({ base: 1, span: 0 });

/** Rarity ids in ascending order. */
export const RARITY_ORDER = Object.freeze([
  'common', 'standard', 'uncommon', 'rare', 'heroic', 'legendary', 'ultimate',
]);

/**
 * @typedef {object} RarityDef
 * @property {string} id
 * @property {string} name          display name
 * @property {number} order         0..6
 * @property {string} color         frame colour
 * @property {number[]} caps        level cap per stage 0..4
 * @property {number[]} growth      median stat multiplier at the cap of each stage vs level 1 (brief §3.2)
 * @property {number[]} fusionCosts gold to fuse from stage i to i+1 (index 0..3)
 * @property {{k:number, base:number, perFusion:number}} sell  gold = k × mana × (base + level + perFusion × stage)
 * @property {number} sacrificeFactor  rarity factor of the sacrifice XP formula
 * @property {[number, number]} manaRange
 * @property {number} pieces        puzzle pieces needed to complete a card of this rarity
 */

/** @type {Readonly<Record<string, RarityDef>>} */
export const RARITIES = Object.freeze({
  common: {
    id: 'common', name: 'Common', order: 0, color: '#9a9a9a',
    caps: [9, 10, 11, 12, 13], growth: [1.87, 2.36, 2.91, 3.52, 4.19],
    fusionCosts: [200, 800, 1800, 3200], sell: { k: 5, base: 9, perFusion: 1 },
    sacrificeFactor: 0.6, manaRange: [1, 2], pieces: 1,
  },
  standard: {
    id: 'standard', name: 'Standard', order: 1, color: '#d8d8d8',
    caps: [10, 12, 14, 16, 18], growth: [2.0, 2.65, 3.4, 4.25, 6.9],
    fusionCosts: [400, 1600, 3600, 6400], sell: { k: 6.5, base: 10, perFusion: 2 },
    sacrificeFactor: 0.8, manaRange: [3, 5], pieces: 1,
  },
  uncommon: {
    id: 'uncommon', name: 'Uncommon', order: 2, color: '#3ccf4e',
    caps: [11, 15, 19, 23, 27], growth: [1.8, 2.5, 3.4, 4.7, 6.1],
    fusionCosts: [900, 3600, 8100, 14400], sell: { k: 8.5, base: 11, perFusion: 4 },
    sacrificeFactor: 1, manaRange: [6, 10], pieces: 2,
  },
  rare: {
    id: 'rare', name: 'Rare', order: 3, color: '#3b82f6',
    caps: [12, 18, 24, 30, 36], growth: [1.58, 2.22, 3.15, 4.11, 5.66],
    fusionCosts: [1920, 7680, 17280, 30720], sell: { k: 20, base: 12, perFusion: 6 },
    sacrificeFactor: 1.6, manaRange: [11, 15], pieces: 4,
  },
  heroic: {
    id: 'heroic', name: 'Heroic', order: 4, color: '#a855f7',
    caps: [13, 21, 29, 37, 45], growth: [1.43, 2.04, 2.84, 3.88, 5.24],
    fusionCosts: [3750, 15000, 33750, 60000], sell: { k: 30, base: 13, perFusion: 8 },
    sacrificeFactor: 2.4, manaRange: [16, 20], pieces: 6,
  },
  legendary: {
    id: 'legendary', name: 'Legendary', order: 5, color: '#f59e0b',
    caps: [14, 24, 34, 44, 54], growth: [1.31, 1.86, 2.6, 3.58, 4.87],
    fusionCosts: [7200, 28800, 64800, 115200], sell: { k: 50, base: 14, perFusion: 10 },
    sacrificeFactor: 3.5, manaRange: [21, 25], pieces: 10,
  },
  ultimate: {
    id: 'ultimate', name: 'Ultimate', order: 6, color: '#ef4444',
    caps: [15, 27, 39, 51, 63], growth: [1.45, 2.25, 3.3, 4.6, 6.3],
    fusionCosts: [10780, 43120, 97020, 172480], sell: { k: 55, base: 15, perFusion: 12 },
    sacrificeFactor: 5, manaRange: [30, 30], pieces: 12,
  },
});

/** Tribe ids; the three main tribes first, then neutral. */
export const TRIBE_ORDER = Object.freeze(['dwarf', 'elf', 'orc', 'neutral']);

/**
 * @typedef {object} TribeDef
 * @property {string} id
 * @property {string} name
 * @property {string} plural
 * @property {string} color
 * @property {string} emblem   icon name under assets/ui (emblem-<name>.svg)
 * @property {boolean} main    counts for the tribe bonus
 */

/** @type {Readonly<Record<string, TribeDef>>} */
export const TRIBES = Object.freeze({
  dwarf: { id: 'dwarf', name: 'Dwarf', plural: 'Dwarves', color: '#3fae4a', emblem: 'crystal', main: true },
  elf: { id: 'elf', name: 'Elf', plural: 'Elves', color: '#3a8de0', emblem: 'triple-arrow', main: true },
  orc: { id: 'orc', name: 'Orc', plural: 'Orcs', color: '#d9432f', emblem: 'axe', main: true },
  neutral: { id: 'neutral', name: 'Neutral', plural: 'Neutrals', color: '#f2a93b', emblem: 'flame', main: false },
});

/** Valid attack directions, in canonical order. */
export const DIRECTIONS = Object.freeze(['left', 'direct', 'right', 'ownLeft', 'ownRight']);

/** Card sets (the main pool plus one per portal / event; the portal sets rotate, data/quests.json portalRotationDays). */
export const SETS = Object.freeze([
  { id: 'main', name: 'Main', portal: false, setReward: 31700, setSize: 17 },
  { id: 'the-dark-beyond', name: 'The Dark Beyond', portal: true, setReward: 4600, setSize: 8 },
  { id: 'dawn-of-eternity', name: 'Dawn of Eternity', portal: true, setReward: 5600, setSize: 8 },
  { id: 'desert-twilight', name: 'Desert Twilight', portal: true, setReward: 4000, setSize: 8 },
  { id: 'divine-peace', name: 'Divine Peace', portal: true, setReward: 4000, setSize: 8 },
  { id: 'dragon-hunt', name: 'Dragon Hunt', portal: true, setReward: 5000, setSize: 8 },
  { id: 'dread-empress', name: 'Dread Empress', portal: true, setReward: 4500, setSize: 8 },
  { id: 'dwarven-rage', name: 'Dwarven Rage', portal: true, setReward: 4000, setSize: 8 },
  { id: 'dying-dreams', name: 'Dying Dreams', portal: true, setReward: 5300, setSize: 8 },
  { id: 'unique-events', name: 'Unique Events', portal: false, setReward: 0, setSize: 3 },
  // Round 5: main-line album sets of the /26 client (exploration/research/round5/starter-sets.md), shown after the portals.
  // `cards` = the page order; membership is also in data/card-overrides.json (`sets`).
  { id: 'dwarven-apprentice', name: 'Dwarven Apprentice', portal: false, album: true, setReward: 50, setSize: 8,
    cards: ['pikeman', 'master-brewer', 'iron-breaker', 'blunderbuss-gunner', 'lance-stabber', 'korim-stoneskull', 'axe-whirler', 'pyromancer'] },
  { id: 'elven-novice', name: 'Elven Novice', portal: false, album: true, setReward: 50, setSize: 8,
    cards: ['envoy', 'keeper', 'falconer', 'scout', 'archer', 'meadow-guard', 'hunter', 'tree-of-life'] },
  { id: 'orc-grunt', name: 'Orc Grunt', portal: false, album: true, setReward: 50, setSize: 8,
    cards: ['pouch-tearer', 'throat-cutter', 'lurking-goblin', 'bone-breaker', 'worm-shaman', 'flinger', 'blood-spitter', 'tribe-avenger'] },
  { id: 'arborearch', name: 'Arborearch', portal: false, album: true, setReward: 3500, setSize: 7,
    cards: ['gremlin', 'will-o-the-wisp', 'ogre', 'giant-lizard', 'giant', 'giant-spider', 'griffin'] },
]);

/**
 * Card XP needed from level l to l+1: max(min, round(k × mana × l^exp / div)); for an unfused Common or Standard
 * card (`lowRarities`, stage 0) at least `low[l − 1]` (the last entry for every higher level) - round 5, fitted on the card levels
 * of the 1.7.0 tutorial video (tutorial-v2.md §11): Master Brewer still level 1 at the Q5 pre-battle after five
 * fights and level 2 after the Q5 win, the Falconer level 2 after its fourth win (Q8), the Envoy level 2 after Q6.
 * The floor stops mattering where the curve passes it (mana 3 from level 7), so mid/high levels keep the curve.
 */
export const CARD_XP_CURVE = Object.freeze({ k: 40, exp: 1.5, div: 10, min: 20, low: Object.freeze([105, 180]), lowRarities: Object.freeze(['common', 'standard']) });

/** Sacrifice (training) XP = k × mana × (level + levelOffset) × rarityFactor. The gold price is ENHANCE_PRICE. */
export const SACRIFICE = Object.freeze({ k: 25, levelOffset: 2 });
/** Fixed XP given by trainer cards when sacrificed. */
export const TRAINER_XP = Object.freeze({
  'lich-king': 4000, 'crystal-ghost': 9000, 'blood-dragon': 20000,
});
/** Most cards sacrificed in one training. */
export const MAX_SACRIFICE_CARDS = 9;

/**
 * Training (enhance) gold price, a port of game.cardmanager.getEnhancePrice summed over the sacrifice stack
 * (game.pricemanager): per card ceil((mana × costManaFactor + (level − 1) × costLevelFactor) ×
 * (1 + raritySellFactor / costRarityDivisor) × rarityEnhanceFactor). rarityEnhanceFactor 2 is the client default;
 * the server config (enhance2Config) is fitted exactly on 8 observed prices (playthroughs-2.md §1.7,
 * playthroughs.md: 111, 180, 240, 240, 441, 520, 540, 660). Sell factors above Uncommon are extrapolated.
 */
export const ENHANCE_PRICE = Object.freeze({
  costManaFactor: 25,
  costLevelFactor: 50,
  costRarityDivisor: 10,
  rarityEnhanceFactor: 2,
  raritySellFactor: Object.freeze({ common: 1, standard: 2, uncommon: 3, rare: 4, heroic: 5, legendary: 6, ultimate: 7 }),
});

/**
 * Card inventory size ("Your cards n/100", lategame.md §3). At or over it, quest and PvP card rewards are sold
 * automatically (client: autosell = cardpoolSize <= count); boosters, fusion and pieces may exceed it.
 */
export const COLLECTION_LIMIT = 100;

/* ----------------------------------------------------------------------------------------------
 * Progression: player start, levels, XP, level-up rewards, stat points, regeneration
 * -------------------------------------------------------------------------------------------- */
/** Fresh account (DECISIONS D1; tutorial.md §0, Benito 2016: 200 gold, 0 gems, 50/50, no potions shown). */
export const PLAYER_START = Object.freeze({
  level: 1, xp: 0, statPoints: 0, stamina: 50, mana: 50, hpMax: 1500,
  gold: 200, gems: 0, staminaPotions: 0, manaPotions: 0,
});
export const MAX_PLAYER_LEVEL = 200;
/** Stat points per level-up and what one point buys (comp_levelup_attribute: HP +30, stamina +1, mana +1). */
export const STAT_POINTS_PER_LEVEL = 12;
export const STAT_POINT_VALUE = Object.freeze({ hp: 30, stamina: 1, mana: 1 });

/** Stamina and mana regenerate by 1 per this many ms of real time. */
export const REGEN_INTERVAL_MS = 60 * 1000;

/**
 * Player XP needed from level L to L+1: round(k × L^exp), levels 1–4 from the `low` table. Player XP comes from
 * minion taps (1 XP per stamina spent, client quest_screen addXp(getXPGain()) per click) and PvP. Fitted on the XP
 * bar: level 6 ≈ 240 and level 7 ≈ 1.15× that (playthroughs-2.md §1.3). The low table (round 5) puts the
 * tutorial's level-ups where the 1.7.0 video has them (tutorial-v2.md §10: level 2 at quest 3 tap 1, 3 at quest 5
 * tap 3, 4 at quest 8 tap 5, 5 at quest 10 tap 6, with the quest-2 replay and one Pieces win on the way).
 */
export const PLAYER_XP_CURVE = Object.freeze({ k: 50, exp: 0.875, low: Object.freeze([47, 47, 92, 94]) });

/**
 * XP earned per fight. Player XP = (base + perOpponentLevel × level) × (winMult on a win): a level-8 rival gave
 * ~21 XP on a win and ~5 on a loss (playthroughs-2.md §1.3). Quest boss fights give no player XP (same source).
 */
export const BATTLE_XP = Object.freeze({
  player: { base: 1.5, perOpponentLevel: 0.5, winMult: 4, questBoss: 0 },
  card: { base: 10, enemyManaDiv: 2, winMult: 1.5, wisdomMult: 2 },
});

/**
 * Level-up rewards (comp_levelup "Rewards" column). Gold = goldPerLevel × new level (L2 100, L3 150, L5 250,
 * L6 300, L7 350 seen). Extras repeat with period 5 from level 2: gems (L2 5, then 50: L7 +50), stamina potion
 * (L3), stamina potion (L4: potion seen, colour unread), mana potion (L5), Neophyte token (L6 bronze token).
 */
export const LEVEL_UP_REWARDS = Object.freeze({
  goldPerLevel: 50,
  /** levels whose gold differs from goldPerLevel × level (tutorial video wqzda6-2fs4: level 4 pays 150) */
  goldOverrides: Object.freeze({ 4: 150 }),
  firstGems: 5,
  gems: 50,
  /** extra by (level − 2) mod 5 */
  cycle: Object.freeze([
    { gems: true }, { potion: 'stamina' }, { potion: 'stamina' }, { potion: 'mana' }, { token: 'neophyte' },
  ]),
});

/* ----------------------------------------------------------------------------------------------
 * Unlocks: features, deck slots, starter cards
 * -------------------------------------------------------------------------------------------- */
/**
 * Player level at which a feature becomes available (DECISIONS D1/D2: fusion 2, arena 4, training 5,
 * league 6; Pieces and Replays are tabs of the Arena). Client feature ids: evolve, pvp, enhance, leagues.
 */
export const FEATURE_UNLOCK_LEVELS = Object.freeze({
  quests: 1, cards: 1, shop: 1, fusion: 2, arena: 4, pieces: 4, replays: 4, training: 5, league: 6,
});

/**
 * Main quest whose first win opens a feature for a save that runs the round-3 tutorial (a `tutorial.r3` record):
 * the "… Unlocked!" popups of the 1.7.0 tutorial appear on the map after these boss wins (Benito: fusion after Q3 at
 * level 2, Arena after Q8 at level 4, Card Training after Q9 still at level 4, Leagues after Q10 at level 5). Saves
 * without the record keep FEATURE_UNLOCK_LEVELS.
 */
export const FEATURE_UNLOCK_QUESTS = Object.freeze({ fusion: 3, arena: 8, pieces: 8, replays: 8, training: 9, league: 10 });

/**
 * Deck slots open by quest progress (client features cardslot1..5, comp_carddeck lockedCardSlots).
 * order: slot indices in the order they open (slots 3 and 2 at the start, then 4, 5, 1; round 3 tutorial:
 * Benito 1.7.0, exploration/research/round3/tutorial-v2.md §2.12, §4.5, §6.10). start: open slots of a new game.
 * quests: open-slot count → main quest whose first win opens it (Q2 → 3 "Card Slot Unlocked!", Q4 → 4, Q7 → 5).
 */
export const DECK_SLOTS = Object.freeze({
  order: Object.freeze([2, 1, 3, 4, 0]),
  start: 2,
  quests: Object.freeze({ 3: 2, 4: 4, 5: 7 }),
});

/**
 * Legacy (pre-round-3) deck slot unlock level by slot index 0..4. Slots now open by quest progress
 * (DECK_SLOTS); this table only sizes the slot count of saves written before that.
 */
export const SLOT_UNLOCK_LEVELS = Object.freeze([5, 1, 1, 1, 3]);

/**
 * Starter collection (DECISIONS D1; tutorial.md §3 item 2): Envoy (Common 100/100/2) in the deck, Master Brewer
 * (Standard 100/200/3) in the collection for the drag-into-deck lesson.
 */
export const STARTER_CARDS = Object.freeze(['envoy', 'master-brewer']);
/** Deck slot index of each starter card that starts in the deck (Envoy in slot 3, the first slot to open). */
export const STARTER_DECK_SLOTS = Object.freeze([2]);

/** Starter collection of a tutorial game (1.7.0: the Envoy alone in deck slot 3; Master Brewer drops in quest 1). */
export const TUTORIAL_STARTER_CARDS = Object.freeze(['envoy']);

/* ----------------------------------------------------------------------------------------------
 * Economy: potions, boosters, gem packs, card pieces
 * -------------------------------------------------------------------------------------------- */
/** Gem price of a potion bought from the Drink-potion dialog (Drinking Contest day: POTION_PRICE_GEMS_EVENT). */
export const POTION_PRICE_GEMS = 40;
export const POTION_PRICE_GEMS_EVENT = 20;

/**
 * Booster packs of the 1.7.4 client (game.boostermanager2, ui.screens.booster.openbooster_screen): every pack
 * is nine face-down cards in a 3×3 grid; each pick costs 1 token of the pack, or `pickGems` gems when the
 * player has none. `slots` is the fixed rarity make-up of the nine cards (Benito tally: big portal pack
 * 1 Legendary + 3 Heroic + 5 Rare, small 1 Heroic + 3 Rare + 5 Uncommon; the main packs are guesses on the
 * same scheme). `portalShare` = chance that a slot draws from the portal's own set when it has that rarity
 * (else the main set); `ultimateChance` = chance the Legendary slot is the portal's Ultimate instead.
 * Gem prices per pick: 50 (Neophyte, playthroughs-2), 975 (Archmage) and 1000 (portal high) from the videos,
 * 250 for the low portal pack (Dark Beyond video), Summoner kept at our earlier 350.
 */
export const BOOSTER_PACKS = Object.freeze({
  neophyte: { id: 'neophyte', name: 'Neophyte Pack', pickGems: 50, portal: false, slots: { uncommon: 5, rare: 3, heroic: 1 } },
  summoner: { id: 'summoner', name: "Summoner's Pack", pickGems: 350, portal: false, slots: { rare: 5, heroic: 3, legendary: 1 } },
  archmage: { id: 'archmage', name: "Archmage's Pack", pickGems: 975, portal: false, slots: { rare: 2, heroic: 5, legendary: 2 } },
  portalLow: { id: 'portalLow', name: 'Portal Pack', pickGems: 250, portal: true, portalShare: 0.5, slots: { uncommon: 5, rare: 3, heroic: 1 } },
  portalHigh: { id: 'portalHigh', name: 'Grand Portal Pack', pickGems: 1000, portal: true, portalShare: 0.6, ultimateChance: 0.1, slots: { rare: 5, heroic: 3, legendary: 1 } },
});
/** Cards in one booster (the 3×3 grid). */
export const BOOSTER_GRID_CARDS = 9;

/**
 * Gem packs of the premium shop (IAP names and USD tiers from the App Store listings, social.md §4; contents from
 * the 2014 shop screen, screens.md §1.8). Shown only: there is no real-money purchase in the offline game.
 */
export const GEM_PACKS = Object.freeze([
  { id: 'apprentice', name: "Apprentice's Bundle", gems: 500, price: '$4.99', sprite: 'shop_gems01' },
  { id: 'wanderer', name: "Wanderer's Purse", gems: 1000, price: '$9.99', sprite: 'shop_gems02' },
  { id: 'hero', name: "Hero's Wallet", gems: 3500, potions: 5, price: '$24.99', sprite: 'shop_gems02' },
  { id: 'treasure', name: "Evoker's Treasure", gems: 10000, potions: 10, card: 'heroic', price: '$49.99', sprite: 'shop_gems05' },
  { id: 'vault', name: "Master's Vault", gems: 20000, potions: 20, card: 'legendary', price: '$99.99', sprite: 'shop_gems05' },
]);

/** Gem price to complete a card by number of missing pieces (index = missing − 1). Halved on Card-piece Day. */
export const PIECE_PRICES = Object.freeze({
  uncommon: [20],
  rare: [30, 60, 140],
  heroic: [170, 285, 625, 1100, 1700],
  legendary: [125, 200, 450, 800, 1250, 1750, 2500, 3200, 4000],
  // Not documented for Ultimate; extrapolated from the Legendary row (assumption).
  ultimate: [150, 250, 550, 950, 1500, 2100, 3000, 3900, 4800, 5600, 6500],
});
/** Gems to buy the first piece of an empty hunt slot (random Rare/Heroic set card); _EVENT on Card-piece Day. */
export const FIRST_PIECE_GEMS = 100;
export const FIRST_PIECE_GEMS_EVENT = 50;
/** Card-piece hunts running at once. */
export const PIECE_HUNT_SLOTS = 8;
/** Daily chance per uncompleted hunt that a simulated raid steals one piece. */
export const PIECE_RAID_CHANCE = 0.2;

/* ----------------------------------------------------------------------------------------------
 * Quests: line sizes, per-tap tables, quality bands, wave and boss rewards
 * -------------------------------------------------------------------------------------------- */
/** Quests of the main line and of each portal (data/quests.json). */
export const MAIN_QUEST_COUNT = 100;
export const PORTAL_QUEST_COUNT = 25;

/** Stamina per minion tap by main-quest band ([fromQuest, toQuest, stamina]). */
export const QUEST_STAMINA_PER_TAP = Object.freeze([
  [1, 1, 2], [2, 5, 3], [6, 10, 4], [11, 30, 5], [31, 70, 6], [71, 100, 7],
]);

/**
 * Gold per minion tap on the main line by quest band ([fromQuest, toQuest, gold]). A tap that hits the minion is
 * always a "Perfect!" tap (client util.questutils.getTapRatingCoins: rating 1 = money.max), so the value is flat
 * per quest. Anchors: Q1 6 (tutorial.md §1.4), Q12–14 30 (playthroughs-2.md §1.1), early quests ~18
 * (playthroughs.md B5), Q97 ~36 (playthroughs.md Qg); i.e. 6 gold per stamina to Q30, flatter after.
 * Portal quests keep their wiki GoldPerFigure.
 */
export const QUEST_GOLD_PER_TAP = Object.freeze([
  [1, 1, 6], [2, 5, 18], [6, 10, 24], [11, 30, 30], [31, 70, 33], [71, 100, 36],
]);

/** Occasional bonus burst on a tap: ~1 in 10 taps pays ~4.5× the tap value (Q12: one 140 burst at 30/tap). */
export const QUEST_TAP_BURST = Object.freeze({ chance: 0.1, mult: 4.5 });
/** Player XP per minion tap = XP_PER_STAMINA × stamina per tap (see PLAYER_XP_CURVE). */
export const XP_PER_STAMINA = 1;
/** Winning the last quest of a portal pays this much gold on top of the boss reward. */
export const PORTAL_FINAL_GOLD = 1000;

/** Card quality bands (game-design §4.3). */
export const QUEST_BANDS = Object.freeze([
  { id: 'main-1', scope: 'main', from: 1, to: 10, rarities: ['common', 'standard'], levels: [1, 3], stage: 0 },
  { id: 'main-2', scope: 'main', from: 11, to: 30, rarities: ['standard', 'uncommon'], levels: [2, 8], stage: 0 },
  { id: 'main-3', scope: 'main', from: 31, to: 60, rarities: ['uncommon', 'rare'], levels: [5, 14], stage: 0 },
  { id: 'main-4', scope: 'main', from: 61, to: 90, rarities: ['rare', 'heroic'], levels: [10, 26], stage: 1 },
  { id: 'main-5', scope: 'main', from: 91, to: 100, rarities: ['heroic', 'legendary'], levels: [20, 34], stage: 2 },
  { id: 'portal-1', scope: 'portal', from: 1, to: 8, rarities: ['uncommon', 'rare'], levels: [8, 18], stage: 0 },
  { id: 'portal-2', scope: 'portal', from: 9, to: 17, rarities: ['rare', 'heroic'], levels: [14, 30], stage: 1 },
  { id: 'portal-3', scope: 'portal', from: 18, to: 25, rarities: ['heroic', 'legendary'], levels: [24, 44], stage: 2 },
]);
/** Wave reward roll (probabilities sum to 1). */
export const WAVE_REWARDS = Object.freeze({ card: 0.2, nothing: 0.8 });
/** Boss reward roll (probabilities sum to 1). */
export const BOSS_REWARDS = Object.freeze({ gold: 0.45, token: 0.25, piece: 0.15, potion: 0.1, gems: 0.05 });
export const BOSS_GEMS_RANGE = Object.freeze([13, 82]);
/** Boss gold reward = bossMult × MAX_WAVE_SIZE × gold per tap (the tap gold itself is QUEST_GOLD_PER_TAP). */
export const QUEST_GOLD = Object.freeze({ bossMult: 3 });

/**
 * Main-quest boss player hp = base + perQuest × quest; portal boss hp ≈ base + perNode × (node − 1)
 * (The Dark Beyond: 3965 at node 1, 4225 at node 2 … 10465 at node 25).
 */
export const BOSS_HP = Object.freeze({ main: { base: 1500, perQuest: 90 }, portal: { base: 3965, perNode: 260 } });
/** Booster token tiers by main-quest number. */
export const QUEST_TOKEN_TIERS = Object.freeze([
  { from: 1, to: 30, token: 'neophyte' }, { from: 31, to: 70, token: 'summoner' }, { from: 71, to: 100, token: 'archmage' },
]);
/** First main quest at which pieces of each rarity can drop. */
export const PIECE_DROP_FROM_QUEST = Object.freeze({ heroic: 31, legendary: 71 });
/** First portal node whose boss can drop a card piece. */
export const PORTAL_PIECE_FROM_NODE = 4;

/* ----------------------------------------------------------------------------------------------
 * PvP: Arena and League
 * -------------------------------------------------------------------------------------------- */
/**
 * Arena: gold = goldPerEnemyMana × enemy deck mana (× winGoldMult on a win), Tournament Points per won Arena or piece
 * fight, one offer per difficulty (opponent level offset [min, max] and side power), replaced after every fight and
 * by the offer rotation (offerRotationMinutes); the simulated-player pool size and the replays kept in the save.
 */
export const ARENA = Object.freeze({
  goldPerEnemyMana: 6, winGoldMult: 2, tournamentPointsPerWin: 10,
  offerRotationMinutes: 30,
  difficulties: [
    { id: 'easy', color: 'green', levelOffset: [-2, 0], power: 0.7 },
    { id: 'normal', color: 'yellow', levelOffset: [-1, 1], power: 1.0 },
    { id: 'hard', color: 'red', levelOffset: [1, 3], power: 1.3 },
  ],
  simulatedPlayers: 60,
  replaysKept: 10,
});

/** League (DECISIONS D3; cardstats.md §4, social.md §1; game-design §6). */
export const LEAGUE = Object.freeze({
  durationHours: 24,
  /** You + 49 simulated players (the 1.7 list showed ~49 rows). */
  players: 50,
  pointsPerWin: 150,
  pointsPerWinDouble: 300,
  /** League points per WON fight by source: league fights 150 (videos); arena / piece-hunt wins give a variable
   *  amount that depends on the opponent (forum + 0FHHEDEqb1I deltas +21 / +31 / +119, league-timing.md), so
   *  these are the bases scaled by `stakeLevelStep` per level of difference, within `stakeRange`. */
  sourcePoints: { league: 150, arena: 50, pieces: 30 },
  /** Arena base points by the opponent's difficulty (green / yellow / red row). */
  arenaPoints: { easy: 20, normal: 60, hard: 120 },
  stakeLevelStep: 0.08,
  stakeRange: [0.6, 1.6],
  maxFightsPerOpponent: 3,
  /** The top 3 advance to the next league, everybody else goes back to Bronze. */
  promote: 3,
  tournamentPointsDiv: 10,
  tiers: [
    { id: 'bronze', name: 'Bronze League', strength: 0.9, simTop: 2400 },
    { id: 'silver', name: 'Silver League', strength: 1.05, simTop: 5000 },
    { id: 'gold', name: 'Gold League', strength: 1.2, simTop: 11000 },
  ],
  /** Prize bands per tier (PRIZES screen of the 1.7 client, Evoker Br 0FHHEDEqb1I). card = rarity of 1 card. */
  prizes: {
    gold: [
      { from: 1, to: 1, card: 'legendary', mana: 12 }, { from: 2, to: 2, card: 'legendary' }, { from: 3, to: 3, card: 'heroic' },
      { from: 4, to: 4, gems: 700 }, { from: 5, to: 9, mana: 10, stamina: 10 }, { from: 10, to: 19, mana: 10 }, { from: 20, to: 29, gems: 200 },
    ],
    silver: [
      { from: 1, to: 1, card: 'heroic', mana: 7 }, { from: 2, to: 2, card: 'heroic' }, { from: 3, to: 3, mana: 7, stamina: 7 },
      { from: 4, to: 4, gems: 400 }, { from: 5, to: 9, mana: 5, stamina: 5 }, { from: 10, to: 19, mana: 5 }, { from: 20, to: 29, gems: 100 },
    ],
    bronze: [
      { from: 1, to: 1, card: 'rare', mana: 5 }, { from: 2, to: 2, card: 'rare' }, { from: 3, to: 3, mana: 5, stamina: 5 },
      { from: 4, to: 4, gems: 200 }, { from: 5, to: 9, mana: 2, stamina: 2 }, { from: 10, to: 19, mana: 2 }, { from: 20, to: 29, gems: 25 },
    ],
  },
});
