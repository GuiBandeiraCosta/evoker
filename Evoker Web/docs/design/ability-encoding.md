# Ability encoding (data/abilities.json)

Every card ability is stored in the **original game's buff model** recovered from the 1.7.4 client
(`docs/design/original-engine.md`). `src/core/abilities.js` validates the data and turns it into the concrete buff list
the engine runs (`buffsForStage`). The engine (`src/engine`) codes against the schema below; the UI only needs
`renderAbilityText`, `hasAbility`, `abilityForStage` and `effectDirs`.

## 1. Schema

`data/abilities.json` is an object keyed by card id (the slug of the catalog name, 200 keys, catalog order). A value is

| value | meaning |
|---|---|
| `null` | the card has no ability (55 cards) |
| `{ "text", "buffs": [], "notes"? }` | flavour text only: the three trainer cards (`hasAbility` is false) |
| `{ "text", "buffs": [buff, …], "notes"? }` | a normal ability |
| `{ "byStage": [e0, e1, e2, e3, e4], "notes"? }` | evolving ability (Bog/Sand/Mountain Yeti, Magmamancer, Army of Ghosts): one entry (`null` or an entry as above) per fusion stage |

`text` is the original card text with the number replaced by `{v}` or the percent by `{pct}` (the UI renders
`{pct}` as `N%`). `{v}` is only allowed when a buff uses `"strength": "value"` or `"cap": "value"`, `{pct}` only when
a buff uses `"strengthPercent": "value"`. A card may use `"value"` without a placeholder (Wheel of Fortune,
Bone Dragon: their texts carry no number).

### A buff

```jsonc
{
  "type": "raise_attack",            // one of the 18 original handlers or an extension type (section 3)
  "strength": "value" | 123,         // "value" = the card's level-scaled ability value; omitted when meaningless
  "strengthPercent": "value" | 75,   // [ext] percent instead of a flat strength (raise_attack, increment_attack,
                                     //       bonus_attack, heal_boost_percent, reduce_ability_attack_percent, gamble)
  "cap": "value" | 123,              // [ext] reflect_damage(_to_player): maximum reflected per hit
  "directions": ["left", "right"],   // front | frontLeft | frontRight | left | right | self (may be [])
  "scope": "own_cards",              // [ext] target set instead of directions (section 3.2)
  "filter": { "tribe": "orc", "offensive": true, "excludeSelf": true, "hasAbility": true },  // [ext]
  "pick": "random", "count": 1,      // [ext] choose `count` cards of the scope (highest_attack | lowest_attack | random)
  "event": "always",                 // always | round_eq | round_ge | round_le | onDamage | onDeath | [ext] round_odd | round_even | onHeal
  "eventData": 1,                    // round number for round_eq/ge/le; "self" | "opponent_cards" | absent for onDamage/onDeath; "self" for onHeal
  "nextRound": true,                 // [ext] event buff whose effect is queued for the next round's phase of that type
  "emptyReduction": -200,            // attack only (original): subtracted from the attack before the split on an empty slot
  "perTarget": true,                 // data flag: strength is a per-target amount, multiplied by #directions by buffsForStage
  "baseAttack": true,                // [ext] strengthPercent is a percent of origAttack (not of the buffed attack)
  "unreflectable": true,             // [ext] attack / deal_damage_to_all_opponent_cards: no onDamage events are pushed
  "triggerDirection": "front",       // [ext] event buff: fires only when the event's `to` card is the card at that direction
  "damagedBySelf": true,             // [ext] onDeath buff: fires only if this card damaged the dying card this round
  "strengthFromEvent": true,         // [ext] the strength is the event's value (onHeal: the healed amount)
  "ext": true                        // present on every buff that uses an extension type, event or field, and only there
}
```

The card's **normal attack is implicit**: the engine adds `{ type: 'attack', directions: <card dirs>, event: 'always' }`
with the catalog dirs mapped `direct → front, left → frontLeft, right → frontRight, ownLeft → left, ownRight → right`
(`DIR_MAP`). A stored `attack` buff **replaces** it (section 2.2). `die` is implicit for every card and never stored.

### Exports of `src/core/abilities.js`

- `BUFF_TYPES`, `DIRECTIONS`, `EVENTS`, `DIR_MAP`, `DIR_MAP_BACK`, `SCOPES`, `PICKS`, `FILTER_KEYS`, `EXT_FIELDS` (the phase
  order lives in `src/engine/effects/index.js`, the tribe list is `constants.TRIBE_ORDER`).
- `validateAbility(ability) → string[]` — shape, known types/directions/events, eventData rules, per-type strength and
  direction rules, extension field rules, `ext` consistency, placeholder rules.
- `abilityForStage(ability, stage)`, `hasAbility(ability, stage)` (true when the stage entry has at least one buff),
  `renderAbilityText(ability, value, stage)`, `formatValue(n)`, `effectTypesOf(ability)` (buff types across stages).
- `effectDirs(ability, stage)` — catalog-named directions of the non-attack buffs (blue arrows); `self` and scope buffs give nothing.
- `buffsForStage(ability, stage, abilityValue, cardDirs)` — the concrete list for the engine: deep copies with every
  `"value"` replaced by `abilityValue` (strength, cap, strengthPercent — percent cards pass the percent), `perTarget`
  strengths multiplied by `#directions` (flag removed), the implicit attack prepended unless overridden or the card has no dirs.
- `toOriginalDirs`, `toCatalogDirs`, `isExtensionBuff`.

## 2. Rules

### 2.1 Splitting and `perTarget`
The original `heal`, `raise_attack` and `raise_hp` handlers give each target `round(strength / #directions)`.

- **Strengtheners give the total** ("Increases the damage dealt by his neighbors by X": each neighbour gets X/2 —
  confirmed by the Dwarf King wiki page). Stored as `strength: "value"`, no `perTarget`.
- **Neighbour heals give the per-target amount** ("Heals each of his neighbors by X"). Stored as the per-target value with
  `perTarget: true`; `buffsForStage` emits `strength = 2X` so the handler's split reproduces X per neighbour
  (original-engine.md section 4).
- **Arch Angel** ("Increases the health points of his neighbors by X") follows original-engine.md section 7 (strength 2X,
  i.e. `perTarget`). game-design.md section 1.4 halved it; removing the flag gives that reading.
- Single-direction and `self` buffs need no flag (`#directions = 1`).
- **Scope buffs are never split**: the strength is the per-target amount (Guardian of Time, Mendicant, Herb Collector, …).

### 2.2 Attack overrides
Only five cards store an `attack` buff; its directions must equal the mapped card dirs (tested against cards.json):

| card | override |
|---|---|
| Catapult | `attack [frontLeft, front, frontRight] round_le 3` (no attack from round 4; `hasAttack` false from round 4) |
| Rat Eater, Succubus | `attack [front] always emptyReduction -200` (200 more to the player on an empty slot) |
| Treeman | `attack [front] always emptyReduction 200` (200 less) |
| Carnivorous Toadstool | `attack [frontLeft, front] always unreflectable` |

Death-time extra attacks are **not** attack overrides: `bonus_attack` with `onDeath/self`, `strengthPercent` and
`baseAttack` (Flameling 100 % front; Schemer 200 % front; Goblin Patriarch 200 % over [left, right] = 1× base each;
Warg Rider 250 % over all five directions = base/2 each). Empty slots hit the opposing player (original attack handler;
the wiki says "the corresponding player" for own-neighbour slots — not reproduced).

### 2.3 Events and target checks
- `onDeath`/`onDamage` with `eventData "self"` = this card; `"opponent_cards"` = a card of the other player; absent = any card.
- An `onDeath/opponent_cards` buff **with directions** (Crystal Golem, Mammoth Citadel, Battering Ram, Ore Titan: `[front]`)
  fires only when the dying card is the card at one of those directions (target check), whoever killed it.
  `damagedBySelf` (Ram, Titan) additionally requires that this card damaged it this round.
- `triggerDirection` (Slaver, Sky Guardian): the dying card must be the `front` card, while the effect's `directions`
  (`[frontLeft, frontRight]`, the dead card's neighbours) differ from the trigger.
- `nextRound`: Bone Collector / Guruk (`raise_attack self onDeath opponent_cards`, +100/+120 per death, next round only),
  Slaver / Sky Guardian (`no_damage` next round), Gladiator / Leviathan (`raise_attack self onHeal`, strength = healed amount).
- `onHeal` (extension event): the `heal` handler pushes `{ type: 'onHeal', from, to, value }` after a successful heal.
- Devourer / Giant Spider: `heal self onDeath opponent_cards strength value` — one heal per enemy death event; the heal
  handler skips a dead target, which is the "if it survives" condition.
- Totem Carver: `increment_attack` (permanent) `onDeath` with no eventData (any death on either side), scope own orcs with an attack.
- Baby Dragon: `increment_attack onDeath self` to the other own Neutral ("dragon") cards with an attack.

### 2.4 Rounds
`round_eq N`, `round_ge N`, `round_le N` as in the original. "Rounds 2 and 3" = two `round_eq` buffs of the same type
(the first matching buff of a type fires each round; disjoint conditions make this safe, used by the yetis and the
Magmamancer). `round_odd` / `round_even` are extensions (Harpy, Werewolf Dwarf). The first-match rule means a card
should never carry two buffs of one type that can match the same round; the validator does not check this, the data does.

### 2.5 Permanent vs per-round attack growth
`raise_attack` is reset every round; `increment_attack` raises `origAttack` permanently. "X more damage each round" /
"increases by X per round" (Scrapmaster, Thief of Time, War Tattooist, Bloodsoaked Totem) and the death counters
(Totem Carver, Baby Dragon, Bone Dragon, Enormous Larva) are `increment_attack`; everything else is `raise_attack`.
`strengthPercent` on `raise_attack` is a percent of the card's attack at the time of the phase (doc section 8);
with `baseAttack` it is a percent of `origAttack` (Goblin Mob, wiki: "twice the basic power", and the death attacks).

### 2.6 Stuns, suspends, dazes
Stun = `no_buff` + `no_damage` as two buffs (the wiki says they are separate: a suspended stunner still suppresses but
no longer dazes, because `no_buff` is the only handler not blocked by `noBuffsAllowed`). Siren, Magmamancer ++ / ++++,
Bouncer and the Thief's `stun_pattern` follow this.

### 2.7 Scope buffs (extension)
`scope` replaces `directions` for abilities that act on a set of cards: `own_cards`, `opponent_cards`, `all_cards`,
`each_side` (Bouncer: the pick is made once per side). `filter` narrows the set: `tribe`, `offensive` (has an attack
direction), `excludeSelf`, `hasAbility` (Medusa). `pick` + `count` choose cards from the set; **random picks are
memoised per (card, round, scope)** so Bouncer's `no_buff` and `no_damage` hit the same cards. Scope buffs are never split.
`filter` is also allowed on direction buffs (Swarmkeeper `[left]`, Bone Oracle `[left, right]`: "if an orc").

### 2.8 Percent cards
Djinn, Medusa, Dark Mage and Wizard Apprentice have a percent ability value; their buffs use `"strengthPercent": "value"`
and their texts `{pct}`. `buffsForStage` puts the percent into `strengthPercent`.

### 2.9 Evolving cards (`byStage`)
Stage entries carry their own text and buffs; stage 0 of the yetis and Magmamancer is text only (`buffs: []`,
`hasAbility` false, the text is still shown). Sand Yeti heals the player at every stage.

## 3. Extensions (all flagged `ext: true`)

### 3.1 Types
| type | semantics (phase slot) |
|---|---|
| `bonus_attack` | event-loop attack with `strengthPercent` of the attack (origAttack with `baseAttack`), split over `directions`, empty slot → opposing player (attack slot) |
| `kill` | after the phase list of round `eventData`: `count` cards of `scope` chosen by `pick` are marked dead (ignores invulnerable, blocked when the owner is suppressed) and `onDeath` events are pushed; ties → first slot |
| `resurrect_allies` | Moon Dragon, `onDeath/self`, once per fight: every own card that died this round (itself included) is resurrected; revived cards fire no death triggers; a card is never revived twice (`resurrected` flag) |
| `swap_stats_random` | (no card since the Dungeon Casino removal, 2026-10-10) Goblin Thieves, round 1 before the raise_attack buffs: one random living card on either side swaps attack and hp (orig values too) |
| `wheel` | (no card since the casino removal) Wheel of Fortune, heal slot: every other living card on both sides is healed by `strength` (50 %) or damaged by `strength` (50 %), one roll per card |
| `gamble` | (no card since the casino removal) Wizard Apprentice, after the raise_attack buffs: one roll per round; with probability (100 − pct) % every own card with an attack gets +25 % attack this round, otherwise −25 % |
| `heal_boost_percent` | Djinn: while it lives and is not suppressed, `heal` buffs of own cards heal `round(strength × (1 + pct/100))`; several Djinns add their percents on the base heal; not `heal_player` |
| `reduce_ability_attack_percent` | Medusa / Dark Mage, round 1 after all raise_attack/gamble: every card with an ability on both sides except itself loses pct % of its attack; several sources multiply |
| `stun_pattern` | Thief of Time: odd rounds `no_buff` + `no_damage` on `[front, left, right]`, even rounds on `[frontLeft, frontRight]` (the `no_buff` half is not blocked when the Thief is suppressed) |

### 3.2 Events and fields
`round_odd`, `round_even`, `onHeal`; `strengthPercent`, `cap`, `nextRound`, `scope`, `filter`, `pick`, `count`,
`baseAttack`, `unreflectable`, `triggerDirection`, `damagedBySelf`, `strengthFromEvent` (sections 1-2).

## 4. Judgement calls per card

| card | decision |
|---|---|
| Arch Angel | `raise_hp [left, right] perTarget` (each neighbour the full value, doc section 7) instead of the halved game-design reading |
| Neighbour healers (Argonaut, Alchemist, Brother Artujan, Druidess, Keeper, Moon Prophetess, Slave Medic, Spore Mage, Stone Priest, Water Elemental, Wolf Shaman) | `perTarget` (stored per neighbour, doubled for the engine) |
| Strengtheners of both neighbours (Dwarf King, Air Elemental, Assault Drummer, Blade Master, Korim, Isilija, Siribia, Tunnel Digger, War Bard, Wrath Bringer, Blood Fairy, Crystal Breeder, Siamese Orc) | total split in half (wiki Dwarf King page) |
| Siren | `no_buff` + `no_damage` front, round 1 (wiki: stunned for the first round) |
| Basilisk, Cursed Stag | `no_damage front round_le 2` |
| Hurricane Dancer | dazes the three opposing cards and her own two neighbours (wiki) |
| Goblin Patriarch | round-1 daze of frontLeft/frontRight; death attack 200 % of base over [left, right] (1× each); empty neighbour slot hits the opposing player (original handler), wiki says own player |
| Warg Rider | 250 % of base over five directions (base/2 each, wiki) |
| Flameling / Schemer | death attack 100 % / 200 % of base at the front slot |
| Goblin Mob | +200 % of `origAttack` in round 1 (additive, wiki), not ×3 of the buffed attack |
| Arrow Master / Gasher | +75 % of the current attack in round 1 / 2 |
| Catapult | explicit `attack round_le 3` |
| Rat Eater / Succubus / Treeman | explicit `attack` with `emptyReduction` −200 / −200 / +200 |
| Carnivorous Toadstool | explicit `attack` with `unreflectable` |
| Lightning Spirit | `deal_damage_to_all_opponent_cards` with `unreflectable`; Sand Kraken / Wilderness Shaper are reflectable (wiki) |
| Star Seer | damage goes to the opposing player (wiki), like Loremaster / Lava Toad; `cap: "value"` |
| Lookalike / Will-o'-the-Wisp | `reflect_damage` uncapped |
| Crystal Golem / Mammoth Citadel | `deal_damage_to_opponent_player [front] onDeath opponent_cards` (target check: the front card died, whoever killed it; fires again after a revive) |
| Battering Ram / Ore Titan | same plus `damagedBySelf` |
| Slaver / Sky Guardian | `no_damage [frontLeft, frontRight] onDeath opponent_cards triggerDirection front nextRound`; works even if the owner dies the same round |
| Bone Collector / Guruk | flat 100 / 120 `raise_attack self onDeath opponent_cards nextRound` per death (not permanent) |
| Devourer / Giant Spider | `heal self onDeath opponent_cards` (per enemy death; dead target not healed) |
| Gladiator / Leviathan | `raise_attack self onHeal self strengthFromEvent nextRound` |
| Scrapmaster / Thief of Time / War Tattooist / Bloodsoaked Totem | permanent `increment_attack` every round (round 1 included); the Totem includes itself (own-neighbour attacker = offensive) |
| Thief of Time | `stun_pattern` extension (odd: front + own neighbours, even: frontLeft/frontRight) |
| Totem Carver | `increment_attack onDeath` (any death, both sides) to own offensive orcs |
| Baby Dragon | "dragons" = Neutral cards; permanent buff to other own offensive Neutrals on its death |
| Guardian of Time / Mendicant / Magma Thrower | scope buffs, full value per card; Mendicant excludes himself ("other"), Magma Thrower includes himself |
| Herb Collector / Sentinel | scope heals (other elves / other own cards), full value per card |
| Swarmkeeper / Bone Oracle | `invulnerable` on the neighbour(s) with `filter.tribe orc`; protection holds even if the neighbour is suppressed |
| Harpy / Werewolf Dwarf | `invulnerable self round_even` |
| Phoenix / Gargoyle / Sand Mystic / Astral Navigator | `resurrect onDeath self` (Navigator also `heal_player`) |
| Enormous Larva | `resurrect` + `increment_attack strengthPercent 1000 baseAttack` on its death (attack × 11; the catalog ability column is exactly 11 × attack) |
| Bone Dragon | `resurrect` + `increment_attack strength value` on its death (100 + 3100 = 3200 at L1, wiki) |
| Moon Dragon | `resurrect_allies`, itself included (game-design 1.2 / doc section 8; the wiki says it does not revive itself) |
| Colossus / Dwarf Judge | `kill` highest / lowest attack, 1 opposing card, end of round 2; ties → first slot |
| Umbral Dragon | `kill random 2` among all cards except itself |
| Goblin Thieves | `swap_stats_random` in round 1 on any living card (itself possible) |
| Bouncer | `no_buff` + `no_damage` with `scope each_side`, random pick per side, rounds 1-2; shared pick per (card, round, scope) |
| Wheel of Fortune | `wheel` on every other card, both sides; its value is used although the text has no number |
| Wizard Apprentice | `gamble`, value = fail chance in percent, own offensive cards |
| Djinn | `heal_boost_percent` on own cards' heals only (not player heals), additive between Djinns |
| Medusa / Dark Mage | every card with an ability on both sides **except itself** (game-design 1.4; the wiki says itself too), after strengthening, multiplicative |
| Dwarven Sage / Tree of Life | `raise_player_hp always` (re-applied each round while alive; the wiki says the Sage's bonus persists after his death — not reproduced) |
| Goblin Cook | `raise_player_hp` + `deal_damage_to_player round_eq 4` of the same value (poison amount undocumented) |
| Minor Demon / Arch Demon | flat 100 / 240 `deal_damage_to_player` |
| Incubus | `deal_damage_to_opponent_player` + `deal_damage_to_player` |
| Voodoo Witch | `deal_damage_to_opponent_player` + `heal_player` |
| Magmamancer | frontLeft = the enemy card facing her left neighbour; + suspend r1, ++ stun r1, +++ stun r1 + suspend front r2, ++++ stun r1 + stun front r2 |
| Bog Yeti | + round 2, ++ round 3 (reversed relative to Mountain Yeti / Army of Ghosts / Sand Yeti, per wiki) |
| Army of Ghosts | stage-0 wiki text is Italian; the English yeti wording is used |
| Werewolf Dwarf | wiki text "is indestructible in the even numbererd rounds" normalised |
| Trainers (Lich King, Crystal Ghost, Blood Dragon) | flavour text, `buffs: []` |
