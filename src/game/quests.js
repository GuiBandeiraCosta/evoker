'use strict';

import { takeRng, updatePlayer, DAY_MS, unlockSlotsForQuest, slotUnlocked, unlocksByQuest, inTutorial } from './state.js';
import { needsPotion, spendStamina, addPlayerXp, cardFightXp, eventId, addGold, goldWithEvent, QUEST_BOSS_PLAYER_XP } from './player.js';
import { addDeckXp, validateDeck, capFor, addCard } from './collection.js';
import { rollWaveReward, rollBossReward, applyReward, pickBandCard, rollTapGold, MAX_WAVE_SIZE } from './rewards.js';
import { XP_PER_STAMINA, QUEST_BANDS, QUEST_TAP_BURST, PORTAL_FINAL_GOLD } from '../core/constants.js';
import { sideOptions, buildPlayerSide } from './opponents.js';

/**
 * Quest map: main quest + portals, minion waves, boss line-ups and rewards (game-design §4).
 * Quest definitions come from data/quests.json (`deps.quests`).
 *
 * state.quests = {
 *   main: { unlocked, done, firstWins: [] },
 *   portals: { [portalId]: { unlocked, done, firstWins: [] } },
 *   active: { line, n, waves: string[][], waveIndex, waveDone, figuresDone, figuresTotal, bossReady, boss: lineup|null } | null,
 *   manualPortal: string|null,   (written by the removed Portal archive; kept for old saves, ignored)
 * }
 */

/** [fromQuest, toQuest] of the quality bands (constants QUEST_BANDS) of the main line and of a portal. */
export const MAIN_BANDS = bandRanges('main');
export const PORTAL_BANDS = bandRanges('portal');
export const MIN_WAVES = 2;
export const MAX_WAVES = 5;
export const MIN_WAVE_SIZE = 2;

/**
 * @param {'main'|'portal'} scope
 * @returns {Array<[number, number]>}
 */
function bandRanges(scope) {
  return QUEST_BANDS.filter((b) => b.scope === scope).map((b) => [b.from, b.to]);
}

/**
 * A quest line definition ('main' or a portal id).
 * @param {object} deps
 * @param {string} lineId
 * @returns {object|null}
 */
export function questLine(deps, lineId) {
  const q = deps.quests;
  if (!q) return null;
  if (lineId === 'main') return q.main;
  return (q.portals || []).find((p) => p.id === lineId) || null;
}

/**
 * A quest node.
 * @param {object} deps
 * @param {string} lineId
 * @param {number} n  1-based
 * @returns {object|null}
 */
export function getQuest(deps, lineId, n) {
  const line = questLine(deps, lineId);
  return (line && line.nodes[n - 1]) || null;
}

/**
 * Progress record of a line (created with defaults when missing).
 * @param {object} state
 * @param {string} lineId
 * @returns {{unlocked: number, done: number, firstWins: number[]}}
 */
export function lineProgress(state, lineId) {
  const rec = lineId === 'main' ? state.quests.main : state.quests.portals[lineId];
  return rec ? { firstWins: [], ...rec } : { unlocked: 1, done: 0, firstWins: [] };
}

function setLineProgress(state, lineId, rec) {
  if (lineId === 'main') return { ...state, quests: { ...state.quests, main: rec } };
  return { ...state, quests: { ...state.quests, portals: { ...state.quests.portals, [lineId]: rec } } };
}

/**
 * @param {object} state
 * @param {string} lineId
 * @param {number} n
 * @returns {'done'|'current'|'locked'}
 */
export function questStatus(state, lineId, n) {
  const p = lineProgress(state, lineId);
  if (n < p.unlocked) return 'done';
  if (n === p.unlocked) return 'current';
  return 'locked';
}

/**
 * Which portal is open by the 7-day rotation that starts at the save's creation.
 * @param {object} deps
 * @param {number} createdAt
 * @param {number} now
 * @returns {{portalId: string, index: number, startedAt: number, endsAt: number, remainingMs: number}|null}
 */
export function portalSchedule(deps, createdAt, now) {
  const portals = (deps.quests && deps.quests.portals) || [];
  if (!portals.length) return null;
  const period = ((deps.quests && deps.quests.portalRotationDays) || 7) * DAY_MS;
  const k = Math.max(0, Math.floor((now - createdAt) / period));
  const index = k % portals.length;
  const startedAt = createdAt + k * period;
  return { portalId: portals[index].id, index, startedAt, endsAt: startedAt + period, remainingMs: Math.max(0, startedAt + period - now) };
}

/**
 * Band position (0..1) of a quest inside its quality band.
 * @param {string} lineId
 * @param {number} n
 * @returns {number}
 */
export function bandPosition(lineId, n) {
  const bands = lineId === 'main' ? MAIN_BANDS : PORTAL_BANDS;
  const b = bands.find(([a, z]) => n >= a && n <= z) || bands[bands.length - 1];
  return b[1] === b[0] ? 1 : (n - b[0]) / (b[1] - b[0]);
}

/**
 * Split a quest's figures into 2–5 waves of (normally) 2–4 minions, each a random band card id.
 * @param {object} rng
 * @param {object} deps
 * @param {object} quest
 * @returns {string[][]}
 */
export function generateWaves(rng, deps, quest) {
  const figures = Math.max(MIN_WAVES * MIN_WAVE_SIZE, quest.figures | 0);
  const nWaves = Math.max(MIN_WAVES, Math.min(MAX_WAVES, Math.ceil(figures / MAX_WAVE_SIZE)));
  const sizes = new Array(nWaves).fill(Math.floor(figures / nWaves));
  for (let i = 0; i < figures % nWaves; i++) sizes[i] += 1;
  return sizes.map((size) => {
    const ids = [];
    for (let i = 0; i < size; i++) {
      const def = pickBandCard(rng, deps.db, quest.band);
      ids.push(def ? def.id : null);
    }
    return ids;
  });
}

/**
 * Start (or restart) a quest: builds the minion waves. Only an unlocked quest can be started.
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @param {{line: string, n: number}} args
 * @returns {{state: object, active: object}}
 */
export function startQuest(state, deps, now, args) {
  const quest = getQuest(deps, args.line, args.n);
  if (!quest) throw new Error('No such quest');
  if (questStatus(state, args.line, args.n) === 'locked') throw new Error('Quest locked');
  const t = takeRng(state, deps);
  const waves = generateWaves(t.rng, deps, quest);
  const active = {
    line: args.line, n: args.n, waves, waveIndex: 0, waveDone: 0, figuresDone: 0,
    figuresTotal: waves.reduce((s, w) => s + w.length, 0), bossReady: false, boss: null, startedAt: now,
  };
  return { state: { ...t.state, quests: { ...t.state.quests, active } }, active };
}

/**
 * Abandon the active quest (progress is lost).
 * @param {object} state
 * @returns {object}
 */
export function leaveQuest(state) {
  return { ...state, quests: { ...state.quests, active: null } };
}

/**
 * Quest progress 0..100.
 * @param {object|null} active
 * @returns {number}
 */
export function questProgressPct(active) {
  if (!active || !active.figuresTotal) return 0;
  return Math.round((active.figuresDone / active.figuresTotal) * 100);
}

/**
 * Per-tap numbers of a quest node: stamina cost, gold of a "Perfect!" tap, player xp, minion count.
 * @param {object} quest  quest node
 * @returns {{stamina: number, gold: number, xp: number, figures: number, burstChance: number, endGold: number}}
 */
export function questTapInfo(quest) {
  const stamina = Number(quest.staminaPerTap) || 0;
  return {
    stamina,
    gold: Number(quest.goldPerFigure) || 0,
    xp: quest.xpPerTap != null ? Number(quest.xpPerTap) : stamina * XP_PER_STAMINA,
    figures: Number(quest.figures) || 0,
    burstChance: quest.burstChance == null ? QUEST_TAP_BURST.chance : Number(quest.burstChance),
    endGold: Number(quest.endGold) || 0,
  };
}

/**
 * Tap the next minion (the quest screen calls this once per tap). The tap costs the quest's stamina per tap and
 * pays at once: flat gold per tap (a "Perfect!" tap) with an occasional bonus burst, and player xp
 * (1 per stamina; may level up, see `levelUpDetails`). When a wave ends a card may drop (`reward`).
 * When stamina is short nothing changes and `needsPotion` describes the Drink-potion dialog.
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @param {{event?: object|string|null}} [args]
 * @returns {{state: object, needsPotion: object|null, reward: object|null, waveCleared: boolean, bossReady: boolean,
 *   pct: number, minion: string|null, stamina: number, gold: number, tapGold: number, burst: number,
 *   perfect: boolean, xp: number, levelUps: number[], levelUpDetails: object[]}}
 *   gold = everything this tap paid (tapGold + burst); reward = the wave's card drop, or for a burst-only tap a
 *   `{type: 'gold', gold: burst, burst: true}` record (for the coin shower); levelUps as addPlayerXp
 */
export function tapMinion(state, deps, now, args = {}) {
  const active = state.quests.active;
  const idle = { needsPotion: null, reward: null, waveCleared: false, stamina: 0, gold: 0, tapGold: 0, burst: 0, perfect: false, xp: 0, levelUps: [], levelUpDetails: [] };
  if (!active) throw new Error('No active quest');
  if (active.bossReady) return { ...idle, state, bossReady: true, pct: 100, minion: null };
  const quest = getQuest(deps, active.line, active.n);
  const info = questTapInfo(quest);
  const np = needsPotion(state, 'stamina', info.stamina, args.event);
  if (np.needed) return { ...idle, state, needsPotion: np, bossReady: false, pct: questProgressPct(active), minion: null };
  let s = spendStamina(state, info.stamina);
  const wave = active.waves[active.waveIndex];
  const minion = wave[active.waveDone] || null;
  let next = { ...active, waveDone: active.waveDone + 1, figuresDone: active.figuresDone + 1 };
  const last = next.figuresDone >= active.figuresTotal;
  const tg = takeRng(s, deps);
  s = tg.state;
  const tapGold = rollTapGold(tg.rng, quest, { last, event: args.event });
  s = addGold(s, tapGold.gold);
  const px = addPlayerXp(s, deps, info.xp);
  s = px.state;
  let reward = tapGold.burst ? { type: 'gold', gold: tapGold.burst, burst: true } : null;
  const soul = soulDrop(s, deps, quest, next.figuresDone);
  s = soul.state;
  let waveCleared = false;
  if (next.waveDone >= wave.length) {
    waveCleared = true;
    const t = takeRng(s, deps);
    s = t.state;
    // the tutorial quests of a tutorial game drop no random cards (1.7.0 video); other saves roll as usual
    const scripted = quest.waveCards === false && unlocksByQuest(state);
    const rolled = scripted ? { type: 'none' } : rollWaveReward(t.rng, deps, quest);
    if (rolled.type !== 'none') {
      const ap = applyReward(s, deps, now, rolled);
      s = ap.state;
      reward = ap.reward;
    }
    next = { ...next, waveIndex: next.waveIndex + 1, waveDone: 0 };
    if (next.waveIndex >= active.waves.length) next = { ...next, bossReady: true };
  }
  s = { ...s, quests: { ...s.quests, active: next } };
  return {
    state: s, needsPotion: null, reward, waveCleared, bossReady: next.bossReady, pct: questProgressPct(next), minion,
    stamina: info.stamina, gold: tapGold.gold, tapGold: tapGold.tap, burst: tapGold.burst, perfect: tapGold.perfect,
    xp: px.xp, levelUps: px.levelUps, levelUpDetails: px.levelUpDetails, soulCard: soul.reward,
  };
}

/**
 * The scripted soul-card drop of a tutorial quest (`quest.soulDrop = {tap, cardId}`; quest 1 of the 1.7.0 client:
 * the 2nd minion drops the Master Brewer, which goes straight into the first open empty deck slot). Only a save
 * that does not own the card yet gets it.
 * @param {object} state
 * @param {object} deps
 * @param {object} quest
 * @param {number} figuresDone  minions slain after this tap
 * @returns {{state: object, reward: object|null}}  reward: {type: 'card', cardId, stage, level, uid, soul: true, slot}
 */
export function soulDrop(state, deps, quest, figuresDone) {
  const drop = quest && quest.soulDrop;
  if (!drop || Number(drop.tap) !== figuresDone || !deps.db.get(drop.cardId)) return { state, reward: null };
  if ((state.cards || []).some((c) => c.cardId === drop.cardId)) return { state, reward: null };
  const r = addCard(state, deps, drop.cardId, { force: true });
  let s = r.state;
  const slot = [0, 1, 2, 3, 4].find((i) => !s.deck[i] && slotUnlocked(s, i));
  if (slot != null) { const deck = s.deck.slice(); deck[slot] = r.uid; s = { ...s, deck }; }
  return { state: s, reward: { type: 'card', cardId: drop.cardId, stage: 0, level: 1, uid: r.uid, soul: true, slot: slot == null ? -1 : slot } };
}

/**
 * Boss line-up: the fixed boss card (or a random band card) at a band level in the middle slot plus
 * `quest.bossCards` band cards at matching levels (the ids in `quest.bossCardIds` first, then random ones).
 * The opponent's name is `quest.bossName` when the node has one (quests 1–5 "Worm Shaman", 6–9 "???", 10 "Succubus");
 * `quest.bossSlot` moves the boss card off the middle slot (quest 8: the video's Tribe Avenger is 4th),
 * `quest.bossSlots` places the extra cards (tutorial line-ups, e.g. [1, 3, 4] leaves slot 1 empty), `bossCardStages`
 * gives their fusion stages and `bossLevel` fixes every card's level (the 1.7.0 tutorial bosses play level 1 cards).
 * @param {object} quest
 * @param {object} rng
 * @param {object} db
 * @param {object} stats
 * @param {string} [lineId]  'main' by default (sets the band position)
 * @returns {{boss: object, player: {name: string, hp: number, maxHp: number}, cards: Array<object|null>}}
 */
export function bossLineup(quest, rng, db, stats, lineId = 'main') {
  const deps = { db, stats };
  const t = bandPosition(lineId, quest.n);
  const [lo, hi] = quest.band.levels;
  const [s0, s1] = quest.band.stages || [0, 0];
  const levelAt = (def, stage, jitter) => {
    if (quest.bossLevel != null) return Math.max(1, Math.min(capFor(deps, def, stage), Number(quest.bossLevel) || 1));
    const base = lo + (hi - lo) * t + jitter;
    return Math.max(1, Math.min(capFor(deps, def, stage), Math.round(base)));
  };
  let bossDef = quest.boss ? db.get(quest.boss) : null;
  if (!bossDef) bossDef = pickBandCard(rng, db, quest.band);
  const bossStage = Math.max(0, Math.min(4, quest.boss ? quest.bossStage | 0 : s1));
  const boss = { uid: 'boss', cardId: bossDef.id, stage: bossStage, level: levelAt(bossDef, bossStage, 0), evolveQuality: 1, isBoss: true };
  const cards = [null, null, null, null, null];
  const bossSlot = Number.isInteger(quest.bossSlot) && quest.bossSlot >= 0 && quest.bossSlot < 5 ? quest.bossSlot : 2;
  cards[bossSlot] = boss;
  const free = [1, 3, 0, 4, 2].filter((i) => i !== bossSlot);
  const order = Array.isArray(quest.bossSlots) && quest.bossSlots.length ? quest.bossSlots.concat(free.filter((i) => !quest.bossSlots.includes(i))) : free;
  const count = Math.max(0, Math.min(4, quest.bossCards == null ? 4 : quest.bossCards));
  const fixed = Array.isArray(quest.bossCardIds) ? quest.bossCardIds : [];
  for (let i = 0; i < count; i++) {
    const fixedDef = fixed[i] ? db.get(fixed[i]) : null;
    if (fixedDef) {
      // scripted (tutorial) line-ups: the listed card at the boss's stage and level, no randomness
      const stages = Array.isArray(quest.bossCardStages) ? quest.bossCardStages : null;
      const stage = stages && stages[i] != null ? Math.max(0, Math.min(4, stages[i] | 0)) : bossStage;
      cards[order[i]] = { uid: 'boss-' + i, cardId: fixedDef.id, stage, level: levelAt(fixedDef, stage, 0), evolveQuality: 1 };
      continue;
    }
    const def = pickBandCard(rng, db, quest.band);
    if (!def) continue;
    const stage = s0 + rng.int(Math.max(1, s1 - s0 + 1));
    cards[order[i]] = { uid: 'boss-' + i, cardId: def.id, stage, level: levelAt(def, stage, rng.int(5) - 2), evolveQuality: 1 };
  }
  const name = quest.bossName || bossDef.name + (bossStage ? '+'.repeat(bossStage) : '');
  return { boss, player: { name, hp: quest.bossHp, maxHp: quest.bossHp, level: quest.n }, cards };
}

/**
 * Build (and store) the boss line-up for the active quest so the intro / pre-battle screens can show it.
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @returns {{state: object, lineup: object, quest: object}}
 */
export function prepareBoss(state, deps, now) {
  const active = state.quests.active;
  if (!active || !active.bossReady) throw new Error('The minions are not beaten yet');
  const quest = getQuest(deps, active.line, active.n);
  if (active.boss) return { state, lineup: active.boss, quest };
  const t = takeRng(state, deps);
  const lineup = bossLineup(quest, t.rng, deps.db, deps.stats, active.line);
  return { state: { ...t.state, quests: { ...t.state.quests, active: { ...active, boss: lineup } } }, lineup, quest };
}

/**
 * Engine config for the boss fight of the active quest.
 * @param {object} state
 * @param {object} deps
 * @param {object} lineup
 * @param {number} seed
 * @returns {object}
 */
export function bossBattleConfig(state, deps, lineup, seed) {
  const attacker = buildPlayerSide(state, deps);
  const defender = deps.engine.buildSide(lineup.player, lineup.cards, sideOptions(deps));
  return { attacker, defender, seed };
}

/**
 * Run the boss fight of the active quest and resolve it.
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @param {{event?: object|string|null}} [args]
 * @returns {object} resolveBoss result plus `battle`, `lineup`, `seed`
 */
export function fightBoss(state, deps, now, args = {}) {
  const v = validateDeck(state, deps);
  if (!v.ok) throw new Error(v.reason);
  const pb = prepareBoss(state, deps, now);
  const t = takeRng(pb.state, deps);
  const cfg = bossBattleConfig(t.state, deps, pb.lineup, t.seed);
  const battle = deps.engine.simulateBattle(cfg);
  const res = resolveBoss(t.state, deps, now, { result: battle.result, lineup: pb.lineup, event: args.event });
  return { ...res, battle, lineup: pb.lineup, seed: t.seed };
}

/**
 * Apply a boss fight result: on a win the next quest unlocks, the deck cards get xp and the boss reward is
 * granted; the first win of main Q2 / Q4 / Q7 opens a deck slot (`deckSlots`), the last quest of a portal also
 * pays 1000 gold (`bonusGold`). Quest boss fights give no player xp. On a loss the minions must be beaten again.
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @param {{result: {winner: string}, lineup?: object, event?: object|string|null}} args
 * @returns {{state: object, won: boolean, reward: object|null, unlocked: number|null, firstWin: boolean, playerXp: number, cardXp: number, levelUps: number[], levelUpDetails: object[], cardLevelUps: object[], gems: number, deckSlots: number|null, bonusGold: number, quest: object}}
 *   deckSlots = the new open deck-slot count when this win opened one ("Your deck can now hold n cards.")
 */
export function resolveBoss(state, deps, now, args) {
  const active = state.quests.active;
  if (!active) throw new Error('No active quest');
  const quest = getQuest(deps, active.line, active.n);
  const line = questLine(deps, active.line);
  const lineup = args.lineup || active.boss;
  const won = args.result && args.result.winner === 'attacker';
  const enemyMana = lineup ? lineup.cards.filter(Boolean).reduce((sum, c) => sum + ((deps.db.get(c.cardId) || {}).mana || 0), 0) : 0;
  const cardXp = cardFightXp(enemyMana, won, eventId(args.event) === 'infinite-wisdom');
  const dx = addDeckXp(state, deps, cardXp);
  let s = dx.state;
  const playerXp = QUEST_BOSS_PLAYER_XP;
  const px = addPlayerXp(s, deps, playerXp);
  s = px.state;
  if (!won) {
    s = { ...s, quests: { ...s.quests, active: { ...active, waveIndex: 0, waveDone: 0, figuresDone: 0, bossReady: false, boss: null } } };
    return { state: s, won: false, reward: null, unlocked: null, firstWin: false, playerXp, cardXp, levelUps: px.levelUps, levelUpDetails: px.levelUpDetails, cardLevelUps: dx.levelUps, gems: px.gems, deckSlots: null, bonusGold: 0, quest };
  }
  const prog = lineProgress(s, active.line);
  const firstWin = !prog.firstWins.includes(active.n);
  let unlocked = null;
  const rec = { ...prog };
  if (firstWin) {
    rec.firstWins = [...prog.firstWins, active.n];
    rec.done = prog.done + 1;
    s = updatePlayer(s, { questsDone: s.player.questsDone + 1 });
  }
  if (active.n === prog.unlocked && active.n < line.nodes.length) { rec.unlocked = active.n + 1; unlocked = rec.unlocked; }
  s = setLineProgress(s, active.line, rec);
  let deckSlots = null;
  if (firstWin) {
    const us = unlockSlotsForQuest(s, active.line, active.n);
    s = us.state;
    deckSlots = us.slots;
  }
  let bonusGold = 0;
  if (active.line !== 'main' && active.n === line.nodes.length) {
    bonusGold = goldWithEvent(PORTAL_FINAL_GOLD, args.event);
    s = addGold(s, bonusGold);
  }
  const t = takeRng(s, deps);
  s = t.state;
  const rolled = rollBossReward(t.rng, deps, line, quest, firstWin, args.event);
  const ap = applyReward(s, deps, now, rolled);
  s = { ...ap.state, quests: { ...ap.state.quests, active: null } };
  return { state: s, won: true, reward: ap.reward, unlocked, firstWin, playerXp, cardXp, levelUps: px.levelUps, levelUpDetails: px.levelUpDetails, cardLevelUps: dx.levelUps, gems: px.gems, deckSlots, bonusGold, quest };
}

/**
 * Nodes of a line with their status (for the map).
 * @param {object} state
 * @param {object} deps
 * @param {string} lineId
 * @returns {Array<{n: number, status: string, quest: object}>}
 */
export function mapNodes(state, deps, lineId) {
  const line = questLine(deps, lineId);
  if (!line) return [];
  return line.nodes.map((quest) => ({ n: quest.n, status: questStatus(state, lineId, quest.n), quest }));
}

/**
 * The ranger's quest-map lines of the first session (the 1.7.0 tutorial, exploration/research/round3/tutorial-v2.md). The
 * tutorial texts were server data, not in the APK's loca table: lines read in the English client videos verbatim,
 * the others (marked) translated from the German 1.7.0 video. src/ui/tutorial/lines.js adds the lines of the other
 * screens.
 */
export const GUIDE_LINES = Object.freeze({
  follow: "Don't let it end like this! Follow him to his lair....",
  afterHim: 'I think he went this way! After him!',
  tough: 'That card is tough! You need a stronger deck.',
  rune: "A rune has been branded onto the Shaman's hand. Who sent him to burn your town?",
  // translated from the German 1.7.0 client (no English recording)
  toArena: 'We must go to the Arena to complete cards!',
  arenaSouth: 'I can see the Arena in the south!',
  finishClubSwinger: 'Time to finish the Club Swinger!',
});

/**
 * The ranger's line on the main quest map during the first session (tutorial-v2.md §1–§7), or null.
 * Follows the main-quest first wins and the boss fights lost so far (`state.tutorial.r3.lost`, the tutorial record
 * written by src/ui/tutorial/progress.js, or `ctx.lastLoss` right after a defeat): Q1 "Follow him to his lair....",
 * after Q1 "After him!", a lost Q2 "That card is tough!" until the Throat-Cutter is in the deck, after Q5 the rune
 * line, after Q6 the Arena, after Q7 "the Arena in the south", after Q8 "finish the Club Swinger" until it is
 * complete. Saves without a running tutorial (state.inTutorial) get none.
 * @param {object} state
 * @param {{lastLoss?: boolean}} [ctx]
 * @returns {string|null}
 */
export function guideLine(state, ctx = {}) {
  if (!inTutorial(state)) return null;
  const tut = state.tutorial.r3;
  const wins = state.quests.main.firstWins;
  const won = (n) => wins.includes(n);
  const lost = (n) => (Array.isArray(tut.lost) && tut.lost.includes(n)) || (Boolean(ctx.lastLoss) && nextMain(wins) === n);
  const owns = (cardId) => (state.cards || []).some((c) => c.cardId === cardId);
  const inDeck = (cardId) => (state.deck || []).some((uid) => uid && (state.cards || []).some((c) => c.uid === uid && c.cardId === cardId));
  if (!won(1)) return GUIDE_LINES.follow;
  if (!won(2)) {
    if (lost(2)) return inDeck('throat-cutter') ? null : GUIDE_LINES.tough;
    return GUIDE_LINES.afterHim;
  }
  if (won(5) && !won(6)) return GUIDE_LINES.rune;
  if (won(6) && !won(7)) return GUIDE_LINES.toArena;
  if (won(7) && !won(8)) return GUIDE_LINES.arenaSouth;
  if (won(8) && !won(9) && !owns('club-swinger')) return GUIDE_LINES.finishClubSwinger;
  return null;
}

/**
 * First main quest not won yet.
 * @param {number[]} wins
 * @returns {number}
 */
function nextMain(wins) {
  let n = 1;
  while (wins.includes(n)) n++;
  return n;
}
