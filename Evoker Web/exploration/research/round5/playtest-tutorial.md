# Playtest: tutorial (opening + quests 1-10)

Screenshots: `C:\Users\guiba\AppData\Local\Temp\claude\c--Users-guiba-Desktop-Evoker-Card-Game\5f60a16a-f52a-4277-bb01-5d3db216a6a8\scratchpad\playtest\tutorial\NNN-name.png` (numbers below are the file prefixes, ~460 shots).

## 1. What I played

Brand-new save on port 8111 (headless Edge via tools/cdp.js, driven through a small daemon in the scratchpad). Path: title -> intro (typewriter slides, not skipped) -> scripted Worm Shaman fight -> burning tower -> map -> Q1 ... Q10, all through real clicks and pointer drags: minion taps, boss intros, pre-battle drags, Attack, every result/XP/Continue screen, every unlock popup, level-up dialogs (+/-, Proceed), deck lesson, guided fusion, Q5 rearrange, Arena name prompt ("Godlike"), Pieces fight, card training, Leagues. Ended at level 5, tutorial record `done:true`, no console errors at any step (checked after every step).

Debug API: **not used at all** (no refill needed; I drank the stamina potion through the real "Drink potion" dialog at Q8).
Note: the browser process died once (killed from outside, probably another tester's cleanup) while starting Q5. I restored the save from the LevelDB log (it was one step old: after Q4, deck without the Falconer) via `localStorage.setItem` and replayed the Q4-end deck step and Q5. No other shortcut.

## 2. Bugs / differences

### B1. Tutorial sparkle renders as an opaque black rectangle, hiding the highlighted button - major (visual)
- Steps: any step with a button sparkle: map after Q2 loss (Cards), deck lesson after drag (Quests button), Cards tab after Q3 (fusion tab), after the Arena popup (nav Arena), after Q10 (League nav), training tab.
- Expected: additive glow over the button (original `view_button_sparkle`, frames bz2_0085.5, bz2_0149.3).
- Actual: a ~160x164 black box with a faint streak covers the button. On the deck screen after Q3 (179) the **fusion tab, the target of the lesson, is completely hidden** (only the hand is visible); Arena nav icon shows dimmed (385), League nav icon dimmed/covered (457). Also visible at 150, 427 (training tab 425).
- Cause: `.tut-sparkle-frame` uses `mix-blend-mode: screen`, but `.tut-layer` is `position:absolute; z-index:60` = its own stacking context, so the blend only sees the transparent layer and the frame's black stays opaque. Suspect: `css/tutorial.css` line 7 (`.tut-layer`). Fix idea: put the sparkle outside the isolated layer or use `mix-blend-mode: plus-lighter`/pre-multiplied alpha sprite instead.

### B2. Portal banner on the map enters the portal at player level 3 - major
- Steps: after Q6 on the map, tap the "The Dark Beyond" banner at the top.
- Expected (tutorial-v2 6.7): popup "Portals / Reach user level 8 to enter portals. / OK".
- Actual: the portal map ("The Dark Beyond", node 1) opens with no popup (347). No level gate anywhere.
- Related (minor): Escape from the portal map returns to the main map **not centred on the current quest** (quest 7 off-screen right, no hint, 350); tapping the Quests nav button re-centres it.

### B3. In-fight story lines never appeared (Q2 retry, Q10) - minor/major (content)
- Expected: Q2 second try, round 2: Worm Shaman "Your next victory will not come so easily, Evoker."; Q10: ranger "Tell us why you burned down our town, demoness!" then Succubus "That wretched little village? It is lost to you, Evoker!".
- Actual: I polled the DOM every 0.7 s through the whole fight (and the Q1/Q5/Q6 post-result lines were caught fine with the same poller); the three in-fight lines never showed. Q2 was a retry with `lost:[2]` in the save. Code: `FIGHT_LINES.q2Retry/q10Start` in `src/ui/tutorial/progress.js`, `battleHint` (needs `b.elapsed`, `b.n`, `b.mode`). I could not re-run (quests already won), so confidence is medium.

### B4. Card levels/stats differ from the original from the very first fight - minor/major
- A new game has the "Infinite Wisdom x2 card XP" event running (landing feed after reload, arena banner), so cards level in the tutorial: after Q1 Master Brewer and Envoy are Level 2 ("Level up! 100 -> 113 / 200 -> 227"); after the lost Q2 fight Master Brewer is Level 3; at the deck lesson (148) the cards show "Level 3/10 / Level 3/9" with 128/257 and 119/119 stats where the original shows Level 1/10, 100/200 and 100/100 (frame bz2_0087.4). Spec says "card XP list not shown for Q1" (tutorial-v2 1.9); ours shows two Level-up screens after Q1 (97, 106) and again after Q2 (144) and every later boss.
- Consequence: all later numbers (pre-battle stats, fused card 230/115 still right) are higher than in the video; Q4 was won in round 3, Q7 in round 6.

### B5. Gold per tap not flat / gold totals drift from the video - minor
- Q1: +6 per tap, +10 burst at the end, 240 at the boss: **matches the video**.
- From Q2 on there are random "burst" taps paying 5.5x (Q2..Q4: +99 instead of +18, Q6: +132 instead of +24, etc., about 1 tap in 4; deterministic per seed). Q2 first run: 240 -> 348 (video 240 -> 324 for 6 taps). Gold at the fusion: 876 (video 634) -> 476 after the 400 fee (video 234). The documented "occasional bonus burst" is a design choice, but it deviates from the scripted video numbers.
- HUD gold counter lags: after a tap the top-right gold stays at the old value for one more tap (Q1: HUD showed 200 for the first two taps while the save had 212; after the 4th tap HUD 218 vs 224). Stamina updates instantly. Minor.

### B6. Reward screens lack the "Card added to set: X (n/8)" banner - minor
- Q1 (075), Q3 (172), Q4, Q5 reward screens: only the card plate ("NEW" / name / Standard / Level 1/10 / Tap to continue). Original (bz2_0050.5) shows the banner "Card added to set: Orc Grunt" with the 0/8 -> 1/8 bar at the top. (Only the piece reward shows "1/2".)
- The ranger bubble ("The Shaman has fled! ...") sits over the lower card plate and hides "Standard", the stars and "Tap to continue" (076, 172 vs original bz2_0050.5 where the bubble is below a small card).

### B7. Ranger text box covers the UI it talks about - minor/cosmetic
- 214 px high box at y 898-1112 covers: the tray of the quest screen (029), the lower pre-battle tray ("drag a card into your deck", 121/310/333), pre-battle slot 1 (310), and in the deck lesson **the lower two thirds of the Throat-Cutter card that has to be dragged** while the green arrow starts on that hidden part (148). The original box (290x95 units, bz2_0087.4) sits lower/smaller and keeps the drag source visible. Box seems about 25 % taller/wider than the original frames.
- The speaker portrait stays for ~3 s after the box fades (185 "ranger-alone": only the ranger stands over the fusion screen).

### B8. Deck-mode card slider shows the spare card clipped at the right edge - minor
- After Q3 (first Cards visit with 1 spare Throat-Cutter), the big slider shows the card at x 603-720, cut off by the screen edge (178, 179), while the earlier visits with one spare card (148, 159) centre it. Stays like that after 1.5 s.

### B9. Stale tutorial hand over the training cutscene; training hint repeats after training - minor
- Training: the pointing hand from the OK button stays at (360,430) over the "LEVEL UP" altar cutscene (437). After the cutscene the lesson text + arrow reappear (arrow now from some deck card to the sacrifice stack, 438) even though the lesson was done. (Fusion cutscene had no stale hand.)

### B10. Arena tutorial opponent and numbers differ - minor
- Pieces target is "Torvald, Level 4, Quests 14, Fights Won 30, 1860 HP" (391) vs original "Baltasar, Level 2, Quests 2, Battles won 0"; the fight lasted 6 rounds (original: victory in round 1) with Boss HP 2232 shown. Reward popup button on the arena result is "Proceed" (not Continue) - fine if intended. The Arena first screen shows the opponent rows already behind the name popup (original: "Searching for opponents...").
- Card training cost for Club Swinger L1 + Gremlin = 56 gold and result 333/333 Level 2/11 (video: cost 221, result 309/309 Level 2/11).
- Q9 boss shown as 1680 HP (video: 1400, "no tribe bonus" row in tutorial-v2 10.8).

### B11. Smaller differences
- No red "!" badge on the Character (orange arrow) button after the Q1 win (original 1.10, bz2_0053.3). The badge does appear after level-ups (164, 369).
- Level-up timing: Q3 tap 1 (ok), Q5 tap 3 (ok), Q8 tap 3 (video ~5), Q10 tap 1 (video ~6) - XP carry-over differs slightly.
- Pre-battle at Q1: hand on Attack appears (no sparkle, as in the video), fine; but the Attack sparkle of the intro fight could not be checked (see not-verified).
- Pre-battle slot-1 / hand: on Q5 and later the deck row (5 cards) uses the full width; boss row attack numbers are clipped at the top of the card (same in the original frame, so OK).
- A brand-new game at reload shows the landing feed with a daily-reward banner "D1 ... D21" and "Infinite Wisdom" (305); fine per STATUS but the daily calendar shows on day one after a reload.

### Not verified
- The `bossfight_preview` (Worm Shaman card in the spiky frame, 0:09-0:11) between "Skip intro" part 1 and the board: my screenshots were 5 s apart and did not catch it; I did not tap "Skip intro" (the intro ran by itself into the board and the scripted fight after ~15 s).
- The Defeat banner itself (screenshot taken after the XP list started), the Q5 lost-then-"wrongOrder" path (I rearranged correctly the second time; the first attempt without rearranging was a Defeat at round 10 with Shaman 390/1560, no Shaman "Bah!" line seen).

## 3. Things that look right
- Opening: intro slides -> board with Worm Shaman 300/300, player 1500/1500; scripted fight HP 1500 -> 1200 -> 1000 -> 800 -> 500 -> 0 across 2 rounds exactly as in the video, no Defeat banner; tower picture; map with ranger "Don't let it end like this!..." and a hand on node 1.
- Q1: texts ("The Shaman's orcs are in our way! Smite them!", soul card line, Master Brewer drop into slot 2, "Avenge the village! Unleash your cards!"), stamina 2 per tap, gold +6 per tap, +10 at the end, "Boss Fight 1 / Throat Cutter", Shaman 300/300 after the tribe bonus, Victory, "The Shaman has fled! He dropped a soul card.", map line "I think he went this way! After him!".
- Q2: 3 stamina/tap (44 -> 26), Bone Breaker loss with the Shaman at 56/960 in round 9, Defeat, map line "That card is tough! You need a stronger deck." + Cards sparkle (apart from B1), deck lesson arrow/texts, mana 5 -> 6, "You'll beat the Shaman's Bone Breaker now!", replay from 0 %, win, +50 gold, "Card Slot Unlocked! Your deck can now hold 3 cards.", slot 4 lesson with mana 8.
- Q3: Level-up dialog at tap 1 (Rewards 5 gems + 100 gold, Points 12/12, HP +30/pt, stamina +1/pt, mana +1/pt, - and + work, capped at 12, Proceed refills to 62/62), "Skip fight" appears first time, second Throat-Cutter, "Card Fusing Unlocked!", fusion tab "!" badge, arrow lessons, texts, cost 400, FUSED 230/115 Level 1/12, gold -400.
- Q4 win, "Card Slot Unlocked ... 4 cards", slot 5 lesson (mana 12). Q5: Worm Shaman bubble, Level 3 (stamina potion + 150 gold, stamina -> 74), "Showdown!/Worm Shaman" intro, "Looks deadly... arrange your cards with care.", 1560 HP, Defeat unarranged / Victory arranged, "You did it!", Worm Shaman card, "A rune has been branded onto the Shaman's hand...".
- Q6: 4 stamina/tap, "What is that ugly thing?", boss "???", Club Swinger piece (1/2) with ranger line, "We must go to the Arena...". Q7: Gremlin, slot-1 popup with 5 cards and arrow to slot 1.
- Q8: Drink potion dialog (text, "1 potion", Use potion now), Level 4 (potion + 150 gold), "A Tribe Avenger!..." line, 1392 HP, +100 gold, "Arena Unlocked!", "Time to finish the Club Swinger!".
- Arena: name prompt text and pre-filled `user-...`, typing "Godlike" saved the name, Pieces tab sparkle/hand, "Defeat this amateur mage ...", "The opponent hides his cards.", Club Swinger completed 300/300/6, "Complete card pieces quickly ...".
- Q9: "Strange... these tracks ...", Card Training Unlocked, training tab sparkle, arrows Club Swinger -> Train and Gremlin -> Sacrifice, "Level up" cutscene.
- Q10: peasant line, Level 5 (mana potion + 250 gold), "Succubus" boss, Bone Breaker reward, "Leagues Unlocked!", League screen (Bronze League, countdown).
- No stuck states and no console errors anywhere; every popup could be closed; all drags (deck, fusion, training, rearrange) worked with pointer events.
