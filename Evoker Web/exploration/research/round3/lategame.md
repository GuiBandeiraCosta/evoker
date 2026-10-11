# Round 3 research: late game (cards, shop, boosters, arena, events, shutdown)

Method note: all listed videos were downloaded (720p) and scanned with contact sheets; card faces and key screens were read at full resolution.
Some image reads failed in my session, so **only values I actually saw on screen are listed**; nothing here is copied from data/cards.json.
Frames are in `frames/lategame/` (JPG). Clients differ by language: Solution-nerd = English, Evoker Br = Portuguese, FloW = French, Benito = German.

## 1. Discrepancies and new facts (sorted by importance)

1. **Booster = 9 face-down cards in a 3x3 grid; each pick costs 1 token (or a fixed gem price per card), and you can keep picking.**
   (FloW kDoGK_OJrnI @ 1:36-1:52; Evoker Br r6cMPhmdRyE, ynDJcXQX600, Q-fyeJuiWWw.) Top bar of the booster screen: back arrow, gem count (e.g. 40), hexagon token icon with count, green refresh button.
   Every card back shows the token icon with "1". When tokens run out the backs switch to a gem price: **975 gems** (Archmage; `flow_975s.jpg`) and **1000 gems** (Dread Empress high pack; Q-fyeJuiWWw end). The token counter in the top bar falls with each pick (Dying Dreams 56 -> 1, Dread Empress 47 -> 1).
   Ours: 8 cards, pick one, price per booster (50/350/975). **Differs.** Confidence high for 9-grid and per-card pricing.
2. Benito tally overlay (0fSotXzxTQY, o3_xwONmTZQ @ 0:10-1:00; small text, medium confidence): after 1 booster Dragon Hunt BIG = 1 Legendary, 3 Heroic, 5 Rare, 0 Uncommon (9 cards); small = 0 L, 1 H, 3 R, 5 U (9 cards). After 2 big: 2 L, 6 H, 10 R. So one "booster" reveals all 9 cards (9 tokens); big = Rare/Heroic/Legendary, small = Uncommon/Rare/Heroic. Our portal high odds (R10/H50/L35/U5) give far too many legendaries.
3. **Collection limit later 100, not 80.** Evoker Br: "Suas cartas 59/100" (lvl 117), "72/100" (lvl 124), "92/100" (lvl 109/111) but "79/80" (lvl 105) and "67/80" (lvl 33). Raised from 80 to 100 (update/event, not level-bound). Benito P900: "Deine Karten **962/80**" in red, so the limit can be exceeded (shown red) and booster cards are still given. Ours: hard 80, overflow to gold.
4. **Quest tab landing = event/portal feed** (Evoker Br ET5ite_ixVk @ 0:25-0:50; `main_menu_events.jpg`, `ov_dragon_hunt.jpg`): vertical banner list before the map: "NAO PERCA O PROXIMO PREMIO!" (next daily reward strip: D2 potion, D3 "40" gems, flame, ..., D20 coin, countdown 20:07:28), "Acesse o nosso forum" banner, event banners, the current portal ("Dwarven Rage - Descida as Profundezas, Portal fecha em: 4:07:07:13", d:hh:mm:ss), "Adquirir cartas" shop banners with fanned cards, and the next-portal teaser ("DRAGON HUNT - Que a cacada comece 6:06:45:44"). Ours goes straight to the map with a "Portal archive" button.
5. **Event banners**: "Dia do TORNEIO x2 - PONTOS DE PVP EM DOBRO 21:07:13"; "O GRANDE Concurso de Bebida -50% - POCOES COM 50% DE DESCONTO 19:45:44"; "CORRIDA DO OURO - OURO EM DOBRO 11:27:46" (Gold Rush); "ENDLOSES WISSEN - DOPPELTE XP FUR DEINE KARTEN" (Infinite Wisdom). Event timers are hh:mm:ss.
6. **Set collections are "(n/26)", not /22**: "Dawn of Eternity (1/26)", "The Dark Beyond (4/26)", "Dwarven Rage (6/26)", "Dragon Hunt (7/26)", "Elven Magus (19/26)" with "Recompensa: 1250 gemas" (main-line sets have gem rewards too). Dawn 5600, Dark Beyond 4600, Dragon Hunt 5000, Dwarven Rage 4000 (all match data/quests.json). Layout: left/right arrows beside the title, green "8/8" bar, reward box with gem icon, 2x4 card grid.
7. **Shutdown (Evoker Br Z1-9iNkh9Lc, 1:12; `shutdown_notice.jpg`)**: screen recording of the forums.flaregames.com announcement "Encerramento de servicos em 22 de agosto de 2018" (by GalaMorgane). Content: after more than five years the services close; the game can be played **until end of Wednesday 22 Aug 2018**; from **00:01 CET Tuesday 24 July** no downloads for new players and in-app purchases disabled. Thank-you: every active player with an account created **before 1 July 2018** gets a loyalty package of in-game currency in another Flaregames game (Nonstop Knight, Royal Revolt 2, Olympus Rising, Zombie Gunship Survival, Nonstop Chuck Norris, Flick Arena), claimed by support ticket (old username + target game) **until Friday 21 Sep 2018**. No refunds, no other compensation, all player data deleted permanently, forum pages online until 22 Aug then archived. No in-game ending screen appears in the video.
8. **Quest taps show floating "PERFEKT" text with a coin burst and a damage number** while the purple % bar fills; boss intro banner is titled with the quest name ("Schlacht vor den Toren!", Dying Dreams Q25), boss card in a rune circle with its name underneath; the reward then appears on a dark lightning backdrop (a glowing puzzle-piece card for a card piece). Benito DhEcS3qE34Q @ 0:14-0:50; `ov_godlike_quest100.jpg`.
9. **Battle details**: "Victory" / "Defeat" banners; "Skip fight" bottom-left (localised "Uberspringen", "Pular luta"); cyan rings with text "SUPPRESS" on a card (`ov_godlike_battle.jpg`). HP seen: Morden 5750 vs player 3750 (lvl 42, `sn_l100.jpg`); Grimnack (Dragon Hunt Q25) 10920 vs 3990 (lvl 45, `sn_dh25.jpg`); Sentinel (Dying Dreams Q25) 9880 vs 36000 (lvl 160); PvP: Ragnar Jeff 13440, Doza 14880 (lvl 111), fukfukara 28368/30300 vs 44760/29232 (late PvP HP 28k-45k).
10. **Player level reaches at least 160** (Benito "Day of a Godlike": level 160, 30/60 cards maxed, >40,250 fights won, over 1 year). Evoker Br players: levels 105-124, stamina 506/506, mana 516/516.

## 2. Card stats read from screens

Level-1 stage-0 values: **all 35 cards in the first table match data/cards.json** (ATK, HP, mana), including ability numbers where the card has one. So wiki base values are reliable. English text verbatim (Solution-nerd), Portuguese ones paraphrased.

| Card (rarity, mana) | ATK / HP | Ability text | Source |
|---|---|---|---|
| Moon Dragon (Leg, 22) | 900 / 900 | The first time the Moon Dragon dies, all of your cards that die in the same round are revived and restored to full health. | sn 9i3oQJSnfbA @ 0:07 |
| Dwarf King (Leg, 24) | 800 / 2400 | Increases the damage dealt by his neighbors by 1600. | @ 0:13 |
| Imperial Dragon (Leg, 25) | 3000 / 2000 | none | @ 0:18 |
| Brother Artujan (Leg, 21) | 600 / 2000 | Heals each of his neighbors by 800 health points per round. | @ 0:22 |
| Siribia Morning Dew (Leg, 24) | 1800 / 1800 | Increases the damage dealt by her neighbors by 1200. | @ 0:28 |
| Cave Troll (Unc, 10) | 400 / 500 | Heals himself by 100 health points each round. | sn AJ5AHqhpPlo @ 0:07 |
| Shield Bearer (Unc, 9) | 300 / 400 | Takes no damage in the first round of a fight. | @ 0:13 |
| Homunculus (Unc, 8) | 100 / 500 | Does 200 damage to the opposing player each round. | @ 0:18 |
| Unicorn (Unc, 10) | 300 / 500 | Takes no damage in the first round of a fight. | @ 0:22 |
| Basilisk (Unc, 9) | 100 / 500 | The card opposite does no damage for 2 rounds. | @ 0:28 |
| Harpy (Rare, 14) | 720 / 720 | Receives no damage in even-numbered rounds. | sn 2tLP0xeary4 @ 0:07 |
| Anvil Guard (Rare, 13) | 600 / 720 | Takes no damage in the first round of a fight. | @ 0:13 |
| Star Seer (Rare, 12) | 240 / 720 | If he takes a hit, the attacker takes the same amount of damage, but only up to a maximum of 480. | @ 0:18 |
| Herb Collector (Rare, 15) | 0 / 600 | Heals each of your other elves by 491 health points. | @ 0:22 |
| Phoenix (Rare, 13) | 720 / 480 | The first time it dies, it returns to life at full health. | @ 0:28 |
| Slaver (Her, 20) | 1350 / 1350 | If the card opposite dies, that card's neighbours cannot attack in the following round. | sn tmBm7Y6S0ZY @ 0:07 |
| Dwarf Judge (Her, 19) | 600 / 1500 | At the end of round two, she kills the opposing card with the lowest attack power. | @ 0:13 |
| Wolf Beast (Her, 16) | 1200 / 900 | Takes no damage in the first round of a fight. | @ 0:18 |
| Tundugar Ironeye (Her, 19) | 1050 / 1650 | The card opposite has no abilities in the first round. | @ 0:22 |
| Hurricane Dancer (Her, 20) | 1650 / 900 | None of cards adjacent to Hurricane Dancer can attack in the first round. | @ 0:28 |
| Wilderness Shaper (Ult, 30) | 0 / 2000 | Every round, it does 1000 damage to each enemy card. | sn rQrCCBePg-0 @ 0:07 |
| Sentinel (Ult, 30) | 1800 / 1800 | Heals each of your other cards by 490 health points. Receives no damage in the first round of a fight. | @ 0:13 |
| Voodoo Witch (Ult, 30) | 0 / 2000 | Does 2000 damage to the opposing player each round and heals you by the same amount. | @ 0:18 |
| Siamese Orc (Leg, 25) | 1600 / 2200 | PT: increases the damage dealt by the neighbors by 800 in the first round | Evoker Br -xw0xifj2vE |
| Bone Oracle (Rare, 11) | 0 / 700 | PT: neighbours take no damage in the 2nd round | Evoker Br TCvUZk_3hQ4 |
| Totem Carver (Rare, 12) | 0 / 840 | PT: +240 attack to each of your orcs per dying creature | same |
| Fungus Lord (Rare, 14) | 0 / 1200 | PT: 480 damage to the opposing player each round | same |
| Magmamancer (Her, 20) | 0 / 2100 | PT: "Her visions seem to be of no use" (joke text, no real effect) | same |
| Loremaster (Leg, 22) | 0 / 2200 | PT: attacker/opponent takes same damage up to max 2200 | same |
| Bloodsoaked Totem (Leg, 22) | 2400 / 2600 | PT: attack of each offensive card +400 each round | same |
| Mammoth Citadel (Leg, 25) | 2000 / 2400 | PT: if the card opposite dies, 1200 damage to the opposing player | Evoker Br xrUdFb1GJqo |
| Guardian of Time (Leg, 23) | 0 / 2400 | PT: +600 attack for each of your offensive cards | same |
| Spore Mage (Rare, 15) | 600 / 720 | PT: heals 240 HP of the neighbours | same |
| Swarmkeeper (Her, 18) | 1200 / 900 | PT: the left neighbour, if an orc, takes no damage in the first round | Evoker Br Z0xxEbOBDKs |
| Grimnack (Leg, 23) | 2000 / 2000 | PT: the opposing card does no damage in the first round | same |
| Stonemason (Unc, 9) | 400 / 500 | none | Evoker Br XUAoaKBJQ_Q |
| Battering Ram (Her, 18) | 1500 / 1050 | PT: kills a card -> 300 damage to the opposing player | same |
| Ore Titan (Leg, 22) | 2200 / 1800 | PT: kills a card -> 800 damage to the opposing player | same |
| Magma Thrower (Leg, 23) | 1800 / 2400 | PT: +400 attack of each of your offensive dwarves for 1 round | same |

Leveled / fused observations, where they differ from data/cards.json:

| Card | Stage / level | ATK | HP | Ability | Ours | Source |
|---|---|---|---|---|---|---|
| Bone Dragon | +0, L5/15 | 100 | 550 | "The first time Bone Dragon dies, it returns to life with improved attacks." | HP 362 (DIFF); ATK OK | Evoker Br Z0xxEbOBDKs |
| Blood Dragon (event Ult, mana 1) | +0, L15/15 | 0 | 760 | "Invoked with the blood of the dead ... Sacrifice this card and gain a big XP boost" | OK | Evoker Br Q-fyeJuiWWw |
| Raptorial Fungus | +++, L43/44 | 0 | 5720 | 8438 damage to opposing player each round | HP 5701, ab 8355 | Evoker Br xrUdFb1GJqo |
| Ore Titan | ++, L34/34 | 5043 | 4128 | 1834 | 5528/4524/2010 (ours +9.6 %, consistent with an imperfect-fusion "Evolve Bonus") | Evoker Br XUAoaKBJQ_Q |
| Mammoth Citadel | +++, L34/44 | 5697 | 6837 | 3418 | 5512/6615/3307 (-3 %) | Evoker Br Q-fyeJuiWWw @ 0:14 |
| Mammoth Citadel | +++, L40/44 | 6212 | 7455 | 3726 | 6141/7370/3684 (-1 %) | same @ 0:30 |

Take-away: our mid-level interpolation is 1-3 % low (and Bone Dragon L5 far too low), ability numbers scale with the same factor as HP. Training gold costs seen: 650, 1950, 2340, 5200, 5590 (Benito 3:20-4:10), 5200 and 3380 for a Mammoth+++ with trainer stacks (Q-fyeJuiWWw ~2:00). Fused-card title shows "+++" after the name. The Evoker Br title of fukfukara's tbZPlNdt8Ao ("Evolve Bonus onemli") confirms the Evolve Bonus is player-visible.
FloW 2kY6YnKOaag also shows an Ultimate 3400/2000/30 "Ne dispose d'aucune capacite speciale, du moins en apparence" (vanilla) and Thief of Time 0/4000/30 "Inflige 800 points de degats supplementaires a chaque round. Les voisins du Thief ne peuvent agir qu'un round sur deux" (matches ours).

## 3. Shop, boosters, gems

- Shop list (FloW kDoGK_OJrnI @ 0:08): vertical banners "Pack du neophyte" (blue), portal packs "Temporal" ("Bientot disponible 2:02:23:34") and "Eternal", "Pack de l'invocateur" (purple), "Pack de l'archimage" (gold, token hexagon with count 9), each with "Peut contenir" and four rarity squares (lit = possible). **No odds percentages in the original**; we show %.
- Portal token names: Dawn of Eternity Temporal/Eternal; Dragon Hunt Dragon Stalker/Dragon Slayer; Dying Dreams Dreamwalker/Oneiromancer (Dread Empress high = "Imperatriz").
- Opening sequence (Evoker Br ynDJcXQX600): dark cavern with an altar and glowing token; token enlarges with electric sparks; 3x3 grid fades in; tap a back -> white flash flip -> the card zooms in its rarity frame (green U, blue R, purple H, gold L, red Ultimate) -> tap, it settles face up; the altar returns at the end. We use a single card with a "Take" button.
- Balances seen: gems 40 (lvl 33), 596 (lvl 109), 1725 (Evoker Br lvl 105); gold 80411 (lvl 33), 230139 (lvl 109).
- **Project 900 Token** (OpWzpIY16_s, `p900_full.jpg`): not an item. The uploader saved **900 Dawn of Eternity tokens** and opened them in bulk (1 per card). Result: **962/80 cards** (red) and duplicates **Lightning Spirit 90 (5x16+10), Thief of Time 50 (3x16+2), Mountain Yeti 42 (2x16+10)**; the first 100 tokens gave Lightning Spirit 6, Thief of Time 7, Mountain Yeti 4. So about 20 % of high-pack cards were the set's 3 top cards: the high pack is heavily weighted to the featured cards.
- Gem packs / real-money prices: not shown in any video. Not found.

## 4. Arena, pieces, league

- Tabs Arena / Pecas / Replays as ours. Pieces tab (ET5ite_ixVk @ 0:45): **4x2 grid of 8 slots**, each a puzzle-cut card art with lit pieces, a crossed-swords button below each, an empty slot shows a green "+" button (buy first piece).
- PvP pre-battle: "Atacar!" bar, "Mana necessario 128 / 516". After a lost fight Benito says he "changes the setup for him" and re-attacks the same opponent (opponent decks are fixed and can be re-fought).
- PvP battles use an orange stadium backdrop (not the PvE painting); rounds up to 20 (fukfukara nxnOC8gnN7s "20 Raund").
- League, prizes, tiers, timers: **not shown** in any of these videos. Replay screen, arena reward table: not found.

## 5. Features our recreation lacks (vs docs/STATUS.md)

- Quest-tab portal/event feed and next-reward strip (item 4); 9-card per-pick booster (item 1); "PERFEKT" feedback and quest-name boss banner (item 8); /26 set pages with main-line sets (item 6); Dragon Hunt end dialog from the ranger: "You won the great hunt! Your name will ring out!" followed by a list of the boss-deck cards leveling (portrait + star + "Level n" XP bar) and Continue (sn zTQX-17HoDo @ 1:35, `sn_dh25.jpg`); forum link banner; Dungeon Casino is only seen as card set (RGizuAsD8jc "Parte 1: Goblin Thieves", not analysed in depth).
- Main quest ends at node "100" in a rune circle with a blue light beam (Benito @ 0:14).

## 6. Not found / not done

League screens and prizes; gem-pack prices; arena reward numbers; casino mechanic of Dungeon Casino; most leveled card stats beyond the six rows above. Downloaded but not examined in detail: Evoker Br sTbYKWe9_WU, Ff-jbLef40M, RSHOt0g6T6o, dJ-MATeCHYM, WzDCvHuf8FE, yi9SVGCqOC4, -cusmfeN_qA, X1dZBH_UyD4, RGizuAsD8jc, 7BxPEkmoD84 (steal a piece tip), zMSOP3-QWDE (experience cards), Benito aWUKrCsSCRI, FloW wRHsqpwT1E4/t-o59ao4uG8/FEuWvyDGo00/AN_16aArEWc (boss levels). Evidence for the card tables is also in `frames/lategame/sn_*.jpg`; Evoker Br contact sheets `ov_*.jpg`.

## 7. Other relevant videos found on the channels

Benito: aWUKrCsSCRI, wqzda6-2fs4, OSTs vXY3sHUNLrU, _0OtUbGYmDc, Bkb2v3fLi8w, YGfmA6UndM0. Evoker Br: Q-fyeJuiWWw, -xw0xifj2vE, TCvUZk_3hQ4, Z0xxEbOBDKs, xrUdFb1GJqo, XUAoaKBJQ_Q, RSHOt0g6T6o, RGizuAsD8jc, 7BxPEkmoD84, zMSOP3-QWDE, X1dZBH_UyD4 ("win in 58 of 70 random battles"). FloW: 3bpn318u1Dk, t-o59ao4uG8, wRHsqpwT1E4, kDoGK_OJrnI, FEuWvyDGo00, AN_16aArEWc, kZP91hfUYiU, rsIsEpifIbo, fwGDaXgX8Zs, WlDs7pYbhOc. fukfukara: 16 more Random PvP clips. Solution-nerd: rest of channel unrelated.
