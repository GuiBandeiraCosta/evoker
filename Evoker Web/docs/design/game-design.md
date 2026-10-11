# Evoker Web — Game Design Document

This document says exactly what the recreation does. It follows `exploration/research/evoker-research-brief.md`
(the brief) wherever the original is documented and states an explicit decision wherever it is not.
Numbers in this document are the source of truth for the implementation; `docs/design/architecture.md`
says how it is built.

Scope: a single-player, offline web game that reproduces the original's loop — collect cards on the quest map,
train and fuse them, place five of them in a row and watch the fight resolve, duel simulated players in the
Arena, steal card pieces, climb a daily League — with the original's look (portrait layout, carved stone UI,
hand-painted card art) and the original's 200 cards.

---

## 1. Core battle

### 1.1 Entities
- **Fighter side**: `{ player: {name, hp, maxHp, portrait}, slots: [Card|null ×5] }`. Slot index 0 is the leftmost
  from the *player's* point of view; the opponent's slot *i* faces the player's slot *i* (rows are drawn mirrored, so
  the opponent's leftmost card on screen is their slot 0 as well — "facing" is by index).
- **Card in battle**: `{ instanceId, cardId, name, tribe, rarity, stage, level, attack, maxHp, hp, abilityValue,
  dirs: Set<'direct'|'left'|'right'|'ownLeft'|'ownRight'>, ability, status }`.
  `status` holds per-round flags: `dazed`, `suspended`, `indestructible`, `attackBonus` (flat), `attackMult`,
  `revivedOnce`, `bonusMaxHp`, `dead`, `diedThisRound`.

### 1.2 Round loop (max 20 rounds)
Each round runs these phases in order, exactly as the brief §2.2 lists them:

1. **Suspension** — every *suspend* and *stun* effect fires simultaneously using the abilities as they were at the
   start of the round (a card being suspended this phase still gets to suspend others). Suspended cards lose every
   ability for the rest of the round. Stunned cards are suspended **and** dazed.
2. **Pre-attack** — in slot order 0→4 for the attacker then 4→0 for the defender: daze, indestructible, strengthen,
   HP buffs, attack multipliers, round-conditional effects (Catapult, Gasher…), random effects (Goblin Thieves,
   Bouncer, Wizard Apprentice). Order does not matter for correctness because effects only set flags/bonuses that
   are read in phase 3; implement with one pass per side.
3. **Attack** — attacker's cards in slot order 0→4, then defender's cards 4→0. A card attacks if it is alive (hp > 0
   at the *start* of the phase counts as alive — cards reduced to ≤0 during this phase still attack when their turn
   comes), has attack > 0 after modifiers, and is not dazed. Damage per direction = `floor(effectiveAttack / nDirs)`
   with the remainder given to the direct target (if any) or the first direction. Each direction resolves:
   - target slot holds a living card → the card takes damage (unless indestructible this round; "unreflectable"
     attacks bypass reflect abilities). Reflect abilities fire immediately (damage back to the attacker or to the
     attacking player, capped as specified).
   - target slot empty (no card or card already at ≤0 hp **and** removed in an earlier round — cards that died *this
     round* still occupy the slot until clean-up) → the opposing player takes the damage; unoccupied-field modifiers apply.
   - a diagonal direction that falls off the board (slot −1 or 5) does nothing; for own-neighbour attackers the
     off-board or empty share hits the attacker's **own** player.
   - "if it inflicts damage on a card that dies" effects (Battering Ram, Ore Titan) are checked at clean-up.
4. **Creature heal** — every heal to cards (self, neighbours, tribe, all allies). Heals cannot exceed maxHp, cannot
   target dead cards (hp ≤ 0), and are multiplied by the side's healing bonus (Djinn).
5. **Player heal** — heals to players (cannot exceed maxHp).
6. **Death triggers** — for every card at hp ≤ 0 that has not yet been marked dead: death effects (Tribe Avenger,
   Sun Dragon, Dryad Oracle, Flameling, Schemer, Warg Rider, Goblin Patriarch, Baby Dragon, Sky Guardian/Slaver
   "if the card opposite dies", Crystal Golem/Mammoth Citadel "if the card opposite dies", Totem Carver/Bone
   Collector/Guruk/Devourer/Giant Spider counters). Death-triggered damage can kill other cards; loop until no new
   deaths (cap 10 iterations).
7. **Creature deaths** — cards at hp ≤ 0 are removed, unless a revive applies: Phoenix/Gargoyle/Sand Mystic/Astral
   Navigator (full hp, once), Enormous Larva/Bone Dragon (returns at full hp with attack = ability value, once),
   Moon Dragon (the first time *it* dies, every allied card that died this round, itself included, returns at full hp).
   End-of-round kills (Colossus, Dwarf Judge, Umbral Dragon) happen at the start of this phase in round 2 and are not
   prevented by indestructible but are prevented by suspend.
8. **End check** — fight ends if a player's hp ≤ 0, after round 20, or if no living card on either side has attack > 0
   (and no card has a damaging ability — Voodoo Witch/Fungus Lord/Homunculus-style direct damage counts as "attack" for
   this rule, so a lone Voodoo Witch keeps the fight going). Winner: higher hp; tie after round 20 = draw.

The **attacker** is the side that initiated the fight (always the human player in quests, arena, league and piece
hunts; "defender" is the AI). Within a phase, attacker acts before defender.

### 1.3 Player health in a fight
`fightMaxHp = characterMaxHp × (1 + 0.15 if tribe bonus) + flat max-hp buffs (Tree of Life, Dwarven Sage, Goblin Cook,
Astral Navigator…)`. Both players start at full fightMaxHp. Tribe bonus rule: brief §2.5 (≥3 cards of one main tribe,
no other main tribe, up to 2 Neutrals; smaller line-ups must be majority one tribe with only Neutrals mixed in).

### 1.4 Ability semantics (binding decisions)
- "neighbours" = the card's own left and right slots; a missing neighbour (edge or empty slot) gets nothing. Buffs
  to neighbours give **half** the value to each; heals give the full value to each.
- "the card opposite" = the enemy card in the same slot index. "cards opposite his neighbours" = enemy slots i−1, i+1.
- "offensive" cards = cards with attack > 0.
- "dragons" = Neutral cards; "elves/orcs/dwarves" by tribe.
- "in the first round" = round 1 only; "in even-numbered rounds" = 2,4,6…; "from the fourth round on" = ≥4.
- "X more damage" adds X to attack (before direction split). "75 % more / triple damage" multiplies.
- "per round" cumulative buffs add X every round including round 1 and persist.
- "Deals 100 more damage in the next round for each enemy creature that dies" = flat × (enemy deaths in the previous round).
- "If healed, attack increases next round by the amount healed" = sum of heals received this round added next round.
- "If it is damaged, the attacking card takes the same amount" = reflect to the attacking card (not to players);
  "the opposing player takes the same amount up to a maximum of X" = reflect to enemy player capped at X per hit.
- "Does X damage to the opposing player each round" fires in the attack phase after the card's own attack (even
  if the card has no attack), only if the card is alive and not suspended.
- "Takes no damage in the first round" = indestructible in round 1 (against attacks, reflected damage, card
  damagers and death bursts; not against Direct Kill).
- Hurricane Dancer "none of the cards adjacent to Hurricane Dancer can attack in the first round" = her **own**
  neighbours are dazed in round 1 (literal reading; documented assumption).
- Medusa / Dark Mage reduce the attack of every card **with an ability on both sides, except themselves** by X % in round 1.
- Wheel of Fortune: at the creature-heal phase each round, every card on both sides is either healed by X (50 %)
  or damaged by X (50 %); the Wheel itself is excluded.
- Wizard Apprentice: at pre-attack each round, with probability (100 − X) % all allied offensive cards gain +25 %
  attack this round; otherwise they lose 25 % this round.
- Goblin Thieves: in round 1 pre-attack, one random living card on either side swaps its attack and hp (maxHp too).
- Bouncer: in rounds 1 and 2 (suspension phase) stuns one random living ally (not itself) and one random living foe.
- Umbral Dragon: end of round 2 kills 2 random living cards among all cards except itself.
- Thief of Time: cumulative +X attack each round; odd rounds stun the card opposite and its own two neighbours;
  even rounds stun the enemy cards opposite its neighbours.
- Evolving-ability cards use the per-stage text in the brief §3.3.
- Trainer cards (Lich King, Crystal Ghost, Blood Dragon) have no battle effect.
- Randomness in battle uses a seeded PRNG so a fight can be replayed exactly (Replays tab).

### 1.5 Battle presentation
The engine returns the full event log; the battle screen plays it back (DECISIONS D5, src/ui/battle-player.js).
- **Shot direction.** The bullet always flies along the card's arrow: a hit through an empty slot (damage to the
  player) passes over that slot and carries on in the same direction to the height of the HP bar (`aimPoint`).
- **Pacing (1× = original).** The client drew the server's timeline; the one sample in the APK
  (`exploration/apk/assets/scripts/script_intro_fight.json`) starts an attacker every 1.5 s (wind-up 0–0.4 s, a small golden
  bullet 0.2–0.7 s, impact + HP tween 0.7–1.2 s, red "−N" 0.8–1.5 s), a death ~0.9 s after the last hit, and round n at
  0.9^(n−1) of round 1's speed (floor 0.3). That matches the videos: rounds 3→11 of a lone attacker in ~6–7 s, a 5v5 fight
  of 2–3 rounds in 25–35 s. The speed button (1×/2×) stays as a small, dim convenience next to Skip fight.
- **Layout** (comp_fight_layout, as in a 2016 arena screenshot): ROUND and name bands with the portrait at the top,
  the HP bar, the enemy row, the arena, the own row ~135 px below (rows at ∓70 client units from the centre, slots
  65 units apart), the HP bar, the name band with the ? frame, Skip fight bottom-left.
- **Entry.** After Attack!: the bands slide in, the HP bars grow (1 s), a "Loading..." strip with the spinning pentagram
  (1.5 s), the short lightning flash, then the tribe-bonus moment (glowing tribe emblem in the side's frame, "TRIBE BONUS"
  over the HP number, which counts up by exactly 20 %), then "ROUND 1" appears and "Skip fight" fades in. Skip fight is
  offered from the main-line quest-3 boss on (always in PvP, portals, replays).
- **Hits.** Damage numbers red, bold, on the target (pop, hold, grow 2× and fade, 0.7 s); a hit on a player draws a red
  glowing strip across the HP bar; the HP number blends from grey into red below 2/3 (fully red at 1/6). Death: the card
  shatters into two dark halves with golden sparks. Invulnerable: a golden glow with rays and sparkles around the card
  (no bubble); suppressed: the cyan bullseye rings.
- **Lethal blow.** The step that would drop a player to 0 HP is not played: every card left on both rows vanishes at
  once, a white starburst, then the HP numbers count down in red (accelerating, 1.8 s) to the engine's final values —
  negative, the overkill of the rest of the round (reOM: 68 → −1142 / 4140) — while the banner stamps in.
- **After the fight.** Victory / Defeat / Draw banner (fx_wonlost, 3.66 s) → loot (quests: victory only; PvP: its gold
  either way) with the client's reward animation (coin burst, gem heap, potion, token; a card: glowing card, then
  full size, "Card added to set: X n/8"; a piece: the dark card with the white puzzle cut-out, then the full card with
  its puzzle overlay for 1.5 s) → the card XP screen (deck cards zigzag, violet "Level n" bars, one per second;
  a level-up opens the full-art "Level up!" card popup) → Continue / Proceed → player level-up dialogs → fade to black →
  back. Screen changes fade through black (~0.35 s out, ~0.35 s in). A boss's card flies from the intro into its
  enemy slot (0.35 s) before the Attack! bar opens.

---

## 2. Cards

### 2.1 Static data
All 200 cards from the wiki catalog with: id (slug), name, tribe, rarity, mana, directions, base stats (attack,
hp, abilityValue at stage 0 level 1), per-stage level caps (brief §3.1), per-stat growth checkpoints, ability
definition (architecture §3), portal/set, artwork file names per stage, flavour (none in the original beyond the
ability text).

### 2.2 Owned card instance
`{ uid, cardId, stage (0–4), level, xp }`. Current stats are computed, never stored (architecture §3.2).

### 2.3 Collection
Inventory of **100** instances ("Your cards n/100", lategame.md §3; + an unlimited **card pieces** area). At or over
it, quest and PvP card rewards are sold automatically for their sell value (client `autosell = cardpoolSize <= count`);
boosters, fusion and completed pieces still add the card, so the count can exceed 100 and is then shown red
(the Cards screen computes count / limit itself). Sorting: by level desc, mana desc, name.
Filters: tribe, rarity.

### 2.4 Training (sacrifice)
Pick a training card and up to 9 sacrifice cards. XP gained per sacrificed card = `25 × mana × (level + 2) ×
rarityFactor` (Common 0.6, Standard 0.8, Uncommon 1, Rare 1.6, Heroic 2.4, Legendary 3.5, Ultimate 5); trainer cards
give 4,000 / 9,000 / 20,000; the trained card levels up only as far as that XP reaches. Cards in the active deck
cannot be sacrificed. Level-ups during training show the level-up popup (old → new stats).

**Gold cost** (round 3) = the sum over the sacrificed cards of the client's `getEnhancePrice`
(`game.cardmanager`, summed by `game.pricemanager`), with the server config fitted on every price seen in the
1.7.0 videos: `ceil((mana × 25 + (level − 1) × 50) × (1 + sellFactor / 10) × 2)`, sellFactor Common 1, Standard 2,
Uncommon 3 (Rare 4 … Ultimate 7 extrapolated). It depends on the sacrificed card only: a level-1 Common of 2 mana
costs 111, a level-1 Standard of 3 / 4 mana 180 / 240, a level-4 Common of 2 mana 441, a level-1 Uncommon of 8 mana
520 — all 8 observations reproduced exactly (playthroughs-2.md §1.7). API: `stats.enhancePrice(card, level)`,
`stats.enhancePriceTotal(stack)`, `training.sacrificePrice(deps, inst)`, `training.trainingCost(deps, insts)`.

### 2.5 Fusion
Two instances of the same card at the same stage (< 4). Result: stage + 1, level 1, xp 0, at the full stage-start
stats `base × 1.15^stage` (round 5: the 1.7.0 tutorial video fuses two low-level Throat-Cutters and the result counts
up to **230 / 115** = 200 / 100 × 1.15; the "211 / 111" noted in tutorial-v2.md was a frame of that count-up). The
per-instance "Evolve Bonus" (`evolveQuality`, multiplies attack, hp and ability) stays in the save model because cards
seen in videos carry factors 0.85–1.0 (cardstats.md §2.2), but its source is unknown, so a new fusion always gets
q = 1 (`EVOLVE_BONUS` base 1, span 0); cards fused before round 5 keep their stored value. Gold cost per the brief §5.4 table (Common: 200 / 800 / 1,800 /
3,200), anchored at the **400 gold** seen for every early fusion (two Standard cards at stage 0, tutorial.md §1.8,
playthroughs-2.md §1.6). No warning for inputs below their cap (the client has none). Fused cards show "+" marks after the name and lit pips.

### 2.6 Selling
Gold per the brief §5.4 formulas. Cards in the active deck cannot be sold. Pieces cannot be sold.

### 2.7 Card XP from battles
Every card in the line-up gains `10 + enemyDeckMana / 2` XP per fight (×1.5 on a win, ×2 on an Infinite Wisdom day),
capped when the card is at its stage's level cap. Level thresholds: `xpToNext(l) = round(40 × mana × l^1.5 / 10)`
(min 20); for an **unfused Common or Standard card at least 105 (level 1 → 2) and 180 (every later level)**
(`CARD_XP_CURVE.low`, round 5), so the floor only matters until the curve passes it (mana 3 from level 7, mana 5
from level 5); Uncommon and better cards and fused cards keep the plain curve. Card level-ups are shown after the
fight (popup per card).

Round-5 fit of the low end on the 1.7.0 tutorial video (wqzda6-2fs4; pre-battle frames in
`exploration/research/round3/frames/tutorial/`, card XP lists re-read from the video at 1 fps; the video's day may have had
Infinite Wisdom, its Arena banner shows it at 6:03, so its fights may have counted double — our tutorial has no event).
Card levels / XP bars seen, with our (no-event) fight XP Q1 20, Q2 lost 12, Q2 18, Q3 23, Q4 19, Q5 25, Q6 27, Q7 27,
Q8 28, Pieces 20, Q9 30:

| When (video) | Reading | Ours with the floor |
|---|---|---|
| deck lesson 1:26 (after Q1, lost Q2) | Master Brewer, Envoy, Throat-Cutter level 1 | all level 1 |
| Q5 pre-battle 3:23 (MB after 5 fights) | MB, Envoy, Falconer, Throat-Cutter+ level 1 | all level 1 (MB 92/105) |
| Q5 XP list 3:36 | MB level 2 (bar ~0), TC+ level 2 (~0), Falconer level 1 ~21 %, Envoy level 1 ~74 % | MB 2 (12/180), TC+ 2 (24/34), Falconer 24 %, Envoy 70-94 % |
| Q6 pre-battle 3:49 / XP list 4:10 | MB 2 (~15 %), TC+ 2 (~13 %), Falconer 1 (~41 %), Envoy 2 (~7 %) | MB 2 (21 %), TC+ 2, Falconer 50 %, Envoy 2 (12 %) |
| Q7 XP list 4:58 | Worm Shaman 1 (~66 % after one fight), Falconer 1 (~79 %), TC+ 2 (~41 %), MB 2 (~57 %) | WS 26 %, Falconer 75 %, TC+ 3, MB 37 % |
| Q8 pre-battle 5:27 | Gremlin 1, WS 1, TC+ 2 (260 / 130), Falconer 1, MB 2 (114 / 231) | WS 1, Falconer 1, TC+ 3, MB 2 |
| Pieces pre-battle 6:09 (after Q8) | WS 2, TC+ 2, Falconer 2 (223 / 224), MB 2 | WS 1, TC+ 4, Falconer 2, MB 2 |
| Q10 fight 7:57 | TC+ 3, Falconer 2, WS 2, Club Swinger 2 (trained) | TC+ 4, Falconer 2, WS 1 |

The floor reproduces every level of the unfused Common / Standard starters (Master Brewer level 1 until the Q5 win
and level 2 by Q6, Envoy level 2 after Q6, Falconer level 2 after its 4th win). Not reproduced: the Worm Shaman
levels after two fights (it would need a much lower level-1 threshold than the 3-4 mana cards, against the mana
scaling of the curve), and the fused Throat-Cutter+ levels faster than an unfused card (level 2 after two fights)
but slower than the plain curve (video level 2 at the Pieces fight, ours 4) — the client took each card template's
level curve from the server (`game.cardmanager` `getCardLevelData(card).levelCurve`), so per-card curves may explain
both; we keep one formula. Mid levels: a level-6 account's level 3-5 Common/Standard cards gained ~10-25 % of a bar
per boss win at quests 12-14 (playthroughs-2.md §1.10); the floor gives ~19 % there (the plain curve 15-55 %, depending on mana).
Q8's line-up follows the video (Bone Breaker, Pouch Tearer, Throat-Cutter+, Tribe Avenger, Pouch Tearer:
`bossSlot: 3`, `bossSlots`), which the video's level-1/2 deck beats; with the boss in the middle our deck lost.

---

## 3. Character

- Start (DECISIONS D1, `state.newGame`): level 1, 50 stamina, 50 mana, 1500 HP, 0 XP, 0 stat points, **200 gold,
  0 gems, no potions**; cards **Envoy** (Common 100/100/2, in deck slot 3) and **Master Brewer** (Standard 100/200/3,
  in the collection for the tutorial's drag-into-deck lesson). Max level 200.
- Player XP (round 3): **1 XP per stamina spent on minion taps** (client `quest_screen`: `addXp(getXPGain())` per
  click) plus PvP fights: `(1.5 + 0.5 × opponentLevel)`, ×4 on a win (a level-8 rival ≈ 22 / 6). **Quest boss
  fights give no player XP** (XP bar measured, playthroughs-2.md §1.3). `xpToNext(L) = round(50 × L^0.875)` from
  level 5 (L5 204, L6 240, L7 274: the measured ≈ 240 and ×1.15); levels 1–4 use the table **47, 47, 92, 94**
  (`PLAYER_XP_CURVE.low`, round 5), fitted on the 1.7.0 tutorial video: with the quest-2 replay and one Pieces win
  the level-ups land at quest 3 tap 1 (L2), quest 5 tap 3 (L3), quest 8 tap 5 (L4) and quest 10 tap 6 (L5), as in
  the video (tutorial-v2.md §10).
- **Level-up** (`player.addPlayerXp` → `levelUps` and `levelUpDetails[{level, rewards, statPoints: 12,
  unlocked}]`): +12 stat points, stamina and mana refilled, and the level's rewards are added at once
  (`player.levelUpRewards(level)` → `{level, gold, gems, potions[], tokens[]}`): gold = **50 × level** (except L4: 150, tutorial video), plus one
  extra repeating every 5 levels — L2 5 gems (L7, L12 … 50 gems), L3 and L4 a stamina potion, L5 a mana potion,
  L6 a Neophyte token (seen: L2 100 + 5 gems, L3 150 + stamina potion, L5 250 + mana potion, L6 300 + bronze
  token, L7 350 + 50 gems; the L4 potion colour and everything above L7 are extrapolated).
- **Level-up dialog** (port of the client's `comp_levelup` + `comp_levelup_attribute` / `overlays.levelup`,
  `src/ui/components/popup-levelup.js`): a white flash with the "Level Up" ribbon (hud_levelup), then the panel
  "Level up!" / "Reached level N"; left the "Rewards" column (one special reward picture — gem pile, potion or
  token — and the gold sum next to a coin pile: < 500 shop_coins01, < 1000 shop_coins03, else shop_coins04); right
  "Points: x/N" with the rows Health (+30/pt), Stamina (+1), Mana (+1), each with − (only for points placed in this
  dialog) and + (while points are left), and **Proceed**. N = every unspent point (client getAttributePoints; in a
  multi-level jump each earlier dialog offers its own 12, the last one the rest). Proceed spends them all: points
  not placed by hand are spread evenly (each to the attribute with the fewest points so far, ties mana → stamina →
  health; client autoLevelUp), counted up one per 250 ms, applied with `player.spendStatPoints` (current
  stamina/mana grow with their max). Then the level's unlock popups follow. Points left over in older saves can
  still be spent on the Profile screen.
- **Unlock popups** (`game.gamefeaturehelper.showPopup`, `view_unlocked_feature_popup`,
  `src/ui/components/popup-unlock.js`): "Card Fusing Unlocked! / Combine two identical cards to power up."
  (unlock_fuse), "Card Training Unlocked! / Sacrifice weak cards to level strong cards up." (unlock_train),
  "Arena Unlocked! / Duel against other players" (unlock_pvp), "Leagues Unlocked! / Get to the Top!" (unlock_pvp),
  "Card Slot Unlocked! / Your deck can now hold N cards." (unlock_cardslot), "OK". Feature popups follow the
  level-up dialog; the card-slot popup (and any popup still owed) shows when the Quest tab renders. Each shows once
  (`state.tutorial.seen`: feature ids, `cardslot3`..`cardslot5`); unlocks older than a level / two quests (saves
  from before the popups) are marked seen silently.
- Stamina and mana regenerate 1 point per real minute up to their max (computed from timestamps on load and every
  minute while open). Potions: stamina potion refills stamina to max, mana potion refills mana to max. When an action
  needs more than you have, the **Drink potion** dialog appears (use one, or buy one for 40 gems — 20 on Drinking
  Contest days — which is consumed immediately).
- **Deck slots** open by quest progress (client features `cardslot1..5`): a new game has 2 (slots 2 and 3); the first
  win of main **Q2 opens slot 4** ("Card Slot Unlocked! / Your deck can now hold 3 cards."), Q4 slot 5, Q7 slot 1
  (`resolveBoss` returns `deckSlots` = the new count). Stored as `player.deckSlots`; saves from before round 3 get
  at least what the old level table gave them and every slot that holds a card (`legacyDeckSlots`). API:
  `state.deckSlotCount(state)`, `state.slotUnlocked(state, i)`.
- **Feature unlocks**: a game started with the tutorial (it carries `state.tutorial.r3`) opens its features by
  **main-quest first wins** (`FEATURE_UNLOCK_QUESTS`, as in the 1.7.0 video): Card Fusing after quest 3, Arena (with
  Pieces and Replays) after quest 8, Card Training after quest 9, League after quest 10; the "… Unlocked!" popup shows
  on the map after that win. Older saves keep the level table (DECISIONS D1/D2, `FEATURE_UNLOCK_LEVELS`): Card
  Fusing at level 2, Arena at 4, Card Training at 5, League at 6. Quest map, Cards and Shop are always open. The nav
  buttons, the cards-screen mode buttons and the badges all ask `state.isUnlocked`.
  `state.isUnlocked(state, feature)` accepts fusion / arena / pieces / replays / training / league, the client ids
  evolve / pvp / enhance / leagues, and 'cardslot1'..'cardslot5'; `state.featuresUnlockedAt(level)` lists the
  features whose "… Unlocked!" popup belongs to a level-up (also in `levelUpDetails[].unlocked`).
- Player profile: name (editable), avatar (one of 12 card portraits), best card, Quests completed, Battles won,
  Your cards n/100.

---

## 4. Quest map (PvE)

### 4.1 Structure
- **Main quest**: 100 nodes on a vertically scrolling painted map (6 map sections, ~17 nodes each, drawn as numbered
  square tokens joined by lines; the current node pulses inside a rune circle; beaten nodes are blue, the next one
  highlighted, further ones grey).
- **Portals**: 9 documented portals (The Dark Beyond, Dawn of Eternity, Desert Twilight, Divine Peace, Dragon Hunt,
  Dread Empress, Dwarven Rage, Dying Dreams), each a 25-node line with its own 8-card set (the Dungeon Casino and its
  five random-effect cards were removed from the game on 2026-10-10 at the user's request). One portal
  is open at a time for 7 real days, cycling in the order above (the schedule is deterministic from the save's start
  date); the banner at the top of the main map shows the open portal and its countdown and enters it. **No portal
  archive** (round 5, like the client's map2_screen, which only placed running portals): an ended portal cannot be
  entered until the rotation brings it back; its quest progress and its booster tokens stay in the save, but its
  packs leave the shop (they come back with the portal). The shop also shows the next portal's packs as "Coming
  soon" with the countdown to its start.
- Quest 1 is free (tutorial). Beating a quest unlocks the next. Old quests can be replayed.

### 4.2 Playing a quest
1. Tap the node → **quest screen**: purple progress bar (0–100 %), landscape, the row of remaining minion portraits.
2. Tap a minion (`quests.tapMinion`, once per tap; `quests.questTapInfo(quest)` gives the per-tap numbers):
   - costs `staminaPerTap`: main quest **Q1 2, Q2–5 3, Q6–10 4, Q11–30 5, Q31–70 6, Q71–100 7** (seen: Q1 2, Q2 3,
     Q12–14 5, Q97 7); portals keep the wiki `StaminaPerFigure` 6 → 17. Figures = wiki stamina / stamina per tap
     (Q1 5, Q4 7, Q12–14 11, Q97 23);
   - pays **flat gold per tap** (`goldPerFigure`; a tap on the minion is always a "Perfect!" tap, client
     `getTapRatingCoins` rating 1 = money.max): main **Q1 6, Q2–5 18, Q6–10 24, Q11–30 30, Q31–70 33, Q71–100 36**
     (seen: Q1 6, Q12–14 30, Q97 ~36); portals the wiki `GoldPerFigure` 34 → 97. About 1 tap in 10 adds a bonus
     burst of 4.5× the tap value (Q12: a 140 burst at 30/tap); quests 1–10 (the tutorial) have no random bursts
     (`burstChance: 0`: the 1.7.0 video pays the same gold on both runs of quest 2), quest 1 adds +10 on its last
     tap (`endGold`). Golden Day ×1.5. `rewards.rollTapGold`;
   - gives **1 player XP per stamina** (may level up mid-quest: the level-up dialog then interrupts the quest);
   - the minion is defeated: an orange X-slash, gold "PERFECT", the minion gone within ~0.13 s, the tap's gold as a
     small white number at the top right; progress advances. Waves: 2–5 waves of 2–4 minions, each fading in from
     dark silhouettes. The gold is credited per tap and the HUD counter counts up with each tap (video: 200 → 206 →
     212); only a burst / the end gold is held and steps up (4 steps) under a coin shower when the wave ends. When a wave ends, 20 % of the time a whole card of the quest's band drops: no dialog
     — a glint where the last minion stood, a white flash turning into the glowing, rarity-framed card (1 s hold),
     then it flies into the minideck and the next wave fades in; the remaining minions fade out during a drop
     (the scene shows only the glint, as in the video at 0:28.6).
   Result fields: `stamina, gold, tapGold, burst, perfect, xp, levelUps, levelUpDetails, reward` (the card drop, or
   `{type: 'gold', gold, burst: true}` for the coin shower of a burst), `waveCleared, bossReady, pct`.
3. When all waves are cleared: **Boss fight intro** ("Boss Fight n", boss card in a rune circle, name) → the
   pre-battle screen with the boss line-up face-up → Attack! → battle → result.
   - Boss line-up: the fixed boss card (wiki list for Q33–100 and the portal tables; earlier quests use the quality
     band) at level = `clamp(round(quest × capFraction))`, plus 4 random cards of the quest's band at matching levels.
     Boss player HP: wiki values where given (portals ≈ 3,965 + 260 × q), main quest `1500 + 90 × quest`.
     Quests 1–10 carry the tutorial bosses (tutorial-v2.md §10 item 8; level-1 cards, `bossName`, `bossCardIds`,
     `bossSlots` in quests.json; HP before → after the tribe bonus): Q1 Worm Shaman 2 × Throat-Cutter, 250 → 300;
     Q2 Bone Breaker alone, 800 → 960; Q3 Lurking Goblin + 2 Throat-Cutters, 800 → 960; Q4 Flinger alone (plain, not
     fused), 800 → 960; Q5 Worm Shaman + Throat-Cutter, Pouch Tearer, Throat-Cutter, 1300 → 1560; Q6 Blood Spitter
     and Q7 Club Swinger "???", 1060 → 1272; Q8 Tribe Avenger "???", 1160 → 1392; Q9 Ugluk Maggot Eater "???" with
     a Scout (elf) in the orc line-up, so **no** tribe bonus, 1400; Q10 Succubus, 1260 → 1512. Deviation: the video's
     Q5 row is Flinger, Worm Shaman, Lurking Goblin, Throat-Cutter, but with our card stats that row beats the video's
     arranged deck too, so ours keeps a row that loses unarranged and is won with the Falconer moved to slot 2. With
     the real engine Master Brewer + Envoy win Q1 and lose Q2.
   - Boss fights give the deck cards XP but **no player XP**.
   - Win: next quest unlocks; reward roll — 45 % gold (3 × wave gold), 25 % booster token (Neophyte Q1–30, Summoner
     Q31–70, Archmage Q71–100; portal tokens low/high by node), 15 % card piece of a set card (Q ≥ 31 for Heroic,
     Q ≥ 71 for Legendary; portals from node 4), 10 % potion, 5 % gems (13–82). Quest nodes 25 of a portal
     always give a high token on the first win, and every win of a portal's last quest pays **1,000 gold** on top
     (`bonusGold`). Quest 1's first win gives only the Throat-Cutter soul card (`rewardCard`).
   - Lose: the minions must be beaten again (progress resets to 0 %).
4. The ranger guide shows tutorial lines on the map for the first quests ("That card is tough! You need a stronger deck."
   after a loss; "Card Training Unlocked!" at level 5, etc.).

### 4.3 Card quality bands
| Quests | Band (card rarities) | Card level range |
|---|---|---|
| Main 1–10 | Common, Standard | 1–3 |
| Main 11–30 | Standard, Uncommon | 2–8 |
| Main 31–60 | Uncommon, Rare | 5–14 |
| Main 61–90 | Rare, Heroic (fused + to ++) | 10–26 |
| Main 91–100 | Heroic, Legendary (++) | 20–34 |
| Portal 1–8 | Uncommon, Rare | 8–18 |
| Portal 9–17 | Rare, Heroic | 14–30 |
| Portal 18–25 | Heroic, Legendary | 24–44 |

---

## 5. Arena, Pieces, Replays (PvP against simulated players)

- A pool of ~60 **simulated players** is generated once per save (names, avatars, levels spread around the player's
  level and growing slowly over real days, decks drawn from the catalog at matching power, HP from their level).
  They are regenerated/refreshed daily so the ladder keeps up with the player.
- **Arena tab**: three opponents (easy = level −2…0, deck power 0.7×; normal = level ±1, 1.0×; hard = +1…+3, 1.3×)
  with info popups (best card, level, stamina, mana, HP, quests, fights won) and an attack button. Fighting costs
  mana = deck mana sum (you cannot select a deck whose mana sum exceeds your max mana). Rewards: gold
  (`enemyDeckMana × 6`, ×2 on a win), Tournament Points (10 per win), card XP, player XP. A reroll of the three
  opponents happens automatically after each fight and on a timer (30 min) or for 10 gems.
- **Pieces tab**: 8 piece-hunt slots. A card piece obtained from a boss starts a hunt (slot shows the card art cut
  into n puzzle pieces, lit pieces = owned). For each slot the game picks a simulated player who "holds" a piece of
  that card; attacking costs deck mana; win → +1 piece; lose → nothing. Opponent rerolls after each fight or via the
  Gremlin trick. Completing all pieces creates the card (the full-card celebration). Missing pieces can be bought with
  gems (brief §5.3 table). Buying the first piece of an empty slot: 100 gems (random Rare/Heroic set card).
  Simulated raids: every real day, with 20 % chance per uncompleted hunt, one piece is "stolen" (notified on login) —
  keeps the original tension; can be disabled in Settings.
- **Replays tab**: the last 10 fights (seed + line-ups) can be re-watched.

---

## 6. League

Round 3 (DECISIONS D3): ported from the 1.7.4 client (`game.leaguemanager`, `ui.components.league.*`,
`comp_league_enter_popup`, `comp_league_finish_popup`); server numbers from the 1.7 videos (round3/cardstats.md §4,
social.md §1). Code: `src/game/league.js`, `src/ui/screens/league.js`, constants `LEAGUE` (constants.js).

- **Tiers**: Bronze, Silver, Gold (no Platinum). Everybody starts in Bronze. After each league the **top 3** (with
  points) advance one league (Gold stays Gold); **everybody else goes back to Bronze**. The tier sets the simulated
  players' strength multiplier (0.9 / 1.05 / 1.2). Rules text (info screen): "You start in the Bronze League. Defeat
  other players to earn points! After each tournament, the three players with the most points advance to the next
  league; the others go back to the Bronze League. The higher the league, the better the prizes!"
- **Schedule**: a league runs one real day (00:00–24:00 UTC; joining late is allowed) with a d:hh:mm:ss countdown
  ("FINISHED" at 0). The real league length was server-side and unknown (timers of 0:17 and 0:23 hours were seen).
- **Players**: you + 49 simulated players from the pool (~50 rows like the 1.7 list). About 28 % never fight (0 points,
  rank "-"); the others follow a per-player curve `points(t) = (wins·150 + extra)·f^k` (f = share of the day elapsed,
  k 0.6–1.8), half of them league-only (multiples of 150, so ties happen), the rest with odd Arena/Pieces points. Best
  simulated score of a day ≈ 2,400 (Bronze), 5,000 (Silver), 11,000 (Gold); deterministic from the save's seed.
- **Points**: **+150 per won league fight**, 0 for a loss; **Arena and piece-hunt wins give a variable amount that
  depends on the opponent** (forum: they count; video 0FHHEDEqb1I: +21 / +31 / +119 steps, league-timing.md): Arena base
  20 / 60 / 120 by the green / yellow / red row, piece hunts base 30, each ×(1 + 0.08 × (opponent level − your level))
  clamped to 0.6–1.6; the Arena rows show the points at stake (pvp_points icon). All ×2 on "Double PvP points" days. A league fight costs the deck's
  mana ("Mana needed: deck mana / max mana" in the pre-battle is that cost). Each opponent can be fought 3 times per
  league (our anti-farming rule; the client only sends a `fightable` flag). Points count only after the player joined.
- **Ranking**: by points; **ties share the rank** (5, 5, 7); players with 0 points have no rank ("-"); ranks 1–3 are
  shown in yellow; the own row has the gold frame.
- **Prizes** (to rank 29; a card prize is a random card of that rarity):

  | Rank | Gold | Silver | Bronze |
  |---|---|---|---|
  | 1 | 1 legendary card, 12 mana potions | 1 heroic card, 7 mana potions | 1 rare card, 5 mana potions |
  | 2 | 1 legendary card | 1 heroic card | 1 rare card |
  | 3 | 1 heroic card | 7 mana + 7 stamina potions | 5 mana + 5 stamina potions |
  | 4 | 700 gems | 400 gems | 200 gems |
  | 5–9 | 10 mana + 10 stamina potions | 5 mana + 5 stamina | 2 mana + 2 stamina |
  | 10–19 | 10 mana potions | 5 mana potions | 2 mana potions |
  | 20–29 | 200 gems | 100 gems | 25 gems |

  Tournament Points still accrue at settlement (= league points / 10). Prizes are granted when the league is settled
  (next open); a card prize settled without the card db waits for the finish popup.
- **Screens**: list (top bar with tier name in its colour, timer, info button; rows with rank, picture or "?", name,
  points, up to two prize icons, fight button; opens centred on the own row), info view (RULES + PRIZES per league),
  enter popup on the first visit ("Join League"), finish popup ("Congratulations! / Bronze League completed / Your
  rank: n / prize icons / Take your Reward and enter the next League: or Enter the next league: / next league / Join
  League").
- Old saves: an 8-player league of today is upgraded (points and fights kept), an older unsettled one is settled with
  its old rates, Platinum maps to Gold, a player who already had a league counts as joined.

---

## 7. Shop and economy

- **Currencies**: gold, gems, stamina/mana potions, booster tokens (Neophyte, Summoner, Archmage, portal low/high).
  Gems are earned only in-game (daily rewards, league prizes, set completion, boss drops, level-ups: 5 at level 2,
  50 every 5 levels from level 7, §3). There is no real-money purchase; the "+" button opens the shop.
- **Boosters** (round 3, the 1.7.4 grid of `game.boostermanager2` / `openbooster_screen`; constants `BOOSTER_PACKS`):
  a booster is **nine face-down cards in a 3×3 grid** with a fixed rarity make-up, shuffled over the grid. Each
  pick costs **1 token** of the pack while the player has any, else the pack's **gem price per card** (−50 % on Get
  the Best Cards). The player may draw as many as they like; the booster stays in the save (`state.boosters`,
  key `pack` or `pack@portal`) until the green refresh button (or the last pick) asks "Do you want to open a new
  booster?" and OK seals a fresh one (free; undrawn cards are lost). A card new to its collection set shows
  "Card added to set: <set> n/8".
  - Neophyte Pack: 50 gems/card; 5 Uncommon + 3 Rare + 1 Heroic (main set).
  - Summoner's Pack: 350 gems/card; 5 Rare + 3 Heroic + 1 Legendary (main set).
  - Archmage's Pack: 975 gems/card; 2 Rare + 5 Heroic + 2 Legendary (main set).
  - Portal low pack (named after the low token, e.g. "Infinite Void Pack"): 250 gems/card; 5 Uncommon + 3 Rare +
    1 Heroic; a slot draws the portal's own card of that rarity with 50 %, else a main-set card ("… Cards and
    other Mages").
  - Portal high pack (e.g. "Empyrean Pack"): 1,000 gems/card; 5 Rare + 3 Heroic + 1 Legendary, portal share 60 %;
    the Legendary is the portal's Ultimate with 10 %.
  - Sources: 9-card grid, per-card pricing and 975 / 1000 / 250 / 50 gems from the 1.7.x videos (screens.md §1.1,
    lategame.md §1, playthroughs-2.md); big 1 L + 3 H + 5 R and small 1 H + 3 R + 5 U from the Benito tally
    (lategame.md §1.2). Summoner price and the main packs' make-up are our guesses on the same scheme.
- **Shop screen** (round 5, the user's shop-1/2.png): "Need more Tokens? Visit the Shop!" banner (opens the gem
  packs), then a vertical list of framed pack banners: Neophyte Pack, the running portal's two packs ("Offer ends in
  d:hh:mm:ss"), the next portal's two packs ("Coming soon:" + countdown, not tappable yet), Summoner's Pack,
  Archmage's Pack. Each banner has "Look inside", the "May contain:" rarity squares (no odds) and the token count.
  Ended portals' packs are not listed (their tokens wait in the save for the portal's return).
- **Gem packs** (shown only, no purchase in the offline game): Apprentice's Bundle 500 ($4.99), Wanderer's Purse
  1,000 ($9.99), Hero's Wallet 3,500 + 5 potions ($24.99), Evoker's Treasure 10,000 + Heroic card + 10 potions
  ($49.99), Master's Vault 20,000 + Legendary card + 20 potions ($99.99).
- **Potions**: 40 gems (20 during Drinking Contest), only offered when short (Drink potion dialog); a stamina potion
  refills to full (playthroughs-2.md §1.5). Other gem prices seen in 1.7.0: completing a card piece 20 gems (the one
  missing Uncommon piece, `PIECE_PRICES`), "Recalculate rival" in the Arena 10 gems (`ARENA.rerollGems`).
- **Daily rewards**: exactly the brief §5.4 table (21-day cycle, consecutive-day counter reset on a missed day),
  claimed on the first open of a UTC day. A brand-new game pays nothing on its first day (the 1.7.0 video starts
  with 0 gems and no popup): `newGame` marks that day as claimed with streak 0, so day 1 comes the next day.
- **Daily events** (one per day, deterministic by date): Infinite Wisdom (double card XP), Drinking Contest (potions
  20 gems), Card-piece Day (piece prices halved, 50-gem first piece), Double League Points, Great Potion Deal
  (buy 3 potions for 60 gems in the shop), Get the Best Cards (boosters −50 %), Golden Day (+50 % gold).
- **Set collections**: each portal (and the Main set) has a collection page; owning all 8 (Main: 17) set cards at any
  stage grants the gem reward once (4,600–5,600; Main 31,700).

---

## 8. Screens and navigation

| Screen | Content |
|---|---|
| Title | Dragon key art, logo, "Tap to continue"; a new game plays the opening (tutorial, §9); the name is asked on the first Arena visit. |
| Landing feed (Home) | The client's landing page (`comp_promotions` banner list), shown once at login and later through the extended menu's Home button: "DON'T MISS YOUR NEXT REWARD!" daily-reward strip (next days, D n, countdown to the next claim), Main Quest banner (→ map), today's event with its d:hh:mm:ss countdown (orange x2 badge on double events), the open portal (card fan, "Portal closes in:" countdown → portal map), "Get Cards" booster promo (→ shop), the next portal's teaser with its countdown. |
| Quest Map | The middle nav button goes straight here (no feed in between). HUD without back arrow, the running portal's banner + countdown at the top (enters the portal), the painted map with the quest nodes, guide bubble, bottom nav; owed unlock popups. A portal map is pushed on top (back arrow → main map). |
| Quest | HUD, progress bar, landscape, minion tray, reward bursts, Drink potion dialog. |
| Boss intro | fx_boss_light picture: "Boss Fight n" (or "Showdown!" for a quest marked `showdown` — the tutorial's quests 5 and 10 — or a chapter's last boss) on the title plate, boss card in the rune circle, name plate; auto-advances (~2.6 s or a tap) into the pre-battle. No Continue, no boss HP, no "Quest n unlocked!" toast after the win. |
| Pre-battle (deck) | HUD and bottom nav; opponent row (face-up or card backs), Attack! bar, player row with drag-and-drop from the collection drawer (our addition). No HP bars; PvP adds the opponent's and the player's names and the "Mana needed" bar. Used by quests, arena, pieces, league. |
| Battle | playback as §1.5; Skip fight; banner, loot, card XP bars and level-ups, Continue, then the player level-up dialog(s). |
| Level-up dialog / unlock popups | §3: "Level up! / Reached level N", Rewards, "Points: x/N" with +/−, Proceed; then "… Unlocked!" popups. |
| Cards | The client's deck screen with three modes (round 5, the user's deck.png / fusion.png): deck edit ("Your Deck" with the 5 slots, "Your cards n/100", "Mana needed: x / y"), training ("Card Training": Train slot, Sacrifice stack, price, OK) and fusion ("Fuse cards": Slot 1, price + OK, Slot 2). Below them the mode stripe with three icon buttons (training ←, cards, fusion + with the "!" badge; padlocked while locked) and the horizontal card slider of big cards with "Level x / y", starting scrolled to the left end. Cards move by drag and drop only; a tap opens the card detail (Sell, Zoom). |
| Arena | tabs Arena / Pieces / Replays. Arena: event banner, then three opponent rows (portrait framed in the difficulty colour, name in green / yellow / red, star + level, heart + HP, info, attack). Pieces: 4-per-row grid of puzzle cards with an attack button under each. |
| League | top bar with the tier and d:hh:mm:ss countdown, ~50-row standings with prizes and attack buttons, enter / finish popups, info screen (rules, prize table). |
| Shop | framed pack banners (§7: Neophyte, current portal, next portal "Coming soon", Summoner, Archmage; "Look inside", token counts, countdowns), potion deal, gem packs (display only); booster opening = 3×3 grid of face-down cards. |
| Profile | Opened by tapping the HUD's level / stamina / mana bar or the extended menu's Profile button (the client's playerinfo screen, the user's profile-top-tap.png): avatar (tap = pick a portrait) and name (tap = rename), "Best card" with its art, "Stats" bars (level, stamina, mana, health) with the "Bonus" column, Quest, Battles won, Your cards n/100, Support (the help pages). Stat points left over from older saves get a panel below. |
| Options | The extended menu's Options button: music / FX volume sliders, battle speed on a preset slider, sound, simulated raids, reduced motion, export / import save JSON, reset progress. The 21-day daily calendar is a sub-view of the same screen (`character {tab: 'daily'}`). |
| Collections | portal/set pages with locked silhouettes and gem reward. |
| Help ("?") | rules summary from this document, per screen. |

Navigation (round 5, the client's menubar / statusbar): the bottom nav has League (trophy), Arena (swords), Quest map
(map star), Cards and the green Shop, plus the orange up-arrow that slides up the extended menu (Album = set
collections, Profile, Options, Home = the landing feed); a grey catcher or the arrow closes it. League and Arena wear
the padlock plate until `isUnlocked` (a tutorial game: Arena after quest 8, League after quest 10; older saves:
levels 4 / 6). Badges: "!" on Cards when a fusion is possible (deck_full when the collection is full), "!" on League
while unlocked and not joined, "!" on the arrow and Profile for unspent stat points. HUD: "?" (help) on the left; the
main tabs (quest map, arena, league, cards, shop) have **no back arrow** (Escape = the hardware back key), pushed
sub-screens (quest, pre-battle, card detail, album, profile, options, help, a portal map …) show the back arrow next
to a smaller "?"; the level / stamina / mana bar opens the profile; the gold / gems bar with the green "+" opens the
gem packs. The battle and booster-opening screens hide HUD and nav.

---

## 9. Tutorial (first session)
Round 3/5 (DECISIONS D1; user direction: exactly like Benito's 1.7.0 tutorial video), code in `src/ui/tutorial/`,
step-by-step source `exploration/research/round3/tutorial-v2.md`. The 1.7.4 client ran its tutorial with a server-fed trigger
engine (`game.tutorial.tutorialmanagerv3` + `tutorialgetter`); the step data was server side, so the script is ours,
written from the video; the views are ports of `view_tutorialv3_text` (text box), `view_shp_highlights` (button
sparkle at once, pointing hand after 2 s), `fx_tutorial_arrow` (drag arrow), the opening of `ctrl_intro` /
`ctrl_intro_fight` and `comp_name_popup`. Lines: English client text where an English video recorded it, otherwise
translated from the German video (marked in `lines.js`); ranger = guide, the Worm Shaman / Succubus taunt; no "Morden".
1. **Opening** (new game only): `intro_part1` with the lore captions and "Skip intro" (ends part 1 only) → the Worm
   Shaman's card in the boss frame (`bossfight_preview`, speed 1.2) → the scripted fight of `script_intro_fight.json`
   (Worm Shaman 300 HP with Throat-Cutter, Flinger, Lurking Goblin vs "You" 1500 HP with the Envoy; Attack! sparkle +
   hand; the Envoy dies, the player falls to 0, no Defeat banner) → `intro_part2` (burning tower, white flash) → quest
   map. Escape does nothing during the opening (as on the phone). Automatic `user-<digits>` name.
2. **Start state**: the Envoy alone in deck slot 3, slots 2-3 open, 200 gold, 0 gems, 50/50, 50/50.
3. **Quest 1**: map "Don't let it end like this! Follow him to his lair...." + node 1 sparkle; quest "The Shaman's orcs
   are in our way! Smite them!" until the first tap; the **2nd minion drops the Master Brewer soul card** into deck slot 2
   ("One had a soul card! It will help fight our foe."); 5 minions × 2 stamina, 6 gold + 10; pre-battle "Avenge the
   village! Unleash your cards!"; Worm Shaman 250 (300) HP with 2 Throat-Cutters - **won** with Master Brewer + Envoy;
   reward the Throat-Cutter soul card + "The Shaman has fled! He dropped a soul card."; map "I think he went this way!".
4. **Quest 2**: Bone Breaker alone (800 → 960) beats Master Brewer + Envoy; map "That card is tough! You need a stronger
   deck." + Cards sparkle; the drag arrow puts the Throat-Cutter on the Envoy's slot ("Your Throat-Cutter is stronger
   than the Envoy."), then "You'll beat the Shaman's Bone Breaker now!" + Quests sparkle; the replay shows the Shaman's
   "Your next victory will not come so easily, Evoker." in round 2 and is won; +50 gold; "Card Slot Unlocked!" (slot 4)
   and the arrow puts the spare card into the new slot (also after Q4 / slot 5 and Q7 / slot 1).
5. **Quest 3**: level 2 on the first tap (level-up dialog; later level 3 at quest 5 tap 3, 4 at quest 8 tap 5, 5 at
   quest 10 tap 6, see §3); Throat-Cutter + Throat-Cutter + Lurking Goblin, "Skip fight"
   from here; reward a 2nd Throat-Cutter; map "Card Fusing Unlocked!" → Cards sparkle → fusion tab sparkle → "Fuse
   identical cards to increase their power." + arrow to Slot 1 → "Now drag the other card onto the second slot." + arrow
   to Slot 2 → OK (400 gold) → Throat-Cutter+ 230 / 115, Level 1 / 12.
6. **Quests 4-10** (boss, reward): Q4 Flinger (Falconer), Q5 "Showdown!" Worm Shaman 1300 (Worm Shaman card; quest line
   "No more running. This time I will either crush you or die trying!", pre-battle "Looks deadly... arrange your cards
   with care.", "You did it!"; map rune line), Q6 Blood Spitter "???" (Club Swinger piece, "This card will be mighty once
   it is complete."; pre-battle "What is that ugly thing?"; map "We must go to the Arena to complete cards!"), Q7 Club
   Swinger (Gremlin; map "I can see the Arena in the south!"), Q8 Tribe Avenger (100 gold; "A Tribe Avenger! They're
   insane... just look..."; "Arena Unlocked!", map "Time to finish the Club Swinger!" + Arena sparkle → name popup →
   Pieces tab sparkle → "Defeat this amateur mage to get his card piece!" → pre-battle "The opponent hides his cards." →
   then "Complete card pieces quickly, or other players might steal them."), Q9 Ugluk Maggot Eater (Pouch Tearer; quest
   "Strange... these tracks aren't only from orcs!"; "Card Training Unlocked!" → training tab sparkle → "Sacrifice weaker
   cards to train strong ones." + arrows to Train and Sacrifice → OK), Q10 "Showdown!" Succubus 1260 (Bone Breaker; quest
   "Peasant women from the area claim that their husbands have disappeared.", fight "Tell us why you burned down our
   town, demoness!" / Succubus "That wretched little village? It is lost to you, Evoker!"; "Leagues Unlocked!" + League
   sparkle). The first League visit ends the tutorial. Boss cards of Q1-10 are level 1; a tutorial game gets no random card drops in their
   minion waves (`waveCards: false`) and no random gold bursts (`burstChance: 0`).
   The **Pieces** lesson's holder is scripted (`opponents.TUTORIAL_HOLDER`, set by `pieces.assignHolder` while the
   tutorial runs): "Baltasar", Level 2, Quests 2, Fights won 0, 1500 HP, three hidden level-1 cards (Pouch Tearer,
   Envoy, Pouch Tearer), beaten with the tutorial deck; raids never take the tutorial piece.
   **No daily event** while the tutorial runs (`shop.dailyEvent(now, state)` returns null for a save with an
   unfinished tutorial record), so no double card XP or Golden Day gold changes the video's numbers.
   Fight lines are timed from their round (the battle's "ROUND n" label): the Shaman's line from round 2 of the
   quest-2 retry, the ranger / Succubus lines from round 1 of quest 10; reward lines only after a first win.
   Text box positions (`view_tutorialv3_text_layout`): "bottom" = over the nav bar (5 units from the bottom) for the
   steps of the video, "bottom_menu" (70 units up) where a nav button is highlighted (the deck lesson's "You'll beat
   the Shaman's Bone Breaker now!"; the map's own guide bubble). The button sparkle uses alpha versions of the
   client's black-backed glow frames (`assets/ui/tutorial/`), since the overlay layer isolates blend modes. A training
   / fusion cutscene hides the overlay and closes its lesson.
7. **Unlocks of a tutorial game** follow boss wins (`FEATURE_UNLOCK_QUESTS`): fusion Q3, Arena/Pieces/Replays Q8,
   training Q9, League Q10; the popups show on the map after the win (none with the level-up dialog). Saves without a
   tutorial record keep the level table (§3).
8. **Name**: the first Arena visit opens the name popup (pvpguard portrait, "Before you enter the arena, Evoker,
   please tell me by which name the heralds shall refer to you:", input with the current name, max 18 characters,
   OK; X keeps the name and asks again next visit).
9. **Save**: `state.tutorial.r3 = { intro, lost: [quest numbers lost], seen: [one-off steps], named, done }`. Saves
   without it (all saves before round 3) count as finished and named: no hints, no lines, no name prompt.

---

## 10. Persistence and settings
- Save in `localStorage` (`evoker.save.v1`), autosaved after every state change; export/import as JSON file.
- Settings: sound on/off (no audio assets ship by default; hooks exist), battle speed (1×/2×/skip), simulated raids on/off,
  reduced motion, reset progress (confirm twice).
- The game is fully offline; no network calls at runtime.

---

## 11. Out of scope (documented)
Real multiplayer, real-money purchases, Facebook login, chat, push notifications, the Windows Phone bugs.
