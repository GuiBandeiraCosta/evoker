# Playtest report: PvP (Arena, Pieces, Replays, League) - port 8113

## 1. What was played
- Fresh `debug.newGame('Tester')` (no tutorial record = counts as finished/named, so the real tutorial path was NOT
  exercised), then tapped the title screen. Debug API used for set-up only: `setLevel(12)`, `giveGems(3000)`,
  `giveGold(5000)`, `givePotions(5,5)`, `refill()` (also before league fights, to avoid the potion dialog),
  `addCard` x5 (stage 2, level 20) + `collection.setDeck`, `deckSlots=5`, `manaMax=200` through `store.update`.
  `debug.addDays(1)` for every league finish (with `daily.lastClaim` pre-set so the daily reward does not mix in).
  For the Bronze -> Silver -> Gold promotions and the Gold stay, `sim.league.points` was set to 99999 through the store
  (league fights, Arena and Pieces point gains had been tested for real before). A 0-point Gold league and Bronze
  leagues with 100 / 300 points were also finished. One piece hunt was staged at 3/4 through the store to see the completing win.
- Played through the UI: Arena (list, info popup, 4 fights incl. potion dialog and a defeat), Pieces (8 buys, holder popup,
  reroll, piece fights, completion by gems and by fight), Replays (list, info, watch), League (join popup, list, info,
  3 fights vs one rival, locked button, Arena/Pieces points, 6 finish popups). 130 screenshots in
  `scratchpad\playtest\pvp\` (numbered: 04 arena, 05 info, 63 pieces grid, 64 holder popup, 72 card popup, 97/98 league,
  100 league info, 109/112 finish popups). No console errors at any time.

## 2. Bugs / differences

1. **League nav "!" badge stays after joining** - minor.
   Steps: level 12, open League (badge "!" on the trophy), tap Join League. Expected (nav.js: "!" only while not joined):
   badge disappears. Actual: still drawn while on the League screen (screenshots 98, 103); gone only after switching
   screens. The nav is not re-rendered when `leagueJoined` changes. Suspected: src/ui/chrome.js (badges computed at mount)
   / src/ui/screens/league.js join handler.

2. **Arena info popup HP differs from the HP in the list** - minor.
   The red row says HP 4,134; its info popup says 3,180 (4,134 = 3,180 x 1.3 difficulty power). The user screenshot shows
   one value. Screenshots 04 vs 05. Suspected: sim-info dialog uses `sim.hpMax` without `offer.power`.

3. **Piece-hunt win without completion has no reward step in the result flow** - minor.
   Win a piece fight: Victory banner -> card XP -> Proceed; the piece appears only as a toast "You won a piece of Arrow
   Master!" on the Pieces tab (screenshot 70). game-design.md section 1 says the loot step shows "a piece: the dark card
   with the white puzzle cut-out, then the full card with its puzzle overlay for 1.5 s". (When the win completes the card,
   the loot step does show the full card, screenshots 84/85.)

4. **Completing a card by fight shows two celebrations** - cosmetic.
   Last-piece win: full-size "Card added to set: Dawn of Eternity 1/8" in the loot step, then after Proceed the
   "Card complete! ... Great!" dialog for the same card. Probably redundant.

5. **"Card added to set" banner covers the card's name plate** - cosmetic. Screenshot 85: the banner sits over the top of
   the full card, hiding the name (only "...OUS" of INCUBUS visible).

6. **League list opens at rank 1 after returning from a league fight; event banner inside the league list** - cosmetic/verify.
   First visit scrolls to the own row (as league-2_list_2016). After a fight or re-render it starts at the top, and the
   "INFINITE WISDOM x2" event banner sits above the first row (screenshots 103, 111). The original league frames show no
   banner; unsure whether the original had it on this tab.

7. **Arena offers do not refresh while the screen stays open past the 30-minute timer** - minor.
   Set `sim.arena.rerollAt` 4 s ahead while on the Arena tab, wait 9 s: names unchanged, `rerollAt` stays in the past.
   They refresh when switching tabs or re-entering (verified). No visible timer (matches the original list).

8. **Locked league fight button gives no feedback** - cosmetic. After 3 fights vs one rival the button greys out
   (correct) but tapping it does nothing, no explanation of the 3-per-rival limit (screenshot 104).

9. **Arena/Pieces wins give no visible league-point feedback** - minor/verify. A win adds league points (+149 for the red
   Arena row, +28 for a piece fight, verified in the save) but neither the result flow nor a toast mentions them; Arena
   rows no longer show points at stake (STATUS round 5, like the user screenshot). League fights do show "+150 league points!".

10. **HUD mana label touches the bar end at 3-digit values** - cosmetic. "200/200" / "93/200" run into the right frame of
    the mana bar (screenshots 04, 60). Also the HUD on the quest map kept the old 50/50 mana max after `manaMax` was raised
    through the store until the next screen change (set-up path only, low priority).

11. **Pre-battle "Mana needed" bar: drag-handle arrow sits on top of the label** - cosmetic. Screenshot 06: the double
    arrow overlaps the ":" of "Mana needed: 108 / 200".

12. **"Reroll opponent 10" button overlaps the card panel border in the holder popup** - cosmetic. Screenshot 64: the button
    spans x 230-495 and overlaps the left card box border (x 100-308).

13. **Opponent portrait in the battle header differs between live fight and replay** - cosmetic. Live fights against Jorund
    and Rosalind both showed the same white-robed portrait; the replay of the Rosalind fight shows a different (dark swordsman)
    portrait (screenshots 08 vs 94). Avatar seems picked differently in battle and replay.

(Not a bug: a 0-point finish prints "Your rank: 32" while the list says "-"; the user's original frame league-1_2016 does the same.)

## 3. Looks right
- Arena list: event banner with ticking timer, 3 rows (green / yellow / red names, strongest-card portrait in a rarity frame,
  star + level, heart + HP, info + attack) very close to the user's screenshot; info popup; attack -> pre-battle with
  face-down tribe backs and the opponent name; mana cost deducted exactly (deck 108: 200 -> 92); potion dialog; gold on win
  and on defeat (+228); Tournament Points +10 per win (Arena and Pieces), none for league fights (credited at settlement =
  points/10); offers re-rolled after every fight; replays recorded (icon, name, Won, date, time, info, eye) and watchable.
- Pieces: 8 empty "+" slots with 100-gem buy (confirm, random Rare/Heroic set card, toast), 4-per-row puzzle grid like
  pieces-grid.png, card popup with Complete (140 gems for 3 missing) + confirmation, "Card complete!" celebration, slot
  compaction afterwards, holder popup with Reroll opponent 10 gems (gems -10, new holder), piece win +1.
- League: join popup, 50 rows (you + 49), ranks 1-3 yellow, ties share rank (5,5 / 9x5 / 20x4), "-" for 0 points, prize icons
  only to rank 29, own row gold-framed with greyed fight button, d:hh:mm:ss countdown ticking, info screen RULES + PRIZES
  (Gold/Silver/Bronze) matches the docs, +150 per league win with toast, 3 fights per rival then locked.
- Finish flow via `addDays(1)`: popup with rank + prize icons; credited in the save: Bronze rank 18 -> 2 mana potions, stays
  Bronze; Bronze rank 1 -> rare card + 5 mana -> Silver; Silver rank 1 -> heroic card + 7 mana -> Gold; Gold rank 1 ->
  legendary card + 12 mana, stays Gold; Gold with 0 points -> back to Bronze, no prize; Bronze rank 21 -> 25 gems. Tournament
  Points = points/10 added; new league starts at 0 with the tier's stronger sims.
- Battles: tribe bonus, ROUND banner, hits, deaths, Victory/Defeat banner, loot, card XP, level-up popup; no visual glitches
  seen over ~15 screenshots of 4 fights.
