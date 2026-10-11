# The original battle simulator (recovered from the 1.7.4 client)

Source: `exploration/apk/lua/game.fightsimulatorv2.txt` (disassembled Lua 5.1 bytecode of
`game/fightsimulatorv2.lua`) and its unit tests `exploration/apk/lua/unittests.tests.testfightsimulatorsimplev2.txt`.
This document is the binding specification for `src/engine`. Where the client code is silent (cards added after
April 2016, server-side numbers) the extension section at the end applies.

## 1. Data model

Each player: `{ id: 1|2, origHp, hp, takenDamage, cards: [card|nil × 5] }`. Slot indices are 1..5 **from each player's
own point of view** (slot 1 = leftmost on the player's own row). `hp` is the current maximum, `takenDamage` the damage
taken; current health is `hp - takenDamage`.

Each card: `{ id (= slot index), cardId, playerId, name, race, origHp, hp, origAttack, attack, takenDamage: 0, buffs: [],
died: false, resurrected: false, invulnerable: false, noBuffsAllowed: false }`.

A **buff** (the original name for every ability, *including the card's normal attack*):

```
{ type, strength, directions, event, eventData, emptyReduction }
```

- `type`: one of the 18 handler names in section 3 (plus the extensions in section 8).
- `strength`: number (the card's level-scaled ability value; ignored by `attack`, which uses `card.attack`).
- `directions`: list of `front | frontLeft | frontRight | left | right | self` (may be empty).
- `event`: `always | round_eq | round_ge | round_le | onDamage | onDeath`; `eventData`: the round number for
  `round_*`, or for `onDamage`/`onDeath`: `nil` (any card), `"self"` (this card), `"opponent_cards"` (a card of the
  other player).
- `emptyReduction` (attack only): number subtracted from the attack before the split when the direction hits an
  empty slot (negative = *more* damage to the player, e.g. Rat Eater/Succubus −200; positive = less, Treeman +200).

The card's normal attack is a buff `{ type: 'attack', directions: <card dirs>, event: 'always' }`; a card with no
attack has no `attack` buff. Round-limited attacks exist (`attack` with `round_le 3` = Catapult).

## 2. Targets

`target(slot i, direction, own, opp)`:

| direction | target | off board |
|---|---|---|
| `front` | `opp[6 - i]` | never |
| `frontLeft` | `opp[6 - (i - 1)]` | `i - 1 < 1` → `none` |
| `frontRight` | `opp[6 - (i + 1)]` | `i + 1 > 5` → `none` |
| `left` | `own[i - 1]` | `i - 1 < 1` → `none` |
| `right` | `own[i + 1]` | `i + 1 > 5` → `none` |
| `self` | `own[i]` | never |

Because the opponent's row is indexed from the opponent's own left, "front" of slot *i* is the opponent's slot
`6 - i` (the rows face each other). A target of `none` is skipped entirely. A target of `nil` (empty slot) is passed
to the handler as the direction string; only the `attack` handler does something with it (damage to the player).

## 3. Handlers (buff types)

Handler signature: `(card, target, player, opponent, buff, eventsOut, triggeringEvent, log)`. `player` is the card's
own player, `opponent` the other one. Unless stated otherwise a handler does nothing when `card.noBuffsAllowed`
is true (the card is suppressed this round). Every handler appends a log entry (the battle event the UI animates).

| type | effect |
|---|---|
| `no_buff` | `target.noBuffsAllowed = true` (suspend/suppress). **Not** blocked by the source's own `noBuffsAllowed`. Only on card targets. |
| `heal` | card target, not dead: `amount = round(strength / #directions)`; `target.takenDamage -= amount` (may go below 0; clamped to 0 at round end). |
| `raise_attack` | card target: `amount = round(strength / #directions)`; `target.attack = max(0, target.attack + amount)`. Per round (reset at round start). Negative strength lowers attack. |
| `raise_hp` | card target: `amount = round(strength / #directions)`; `target.hp = max(0, target.hp + amount)`. Per round. |
| `raise_player_hp` | `player.hp = max(0, player.hp + strength)` (not split). Per round (player.hp resets to origHp at round start), so an `always` buff is effectively permanent while the card lives. |
| `heal_player` | `player.takenDamage = max(0, player.takenDamage - strength)`. |
| `increment_attack` | card target: `target.origAttack = max(0, origAttack + strength)`; `target.attack += strength`. **Permanent** (survives the round reset). Not split. |
| `invulnerable` | card target: `target.invulnerable = true`. Per round. |
| `no_damage` | card target: `target.attack = 0`. Per round (daze). |
| `attack` | `dmg = round(card.attack / #directions)`; empty-slot damage `edmg = round((card.attack - emptyReduction) / #directions)` when `emptyReduction` is set, else `dmg`. Card target: if `target.invulnerable` → logged as blocked, nothing else; else `target.takenDamage += dmg` and push event `{ type: 'onDamage', from: card, to: target, player, opponent, value: dmg }`. Empty slot: `opponent.takenDamage += edmg` (also for `left`/`right`/`self` directions of own-neighbour attackers: the empty-slot share always goes to the **opponent** player). |
| `reflect_damage` | only in event mode, for `onDamage` events whose `to` is this card: if `event.from.invulnerable` → blocked; else `event.from.takenDamage += event.value`. Uncapped in the client. |
| `reflect_damage_to_player` | event mode, `onDamage` with `to == card`: `event.player.takenDamage += event.value` (the attacker's player). Uncapped in the client; see section 8 for the cap. |
| `deal_damage_to_all_opponent_cards` | for each of the 5 opponent slots with a card: if invulnerable → blocked; else `takenDamage += strength` and push an `onDamage` event (from card, to that card, value strength). Not split. |
| `self_damage` | `card.takenDamage += strength`. |
| `deal_damage_to_opponent_player` | `opponent.takenDamage += strength`. |
| `deal_damage_to_player` | `player.takenDamage += strength` (own player; Minor Demon, Arch Demon). |
| `die` | card target, not yet dead: if `target.hp <= target.takenDamage` → `target.died = true`; push event `{ type: 'onDeath', from: target, to: target }`. Not blocked by `noBuffsAllowed`. |
| `resurrect` | acts on the **card itself** (ignores target): if not `card.resurrected`: `takenDamage = 0; died = false; resurrected = true`. Once per fight. Blocked by `noBuffsAllowed`. |

The implicit `die` buff: every card is treated as having a `die` buff with direction `self` and event `always`
(the engine runs the `die` phase for every card; see the phase list). Reflects and death effects are buffs with
`event: 'onDamage'` / `'onDeath'` and the matching `eventData`.

## 4. Buff matching

`getBuff(card, type, mode, data)` returns the **first** buff of the card with `buff.type == type` whose condition
holds, or nothing:

- round mode (`data` = round number): `always` → yes; `round_eq N` → round == N; `round_ge N` → round ≥ N;
  `round_le N` → round ≤ N.
- event mode (`data` = the event): `buff.event == event.type` and (`eventData` nil → yes; `"opponent_cards"` →
  `event.to.playerId != card.playerId`; `"self"` → `event.to` is this card).

Only the first matching buff of a type fires per phase; a card wanting two heals (left and right neighbour, unsplit)
therefore uses one `heal` buff with two directions **or** two buffs of different… no: it must use one buff with two
directions, which splits the amount. Encoding rule for this project: "heals each neighbour by X" = one buff with
`directions: [left, right]` and `strength = 2X` is wrong; use **one buff per direction is impossible**, so the
catalog stores `strength` as the per-target amount and the data pipeline doubles it for two-direction heal buffs.
(The help text says heals are not split; the simulator splits; doubling the stored strength reproduces the text.)

## 5. Round loop

```
round = 1
while not over() and round <= 20:
  if round == 1: race bonus (section 6)
  resetRound(1); resetRound(2)              # hp = origHp (cards and players), attack = origAttack,
                                            # invulnerable = false, noBuffsAllowed = false
  events = []; log = []
  for phase in PHASES:                      # one buff type per phase
    processPhase(1, phase, round, events, log)   # player 1, slots 1..5
    processPhase(2, phase, round, events, log)   # player 2, slots 1..5
  while events not empty:                   # event loop
    newEvents = []
    for phase in PHASES:
      processPhase(1, phase, events, newEvents, log)
      processPhase(2, phase, events, newEvents, log)
    runDie(1, events→newEvents, log); runDie(2, ...)   # the 'die' phase again for both players
    events = newEvents
  cleanup(1); cleanup(2)                    # remove died cards from the slots, clamp takenDamage < 0 to 0
  round += 1
```

`PHASES` (exact order): `no_buff, raise_attack, raise_hp, raise_player_hp, increment_attack, invulnerable,
no_damage, attack, reflect_damage, reflect_damage_to_player, deal_damage_to_all_opponent_cards, self_damage, heal,
heal_player, die, resurrect, deal_damage_to_opponent_player, deal_damage_to_player`.

`processPhase(playerId, type, …)`: for slot 1..5: card = own[slot]; skip empty. Round mode: `buff = getBuff(card,
type, 'round', round)`; if none, skip. With directions: for each direction → target; `none` → skip; `nil` → pass the
direction string; call the handler. Without directions: call the handler with `target = nil`. Event mode: for each
event in the list: `buff = getBuff(card, type, 'event', event)`; same dispatch, with `player`/`opponent` taken from
the event and the event passed as `triggeringEvent`.

Consequences: damage never kills during the attack phase; deaths are decided in the `die` phase, **after** heals
(`heal` and `heal_player` come before `die`), so a card damaged past its hp but healed in the same round lives.
Death effects (`onDeath` buffs) and reflects (`onDamage` buffs) run in the event loop after all phases, and can
chain. `resurrect` as an `onDeath/self` buff fires in the same event loop, so a Phoenix dies and returns in the
same round (its `died` flag is cleared before cleanup).

`over()`: true if `p1.hp - p1.takenDamage <= 0` or `p2.hp - p2.takenDamage <= 0`; otherwise false if any card of
either player `hasAttack(round)`; otherwise true (nobody can attack any more). `hasAttack`: an `attack` buff with
event `always` or `round_ge` → true; `round_le N` → `round <= N`; `round_eq N` → `round <= N`. Damaging abilities
do **not** count (a lone Voodoo Witch ends the fight).

Result after the loop: `h1 = p1.hp - p1.takenDamage`, `h2 = p2.hp - p2.takenDamage`; `h1 < h2` → player 2 wins;
`h2 < h1` → player 1 wins; equal → draw.

## 6. Race (tribe) bonus

Evaluated once per side at the start of round 1: count neutral cards `n`, and the cards per main race. If exactly
one main race is present and its count is `> n`, the player's `hp` is multiplied by **1.2** (rounded) and
`origHp` set to that value. Any other mix (two main races, only neutrals, or neutrals ≥ race count) gives nothing.
This is +20 %, not the +15 % of the old help page.

## 7. Timing of common abilities (how the catalog texts map)

| Ability text pattern | Buff |
|---|---|
| "Takes no damage in the first round" | `invulnerable`, `self`, `round_eq 1` |
| "Receives no damage in even-numbered rounds" | `invulnerable`, `self`, event `round_even` (extension) |
| "The card opposite does no damage in the first round" | `no_damage`, `front`, `round_eq 1` |
| "…for 2 rounds" (Basilisk) | `no_damage`, `front`, `round_le 2` |
| "The card opposite has no abilities in the first round" | `no_buff`, `front`, `round_eq 1` |
| "…has no abilities and does no damage" (Siren, stuns) | `no_buff` + `no_damage` (two buffs) |
| "Increases the damage dealt by his neighbors by X" | `raise_attack`, `[left, right]`, `always`, strength X (each gets X/2) |
| "…by X in the first round" | same with `round_eq 1` |
| "Deals X more damage in the first round" | `raise_attack`, `self`, `round_eq 1` |
| "Deals 75 % more damage in the first round" | `raise_attack`, `self`, `round_eq 1`, strengthPercent 75 (extension) |
| "Deals X more damage each round" (Scrapmaster) | `increment_attack`, `self`, `always` |
| "Heals each of his neighbors by X" | `heal`, `[left, right]`, `always`, stored strength 2X (see §4) |
| "Heals himself by X each round" | `heal`, `self`, `always` |
| "Restores X of your health points each round" | `heal_player`, `always` |
| "Raises your maximum health by X" / "gives you X health points for the entire battle" | `raise_player_hp`, `always` |
| "Increases the health points of his neighbors by X" | `raise_hp`, `[left, right]`, `always`, strength 2X |
| "Does X damage to the opposing player each round" | `deal_damage_to_opponent_player`, `always` |
| "Deals you 100 damage in each round" | `deal_damage_to_player`, `always`, strength 100 |
| "He takes X damage in each round" | `self_damage`, `always` |
| "Every round, it deals X damage to each enemy card" | `deal_damage_to_all_opponent_cards`, `always` |
| "If it is damaged, the attacking card takes the same amount of damage" | `reflect_damage`, `onDamage`, `self` |
| "If he receives damage, the opposing player takes the same amount, up to X" | `reflect_damage_to_player`, `onDamage`, `self`, cap X (extension) |
| "The first time it dies, it returns to life at full health" | `resurrect`, `onDeath`, `self` |
| "If the Tribe Avenger dies, he deals X damage to each enemy card" | `deal_damage_to_all_opponent_cards`, `onDeath`, `self` |
| "If the Dryad Oracle dies, it does X damage to the opposing player" | `deal_damage_to_opponent_player`, `onDeath`, `self` |
| "If the card opposite dies, X does damage Y to the opposing player" | `deal_damage_to_opponent_player`, `onDeath`, `opponent_cards`, direction `front` (target check: the dead card is the front one) |
| "If the card opposite dies, that card's neighbors cannot attack in the following round" | `no_damage`, `[frontLeft, frontRight]`, `onDeath`, front card (applies next round: extension `nextRound`) |
| "Deals 100 more damage in the next round for each enemy creature that dies" | `raise_attack`, `self`, `onDeath`, `opponent_cards`, strength 100, `nextRound` |
| "If killed, he attacks one more time, inflicting double damage" | `attack` with `onDeath/self` and strengthPercent 200 (extension: bonus attack) |
| "If he hits an unoccupied field, he deals 200 more damage" | `attack` with `emptyReduction: -200` |
| "Deals no damage from the fourth round on" | `attack` with `round_le 3` |
| "Does triple damage in the first round" | `raise_attack`, `self`, `round_eq 1`, strengthPercent 200 |

## 8. Extensions (not in the 2016 client; needed for later cards and for the help-text caps)

Keep these minimal and flag them in the ability data with `"ext": true`:

- Events `round_odd`, `round_even` (Harpy, Werewolf Dwarf, Thief of Time).
- `strengthPercent` on `raise_attack`: strength = `round(card.attack * pct / 100)` at the time of the phase.
- `cap` on `reflect_damage_to_player` and `reflect_damage`: reflected value = `min(value, cap)`.
- `nextRound: true` on a buff triggered by an event: the effect is queued and applied in the next round's phase
  of that type (Slaver / Sky Guardian daze, Bone Collector / Guruk stacking bonus).
- `bonus_attack` (type): an extra attack with the card's current attack × pct in the given directions, used on
  `onDeath/self` (Schemer, Warg Rider, Flameling, Goblin Patriarch).
- `kill` (type) with `pick: highest_attack | lowest_attack | random`, `count`, `round_eq N`: at the end of the
  phase list of round N, marks the chosen opposing card(s) dead (ignores invulnerable) and pushes `onDeath`.
- `resurrect_allies` (type, Moon Dragon): on `onDeath/self`, every own card that died this round (and itself) is
  resurrected (once per fight for the Moon Dragon).
- `swap_stats_random` (Goblin Thieves, round 1), `wheel` (Wheel of Fortune), `gamble` (Wizard Apprentice),
  `heal_boost_percent` (Djinn: multiplies the side's heal strengths), `reduce_ability_attack_percent`
  (Medusa / Dark Mage: round 1 `raise_attack` with negative percent on every card with an ability on both sides,
  except itself), `stun_pattern` (Thief of Time) — implement as documented in `game-design.md` §1.4.
- Evolving abilities: the card's buff list depends on its fusion stage (`byStage`).

## 9. Event log for the UI

Keep the engine's existing event shapes (architecture §4) but emit them from the original phases: `status` events
for `no_buff` (suspended), `no_damage` (dazed), `invulnerable`; `buff` events for `raise_attack` / `raise_hp` /
`increment_attack` / `raise_player_hp`; `attack` with `targets` (card or player, `blocked` when invulnerable);
`damage`/`heal` for every `takenDamage` change (cards and players); `death` when `died` is set; `revive` on
resurrect; `roundStart`/`roundEnd` with both players' current health; `battleEnd` with the winner.
