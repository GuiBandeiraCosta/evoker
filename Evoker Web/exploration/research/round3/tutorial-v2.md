# Tutorial v2 - step-by-step script of Benito's "EVOKER - Tutorial Playthrough" (wqzda6-2fs4)

Source: BenitoLPGames, `wqzda6-2fs4`, 9:15, German iOS client **1.7.0** (2016-03-24), account `user-1867590`, 720p copy
(phone window cropped to 400x656). Watched completely: 1 fps contact sheets for 0:00-9:15, 2-6 fps segments around
every step, full-resolution frames for every bubble and popup. Evidence frames: `frames/tutorial/bz2_<seconds>_<what>.jpg`
(the older `bz_*` frames are from the first pass).

Text columns: **DE** = verbatim from the video; **EN** = the English client text. The tutorial texts were server data
(not in the APK loca table), so EN comes from (a) `exploration/apk/data/loca_en.json` for client strings (popups, buttons),
(b) the English 2014-15 videos J25GbjkYMbg / Svgtj4sYZRk (1.3.0 client, read verbatim by a subagent, marked `[EN video]`),
(c) the 2014 wiki screenshot for "That card is tough! ..." (`[EN wiki]`); every other EN line is **our translation**
(`[transl.]`). Times are video seconds (m:ss), +-0.3 s.

Notation per step: **Screen** / what is **highlighted** (sparkle = `view_button_sparkle` glow on a button, hand =
`hud_tapindicator01`, arrow = green `fx_tutorial_arrow` drag line) / **text** / what the **player taps** / what the
game does **next**. Bubbles: the ranger (red hair) stands bottom-left, the box sits over the nav bar ("bottom_menu");
the Worm Shaman and the Succubus speak with their own portrait at the same place. A tap on a bubble closes it. Benito
taps through almost every bubble within 0.3-1 s, so no hand is ever visible in this video (the client shows the hand
only after a 2 s delay, ctrl_intro_fight / view_shp_highlights); sparkles on buttons are visible (0:54, 1:25, 5:54).

Nav bar (6 buttons, left to right): League (padlock until Q10), Arena (padlock until Q8), Quests (map star), Cards,
Shop (green), Character (orange up-arrow). HUD: "?" button, level star + XP bar, stamina line, mana line, gold, gems.

---------------------------------------------------------------------------------------------------------------

## 0. Opening (0:06-0:26)

| # | t | Screen | Highlight | Text | Player | Next |
|---|---|---|---|---|---|---|
| 0.1 | 0:06-0:08 | Flare Games logo on red | - | - | - | fade |
| 0.2 | 0:08.2 | `intro_part1` (peaceful harbour village painting) | "Intro überspringen" bottom-right (EN loca: **"Skip intro"**) | - | taps Skip at 0:08.9 | part 1 stops (`music_introvideo_skip`) - **the scripted fight still follows** (the skip only ends part 1) |
| 0.3 | 0:09.0-0:10.8 | `bossfight_preview`: the **Worm Shaman card** in the spiky dark boss frame over the intro-fight background (burning village, two hooded shamans) | - | - | - | the card shrinks/fades (0:10.8), the background stays |
| 0.4 | 0:11.0-0:11.8 | intro fight board slides in: boss row (slots 2-4: Throat-Cutter, Flinger, Lurking Goblin, each "+1"), Attack! bar ("Angriff!" = EN **"Attack!"**), player row (slot 3 Envoy) | Attack! sparkle (hand after 2 s, not reached) | - | taps Attack! at 0:12.0 | HUD fades in: Worm Shaman portrait + name top, HP bar "0 / 100" counting up to **300 / 300**; "Du" (EN loca **"You"**) bottom right with "?"; player HP **1500 / 1500** |
| 0.5 | 0:12.5-0:20 | scripted fight (`script_intro_fight.json`) | - | - | - | "RUNDE 1" (EN "ROUND 1"): Envoy hits Flinger -100, enemies hit the player 1500 -> 1200 -> 1000 -> 800, the Envoy dies; "RUNDE 2": 800 -> 500 -> 200 -> 0. **No Defeat banner.** |
| 0.6 | 0:21-0:24 | `intro_part2`: the burning tower, a ring of runes lights up | - | - | - | white flash 0:24, black 0:25 |

## 1. Quest 1 (0:26-0:53)

Start state on the map (0:26): **Lvl 1, stamina 50/50, mana 50/50, gold 200, gems 0**, no potions; nav League and
Arena padlocked, Quests selected; no "!" badges. The portal banner loads (purple pentagram spinner, then
"Desert Twilight" + countdown).

| # | t | Screen | Highlight | Text (DE / EN) | Player | Next |
|---|---|---|---|---|---|---|
| 1.1 | 0:26.3 | quest map, node 1 pulsing in the rune hexagram, nodes 2+ dark | (hand on node 1 in the 2014 EN video) | DE "Verhindere, dass es so endet! Folge ihm in seinen Unterschlupf...." / EN **"Don't let it end like this! Follow him to his lair...."** [EN video NbX8] | taps the bubble, then node 1 | fade to the quest |
| 1.2 | 0:27.0 | quest 1 "Green Valley" (mountain valley), progress bar 0 %, 3 minions walk in, deck tray at the bottom shows the Envoy (slot 3) | - | DE "Die Orks des Shaman versperren dir den Weg! Vernichte sie!" / EN **"The Shaman's orcs are in our way! Smite them!"** [EN video] | taps a minion | "PERFEKT" (EN "Perfect!"), +6 gold, stamina 50 -> 48 |
| 1.3 | 0:28.0 | minion 2 (40 %) | - | - | tap | **soul card drop**: a light spot, then the **Master Brewer** card full size (Standard, Level 1, 100 / 200 / 3) 0:29.5, it shrinks into the deck tray **slot 2** (white flash on the slot, 0:30.5). |
| 1.4 | 0:28.5-0:29 | (during the drop) | - | DE "Einer von ihnen hatte eine Seelenkarte! Sie wird dir im Kampf nützlich sein." / EN **"One had a soul card! It will help fight our foe."** [EN video] | - | - |
| 1.5 | 0:31-0:32 | minions 3-5 (60-100 %) | - | (2014 EN only: "Puny minions are no threat to you, Evoker." - not shown in 1.7.0) | taps | gold 212 -> 230, stamina -> 40/50; at 100 % a light spot + coin shower **+10** (gold 240) |
| 1.6 | 0:35-0:37 | boss intro: banner "Bossfight 1" (EN **"Boss Fight 1"**), boss card in the golden rune circle, plate **"Throat Cutter"** | - | - | (auto) | the card flies up into the boss row |
| 1.7 | 0:37.5-0:41 | pre-battle: boss row slots 2+3 = **2 Throat-Cutters**; player row: slot 1, 4, 5 padlocked, **slot 2 Master Brewer, slot 3 Envoy**; Attack! bar | (Attack! - Benito taps too fast to see a hand) | DE "Räche das Dorf! Entfessle deine Karten!" / EN **"Avenge the village! Unleash your cards!"** [EN video NbX8] | (Benito swaps his two cards by drag, optional), taps Attack! | fight |
| 1.8 | 0:41-0:47 | fight: "Worm Shaman" **250 / 250 -> 300 / 300** (tribe bonus), player `user-1867590` 1500 / 1500, no Skip button | - | (2014 EN only: "Ha! His Throat-Cutter is fatally wounded!" / "But he's taking your Envoy with him, Evoker." - **not in 1.7.0**) | - | **Victory** (gold banner) - the first boss fight is **won**, not a forced loss |
| 1.9 | 0:49-0:52 | reward screen: dark landscape, light spot; banner "Karte wurde folgendem Set hinzugefügt: Orc Grunt" (EN loca **"Card added to set:"** Orc Grunt), bar 0/8 -> 1/8; the **Throat-Cutter** card rises in a golden glow | - | DE "Der Shaman ist geflohen, aber er hat eine Seelenkarte zurückgelassen." / EN **"The Shaman has fled! He dropped a soul card."** [EN video] | taps the card | (card XP list not shown for Q1) -> map |
| 1.10 | 0:53 | map: node 2 now in the hexagram, node 1 plain | sparkle-less; a red "!" badge appears on the Character button | DE "Ich glaube, er ist da lang! Ihm nach!" / EN **"I think he went this way! After him!"** [EN video] | taps node 2 | quest 2 |

No gold, gem or token reward for the Q1 boss: the soul card only.

## 2. Quest 2 (0:54-1:56) - the lost fight and the deck lesson

| # | t | Screen | Highlight | Text | Player | Next |
|---|---|---|---|---|---|---|
| 2.1 | 0:54-1:01 | quest 2 cave, **6 minions** (17 % steps), **3 stamina** per tap (40 -> 22), gold 240 -> 324 | - | - | taps | coin showers |
| 2.2 | 1:02 | "Bossfight 2" / **"Bone Breaker"** | - | - | - | - |
| 2.3 | 1:04-1:07 | pre-battle: boss row only slot 3 (Bone Breaker); player slot 2 Master Brewer, slot 3 Envoy | - | - | taps Attack! | - |
| 2.4 | 1:07-1:23 | fight: Worm Shaman **800 / 800 -> 960 / 960**; Master Brewer dies in round 1, the Envoy alone fights to round 9 (Shaman 60 / 960) | - | - | - | **Defeat** (red banner, blood) at 1:23 |
| 2.5 | 1:25.3 | map, node 2 still current | **Cards** nav button glows (sparkle) | DE "Diese Karte ist mächtig! Du brauchst ein stärkeres Deck." / EN **"That card is tough! You need a stronger deck."** [EN wiki] | taps Cards | deck screen |
| 2.6 | 1:26.3-1:27.4 | deck screen "Dein Deck" (EN loca "Your Deck"): slots 1, 4, 5 padlocked, slot 2 Master Brewer, slot 3 Envoy; "Deine Karten 3/80" (EN "Your cards"), "Benötigtes Mana: 5 / 50" (EN "Mana needed: 5 / 50"); tabs: training (padlock), cards, fusion (padlock); card row below: Throat-Cutter (200/100/3, Level 1/10) | **green drag arrow from the Throat-Cutter card up to slot 3 (the Envoy)** | DE "Dein Throat Cutter ist stärker als der Envoy." / EN **"Your Throat-Cutter is stronger than the Envoy."** [EN video] | drags Throat-Cutter onto slot 3 | the Envoy drops back into the row, mana 6 / 50 |
| 2.7 | 1:28.2 | deck screen after the swap | (Quests button - he taps it at 1:28.8) | DE "Jetzt kannst du den Bone Breaker des Shaman besiegen!" / EN **"You'll beat the Shaman's Bone Breaker now!"** [EN video] | taps Quests, node 2 | quest 2 again **from 0 %** |
| 2.8 | 1:30-1:36 | quest 2 replay (stamina 22 -> 4) | - | - | taps | - |
| 2.9 | 1:37-1:40 | Bossfight 2 again, pre-battle (Master Brewer + Throat-Cutter) | - | - | Attack! | - |
| 2.10 | 1:42-1:46 | fight 800 -> 960; round 2: the Worm Shaman's bubble | - | DE "Dein nächster Sieg wird nicht so leicht werden, Evoker." / EN **"Your next victory will not come so easily, Evoker."** [EN video] (Shaman portrait) | - | **Victory** (Shaman 40 / 960) |
| 2.11 | 1:53-1:55 | reward: coin shower **+50 gold** (408 -> 458) | - | - | - | map |
| 2.12 | 1:56 | map | - | popup **"Card Slot Unlocked!" / "Your deck can now hold 3 cards." / OK** (DE "Kartenfeld freigeschaltet! Dein Deck kann jetzt 3 Karten umfassen.") with the gold padlock | OK, then Cards | deck screen: the padlock of **slot 4** opens (sparkle); Benito drags the Envoy into slot 4 (mana 8 / 50) |

## 3. Quest 3 (1:59-2:36) - level 2 and the first fusion

| # | t | Screen | Highlight | Text | Player | Next |
|---|---|---|---|---|---|---|
| 3.1 | 1:59 | quest 3 snow gate, 6 minions, 3 stamina | - | - | 1st tap | - |
| 3.2 | 2:00-2:10 | "Level Up" burst, then **"Levelaufstieg! / Level 2 erreicht"** (EN loca **"Level up!" / "Reached level 2"**), left "Boni" (EN **"Rewards"**): **pile of 5 gems + 100 gold**; right **"Punkte: 12/12"** (EN "Points:"), HP 1500, stamina 50, mana 50 with - / + | - | - | Benito tries HP (+30 per point, 1500 -> 1860), resets, puts all 12 into stamina (50 -> 62) and taps **"Weiter"** (EN **"Proceed"**) | gems 0 -> 5, gold +100, stamina refilled to 62/62 |
| 3.3 | 2:11-2:17 | minions 2-6 | - | - | taps | - |
| 3.4 | 2:18 | "Bossfight 3" / **"Lurking Goblin"** | - | - | - | - |
| 3.5 | 2:19-2:21 | pre-battle: boss slots 2-4 = Throat-Cutter, Throat-Cutter, Lurking Goblin; player slots 2-4 Master Brewer, Throat-Cutter, Envoy | - | - | Attack! | - |
| 3.6 | 2:22-2:25 | fight 800 -> 960; **"Überspringen" (EN "Skip fight") button bottom-left - first time** | - | - | - | Victory |
| 3.7 | 2:27-2:28 | reward: card **Throat-Cutter** (Standard) - a second copy | - | - | tap | map |
| 3.8 | 2:29 | map | - | popup **"Card Fusing Unlocked!" / "Combine two identical cards to power up." / OK** (DE "Kartenfusionen freigeschaltet! Kombiniere 2 identische Karten, um stärker zu werden.") | OK | the **Cards** button gets a "!" badge |
| 3.9 | 2:30-2:31 | deck screen (4/80, mana 8/50): the fusion tab is open now and has a "!" badge | fusion tab glows | - | taps the fusion tab | fusion screen |
| 3.10 | 2:32.3 | **"Karten-Fusion"** (EN loca **"Fuse cards"**): "Feld 1" / "Feld 2" (EN "Slot 1" / "Slot 2"), cost "0" + OK between them; row: Throat-Cutter (the one not in the deck) | **green drag arrow from the Throat-Cutter to Slot 1** | DE "Fusioniere identische Karten, um sie stärker zu machen." / EN **"Fuse identical cards to increase their power."** [EN video] | drags it into Slot 1 | - |
| 3.11 | 2:33.3 | Slot 1 filled; row shows the second Throat-Cutter | arrow to Slot 2 | DE "Ziehe jetzt die andere Karte auf das andere Feld." / EN **"Now drag the other card onto the second slot."** [EN video] (no portrait, box only) | drags it into Slot 2 | cost **400** gold on the button |
| 3.12 | 2:34-2:36 | OK -> green "Fused" splash, fusion cutscene, card on the altar "FUSIONIERT" (EN "FUSED"): Throat-Cutter+ counting up 202 / 102 → 211 / 111 → 216 / 115 → **230 / 115** (round-5 re-check at 5 fps: the stats count up by 1 per tick, so 211 / 111 was a mid-count frame; final = base × 1.15), Level 1 / 12 | - | - | tap | fusion screen empty; gold 634 -> 234 |

## 4. Quest 4 (2:37-3:03)

| # | t | Screen | Text | Next |
|---|---|---|---|---|
| 4.1 | 2:37-2:45 | quest 4 swamp, 7 minions, 3 stamina | - | - |
| 4.2 | 2:48-2:52 | "Bossfight 4" / Flinger; pre-battle: boss row slot 3 only (Flinger); player Master Brewer, Throat-Cutter+, Envoy | (2015 EN: "Careful: that Flinger is fused for extra power!" - not in 1.7.0) | Attack! |
| 4.3 | 2:52-2:56 | fight **800 / 800 -> 960**, Skip button | - | Victory |
| 4.4 | 2:57-2:59 | reward "Card added to set: **Elven Novice**" 1/8 -> 2/8: **Falconer** (Standard 200 / 200 / 4) | - | map |
| 4.5 | 3:00 | map: popup "Card Slot Unlocked! / Your deck can now hold 4 cards." (padlock icon flies over the map) | - | Cards: the padlock of **slot 5** opens; Benito drags the Falconer into the deck (mana 12 / 50) |

## 5. Quest 5 "Showdown!" (3:04-3:39)

| # | t | Screen | Highlight | Text | Next |
|---|---|---|---|---|---|
| 5.1 | 3:04.5 | quest 5 dark forest, 7 minions | - | Worm Shaman portrait: DE "Jetzt wird nicht mehr davongerannt. Diesmal werde ich dich zerquetschen oder sterben!" / EN **"No more running. This time I will either crush you or die trying!"** [EN video] | - |
| 5.2 | 3:09-3:14 | **Level 3**: Rewards **orange (stamina) potion + 150 gold**, Points 12/12 (all into stamina 62 -> 74) | - | - | Proceed |
| 5.3 | 3:21 | banner **"Showdown!"**, plate **"Worm Shaman"** | - | - | - |
| 5.4 | 3:23-3:28 | pre-battle: boss slots 2-5 (Flinger, Worm Shaman, Lurking Goblin, Throat-Cutter); player slots 2-5 | - | ranger: DE "Sieht sehr gefährlich aus ... arrangiere deine Karten mit Vorsicht." / EN **"Looks deadly... arrange your cards with care."** [EN video] | Benito moves the Falconer to slot 2, Attack! |
| 5.5 | 3:29-3:32 | fight **1300 / 1300 -> 1560**, Skip button, he skips | - | at Victory: ranger DE "Du hast es geschafft!" / EN **"You did it!"** [EN video NbX8] | - |
| 5.6 | 3:34-3:37 | reward: "Card added to set: Orc Grunt" 1/8 -> 2/8, the **Worm Shaman card** (Standard 100 / 300 / 5, "Heals his right neighbor by 100 health points."), then the card XP list ("Level 1/2") + **"Weiter" (EN "Continue")** | - | - | map |
| 5.7 | 3:38.7 | transition to the map | - | DE "Auf der Hand des Shaman ist eine Rune eingebrannt. Wer hat ihn entsandt, deine Stadt niederzubrennen?" / EN **"A rune has been branded onto the Shaman's hand. Who sent him to burn your town?"** [EN video NbX8] | quest 6 |

## 6. Quests 6-7 (3:39-5:03) - the card piece and the 5th slot

| # | t | Screen | Text | Next |
|---|---|---|---|---|
| 6.1 | 3:39-3:46 | quest 6 swamp, 7 minions, **4 stamina** per tap | - | - |
| 6.2 | 3:47 | "Bossfight 6" / **"Blood Spitter"** | - | - |
| 6.3 | 3:49-3:51 | pre-battle, boss slots 2-5 | ranger: DE "Was ist das denn für ein hässliches Ding?" / EN **"What is that ugly thing?"** [EN video NbX8] | Attack! |
| 6.4 | 3:52-4:06 | the Blood Spitter card (Uncommon 500 / 300 / 6) is shown first; fight: opponent name **"???"** (hidden from Q6 on), **1060 -> 1272**, Victory | - | - |
| 6.5 | 4:08-4:10 | reward: a **card piece of the Club Swinger** (art with a puzzle-shaped hole) | ranger: DE "Diese Karte wird nach der Vervollständigung mächtig sein." / EN [transl.] **"This card will be mighty once it is complete."** | card XP list |
| 6.6 | 4:12 | map, node 7 | ranger: DE "Wir müssen zur Arena, um Karten zu vervollständigen!" / EN [transl.] **"We must go to the Arena to complete cards!"** | - |
| 6.7 | 4:24-4:25 | (Benito taps the portal swirl on the map) popup **"Portale" / "Erreiche Benutzer-Level 8, um Portale zu betreten." / OK** | EN [transl.] "Portals" / "Reach user level 8 to enter portals." | - |
| 6.8 | 4:26-4:53 | quest 7 (green valley), "Bossfight 7" / **"Club Swinger"**, opponent "???" 1060 -> 1272, Victory | - | - |
| 6.9 | 4:56-4:58 | reward: "Card added to set: **Arborearch**" 0/7 -> 1/7: **Gremlin** (Common 0 / 400 / 1) | - | - |
| 6.10 | 4:59 | map: popup "Card Slot Unlocked! / Your deck can now hold **5** cards." | - | Cards: **slot 1** (the last padlock) opens |
| 6.11 | 5:03.4 | map, node 8 | ranger: DE "Ich kann im Süden die Arena sehen!" / EN [transl.] **"I can see the Arena in the south!"** | - |

## 7. Quest 8 and the Arena (5:05-6:33)

| # | t | Screen | Highlight | Text | Next |
|---|---|---|---|---|---|
| 7.1 | 5:05-5:22 | quest 8 (big tree), **Level 4** at 5:14: Rewards **orange potion + 150 gold**, Points 12/12 (stamina 74 -> 86) | - | - | - |
| 7.2 | 5:23 | "Bossfight 8" / **"Tribe Avenger"** | - | - | - |
| 7.3 | 5:27.8 | pre-battle | - | ranger: DE "Ein Tribe Avenger! Die sind irrsinnig ... sieh doch nur ..." / EN [transl.] **"A Tribe Avenger! They're insane... just look..."** | Attack! |
| 7.4 | 5:37-5:47 | fight "???" 1160 -> 1392, Victory | - | - | reward **100 gold** (1391 -> 1491), card XP list |
| 7.5 | 5:54.2 | map | - | popup **"Arena Unlocked!"** (DE "Arena freigeschaltet! Kämpfe gegen andere Spieler"; EN loca text "Duel against other players") / OK | the 2nd nav padlock turns into the **Arena** (crossed swords) with a white flash |
| 7.6 | 5:54.8 | map | **sparkle on the Arena nav button** | ranger: DE "Zeit, den Club Swinger fertigzustellen!" / EN [transl.] **"Time to finish the Club Swinger!"** | taps Arena |
| 7.7 | 5:56 | first Arena visit: the **name popup** (pvpguard portrait): DE "Bitte sag mir, ehe du die Arena betrittst, wie dich die Herolde nennen sollen:" / EN loca **"Before you enter the arena, Evoker, please tell me by which name the heralds shall refer to you:"**, input pre-filled `user-1867590`, OK, X; "Gegner-Suche ..." (EN "Searching for opponents...") behind it | - | - | types "Godlike", OK |
| 7.8 | 6:03-6:06 | Arena tab (tabs "Arena / Teile / Wiederhol." = EN "Arena / Pieces / Replays"), event banner "ENDLOSES WISSEN / DOPPELTE XP FÜR DEINE KARTEN x2" (EN "Infinite Wisdom" / double card XP), Searching for opponents... | - | - | Benito opens the **Pieces** tab |
| 7.9 | 6:07.3 | Pieces tab: slot 1 = the Club Swinger piece card with an attack (crossed swords) button below, slot 2 = big green "+" | - | ranger: DE "Besiege diesen Amateurmagier, um sein Kartenstück zu erhalten!" / EN [transl.] **"Defeat this amateur mage to get his card piece!"** | taps the attack button under the piece |
| 7.10 | 6:08 | opponent info popup "Baltasar": card art, Level 2, stats, "Quests 2", "Gewonnene Kämpfe 0" (EN "Battles won"), attack button | - | - | attack |
| 7.11 | 6:09.4 | pre-battle vs Baltasar: his cards are **hidden** (tribe icons), "Godlike", "Benötigtes Mana: 16 / 50" | - | ranger: DE "Der Gegner verbirgt seine Karten." / EN [transl.] **"The opponent hides his cards."** | Attack! |
| 7.12 | 6:10-6:14 | fight vs Baltasar 1500 HP (shown "0/100" -> 1500), Skip, Victory in round 1 | - | - | - |
| 7.13 | 6:15-6:18 | reward: the piece completes - **Club Swinger** (Uncommon 300 / 300 / 6) | - | - | card XP list, Continue |
| 7.14 | 6:21.5 | Pieces tab (empty grid + green "+") | - | box (fading): DE "Vervollständige Kartenteile schnell oder andere Spieler stehlen sie dir vielleicht." / EN [transl.] **"Complete card pieces quickly, or other players might steal them."** | Benito puts the Club Swinger in the deck (7/80, mana 19/50) |

## 8. Quest 9 and Card Training (6:35-7:23)

| # | t | Screen | Highlight | Text | Next |
|---|---|---|---|---|---|
| 8.1 | 6:35.4 | quest 9 (overgrown ruins) | - | ranger: DE "Seltsam ... diese Spuren stammen nicht nur von Orks!" / EN [transl.] **"Strange... these tracks aren't only from orcs!"** | - |
| 8.2 | 6:47 | "Bossfight 9" / **"Ugluk Maggot Eater"**; fight "???" 1400, Victory | - | - | reward **Pouch Tearer** (Common 100 / 100 / 2), Orc Grunt 3/8 |
| 8.3 | 6:59 | map | - | popup **"Card Training Unlocked!" / "Sacrifice weak cards to level strong cards up." / OK** (DE "Kartentraining freigeschaltet! Opfere schwache Karten, um die Level starker Karten zu erhöhen.") - at **player level 4**, i.e. after quest 9, not at a level-up | OK |
| 8.4 | 7:00.5 | Cards (Benito taps it) -> deck screen | **training tab (left, arrow icon) sparkles** | - | taps it |
| 8.5 | 7:02 | **"Karten-Training"** (EN "Card Training"): "Trainieren" slot left (EN "Train"), "Opfern" slot right with a skull (EN "Sacrifice"), cost "0" + OK | **green arrow from the Club Swinger to the Train slot** | ranger: DE "Opfere schwächere Karten, um starke zu trainieren." / EN [transl.] **"Sacrifice weaker cards to train strong ones."** | drags the Club Swinger into Train |
| 8.6 | 7:03.5-7:05 | Train filled | **arrow from a weak card (Gremlin) to the Sacrifice slot** | (same box stays) | drags the Gremlin onto Sacrifice: cost **221** |
| 8.7 | 7:06-7:08 | OK -> "Trained" medal, altar cutscene, **LEVELAUFSTIEG** (card level-up) Club Swinger 309 / 309, Level 2 / 11 | - | - | Benito trains more (111, 420 gold) |

## 9. Quest 10 and the League (7:24-9:01)

| # | t | Screen | Text | Next |
|---|---|---|---|---|
| 9.1 | 7:24.4 | quest 10 (valley) | ranger: DE "Bäuerinnen aus der Gegend behaupten, dass ihre Männer verschwunden seien." / EN [transl.] **"Peasant women from the area claim that their husbands have disappeared."** | - |
| 9.2 | 7:33 | "Drink potion" popup when stamina runs out ("5 Tränke", "Trank nutzen" = EN "Use potion now") | - | - |
| 9.3 | 7:34-7:42 | **Level 5**: Rewards **blue (mana) potion + 250 gold**, Points 12/12 | - | Proceed |
| 9.4 | 7:48 | **"Showdown!" / "Succubus"** | - | - |
| 9.5 | 7:57-7:59 | fight: opponent **"Succubus"** (named again) 1260 -> 1512; ranger: DE "Sag uns, warum du unsere Stadt niedergebrannt hast, Dämonin!" / EN [transl.] **"Tell us why you burned down our town, demoness!"** | then the **Succubus** (own portrait): DE "Dieses jämmerliche Dörflein? Es ist für dich untergegangen, Evoker!" / EN [transl.] **"That wretched little village? It is lost to you, Evoker!"** | Victory 8:10 |
| 9.6 | 8:13-8:15 | reward Bone Breaker (Standard 200 / 200 / 4), Orc Grunt 4/8, card XP list, Continue | - | - |
| 9.7 | 8:16.4 | map | popup **"Leagues Unlocked!"** (DE "Ligen freigeschaltet! Arbeite dich an die Spitze vor!"; EN loca "Get to the Top!") / OK | the 1st nav padlock turns into the **League trophy** (white flash) |
| 9.8 | 8:19 | Bronze League (DE "Bronze-Liga"), countdown 0:23:47:44, 50 rows, prizes per rank | - | (end of the tutorial content; the rest is Benito exploring: Arena, Pieces, training) |

---------------------------------------------------------------------------------------------------------------

## 10. Corrections to `tutorial.md` (first pass)

1. **Q1 is won, not a forced loss.** The 1.7.0 player gets the **Master Brewer as a soul card from the 2nd minion of
   quest 1** (auto-placed in deck slot 2) and beats the two Throat-Cutters with Master Brewer + Envoy. The forced loss with
   the Envoy alone and the "drag Master Brewer into the deck" lesson (§1.4) belong to the 2014 client (NbX8), and even
   there J25GbjkYMbg (1.3.0) shows a won Q1. Start collection in 1.7.0 = **Envoy only** ("Your cards 3/80" after Q1 =
   Envoy, Master Brewer, Throat-Cutter).
2. **The deck lesson is at quest 2**: the Q2 boss (Bone Breaker alone) beats Master Brewer + Envoy; on the map "That card
   is tough! You need a stronger deck." + Cards sparkle; the drag arrow puts the **Throat-Cutter on the Envoy's slot**.
3. **Skip intro only skips intro part 1**; the Worm Shaman card (`bossfight_preview`) and the scripted fight follow.
4. **Fusion is guided right after the Q3 win** (popup on the map, then fusion tab, two arrows, 400 gold) - not after a
   lost Q4. "We need to fuse a card to take him on!" and "Careful: that Flinger is fused ..." are 2015 lines, absent in
   1.7.0; the Q4 boss is a plain Flinger at 800 HP and is beaten first try.
5. **Unlock popups appear on the map after a boss win**, not right after the level-up dialog: fusion after Q3 (level 2),
   Arena after **Q8** (level 4), Card Training after **Q9** (still level 4), Leagues after **Q10** (level 5). The client
   took `isGameFeatureUnlocked` from the server, so these follow quest progress, not the level alone.
6. **Deck slots**: start = slots 2-3; Q2 opens **slot 4**, Q4 opens **slot 5**, **Q7** opens **slot 1** (not Q6).
7. Shaman lines in 1.7.0 fights: only Q2 (2nd try) "Your next victory ...", Q5 minions "No more running ...". No line in
   the Q1 and Q3 fights ("Not bad, but I'm just getting warmed up." is 2014-15 only), no "Bah! You won't win ..." (only
   after a lost Q5).
8. Boss HP (before -> after the tribe bonus): Q1 250 -> 300, Q2-Q4 800 -> 960, Q5 1300 -> 1560, Q6-Q7 1060 -> 1272,
   Q8 1160 -> 1392, Q9 1400, Q10 1260 -> 1512. Opponent name "Worm Shaman" Q1-Q5, "???" Q6-Q9, "Succubus" Q10.
9. Boss rewards (first win): Q1 Throat-Cutter, Q2 50 gold, Q3 Throat-Cutter, Q4 Falconer, Q5 Worm Shaman, Q6 Club Swinger
   piece, Q7 Gremlin, Q8 100 gold, Q9 Pouch Tearer, Q10 Bone Breaker.
10. Level-up rewards seen: L2 5 gems + 100 gold, L3 stamina potion + 150 gold, **L4 stamina potion + 150 gold** (ours
    200), L5 mana potion + 250 gold. Levels were reached at Q3 tap 1, Q5 tap ~3, Q8 tap ~5, Q10 tap ~6.
11. No hand cursor is visible anywhere in this video; guidance = text box + button sparkle + green drag arrows. The
    hand (2 s delay) is kept for slow players (client view_shp_highlights `hand` with `delay`).
