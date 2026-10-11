'use strict';
/**
 * Tutorial progress and the step script of the first session (pure, no DOM).
 *
 * The 1.7.4 client ran its tutorial with a generic trigger engine (game.tutorial.tutorialmanagerv3): the server
 * sent steps whose triggers read client getters (game.tutorial.tutorialgetter: completedQuests, currentQuest,
 * lostLastBossFight, deckCards, fightStatus, fightRound, context, isGameFeatureUnlocked, ...) and whose actions
 * showed a text (view_tutorialv3_text), a button sparkle / pointing hand (view_shp_highlights "sparkle" at once,
 * "hand" after a delay) or a drag arrow (fx_tutorial_arrow); a step once played was stored with setSeenTutorialStep.
 * The step data itself was server side, so `hintFor` below is our script of it, written step by step from the
 * German 1.7.0 tutorial video (exploration/research/round3/tutorial-v2.md): quest 1 with the Master Brewer soul card and a
 * won first boss fight, the lost quest-2 fight and the Throat-Cutter swap, the deck slots, the guided first fusion
 * after quest 3, the quest-5 showdown, the card piece of quest 6, the Arena / Pieces visit after quest 8, the guided
 * training after quest 9 and the League after quest 10.
 *
 * Save: `state.tutorial.r3 = { intro, lost: number[], seen: string[], named, done }` (created by
 * `newTutorialGame` / `startTutorial`). A save without it (every save written before round 3) counts as having
 * finished the tutorial and having chosen its name, so nothing is shown and nothing is migrated.
 */
import { newGame, slotUnlocked, isUnlocked, getCard } from '../../game/state.js';
import { TUTORIAL_STARTER_CARDS } from '../../core/constants.js';

/** The tutorial's last main quest: its win opens the League; the first League visit (or any later win) ends it. */
export const FINAL_QUEST = 10;
/** Fresh record of a new game. */
export const NEW_RECORD = Object.freeze({ intro: true, lost: Object.freeze([]), seen: Object.freeze([]), named: false, done: false });
/** What a save without a record behaves like. */
const DONE_RECORD = Object.freeze({ intro: true, lost: Object.freeze([]), seen: Object.freeze([]), named: true, done: true, legacy: true });
/** view_shp_highlights: the hand joins a sparkle after this long (ctrl_intro_fight: sparkle 0, hand 2000 ms). */
export const HAND_DELAY = 2000;

/**
 * DOM targets the hints point at: stable hooks of the screens (nav / HUD: menus agent; cards screen: cards agent;
 * arena: arena agent; quest map: map agent; quest, pre-battle: quest flow).
 */
export const TARGETS = Object.freeze({
  nav: (id) => `.nav-btn[data-nav="${id}"]`,
  mapNode: (n) => `.qm-node[data-quest="${n}"]`,
  feedQuest: '[data-feed="quest"]',
  minion: '.quest-minion:not(.hit):not(.enter):not(.slain)',
  attack: '.attack-bar .attack-btn',
  modeTab: (mode) => `.mode-btn[data-tab="${mode}"]`,
  sliderCard: (uid) => `.card-slider .card[data-uid="${uid}"]`,
  slot: (i) => `.deck-slot[data-slot="${i}"]`,
  zone: (id) => `.cards-zone[data-zone="${id}"]`,
  fusionOk: '.fusion-ok',
  trainingOk: '.training-ok',
  arenaTab: (id) => `.arena-top .tab[data-tab="${id}"], .tabbar [data-tab="${id}"]`,
  pieceAttack: (cardId) => `.piece-slot[data-card-id="${cardId}"] .piece-attack`,
});

/** The card piece of quest 6 that the Arena lesson completes. */
export const PIECE_CARD = 'club-swinger';

/**
 * The tutorial record of a save (a finished one for saves without it).
 * @param {object|null} state
 * @returns {{intro: boolean, lost: number[], seen: string[], named: boolean, done: boolean, legacy?: boolean}}
 */
export function tutorialOf(state) {
  const r3 = state && state.tutorial && state.tutorial.r3;
  if (!r3 || typeof r3 !== 'object') return DONE_RECORD;
  return {
    intro: r3.intro !== false,
    lost: Array.isArray(r3.lost) ? r3.lost : [],
    seen: Array.isArray(r3.seen) ? r3.seen : [],
    named: Boolean(r3.named),
    done: Boolean(r3.done),
  };
}

/**
 * Is the first-session tutorial running for this save?
 * @param {object|null} state
 * @returns {boolean}
 */
export function isTutorialActive(state) {
  return Boolean(state) && !tutorialOf(state).done;
}

/**
 * Give a save a fresh tutorial record.
 * @param {object} state
 * @returns {object}
 */
export function startTutorial(state) {
  return { ...state, tutorial: { ...(state.tutorial || {}), r3: { ...NEW_RECORD, lost: [], seen: [] } } };
}

/**
 * Merge changes into the record (creates it when missing).
 * @param {object} state
 * @param {object} patch
 * @returns {object}
 */
export function patchTutorial(state, patch) {
  const cur = state.tutorial && state.tutorial.r3 && typeof state.tutorial.r3 === 'object' ? state.tutorial.r3 : { ...DONE_RECORD };
  const next = { ...cur, ...patch };
  delete next.legacy;
  return { ...state, tutorial: { ...(state.tutorial || {}), r3: next } };
}

/**
 * Remember a played one-off step (setSeenTutorialStep).
 * @param {object} state
 * @param {string} id
 * @returns {object}
 */
export function markSeen(state, id) {
  const t = tutorialOf(state);
  if (t.legacy || t.seen.includes(id)) return state;
  return patchTutorial(state, { seen: [...t.seen, id] });
}

/**
 * Record a boss fight of the main quest line: a loss is remembered (lostLastBossFight); a win after the final
 * quest ends the tutorial. Saves without a record are left alone.
 * @param {object} state
 * @param {string} line
 * @param {number} n
 * @param {boolean} won
 * @returns {object}
 */
export function recordBossFight(state, line, n, won) {
  const t = tutorialOf(state);
  if (t.legacy || t.done || line !== 'main') return state;
  if (won) return n > FINAL_QUEST ? patchTutorial(state, { done: true }) : state;
  return t.lost.includes(n) ? state : patchTutorial(state, { lost: [...t.lost, n] });
}

/**
 * The automatic account name of a new game ("user-<digits>", like the client's guest accounts).
 * @param {number} seed
 * @returns {string}
 */
export function defaultPlayerName(seed) {
  return `user-${1000000 + ((Number(seed) >>> 0) % 9000000)}`;
}

/**
 * A new save that starts the tutorial: the 1.7.0 starter state (the Envoy alone in deck slot 3, 200 gold, 0 gems;
 * the Master Brewer drops in quest 1), an automatic "user-<digits>" name (the name is asked on the first Arena
 * visit) and a fresh record.
 * @param {number} seed
 * @param {number} now
 * @param {object} [deps]
 * @returns {object}
 */
export function newTutorialGame(seed, now, deps) {
  const s = newGame(defaultPlayerName(seed), seed, now, deps);
  const cards = s.cards.filter((c) => TUTORIAL_STARTER_CARDS.includes(c.cardId));
  const keep = new Set(cards.map((c) => c.uid));
  const deck = s.deck.map((uid) => (uid && keep.has(uid) ? uid : null));
  return startTutorial({ ...s, cards, deck });
}

/**
 * Does the first Arena visit still have to ask for the name (comp_name_popup)?
 * @param {object|null} state
 * @returns {boolean}
 */
export function needsName(state) {
  return Boolean(state) && !tutorialOf(state).named;
}

/** Longest name the name popup accepts (comp_name_popup: txt:sub(1, 18)). */
export const NAME_MAX = 18;

/**
 * Clean a typed name like the client (trimmed, single spaces, at most NAME_MAX characters); '' when invalid.
 * @param {string} raw
 * @returns {string}
 */
export function cleanPlayerName(raw) {
  const s = String(raw == null ? '' : raw).replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim();
  return s.slice(0, NAME_MAX).trim();
}

/**
 * Store the chosen name and close the name step (an invalid name keeps the current one).
 * @param {object} state
 * @param {string} raw
 * @returns {object}
 */
export function setPlayerName(state, raw) {
  const name = cleanPlayerName(raw) || state.player.name;
  return patchTutorial({ ...state, player: { ...state.player, name } }, { named: true });
}

/* ------------------------------------------------------------------ getters (tutorialgetter) */

/**
 * The facts the step triggers read.
 * @param {object} state
 * @param {object} [deps]  only `deps.db` (card mana for the training lesson); optional
 * @returns {object}
 */
export function tutorialFacts(state, deps) {
  const t = tutorialOf(state);
  const wins = (state.quests && state.quests.main && state.quests.main.firstWins) || [];
  const cards = state.cards || [];
  const deck = state.deck || [];
  const byId = (cardId) => cards.filter((c) => c.cardId === cardId);
  const inDeck = (cardId) => deck.some((uid) => uid && byId(cardId).some((c) => c.uid === uid));
  const spare = (cardId) => { const c = byId(cardId).find((x) => !deck.includes(x.uid)); return c ? c.uid : null; };
  const slotOf = (cardId) => deck.findIndex((uid) => uid && byId(cardId).some((c) => c.uid === uid));
  const openSlots = [0, 1, 2, 3, 4].filter((i) => slotUnlocked(state, i));
  const emptySlot = openSlots.find((i) => !deck[i]);
  const mana = (c) => { const d = deps && deps.db ? deps.db.get(c.cardId) : null; return (d ? d.mana : 0) * 100 + (c.stage | 0) * 10 + (c.level | 0); };
  const spares = cards.filter((c) => !deck.includes(c.uid) && !c.pieces);
  return {
    record: t,
    active: !t.done,
    won: (n) => wins.includes(n),
    lost: (n) => t.lost.includes(n) && !wins.includes(n),
    seen: (id) => t.seen.includes(id),
    owns: (cardId) => byId(cardId).length > 0,
    inDeck,
    spare,
    slotOf,
    openCount: openSlots.length,
    emptySlot: emptySlot == null ? -1 : emptySlot,
    bestSpare: spares.slice().sort((a, b) => mana(b) - mana(a))[0] || null,
    hasFused: cards.some((c) => (c.stage | 0) > 0),
    fusionPair: fusionPair(cards),
    fusionOpen: isUnlocked(state, 'fusion'),
    trainingOpen: isUnlocked(state, 'training'),
    rank: mana,
    level: state.player ? state.player.level : 1,
  };
}

/**
 * Two cards of the same id and fusion stage (the first pair, the copy outside the deck first).
 * @param {object[]} cards
 * @returns {[object, object]|null}
 */
function fusionPair(cards) {
  const groups = new Map();
  for (const c of cards) {
    if ((c.stage | 0) >= 4) continue;
    const k = `${c.cardId}/${c.stage | 0}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  for (const list of groups.values()) if (list.length >= 2) return [list[0], list[1]];
  return null;
}

/* ------------------------------------------------------------------ the step script */

/**
 * @typedef {object} Hint
 * @property {string|null} text     line id (lines.js) of the text box, or null
 * @property {'bottom'|'bottom_menu'|'top'|'center'} [position]  view_tutorialv3_text position
 * @property {null|{tap: string, fallback?: string[], sparkle?: boolean, delay?: number}|{drag: {from: string, to: string}, fallback?: string[]}} hand
 *   tap: the element the highlight sits on (sparkle: the button glow at once; the hand after `delay` ms);
 *   drag: the green arrow from `from` to `to` (with the hand travelling along it); fallback: selectors tried
 *   (in order) when the target is not on screen
 * @property {string} [once]        a one-off step: the manager marks it seen when the screen is left
 * @property {string} [reveal]      a TARGETS.sliderCard selector: the cards screen's slider turns that card to the
 *   front (its curved slider starts at the right edge, where a lone card is cut off by the screen)
 */

const NONE = Object.freeze({ text: null, hand: null });
/** A highlighted button: the sparkle at once, the hand after HAND_DELAY. */
const spark = (tap, fallback) => ({ tap, sparkle: true, delay: HAND_DELAY, ...(fallback ? { fallback } : {}) });

/**
 * The cards-screen lessons pending, in the order the video plays them.
 *  - swap: quest 2 lost with the Envoy: the Throat-Cutter onto the Envoy's slot (tutorial-v2 §2.6)
 *  - swapped: the swap is done, back to quest 2 (§2.7)
 *  - slot: a deck slot just opened and a card waits outside the deck (§2.12, §4.5, §6.10)
 *  - fusion: fusion is open (quest 3 won), nothing fused yet, a pair to fuse (§3.9–3.12)
 *  - training: training is open (quest 9 won) and not shown yet (§8.4–8.7)
 * @param {object} f  tutorialFacts
 * @returns {null|{kind: string, uid?: string|null, toSlot?: number, key?: string}}
 */
export function pendingLesson(f) {
  if (!f.active) return null;
  if (f.won(1) && !f.won(2) && f.lost(2)) {
    if (!f.inDeck('throat-cutter') && f.spare('throat-cutter')) {
      const envoy = f.slotOf('envoy');
      return { kind: 'swap', uid: f.spare('throat-cutter'), toSlot: envoy >= 0 ? envoy : f.emptySlot };
    }
    if (f.inDeck('throat-cutter')) return { kind: 'swapped' };
  }
  if (f.won(2) && f.emptySlot >= 0 && f.bestSpare && !f.seen(`slot${f.openCount}`)) {
    return { kind: 'slot', uid: f.bestSpare.uid, toSlot: f.emptySlot, key: `slot${f.openCount}` };
  }
  if (f.fusionOpen && !f.hasFused && f.fusionPair && !f.seen('fusionLesson')) return { kind: 'fusion', key: 'fusionLesson' };
  if (f.trainingOpen && !f.seen('trainLesson')) return { kind: 'training', key: 'trainLesson' };
  return null;
}

/**
 * The Arena lesson after quest 8 (§7.6–7.14): go to the Arena, the Pieces tab, beat the holder of the Club Swinger
 * piece; then the "steal" warning once.
 * @param {object} f
 * @returns {null|'go'|'steal'}
 */
export function arenaLesson(f) {
  if (!f.active || !f.won(8)) return null;
  if (!f.owns(PIECE_CARD)) return 'go';
  if (!f.seen('steal')) return 'steal';
  return null;
}

/**
 * What the tutorial shows right now: a text and / or a highlight.
 * @param {object|null} state
 * @param {{id: string, params?: object}|null} route  the router's current screen
 * @param {{cardsTab?: string, zones?: {fuse1?: string|null, fuse2?: string|null, train?: string|null, stack?: number},
 *   arenaTab?: string, quest?: {line: string, n: number, figuresDone: number}, battle?: {n: number, line: string,
 *   mode: string, won: boolean, lostBefore?: boolean, elapsed: number, resultShown: boolean, resultElapsed: number},
 *   deps?: object}} [extra]  lostBefore: the quest had been lost before this fight (the record already holds this one)
 *   observations of the screen (DOM tab and zones, timing since the battle opened / its result banner appeared)
 * @returns {Hint}
 */
export function hintFor(state, route, extra = {}) {
  if (!state || !route) return NONE;
  const f = tutorialFacts(state, extra.deps);
  if (!f.active) return NONE;
  const p = route.params || {};
  const lesson = pendingLesson(f);
  switch (route.id) {
    case 'quest-map': return mapHint(f, p, lesson);
    case 'cards': return cardsHint(f, lesson, extra.cardsTab || p.tab || 'deck', extra.zones || {}, state);
    case 'quest': return questHint(f, p, extra.quest || null);
    case 'prebattle': return prebattleHint(f, p);
    case 'battle': return battleHint(f, extra.battle || null);
    case 'arena': return arenaHint(f, extra.arenaTab || p.tab || 'arena');
    default: return NONE;
  }
}

function mapHint(f, p, lesson) {
  if ((p.line && p.line !== 'main') || p.feed) {
    // the Quest tab's landing feed: its Main Quest banner leads to the map
    return p.feed && !f.won(1) ? { text: null, hand: spark(TARGETS.feedQuest) } : NONE;
  }
  if (!f.won(1)) return { text: null, hand: spark(TARGETS.mapNode(1)) };
  if (lesson && lesson.kind === 'swapped') return { text: null, hand: spark(TARGETS.mapNode(2)) };
  if (lesson) return { text: null, hand: spark(TARGETS.nav('cards')) };
  const arena = arenaLesson(f);
  if (arena === 'go') return { text: null, hand: spark(TARGETS.nav('arena')) };
  if (f.won(FINAL_QUEST) && !f.seen('league')) return { text: null, hand: spark(TARGETS.nav('league')) };
  return NONE;
}

function cardsHint(f, lesson, tab, zones, state) {
  if (!lesson) return NONE;
  switch (lesson.kind) {
    case 'swap': {
      if (tab !== 'deck') return { text: null, hand: spark(TARGETS.modeTab('deck')) };
      const to = lesson.toSlot >= 0 ? TARGETS.slot(lesson.toSlot) : TARGETS.slot(2);
      return { text: 'throatCutterStronger', position: 'bottom', hand: { drag: { from: TARGETS.sliderCard(lesson.uid), to } } };
    }
    case 'swapped':
      return { text: 'beatBoneBreaker', position: 'bottom_menu', hand: spark(TARGETS.nav('quest')) };
    case 'slot': {
      if (tab !== 'deck') return NONE;
      return { text: null, once: lesson.key, hand: { drag: { from: TARGETS.sliderCard(lesson.uid), to: TARGETS.slot(lesson.toSlot) } } };
    }
    case 'fusion': {
      const pair = f.fusionPair;
      if (tab !== 'fusion') {
        const spare = pair.find((c) => !(state.deck || []).includes(c.uid)) || pair[0];
        return { text: null, hand: spark(TARGETS.modeTab('fusion')), reveal: TARGETS.sliderCard(spare.uid) };
      }
      const z1 = zones.fuse1 || null;
      const z2 = zones.fuse2 || null;
      if (!z1) {
        const first = pair.find((c) => c.uid !== z2) || pair[0];
        return { text: 'fuseGuide', position: 'bottom', once: lesson.key, hand: { drag: { from: TARGETS.sliderCard(first.uid), to: TARGETS.zone('fuse1') } } };
      }
      if (!z2) {
        const inSlot = getCard(state, z1);
        const other = inSlot ? (state.cards || []).find((c) => c.uid !== z1 && c.cardId === inSlot.cardId && (c.stage | 0) === (inSlot.stage | 0)) : null;
        const from = other ? TARGETS.sliderCard(other.uid) : TARGETS.sliderCard(pair[1].uid);
        return { text: 'fuseSecond', position: 'bottom', once: lesson.key, hand: { drag: { from, to: TARGETS.zone('fuse2') } } };
      }
      return { text: null, once: lesson.key, hand: { tap: TARGETS.fusionOk } };
    }
    case 'training': {
      if (tab !== 'training') return { text: null, hand: spark(TARGETS.modeTab('training')) };
      const cards = (state.cards || []).filter((c) => !c.pieces);
      const ranked = cards.slice().sort((a, b) => f.rank(b) - f.rank(a));
      if (!zones.train) {
        const best = ranked[0];
        return { text: 'trainGuide', position: 'bottom', once: lesson.key, hand: best ? { drag: { from: TARGETS.sliderCard(best.uid), to: TARGETS.zone('train') } } : null };
      }
      if (!zones.stack) {
        const deck = state.deck || [];
        const weak = ranked.slice().reverse().find((c) => c.uid !== zones.train && !deck.includes(c.uid)) || ranked.slice().reverse().find((c) => c.uid !== zones.train);
        return { text: 'trainGuide', position: 'bottom', once: lesson.key, hand: weak ? { drag: { from: TARGETS.sliderCard(weak.uid), to: TARGETS.zone('stack') } } : null };
      }
      return { text: null, once: lesson.key, hand: { tap: TARGETS.trainingOk } };
    }
    default: return NONE;
  }
}

function questHint(f, p, q) {
  const line = p.line || 'main';
  const n = Number(p.quest) || (q && q.n) || 0;
  if (line !== 'main' || !q || q.figuresDone !== 0 || f.won(n)) return NONE;
  switch (n) {
    case 1: return { text: 'smite', position: 'bottom', hand: { tap: TARGETS.minion, delay: HAND_DELAY } };
    case 5: return { text: 'noMoreRunning', position: 'bottom', hand: null };
    case 9: return { text: 'strangeTracks', position: 'bottom', hand: null };
    case 10: return { text: 'peasantWomen', position: 'bottom', hand: null };
    default: return NONE;
  }
}

function prebattleHint(f, p) {
  if (p.mode === 'pieces') return arenaLesson(f) === 'go' ? { text: 'hidesCards', position: 'bottom', hand: null } : NONE;
  if (p.mode !== 'quest' || (p.line && p.line !== 'main')) return NONE;
  const n = Number(p.quest) || 0;
  if (f.won(n)) return NONE;
  switch (n) {
    case 1: return { text: 'avenge', position: 'bottom', hand: { tap: TARGETS.attack, delay: HAND_DELAY } };
    case 5: return { text: f.lost(5) ? 'wrongOrder' : 'looksDeadly', position: 'bottom', hand: null };
    case 6: return { text: 'uglyThing', position: 'bottom', hand: null };
    case 8: return { text: 'tribeAvenger', position: 'bottom', hand: null };
    default: return NONE;
  }
}

/**
 * Timed fight lines: [from ms, to ms, line id]. The in-fight lines are timed from the start of their round (the
 * battle screen's "ROUND n" label; the fight opens with Loading and the tribe-bonus banner first): the Worm Shaman's
 * taunt in round 2 of the quest-2 retry (tutorial-v2 §2.10), the ranger and the Succubus as round 1 of quest 10 starts
 * (§9.5). The reward lines are timed from the result banner.
 */
export const FIGHT_LINES = Object.freeze({
  q2Retry: [[300, 4700, 'nextVictory']],
  q1Won: [[2600, 8000, 'shamanFled']],
  q5Won: [[200, 4200, 'didIt']],
  q6Won: [[2600, 8000, 'mightyPiece']],
  q10Start: [[400, 3600, 'demoness'], [3600, 7000, 'wretchedVillage']],
});
/** The round each in-fight table is timed from. */
export const FIGHT_LINE_ROUND = Object.freeze({ q2Retry: 2, q10Start: 1 });

function pick(table, t) {
  const hit = table.find(([a, b]) => t >= a && t < b);
  return hit ? hit[2] : null;
}

/**
 * Time since the start of round `round` of the fight: `b.sinceRound[round]` from the battle screen's round label;
 * without round data (tests, a screen without the label) `b.elapsed` stands for it.
 * @param {object} b
 * @param {number} round
 * @returns {number|null}
 */
function sinceRound(b, round) {
  if (b.sinceRound && typeof b.sinceRound === 'object') {
    const t = b.sinceRound[round];
    return t == null ? null : Number(t);
  }
  return Number(b.elapsed) || 0;
}

function battleHint(f, b) {
  if (!b || (b.mode !== 'quest' && b.mode !== 'boss') || (b.line && b.line !== 'main')) return NONE;
  // wonBefore / lostBefore: the quest's state before this fight (the save already holds this fight's result)
  const wonBefore = b.wonBefore != null ? Boolean(b.wonBefore) : f.won(b.n) && !b.won;
  let id = null;
  if (b.resultShown) {
    if (!b.won || wonBefore) return NONE;
    const table = b.n === 1 ? FIGHT_LINES.q1Won : b.n === 5 ? FIGHT_LINES.q5Won : b.n === 6 ? FIGHT_LINES.q6Won : null;
    id = table ? pick(table, b.resultElapsed) : null;
  } else if (b.n === 2 && (b.lostBefore != null ? b.lostBefore : f.record.lost.includes(2) && !wonBefore)) {
    const t = sinceRound(b, FIGHT_LINE_ROUND.q2Retry);
    id = t == null ? null : pick(FIGHT_LINES.q2Retry, t);
  } else if (b.n === 10 && !wonBefore) {
    const t = sinceRound(b, FIGHT_LINE_ROUND.q10Start);
    id = t == null ? null : pick(FIGHT_LINES.q10Start, t);
  }
  return id ? { text: id, position: 'bottom', hand: null } : NONE;
}

function arenaHint(f, tab) {
  const lesson = arenaLesson(f);
  if (lesson === 'go') {
    if (tab !== 'pieces') return { text: null, hand: spark(TARGETS.arenaTab('pieces')) };
    return { text: 'amateurMage', position: 'bottom', hand: { tap: TARGETS.pieceAttack(PIECE_CARD), delay: HAND_DELAY } };
  }
  if (lesson === 'steal' && tab === 'pieces') return { text: 'stealPieces', position: 'bottom', once: 'steal', hand: null };
  return NONE;
}
