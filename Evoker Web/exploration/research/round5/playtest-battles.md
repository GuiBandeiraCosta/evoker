# Playtest: battle playback (topic `battles`, port 8116)

Scratchpad (screenshots, traces, scripts):
`C:\Users\guiba\AppData\Local\Temp\claude\c--Users-guiba-Desktop-Evoker-Card-Game\5f60a16a-f52a-4277-bb01-5d3db216a6a8\scratchpad\playtest\battles\<fight>\`
(`sNNN-<ms>.png` = frames at ~4-5 per second, `trace.json` = DOM sampled every 40 ms: both HP bars, every card's attack/hp/status/fx, floating numbers with their x,y, projectiles; `events.json` = the engine log; `sheet-N.png` = contact sheets). Scripts: `scratchpad\scripts\` (`bt-lib.mjs`, `fights.mjs`, `tr.mjs`, `ev.mjs`, `chk.mjs`, `ui2.mjs`).

## 1. What was played

Staged fights (page: `deps.engine.buildSide` + `simulateBattle` + `router.go('battle', ...)`, like `aim-check.mjs`), each recorded as screenshots + 40 ms DOM trace and compared with the event log (an automatic per-card HP-sequence diff, `chk.mjs`, plus manual event-by-event reading):

| fight | what it exercises |
|---|---|
| `f1-drummer`, `f2-boost` | Assault Drummer / Air Elemental / Armorer boosts over 3 rounds, 1-3 arrow cards, Siren/Basilisk-type suppression, healers, self damage |
| `f3-death` | Bone Dragon / Phoenix / Moon Dragon revive, Sun Dragon + Dryad death triggers, Colossus kill, Astral Navigator revive + player heal |
| `f4-abil`, `f11-poison`, `f9-misc` | Thief of Time (suspend/stun/daze), Lightning Spirit AoE, Medusa debuff, Incubus/Arch Demon player damage, Tree of Life/Goblin Cook/Sage player HP, Wheel of Fortune, Wizard Apprentice gamble, Goblin Thieves swap, Dwarf Judge kill, Voodoo Witch |
| `f5-arrows` | diagonal arrows into empty slots, invulnerable (Anvil Guard, Harpy), blocked hits |
| `f8-reflect` | Lava Toad / Will-o-Wisp / Lookalike / Loremaster / Star Seer reflect, death AoE |
| `f6-lethal`, `s3-skip-lethal` | lethal finale, overkill, defeat |
| `f10-draw20` | 20-round limit, draw banner, 2x speed (284 events) |
| `p4-poison` | raise_player_hp / poison over 5 rounds |
| `s1/s2/s3`, `sp-speed` | Skip fight (mid fight, during "Loading...", on a lethal fight), speed button mid fight |

Real UI: new game, `setLevel`, `addCard`, deck patched in the store, `unlockQuests`, then through the real buttons: quest map -> quest 3 boss (minion taps, boss intro, pre-battle, Attack!) twice (strong deck: 1-round win; starter deck: 8-round loss with a real Skip fight click at 9 s), and Arena (offers 0 and 1, pre-battle, Attack!, 2-3 round fights, result popup). Debug API used only for set-up (new game, level, cards, deck, unlock quests, refill stamina/mana). Console: no errors or warnings in any run.

## 2. Bugs / differences

### B1 (major) Effects whose source or target card is already dead are drawn in the top-left corner of the stage
- Steps: any fight where a card with a death trigger or reflect dies in the round, e.g. `f3-death` (Sun Dragon "does 503 to each enemy card" on death), `f8-reflect` (Lookalike / Will-o-Wisp reflect after they died; Sun Dragon AoE hitting dead cards), Dryad Oracle / Battering Ram style "damage to the opposing player on death".
- Expected: the lightning bolts / spell circle start on the dead card's slot (the slot is still on the board); the "-503" numbers, impact bursts and reflect beams show on the slot that is hit (original: effects are always on the board).
- Actual: the dead card's wrapper is detached from the DOM but `cardOf()` still returns it, so `center()` measures a zero rect and returns the stage origin. Sun Dragon's bolts start at the top-left corner and fan over the "?" portrait, name band and HP bar (f3-death/s092-20356.png); reflect beams come from the top-left corner (f8-reflect/sheet-58.png); the hit bursts and floats on dead defenders pile up at (0,-10) in the corner and are clipped (f8-reflect/s092-19673.png; trace: `damage:-503@0px,-10px` x4 at t=19568). Hits on dead cards are therefore also invisible on the board (no number over the slot).
- Suspected: `src/ui/battle-player.js` `targetCenter()` (line ~543: `center(cardOf(side, slot) || slotOf(side, slot))`) and `floatPos()` / the `damage` step source lookup (~line 1019). Fall back to `slotOf()` when the wrapper is not `isConnected`.

### B2 (minor) Battle numbers: thousands separators, and inconsistent between first render and updates
- Steps: any fight with 4-digit values (e.g. `f1-drummer`).
- Expected: plain digits like the original ("11280 / 11280", "-5172", card stats "4767"; `frames/user/battle-arena-2016.png`). The code comment in `card.js` even says "plain numbers like the original (no thousands separator)".
- Actual: a card first shows `1103`, `2302`; as soon as it is updated (`updateCardHp` / `updateCardAttack` call `fmt()`) it flips to `1,103`, `2,302`. HP bars show `5,000 / 5,000`, floats `-1,139`. (trace f1-drummer t=364 `d0=918/1103` vs t=1889 `1,103`; f1-drummer/s022-5047.png)
- Suspected: `src/ui/components/card.js` `updateCardHp`/`updateCardAttack` (use plain `Math.round`), `origHpBar`/`hpBar` label and `floatNum` (`fmt`) in battle-player.js.

### B3 (minor) Two hits at the same player/slot show floating numbers on exactly the same spot
- Steps: any 2/3-arrow card attacking an empty slot (both arrows hit the player): `f2-boost` (-369 -369), `f5-arrows`, `f9-misc` (3 x -905), reflect-to-player (`f8-reflect`: -704 / -199).
- Expected: each hit readable (original shows one number per hit; ref `orig-battle-numbers-projectiles_reOM_0344.jpg`).
- Actual: the floats are created at identical x,y (player bar centre 374,955 / 374,325), they overlap into one smudged number ("-2,6541,008" when two different values collide) and the bar drops by the sum, which is never shown. The float also sits on top of the "28,190 / 30,000" label and hides it (f9-misc/sheet-182.png frames 5-6).
- Suggestion: offset or sum the floats of one step on a player.

### B4 (minor) raise_player_hp cards (Goblin Cook, Dwarven Sage, Arch Angel...) cause a fake "-N damage" and "+N heal" on the player's bar every round
- Steps: `p4-poison` (Goblin Cook + Dwarven Sage, 5 rounds); also `f11-poison` round 2 ("-3,043" when the Cook is dead).
- Expected: the +N max-HP is applied silently once (first round), no damage/heal shown for the engine's per-round reset.
- Actual: every round start the engine logs `buff aP maxHp -100` then `+100` and the playback shows a red "-100" with the HP number dipping to 5,100 and then a green "+100" back to 5,200 (trace t=8688 / 9247, 11121 / 11646, 14247 / 14689). Looks like phantom damage, even though the real poison round (4) is a separate event.
- Suspected: `reduceEvent` / `buff` step for `aP maxHp` in battle-player.js; collapse the -x/+x pair of one round start (or show only net change).

### B5 (minor) Attack reductions (Medusa, Dark Mage) are shown as red HP-damage numbers
- Steps: `f11-poison` round 1: Medusa "-172 / -45 / -151 / -355 / -319 / -285 / -97".
- Actual: the cards' attack numbers drop but the float is the same bold red "-172" as a hit and the card gets a red flash; HP is unchanged, so the player sees damage that does not exist. (Attack boosts show a gold "+510", so a debuff probably needs a distinct look: red down arrows / smaller text.)

### B6 (cosmetic) Invulnerable glow hides the card art and stats
- Steps: any invulnerable card (Anvil Guard round 1, Harpy even rounds, Sentinel...). f5-arrows/sheet-19.png, f1-drummer/s022-5047.png.
- Expected (user's 2016 arena screenshot): golden halo and rays around the card, sparkles; the art, attack and HP stay readable.
- Actual: the golden wash is almost opaque, the card looks like a flat yellow slab, the attack/HP strip is washed out; sparkles hardly visible. At the moment the status turns on, the whole card flashes cream-white (f1-drummer/sheet-18.png frame 2).

### B7 (cosmetic) Text at the stage edge is clipped
- "Revived!" over slot 0 reads "evived!" (f3-death/sheet-94.png), "-2,325" on the first top slot is cut (ui-arena0 sheet-20 frame 6), "-503" on the last slot loses its right side. Clamp the float's x to the stage (keep 50 px margin).

### B8 (cosmetic) Skip on a lethal fight leaves cards on the board, normal playback clears them
- Steps: `s3-skip-lethal` and the real quest-3 fight with a Skip click. Normal playback: all cards on both sides vanish before the HP countdown. After Skip: final HP correct (4,122 / -1,422, and -100 / 960 in the real fight), but the survivors (e.g. 4 cards) stay on the board and the Defeat banner stamps over them (ui-q3-result.png). Probably should show the same empty finale board.

### B9 (cosmetic) Shots through an empty edge slot fly off the screen
- Attack from slot 1 with the left arrow into empty slot 0 keeps its direction as required, but ends at x=-10 (left of the HP bar; bar spans x~72-645); same on the right for slot 3 -> 730 (f9-misc bullets `(214,791)+(-213,-466)`). The player bar flashes while the bullet has left the screen. Mention only; the "keep flying past the empty slot" rule itself works (f5-arrows: `(68,791)+(213,-466)` ends on the bar).

### Observations (not necessarily bugs)
- The first attack of a round only starts after every buff/status step has played: 2.5-4 s (700 ms each) with a drummer + a Siren/Thief on the board (f1-drummer: round start 1.9 s, first projectile 5.9 s). Fine if the original's server timeline did that; otherwise it makes boosted/status boards feel slow.
- Heal on a full-HP card prints "+409" although nothing healed (Gladiator, `f4-abil` event 18: engine reports the nominal amount).
- Duplicate status layers: a card that is suspended + stunned + dazed in one round stacks identical ring/daze layers (trace `[suspend,suspend2,daze,suspend,suspend2,daze]`), making the ring brighter than a single suspend.
- Dead cards linger with negative HP until the round's death step (matches the original, which shows HP below zero).

## 3. Things that look right
- Event-by-event match in all staged fights (automatic HP-sequence diff clean except the cases of B1 where the target is gone): attack numbers, hit damage = attack / number of arrows (Archer 1108 -> 369 per hit; Falconer 1623 -> 812 x2), HP after each hit, heals at the end of the round after all attacks, death triggers after the deaths, revives with "Revived!" (Bone Dragon returns with +3324 attack: 100 -> 3,424), Moon Dragon revive, permanent buffs (Colossus +469 per round) keep, round-only buffs (Drummer +510, Armorer/Air Elemental +588) rise when the buff step plays and fall back at the start of the next round (f2-boost, 3 rounds).
- Player HP: damage, heal, tribe-bonus count-up, reflect-to-player, incubus/arch demon, poison, overkill below zero (card HP -2,443, player -6,012 in labels).
- Suppress/stun: cyan ring (suspend), red streaks (daze), both for stun; statuses clear at the next round start. Blocked hits show "BLOCKED" shield and no HP change; invulnerable aura ends after round 1 for Anvil Guard.
- Arrows: 1/2/3 arrows, diagonal projectiles, bullets keep direction through empty slots to the HP bar, mirrored for the defender row, player-hit strip on the HP bar.
- Lethal-blow finale: cards of both sides vanish, starburst, HP counts down into the negative (-1,422 / -3,581), Victory/Defeat stamps while counting; draw banner at round 20 with equal HP (`f10-draw20`, 20 rounds, 284 events); the round label rolls "ROUND n"; later rounds are faster.
- Skip fight (mid fight, during Loading, after round 1) jumps to the engine's exact final state (HP bars, surviving cards); speed button 1x -> 2x switches pacing immediately; Skip is locked on quest 1-2 and offered from quest 3.
- Arena and quest-boss fights through the real UI play like the staged ones; look matches the 2016 reference layout (round banner, name bands, HP bars, 5+5 slots).
