/**
 * @file Card catalog access: builds an indexed, read-only view over data/cards.json with lookups,
 * filters, text search and seeded random picks. Browser-safe (no Node imports at module level).
 */

/**
 * Canonical card id from a card name. The same rule is used by tools/build-cards.js and every
 * module that references cards by id.
 * @param {string} name
 * @returns {string}
 */
export function slugify(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Lower-cased, accent-stripped text for searching.
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * @typedef {object} CardsDb
 * @property {(id: string) => object|undefined} get      card by id
 * @property {(id: string) => boolean} has
 * @property {() => object[]} all                         every card (new array, catalog order)
 * @property {(rarity: string) => object[]} byRarity
 * @property {(tribe: string) => object[]} byTribe
 * @property {(set: string) => object[]} bySet            cards whose `set` or extra `sets` include it
 * @property {(text: string) => object[]} search          every whitespace-separated token must match
 * @property {number} size
 * @property {number} version
 */

/**
 * Builds the catalog view. Cards are deep-frozen so no module can mutate static data.
 * @param {{version?: number, cards: object[]}} json parsed data/cards.json
 * @returns {CardsDb}
 */
export function createCardsDb(json) {
  if (!json || !Array.isArray(json.cards)) throw new TypeError('createCardsDb: { cards: [] } expected');
  /** @type {Map<string, object>} */
  const byId = new Map();
  const cards = json.cards.map((card) => deepFreeze(structuredClone(card)));
  for (const card of cards) {
    if (!card.id) throw new Error('createCardsDb: card without id');
    if (byId.has(card.id)) throw new Error(`createCardsDb: duplicate card id "${card.id}"`);
    byId.set(card.id, card);
  }
  /** @type {Map<string, string>} search blob per id */
  const blobs = new Map(cards.map((c) => [c.id, normalizeText(
    [c.name, c.id, c.tribe, c.rarity, c.set, ...(c.sets || []), c.sourceText || '', ...(c.categories || [])].join(' '),
  )]));

  return {
    version: json.version ?? 1,
    size: cards.length,
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),
    all: () => cards.slice(),
    byRarity: (rarity) => cards.filter((c) => c.rarity === rarity),
    byTribe: (tribe) => cards.filter((c) => c.tribe === tribe),
    bySet: (set) => cards.filter((c) => cardInSet(c, set)),
    search(text) {
      const tokens = normalizeText(text).split(/\s+/).filter(Boolean);
      if (tokens.length === 0) return cards.slice();
      return cards.filter((c) => {
        const blob = blobs.get(c.id);
        return tokens.every((t) => blob.includes(t));
      });
    },
  };
}

/**
 * @param {object} card
 * @param {string} set
 * @returns {boolean}
 */
function cardInSet(card, set) {
  return card.set === set || (Array.isArray(card.sets) && card.sets.includes(set));
}

/**
 * @template T
 * @param {T} obj
 * @returns {T}
 */
function deepFreeze(obj) {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj)) deepFreeze(v);
  }
  return obj;
}

/**
 * Node loader for tests and tools (imports fs lazily so this module stays browser-safe).
 * @param {string|URL} [path] defaults to <repo>/data/cards.json relative to this file
 * @returns {Promise<CardsDb>}
 */
export async function loadCardsDbFromFile(path) {
  const { readFile } = await import('node:fs/promises');
  const target = path ?? new URL('../../data/cards.json', import.meta.url);
  return createCardsDb(JSON.parse(await readFile(target, 'utf8')));
}
