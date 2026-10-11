# Playtest: progression (new game to level 10)

Tester: QA agent, port 8112, headless Edge through `tools/cdp.js`. Screenshots: `C:\Users\guiba\AppData\Local\Temp\claude\c--Users-guiba-Desktop-Evoker-Card-Game\5f60a16a-f52a-4277-bb01-5d3db216a6a8\scratchpad\playtest\progression\` (abbreviated `shots\` below).

## 1. What I played

- Fresh save: title, intro, scripted Worm Shaman fight (Attack! tapped), burning tower, quest map, then main quests 1 to 28 through the real UI.
- Quests 1 to 10 in the tutorial order. Quest 2 was lost first (as scripted), then I dragged the Throat-Cutter into the deck and replayed it. Quest 3 fusion was done by dragging both cards into the slots and pressing OK. Unlock popups for slots, Arena, Training and Leagues all came up. I did the name popup, a Pieces fight (lost once, then won the re-roll), a training sacrifice and a booster opening with the 2 Neophyte tokens from level-ups and boss rewards.
- Level 10 was reached in quest 26 (player level 10, 26 quests beaten, 16 cards). I played on to quest 28 only to look for card drops.
- Every tap, drag and result-screen click was a real mouse event. Deck changes used pointer-event drags (Cards tab slider to deck slot, to the training and fusion zones).
- Time: about 107 minutes of game clock for the final save (about 2 h including two aborted attempts), roughly 400 minion taps in total (about 90 in quests 1 to 10, about 310 in 11 to 28 including replays). Some of that time was waiting for animations, not play.
- 31 quest runs; 5 boss fights lost (quest 2 scripted, quest 13 three times, quest 15 once, quest 26 once), 4 of them in the quest 13 to 26 range.
- Debug API: `refill()` 13 times, always at the "Drink potion" dialog when the player had 0 potions and fewer than 40 gems (once per level on average from level 5 onwards). Everything else (taps, fights, level-up dialogs, potions, gems purchase, drag deck changes) was played through the UI. A potion was used from stock 6 times and bought with gems once (55 gems -> 15 gems, correct; the pending tap was then spent from the refilled bar).
- The harness (not the game) lost the browser twice at the beginning of a battle in my first two attempts (`Runtime.evaluate: connection closed`). It did not recur in the following ~45 battles, so I can't attribute it to the game. Console errors: none in the final session.

### Pacing (per level)

| Level reached | Where | Taps (approx, whole level) | Notes |
|---|---|---|---|
| 2 | quest 3 tap 1 | 17 | XP 47 (2 + 2 + 3 per tap early) |
| 3 | quest 5 tap 3 | 14 | XP 47 |
| 4 | quest 8 tap 5 | 25 | XP 92 |
| 5 | quest 10 tap 6 | 30 | XP 94 (matches 1.7.0 video timings in game-design 3) |
| 6 | quest 13 (3rd attempt) | about 41 | 204 XP at 5 per tap |
| 7 | quest 13 (4th attempt) | about 48 | 240 XP |
| 8 | quest 18 tap 1 | about 55 | 274 XP |
| 9 | quest 22 tap 13 | about 62 | 310 XP |
| 10 | quest 26 | about 68 | 342 XP |

Each quest is 7 to 17 taps (about 2.5 minutes of play incl. the boss fight at 1x with Skip fight). Stamina per level from level 6 on is 200 to 340 while the bar holds 66 to 82 and regens 1 per minute. One level-up refill plus the potions from level-ups (stamina potion at L3/4/8/9, mana at L5/10) covers about a quarter of it, so a real player without gems would wait hours per level from level 6 on. In the original that is the point (potions and gems are the monetisation), so I think the pacing is plausible. The unplanned feel comes from quest 13: three losses in a row with my best deck (Tamer 763 attack, Club Swinger, Falconer) and four extra quests of grinding (replays of 12 and 13, plus training) before the deck could win. See bug 5.

## 2. Bugs and differences

1. **Cards tab slider starts with the first card at the far right edge, cut off** (major). Steps: Cards tab, deck / training / fusion mode with a small collection (1 to 9 cards, level 2 to 10). Expected: the user's `exploration/research/round3/frames/user/deck.png` shows the front card centred and neighbours on both sides on an arc. Actual: with 1 card (after quest 2) that card is at x=602 (156 wide), clipped by the screen edge, the rest of the slider area is empty. With more cards the first card is at the right edge and the others are hidden or tiny at x=808 until the slider is swiped (training screenshot `shots\67-training.png`, fusion `shots\40-fusion.png`, deck `shots\37.png`, `shots\38.png`, `shots\54-cards.png`). A new player has to find out they must swipe the slider; the dragging tutorial arrow points at the card at the edge. Suspect `SLIDER.START` / `sliderPose` in `src/ui/screens/cards-helpers.js`, `createSlider` in `src/ui/screens/cards.js`.

2. **First Pieces fight in the tutorial is lost with a 5-card level-4 deck** (minor to major for the tutorial flow). Steps: win quest 8, Arena, name popup, Pieces, tap the first attack. Opponent "IronBeard77" (Level 5, 1,980 HP, a Tamer 719/360 on its level 4, 9 mana) beat my deck (HP -1,359 at the end), so the "Defeat this amateur mage to get his card piece!" step ends in a defeat and a re-roll is needed (10 gems or the second button). tutorial-v2.md 8.x implies a won first fight with an easy opponent. Expected: a clearly weaker scripted opponent (the original's "amateur mage"). Screenshots `shots\59-pieces-pre.png`, `shots\61.png`. Suspect the tutorial opponent selection in `src/game/pieces.js` / `src/game/opponents.js`.

3. **Result screen after a lost Arena/Pieces fight has no "Continue", only "Proceed", and the result helper-style tap anywhere does nothing** (cosmetic). The button is labelled "Proceed" while boss results use "Continue"; only the lower button works (tapping the middle of the screen skips steps only in the XP part). If the original used "Continue" here as in `battle-gameplay` frames this is a label difference. Low priority. Screenshot `shots\61.png`.

4. **Taps are silently swallowed for about 6 seconds after the quest 1 soul-card drop** (minor). Steps: quest 1, 2nd minion drops the Master Brewer card ("One had a soul card!"). Expected: either the next minion walks in at once or the minions look inactive. Actual: three real taps on the live minion did nothing (stamina, gold and progress unchanged) until the animation was over; no feedback. Screenshot `shots\29-stuck.png`. Suspect the card-drop animation lock in `src/ui/screens/quest.js`.

5. **Difficulty wall at quest 13 and boss HP not scaled the same as quests 1 to 10** (minor / balance, needs a decision). Boss HP shows `bossHp x 1.2` for quests 1 to 10 (1,560 for 1,300, 1,512 for 1,260) but exactly the data value from quest 11 on (2,490 / 2,580 / 2,670 ...). Same 20 percent tribe-bonus banner logic or a data inconsistency; either way the jump from quest 12 (2,580 HP, won with Falconer/Throat-Cutter/Club Swinger/Gremlin/Master Brewer) to quest 13 (boss "Archer" line-up with 4 cards at 5 to 8 stars, three losses) is abrupt. A new player is stuck for several quests unless they train (training unlock at quest 9 works). `data/quests.json` n=11 to 13, `bossLineup` in `src/game/quests.js`.

6. **docs/design/game-design.md 4.2 mentions "Q4 Flinger+ alone, 1050"** but data and tutorial-v2.md say a plain Flinger, 800 HP (displayed 960 with the tribe bonus). Doc stale, game fine. Also tutorial-v2.md 5.4 lists the quest 5 boss row as Flinger, Worm Shaman, Lurking Goblin, Throat-Cutter, while the game uses Throat-Cutter, Pouch Tearer, Throat-Cutter around the Worm Shaman (`bossCardIds` of node 5). Minor difference from the video.

7. **Fusion dialog flow: fusing leaves the player on the fusion tab with the new card and no "level 1/12 -> deck" hint** (cosmetic, not a bug). Noting only: after the quest 3 fusion the Throat-Cutter+ (230 / 115, Level 1 / 12) is correct as in the video; the deck slot kept the old Throat-Cutter id, which the game replaced by the fused one automatically (deck showed c6 after fusion). Fine.

8. **The HUD gold counter stays at the pre-wave value during a level-up dialog** (cosmetic, by design). `shots\q5-lvl0.png`: HUD 764 gold while the save had 968 (the +150 level-up gold is only credited at the end of the wave). Expected per game-design 4.2 (held counter), but a dialog that lists "150 gold" over a HUD that has not moved looks odd; the original credits the reward when the dialog opens.

## 3. Numbers checked and correct

- **Stamina per tap / gold per tap**: Q1 2 / 6 (+10 on the last tap), Q2 to 5 3 / 18, Q6 to 10 4 / 24, Q11 to 30 5 / 30 (all as in game-design 4.2 and data/quests.json). Bursts: 99 at Q2 (18 + 81), 132 at Q6 to 10, 165 at Q11+; about 1 in 10 taps; none on Q1. Figures per quest match `figures` (Q1 5, Q2 6, Q3 6, Q4 7, Q5 7, Q6 7, Q7 8, Q8 9, Q9 11, Q10 12, Q11 7, Q12 11). Boss reward gold 360 = 3 x 4 x 30.
- **XP**: 1 per stamina (2/3/4/5). Level thresholds 47, 47, 92, 94, then 204, 240, 274, 310, 342; the level-ups landed exactly at quest 3 tap 1, quest 5 tap 3, quest 8 tap 5, quest 10 tap 6 as in the 1.7.0 video. Boss fights give no player XP.
- **Level-up dialog**: "Level up! / Reached level N", Rewards column, "Points: 12/12", + / - rows, Proceed. Rewards: L2 100 gold + 5 gems, L3 150 + stamina potion, L4 150 + stamina potion, L5 250 + mana potion, L6 300, L7 350 + 50 gems (gems 5 -> 55), L8 400 + stamina potion, L9 450 + stamina potion, L10 500 + mana potion. Gold, stamina and mana refill on level-up. Points: +30 HP / +1 stamina / +1 mana (hand placed 2 HP + 1 stamina, auto-spread of the remaining 9: HP 1,500 -> 1,620, stamina and mana 50 -> 54). The dialog shows the new maxima live.
- **Unlock popups**: Card Fusing (after quest 3), Card Slot (4 cards) after quest 4, Card Slot (5 cards) after quest 7, Arena after quest 8, Card Training after quest 9, Leagues after quest 10 (each shown once, after the win on the map; the League screen then showed the enter popup and the standings; the tutorial flag `done` set).
- **Boss HP / intro**: quest 1 shows 300 (250 x 1.2), quests 2 to 4 960, quest 5 1,560 ("Showdown!" intro), quest 6 and 7 1,272, quest 8 1,392, quest 9 1,680, quest 10 1,512. Boss intro auto-advances to the pre-battle; "Boss fight!" button after 100 percent.
- **Card XP**: every deck card gets (10 + enemy mana / 2) x 1.5 on a win, x2 on Infinite Wisdom days (event active all session; e.g. +80 per win at quest 26, +39 at quest 1), level-ups shown after each fight card by card ("Level up! n -> m"), caps shown as "Level 9 (MAX)".
- **Result flow** (banner, "NEW" card reward, card XP bars with levels, Continue, then the player level-up dialog on the quest screen): works in order; the potion and the gems purchase dialogs show the right text ("Your Stamina is too low. Would you like to use one of your Stamina potions?" / "... Buy one for 40 gems?" with the button greyed when gems < 40).
- **Quest map**: nodes sit on the painted sockets, beaten nodes grey, the current node inside the rune ring, locked nodes as dark sockets; the portal banner "The Dark Beyond" with the timer ticks (6:23:59:57 -> 6:22:13:01 over about 2 hours) and the landing feed shows "Portal closes in", the Dawn of Eternity "Coming soon" countdown and the daily reward strip. Section name `Green Valley` for 1 to 17, `Shadow Swamp` from 18 (shown in the quest title "Main Quest - Shadow Swamp 26"); the HUD stamina / mana bonus numbers show the potion counts.
- **Cards**: drag to deck slots, to the fusion slots and to the training zones works; training price rises with each sacrifice (111, 351 for two, 1,620 for the last five); the Tamer went from level 4 to level 8 (Level 8, xp 108) for 1,486 gold; deck mana bar updates (8 / 54 etc.). The collection reached 16 cards by level 10. Booster: 3 x 3 face-down grid, each pick costs a token and reveals the card (Gargoyle, Tamer); card-drop-after-wave works (cards appeared in the collection almost every quest from 12 on).
