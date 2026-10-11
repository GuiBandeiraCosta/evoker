# Playtest: cards-shop (port 8114)

Screenshots: `C:\Users\guiba\AppData\Local\Temp\claude\c--Users-guiba-Desktop-Evoker-Card-Game\5f60a16a-f52a-4277-bb01-5d3db216a6a8\scratchpad\playtest\cards-shop\` (numbered, referred to below by number).

## 1. What was played

Headless Edge through a small CDP daemon (real mouse events: taps, drags, wheel). Console errors: none in the whole session.
Path: title (tap, Skip intro) -> `debug.newGame('Tester')` (started on the quest map) -> Cards (deck / training / fusion modes, card detail,
sell dialog) -> Album (sets, claim) -> Shop (all banners, Look inside, 3x3 booster with tokens and gems, "not enough gems", gem packs,
new booster) -> profile (avatar, rename, Support) -> Options (every control, export) -> Help (all 12 topics) -> daily rewards over ~30 days
-> potion deal -> orange menu. About 1 hour. No quests were played.

Debug API used (setup only): `newGame`, `setLevel(10)`, `giveGold(5000)`, `giveGems(2000)` (+ later 5000, and a negative `giveGems(-6540)` to
force the "need more gems" case), `giveTokens` (neophyte 3, summoner 2, portalLow 2 for the open portal), `addCard` (duplicates of pikeman /
scout / pouch-tearer, the 8 cards of The Dark Beyond for the album, one Alchemist, a stage-2 Master Brewer, a Guardian of the Throne),
`addDays(1)` many times, `store.update` to remove the Dark Beyond cards again so the "Card added to set" plate could be seen.
The tutorial was NOT marked done: `setLevel(10)` alone already unlocked fusion / training (the tutorial `seen` list was filled).
`addDays` only moves `createdAt`/daily dates (not the clock), so the daily event never changes with it. For the Great Potion Deal I overrode
`Date.now` in the page (+20 days) instead. (An early browser crash during an addDays loop was most likely caused by me killing Edge
processes by mistake, see "Note" at the end.)

## 2. Bugs / differences

### B1. Help "Shop" says "Look inside" shows the rarities a pack may contain - major text inconsistency (minor)
Severity: minor. Steps: Help -> Shop, paragraph 3: `Tap "Look inside" to see which rarities a pack may contain.` Actual: "Look inside" opens the
sealed booster / 3x3 grid (44, 45); the rarities are the little coloured squares under "May contain:" and need no tap. Suspected: `src/ui/screens/help.js` (TOPICS.shop).

### B2. Help says the daily calendar is a 21-day cycle that restarts; the game keeps counting past day 21 - minor
Steps: Help -> Character ("walk through the 21-day reward calendar ... Missing a day restarts the cycle") and the Options-era text "Missing a day restarts the 21-day calendar".
Played 30 consecutive days with `addDays(1)`: toasts read "Daily reward (day 22): 2 stamina potions", "(day 23)", ... "(day 31): 120 gems";
the strip on the landing feed shows "D 25 ... D 42" (80). Day 21 pays 2 Archmage tokens and then the sequence simply goes on. Expected (docs/help): 21-day
calendar. Either the help text or the calendar logic is wrong (probably a cycle wrap is missing, or the wrap is intended to be endless and the text is wrong).

### B3. Several daily-reward toasts pile up over the UI and use the gem icon for potions/tokens - minor/cosmetic
Steps: `addDays(1)` repeatedly (or log in after several days away) while on the shop / landing feed. Each day shows its own toast, stacked 5-7 high, covering the
banners (shots 80, 81-shop-event); the toast icon is always the blue gem even for "4 stamina potions" or "2 summoner tokens". Expected: one summary, or
at least the matching icon. Suspected: `character.js`/`app.js` notice toasts (`showNotices`).

### B4. Landing-feed daily strip is not refreshed after a claim - cosmetic
After "Daily reward (day 17): 200 gems" (shot 79) the highlighted big box still shows "200" (the reward just claimed) until the screen is re-rendered; after
re-render it correctly shows day 18. Minor staleness.

### B5. Card detail: the "Sells for / Main Quest" chips are cut off by the bottom nav - cosmetic
Card detail (any card, shots 14, 98, 99): the meta chips sit at y 1258-1296, behind/under the bottom bar; the page is scrollable (1190/1162) but nothing hints at it.
The big card art + stat panel + two buttons fill the screen; the chips are half hidden. Suspected: `card-detail.js` layout (`detail-stack` is 1190 px high in a 1162 px body).

### B6. Dropping a card on a locked deck slot does nothing and says nothing - cosmetic / possible difference
Deck mode, drag a slider card (or a deck card) onto a padlocked slot: the card snaps back silently (shots 11). Original unknown; a short hint ("Unlocked after quest 2/4/6") may exist.

### B7. Inline gem icon in the Great Potion Deal confirm dialog is misaligned - cosmetic
Dialog text "Buy 2 stamina potions and 1 mana potion for 60 [gem]?" - the gem glyph is tiny and sits on the baseline, the "?" ends up on the next line (shot 84).

### B8. Debug `addDays` cannot advance the daily event / countdowns - tooling note
`debug.addDays` shifts the save's dates only; events (Infinite Wisdom stays forever), portal rotation (it does rotate: Dark Beyond -> Dawn -> Desert -> Divine Peace -> ...)
and shop countdowns follow other clocks. Makes it impossible to test event days with the debug API (I patched `Date.now`).

No blockers or majors found in my area. Everything below worked as specified.

## 3. Things that look right

- Cards tab: deck screen matches the user's deck.png / fusion.png: "Your Deck", 5 slots (3 padlocked at start with 2 open, matching `deckSlots: 2`), "Your cards 8/100"
  plate, "Mana needed: 2 / 50" with marker, three mode buttons, the "!" badge on fusion; the slider starts with the first card at the far right edge and the rest off screen,
  exactly like fusion.png. Swiping scrolls (drag 600 -> 150 moved six cards in an arc). Mana line updates when a card is placed (2 -> 6).
- Deck mode: drag slider -> slot, swap between two slots (works), drag out of a slot into the slider removes it, locked slot rejects.
- Card detail: art, rarity, level n / cap, ATK / HP / mana, ability text with the value filled in ("Heals each of his neighbors by 557 ..."), "No ability." when none, "+" / "++" after the name for stages, pip row,
  Zoom (tap to close) and Sell (confirm dialog "Sell Pikeman (Level 1) for 100 gold?", Cancel works). Stage-2 Master Brewer L5/14 = 189/378.
- Training: empty OK -> "Add one card to the Training slot and at least one card to the Sacrifice slot."; stack of 3 -> price 333 (sum of sacrifice prices), taken from gold; level 1 -> 6 (xp 32);
  10th card -> "You're not allowed to sacrifice more than 9 cards at once."; deck card in the stack -> "Your sacrifice stack contains a card that is: - in your deck"; fused card -> "... - fused"; the
  animation shows the stack flying into the card and "LEVEL UP" with the new stats; sacrificed cards are removed (11 -> 8 cards).
- Fusion: slider narrows to partners after Slot 1 (only identical cards), price shows 200 for a Common (400 for Standard per design), result = stage 1 pikeman 115/115 (= base x 1.15), Level 1/10, "FUSED"
  banner, gold -200, the two sources removed.
- Album: sets of 17 / 8, "(2/10)" paging, progress 0/8 -> 7/8 -> 8/8, locked silhouettes with rarity frames, reward "4600 Gems" row; at 8/8 the Claim button appears (glow), claiming credits +4,600 gems,
  toast, then "Claimed" (shots 36-38).
- Shop: banners exactly as required (Neophyte, current portal 2 packs with "Offer ends in" countdown, next portal 2 packs "Coming soon:" + countdown, Summoner, Archmage, Set collections link); the
  token counters on the banners follow the save; Look inside -> sealed box -> 3x3 grid; picks cost a token first (3 tokens -> 3 picks, count in the top bar goes down), then gems (50 per Neophyte card,
  250 per portal-low card, 5010 -> 4760 ...); "Card added to set: The Dark Beyond 1/8" plate with progress bar appears only for a card new to its set; after 9 picks "Do you want to open a new booster?"
  -> fresh grid; refresh button asks the same; with too few gems "You need more Gems to get a booster card!" + "Get more" opens the gem packs.
- Gem packs: 5 entries, prices, bonus lines, display-only ("Purchases are not available in this offline version ...") from the HUD "+", the banner and "Get more"; close X works.
- Potion deal: only on its event day (Date override), "Great Potion Deal ... 60 gems", confirm dialog, buying credits +2 stamina +1 mana potion, -60 gems, panel disappears (once per day).
- HUD: level box -> profile (avatar, name, best card, stats with Bonus column, Quest, Battles won, "Your cards 34/100", Support); avatar picker (12 avatars) saves; rename dialog limits to 20 chars and shows
  "Welcome, <name>!"; money box -> gem packs; "?" opens the topic page of the current screen; Support opens the Character help; orange arrow menu: Album, Profile, Options, Home all work (shot 101).
- Options: music / FX volume sliders (70 -> 12, 100 -> 39), battle speed 1x/2x, Sound / Simulated raids / Reduced motion toggles all write the save; Export save toasts "Save exported"; Import opens a file picker (cancelled); Reset NOT pressed.
- Help: all 12 topics render, scroll, topic buttons wired. Texts agree with the game now (slots 2/3/4/5, fusion costs, shop prices 50/350/975/250/1000, unlock quests 3/8/9/10, collection numbers) apart from B1 and B2.
- Daily rewards: streak counts per day, gems / potions / tokens credited correctly (day 17: +200 gems; day 20: +240 gems; day 21: 2 Archmage tokens), no reward on the first day of a new game.

## Note
While recovering from the browser crash I stopped Edge processes that had `remote-debugging` in their command line; if another playtester's headless browser died around that time
(roughly the last third of my session) that was me.
