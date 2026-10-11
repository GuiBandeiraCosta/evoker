'use strict';

import { takeRng, utcDay, DAY_MS, inTutorial } from './state.js';
import { spendGems, addGems, addPotions, addTokens, tokenCount, eventId, eventClock } from './player.js';
import { addCard, cardsOfRarity } from './collection.js';
import { questLine, portalSchedule } from './quests.js';
import { shuffle } from './opponents.js';
import { BOOSTER_PACKS, BOOSTER_GRID_CARDS, RARITY_ORDER, GEM_PACKS, SETS } from '../core/constants.js';

/**
 * Shop and economy (game-design §7): boosters (the 1.7.4 nine-card grid of game.boostermanager2), potions,
 * daily rewards, daily events, set collections. Open boosters live in `state.boosters`, keyed by `boosterKey`.
 */

/**
 * The booster packs (constants BOOSTER_PACKS) with their token kind and the rarities a pack may contain
 * (the coloured squares on the shop banner), in shop order.
 */
export const BOOSTER_CARDS = BOOSTER_GRID_CARDS;
export const BOOSTERS = Object.freeze(Object.fromEntries(Object.values(BOOSTER_PACKS).map((p) => [p.id, Object.freeze({
  ...p, token: p.id, gems: p.pickGems,
  mayContain: Object.freeze([...RARITY_ORDER.filter((r) => p.slots[r]), ...(p.ultimateChance ? ['ultimate'] : [])]),
})])));

/** 21-day daily reward cycle (brief §5.4). */
export const DAILY_REWARDS = [
  { stamina: 2 }, { mana: 1, stamina: 1 }, { gems: 40 }, { stamina: 2 }, { mana: 1, stamina: 1 }, { gems: 80 }, { tokens: 'neophyte', count: 2 },
  { stamina: 3 }, { mana: 1, stamina: 2 }, { gems: 120 }, { stamina: 3 }, { mana: 1, stamina: 2 }, { gems: 160 }, { tokens: 'summoner', count: 2 },
  { stamina: 4 }, { mana: 2, stamina: 2 }, { gems: 200 }, { stamina: 4 }, { mana: 2, stamina: 2 }, { gems: 240 }, { tokens: 'archmage', count: 2 },
];

export const EVENTS = [
  { id: 'infinite-wisdom', name: 'Infinite Wisdom', desc: 'Double card XP from every fight.' },
  { id: 'drinking-contest', name: 'Drinking Contest', desc: 'Potions cost 20 gems.' },
  { id: 'card-piece-day', name: 'Card-piece Day', desc: 'Card-piece prices halved, first piece 50 gems.' },
  { id: 'double-league-points', name: 'Double League Points', desc: '300 league points per win.' },
  { id: 'great-potion-deal', name: 'Great Potion Deal', desc: '3 potions for 60 gems in the shop.' },
  { id: 'get-the-best-cards', name: 'Get the Best Cards', desc: 'Boosters cost 50 % less gems.' },
  { id: 'golden-day', name: 'Golden Day', desc: '+50 % gold from quests and arena.' },
];
export const POTION_DEAL_GEMS = 60;
export const POTION_DEAL_COUNT = 3;

/**
 * The daily event for a date (deterministic hash of the UTC day). With a save: none while its first-session
 * tutorial runs (state.inTutorial), so the tutorial plays without double card XP, Golden Day gold etc. and its
 * numbers stay those of the 1.7.0 tutorial video; the events start once the tutorial is finished.
 * @param {number} now
 * @param {object|null} [state]  the save the event applies to (omit for the calendar's event of the day)
 * @returns {{id: string, name: string, desc: string}|null}  null only for a save in the tutorial
 */
export function dailyEvent(now, state) {
  if (state && inTutorial(state)) return null;
  const day = Math.floor(now / DAY_MS);
  let h = Math.imul(day ^ 0x5bd1e995, 0x9e3779b1) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return EVENTS[h % EVENTS.length];
}

/**
 * Gem price of one pick from a booster when the player has no token (−50 % on Get the Best Cards).
 * @param {string} boosterId
 * @param {object|string|null} [event]
 * @returns {number}
 */
export function boosterPrice(boosterId, event) {
  const b = BOOSTERS[boosterId];
  if (!b) throw new Error('Unknown booster ' + boosterId);
  return eventId(event) === 'get-the-best-cards' ? Math.ceil(b.pickGems / 2) : b.pickGems;
}

/**
 * Save key of a booster: the pack id, plus the portal for the portal packs ("portalHigh@the-dark-beyond").
 * @param {string} boosterId
 * @param {string|null} [portalId]
 * @returns {string}
 */
export function boosterKey(boosterId, portalId) {
  const b = BOOSTERS[boosterId];
  if (!b) throw new Error('Unknown booster ' + boosterId);
  if (!b.portal) return boosterId;
  if (!portalId) throw new Error('Unknown portal ' + portalId);
  return `${boosterId}@${portalId}`;
}

/**
 * Card ids of the main set (the Neophyte / Summoner / Archmage packs and the "other Mages" of portal packs).
 * @param {object} deps
 * @returns {string[]|null}
 */
function mainSetIds(deps) {
  const fromDb = deps.db.bySet ? (deps.db.bySet('main') || []).map((d) => d.id) : [];
  if (fromDb.length) return fromDb;
  const line = questLine(deps, 'main');
  return line && line.cards && line.cards.length ? line.cards : null;
}

/**
 * Card defs a booster can produce, by slot rarity.
 * @param {object} deps
 * @param {string} boosterId
 * @param {string} [portalId]
 * @returns {Array<{rarity: string, count: number, portal: object[], main: object[]}>}
 */
export function boosterPool(deps, boosterId, portalId) {
  const b = BOOSTERS[boosterId];
  if (!b) throw new Error('Unknown booster ' + boosterId);
  let portalIds = null;
  if (b.portal) {
    const line = questLine(deps, portalId);
    if (!line || portalId === 'main') throw new Error('Unknown portal ' + portalId);
    portalIds = line.cards;
  }
  const main = mainSetIds(deps);
  const rarities = [...Object.keys(b.slots), ...(b.ultimateChance ? ['ultimate'] : [])];
  // a booster slot never produces a trainer card (collection.cardsOfRarity)
  return rarities.map((rarity) => {
    const mainCards = cardsOfRarity(deps.db, rarity, main);
    return {
      rarity,
      count: b.slots[rarity] || 0,
      portal: portalIds ? cardsOfRarity(deps.db, rarity, portalIds) : [],
      main: mainCards.length ? mainCards : cardsOfRarity(deps.db, rarity, null),
    };
  });
}

/**
 * Roll the nine cards of a booster (fixed rarity make-up, shuffled over the 3×3 grid).
 * Portal packs draw a slot from the portal's set with `portalShare` when the set has the rarity, else from the
 * main set; the big portal pack's Legendary slot is the portal's Ultimate with `ultimateChance`.
 * @param {object} rng
 * @param {object} deps
 * @param {string} boosterId
 * @param {string} [portalId]
 * @returns {string[]} nine card ids, by grid position (0..8, row by row)
 */
export function rollBoosterCards(rng, deps, boosterId, portalId) {
  const b = BOOSTERS[boosterId];
  const pool = boosterPool(deps, boosterId, portalId);
  const byRarity = Object.fromEntries(pool.map((e) => [e.rarity, e]));
  const out = [];
  for (const e of pool) {
    for (let i = 0; i < e.count; i++) {
      let entry = e;
      if (e.rarity === 'legendary' && b.ultimateChance && byRarity.ultimate && byRarity.ultimate.portal.length && rng.chance(b.ultimateChance)) {
        entry = byRarity.ultimate;
      }
      const fromPortal = entry.portal.length > 0 && (!entry.main.length || rng.chance(b.portalShare || 0));
      const list = fromPortal ? entry.portal : entry.main;
      if (list.length) out.push(rng.pick(list).id);
    }
  }
  return shuffle(rng, out); // over the grid positions
}

/**
 * The booster a pack currently holds in the save (null before its first visit). Old saves have no
 * `state.boosters`; it is treated as empty.
 * @param {object} state
 * @param {string} boosterId
 * @param {string} [portalId]
 * @returns {{id: string, portalId: string|null, cards: string[], drawn: number[], opened: boolean, seq: number}|null}
 */
export function getBooster(state, boosterId, portalId) {
  const bag = state.boosters && typeof state.boosters === 'object' ? state.boosters : {};
  return bag[boosterKey(boosterId, portalId)] || null;
}

function putBooster(state, booster) {
  const bag = state.boosters && typeof state.boosters === 'object' ? state.boosters : {};
  return { ...state, boosters: { ...bag, [boosterKey(booster.id, booster.portalId)]: booster } };
}

function rollNewBooster(state, deps, boosterId, portalId, seq) {
  const t = takeRng(state, deps);
  const cards = rollBoosterCards(t.rng, deps, boosterId, portalId);
  const booster = { id: boosterId, portalId: BOOSTERS[boosterId].portal ? portalId : null, cards, drawn: [], opened: false, seq };
  return { state: putBooster(t.state, booster), booster };
}

/**
 * Enter a booster (booster screen): rolls a sealed booster when the pack has none yet; `open: true` marks it
 * opened (the chest-to-grid intro has played). Free: the cards are paid per pick.
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @param {{booster: string, portalId?: string, open?: boolean}} args
 * @returns {{state: object, booster: object, fresh: boolean}}
 */
export function openBooster(state, deps, now, args) {
  if (!BOOSTERS[args.booster]) throw new Error('Unknown booster');
  let s = state;
  let booster = getBooster(s, args.booster, args.portalId);
  const fresh = !booster || !booster.opened;
  if (!booster) ({ state: s, booster } = rollNewBooster(s, deps, args.booster, args.portalId, 1));
  if (args.open && !booster.opened) {
    booster = { ...booster, opened: true };
    s = putBooster(s, booster);
  }
  return { state: s, booster, fresh };
}

/**
 * How the next pick from a booster gets paid (openbooster_screen getPayment / tryDrawCard): one token of the
 * pack while the player has any, else the pack's gem price per card.
 * @param {object} state
 * @param {string} boosterId
 * @param {string} [portalId]
 * @param {object|string|null} [event]
 * @returns {{type: 'token'|'gems', amount: number, canPay: boolean, tokens: number, gems: number}}
 */
export function pickPayment(state, boosterId, portalId, event) {
  const tokens = tokenCount(state, boosterId, portalId);
  const gems = state.player.gems;
  if (tokens > 0) return { type: 'token', amount: 1, canPay: true, tokens, gems };
  const amount = boosterPrice(boosterId, event);
  return { type: 'gems', amount, canPay: gems >= amount, tokens, gems };
}

/**
 * The collection set a card counts for (its portal set, else the main set) with the owned count.
 * @param {object} state
 * @param {object} deps
 * @param {string} cardId
 * @returns {{id: string, name: string, owned: number, total: number}|null}
 */
export function setProgressFor(state, deps, cardId) {
  const col = setCollections(state, deps);
  const hit = col.find((c) => c.id !== 'main' && c.cards.some((x) => x.cardId === cardId)) || col.find((c) => c.cards.some((x) => x.cardId === cardId));
  return hit ? { id: hit.id, name: hit.name, owned: hit.ownedCount, total: hit.total } : null;
}

/**
 * Draw (reveal) the face-down card at a grid position: pays 1 token or the gem price and adds the card.
 * `setAdded` is filled when the card is new to its collection set ("Card added to set: X n/8").
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @param {{booster: string, portalId?: string, position: number, event?: object|string|null}} args
 * @returns {{state: object, cardId: string, uid: string|null, converted: boolean, gold: number, paidWith: 'token'|'gems', cost: number,
 *   setAdded: {id: string, name: string, owned: number, total: number}|null, remaining: number, booster: object}}
 */
export function drawBoosterCard(state, deps, now, args) {
  const booster = getBooster(state, args.booster, args.portalId);
  if (!booster) throw new Error('The booster is not open');
  const pos = Number(args.position);
  const cardId = Number.isInteger(pos) ? booster.cards[pos] : undefined;
  if (!cardId) throw new Error('No such card');
  if (booster.drawn.includes(pos)) throw new Error('This card was already drawn');
  const pay = pickPayment(state, args.booster, args.portalId, args.event);
  if (!pay.canPay) throw new Error('Not enough gems');
  let s = pay.type === 'token' ? addTokens(state, args.booster, -1, args.portalId) : spendGems(state, pay.amount);
  const before = setProgressFor(s, deps, cardId);
  const wasOwned = s.cards.some((c) => c.cardId === cardId);
  const r = addCard(s, deps, cardId, { stage: 0, level: 1, force: true }); // boosters may exceed the card limit
  s = r.state;
  const setAdded = before && !wasOwned && !r.converted ? { ...before, owned: before.owned + 1 } : null;
  const next = { ...booster, opened: true, drawn: [...booster.drawn, pos] };
  s = putBooster(s, next);
  return {
    state: s, cardId, uid: r.uid, converted: r.converted, gold: r.gold, paidWith: pay.type, cost: pay.type === 'gems' ? pay.amount : 0,
    setAdded, remaining: next.cards.length - next.drawn.length, booster: next,
  };
}

/**
 * Discard the current booster and put a new sealed one in its place (the green reset button,
 * "Do you want to open a new booster?"). Undrawn cards are lost; nothing is paid.
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @param {{booster: string, portalId?: string}} args
 * @returns {{state: object, booster: object}}
 */
export function discardBooster(state, deps, now, args) {
  if (!BOOSTERS[args.booster]) throw new Error('Unknown booster');
  const old = getBooster(state, args.booster, args.portalId);
  return rollNewBooster(state, deps, args.booster, args.portalId, (old ? old.seq : 0) + 1);
}

/**
 * Reward for a streak day (1-based, cycles every 21 days).
 * @param {number} day
 * @returns {object}
 */
export function dailyRewardFor(day) {
  return DAILY_REWARDS[(Math.max(1, day) - 1) % DAILY_REWARDS.length];
}

/**
 * Previous UTC day string.
 * @param {string} day  'YYYY-MM-DD'
 * @returns {string}
 */
export function previousDay(day) {
  return utcDay(Date.parse(day + 'T00:00:00Z') - DAY_MS);
}

/**
 * Claim the daily reward on the first open of a UTC day. Consecutive days advance the streak; a missed day
 * resets it to 1.
 * @param {object} state
 * @param {number} now
 * @returns {{state: object, claimed: boolean, day: number, reward: object|null}}
 */
export function claimDaily(state, now) {
  const today = utcDay(now);
  const d = state.daily || { streak: 0, lastClaim: '' };
  if (d.lastClaim === today) return { state, claimed: false, day: d.streak, reward: null };
  const streak = d.lastClaim === previousDay(today) ? d.streak + 1 : 1;
  const reward = dailyRewardFor(streak);
  let s = { ...state, daily: { ...d, streak, lastClaim: today } };
  if (reward.gems) s = addGems(s, reward.gems);
  if (reward.stamina) s = addPotions(s, 'stamina', reward.stamina);
  if (reward.mana) s = addPotions(s, 'mana', reward.mana);
  if (reward.tokens) s = addTokens(s, reward.tokens, reward.count || 1);
  return { state: s, claimed: true, day: streak, reward: { day: streak, ...reward } };
}

/**
 * Is the Great Potion Deal purchasable now (event day, once per day)?
 * @param {object} state
 * @param {number} now
 * @param {object|string|null} [event]
 * @returns {boolean}
 */
export function potionDealAvailable(state, now, event) {
  return eventId(event) === 'great-potion-deal' && (state.daily.potionDealDay || '') !== utcDay(now);
}

/**
 * Buy the Great Potion Deal: 2 stamina + 1 mana potion for 60 gems, once per event day.
 * @param {object} state
 * @param {number} now
 * @param {object|string|null} [event]
 * @returns {{state: object, cost: number}}
 */
export function buyPotionDeal(state, now, event) {
  if (!potionDealAvailable(state, now, event)) throw new Error('The potion deal is not available');
  let s = spendGems(state, POTION_DEAL_GEMS);
  s = addPotions(s, 'stamina', 2);
  s = addPotions(s, 'mana', 1);
  return { state: { ...s, daily: { ...s.daily, potionDealDay: utcDay(now) } }, cost: POTION_DEAL_GEMS };
}

/**
 * The main-line album sets of constants SETS (`album: true`: Dwarven Apprentice, Elven Novice, Orc Grunt,
 * Arborearch; exploration/research/round5/starter-sets.md) in their page order, limited to cards the database knows
 * (their membership is also in data/cards.json `sets`).
 * @param {object} deps
 * @returns {Array<{id: string, name: string, gemReward: number, cards: string[]}>}
 */
export function albumSets(deps) {
  const db = deps.db;
  return SETS.filter((s) => s.album).map((s) => ({
    id: s.id,
    name: s.name,
    gemReward: s.setReward,
    cards: (s.cards || []).filter((id) => db.get(id)),
  })).filter((s) => s.cards.length > 0);
}

/**
 * Set collection pages: the main set, every portal, then the main-line album sets (albumSets).
 * @param {object} state
 * @param {object} deps
 * @returns {Array<{id: string, name: string, reward: number, cards: Array<{cardId: string, owned: boolean}>, ownedCount: number, total: number, complete: boolean, claimed: boolean}>}
 */
export function setCollections(state, deps) {
  const q = deps.quests;
  if (!q) return [];
  const owned = new Set(state.cards.map((c) => c.cardId));
  const lines = [q.main, ...(q.portals || []), ...albumSets(deps)];
  return lines.map((line) => {
    const cards = line.cards.map((cardId) => ({ cardId, owned: owned.has(cardId) }));
    const ownedCount = cards.filter((c) => c.owned).length;
    return {
      id: line.id, name: line.name, reward: line.gemReward, cards, ownedCount, total: cards.length,
      complete: ownedCount === cards.length && cards.length > 0, claimed: state.collections.claimed.includes(line.id),
    };
  });
}

/**
 * Owned set cards the album has not shown yet (state.collections.seen): the album's "!" badge (the client's
 * setsmanager newCardsUnlocked / playedCardAnimations). A save without the list (null) shows none.
 * @param {object} state
 * @param {object} deps
 * @returns {string[]}  card ids
 */
export function albumNewCards(state, deps) {
  const seen = state && state.collections && state.collections.seen;
  if (!Array.isArray(seen)) return [];
  const known = new Set(seen);
  const out = new Set();
  for (const set of setCollections(state, deps)) for (const c of set.cards) if (c.owned && !known.has(c.cardId)) out.add(c.cardId);
  return [...out];
}

/**
 * Mark cards as shown by the album (clears their part of the "!" badge).
 * @param {object} state
 * @param {string[]} cardIds
 * @returns {object}  the same state when nothing is new
 */
export function markAlbumSeen(state, cardIds) {
  const seen = Array.isArray(state.collections && state.collections.seen) ? state.collections.seen : [];
  const add = (cardIds || []).filter((id) => !seen.includes(id));
  if (!add.length) return state;
  return { ...state, collections: { ...state.collections, seen: [...seen, ...add] } };
}

/**
 * Claim the gem reward of a completed set (once).
 * @param {object} state
 * @param {object} deps
 * @param {string} setId
 * @returns {{state: object, gems: number}}
 */
export function claimCollection(state, deps, setId) {
  const col = setCollections(state, deps).find((c) => c.id === setId);
  if (!col) throw new Error('Unknown set');
  if (!col.complete) throw new Error('The set is not complete');
  if (col.claimed) throw new Error('Already claimed');
  const s = addGems(state, col.reward);
  return { state: { ...s, collections: { ...s.collections, claimed: [...s.collections.claimed, setId] } }, gems: col.reward };
}

/**
 * Everything the Shop screen lists, priced for today. The booster list of the 1.7.4 client came from the server
 * (game.boostermanager2 getBoosters, refreshed when the nearest `preBoosterTimeout` / `boosterTimeout` passes) and is
 * rebuilt here from the portal rotation, in the order of the 2016 shop (exploration/research/round3/frames/user/shop-1.png,
 * shop-2.png; shop-1_v174.jpg):
 *   Neophyte Pack, the running portal's two packs (low, high; "Offer ends in" = the portal's countdown), the NEXT
 *   portal's two packs as pre-packages (boosterlist_entry_comp isPrePackage: "Coming soon:" + the countdown to the
 *   portal's start, not tappable; booster_pre_template), Summoner's Pack, Archmage's Pack.
 * The packs of a portal that has ended are not listed (the client only knew the boosters the server sent, and a
 * pack's tokens existed only as `booster.token.amount` of a listed booster); their tokens stay in the save and can be
 * spent again when the rotation brings that portal back. A manual portal choice (`state.quests.manualPortal`, the
 * removed Portal archive) is ignored. Then the Great Potion Deal on its event day and the gem packs.
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @param {string|null} [portalId]  the running portal (default: the 7-day rotation; null = no portal packs). An
 *   explicit portal has no countdowns; its successor in the portal list is the "coming soon" one.
 * @returns {{event: object, boosters: object[], potionDeal: object|null, gemPacks: object[]}}
 */
export function shopOffers(state, deps, now, portalId) {
  const event = dailyEvent(eventClock(state, now), state);
  const portals = (deps.quests && deps.quests.portals) || [];
  let running = null;
  let endsAt = 0;
  let next = null;
  if (portalId === undefined) {
    const sch = portalSchedule(deps, state.createdAt, now);
    if (sch && questLine(deps, sch.portalId)) {
      running = sch.portalId;
      endsAt = sch.endsAt;
      if (portals.length > 1) next = portals[(sch.index + 1) % portals.length].id;
    }
  } else if (portalId && portalId !== 'main' && questLine(deps, portalId)) {
    running = portalId;
    const i = portals.findIndex((p) => p.id === portalId);
    if (portals.length > 1 && i >= 0) next = portals[(i + 1) % portals.length].id;
  }
  const offer = (id, pid, extra) => {
    const b = BOOSTERS[id];
    const line = pid ? questLine(deps, pid) : null;
    const booster = getBooster(state, id, pid || undefined);
    return {
      ...b,
      // a portal pack is named after its token ("Dreamwalker", "Oneiromancer" of Dying Dreams)
      name: line ? line.tokens[id === 'portalLow' ? 'low' : 'high'].name.replace(/ token$/i, '') : b.name,
      setName: line ? line.name : null,
      portalId: pid || undefined,
      price: boosterPrice(id, event),
      discounted: eventId(event) === 'get-the-best-cards',
      tokens: tokenCount(state, id, pid || undefined),
      left: booster ? booster.cards.length - booster.drawn.length : BOOSTER_CARDS,
      pre: false,
      endsInMs: 0,
      startsInMs: 0,
      ...extra,
    };
  };
  const items = [offer('neophyte', null)];
  if (running) {
    const endsInMs = endsAt ? Math.max(0, endsAt - now) : 0;
    items.push(offer('portalLow', running, { endsInMs }), offer('portalHigh', running, { endsInMs }));
  }
  if (next && next !== running) {
    const startsInMs = endsAt ? Math.max(0, endsAt - now) : 0;
    items.push(offer('portalLow', next, { pre: true, startsInMs }), offer('portalHigh', next, { pre: true, startsInMs }));
  }
  items.push(offer('summoner', null), offer('archmage', null));
  return {
    event,
    boosters: items,
    potionDeal: potionDealAvailable(state, now, event) ? { gems: POTION_DEAL_GEMS, potions: POTION_DEAL_COUNT } : null,
    gemPacks: GEM_PACKS.map((g) => ({ ...g })),
  };
}
