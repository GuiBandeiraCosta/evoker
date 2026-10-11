# Remaining gaps: our build vs the original (client 1.7.4 target)

Method: our screenshots (`tests/screenshots/*.png`, `qa-core-loop/`, `qa-cards-economy/`, `qa-pvp/`) were compared by eye with the best original frames in `frames/screens/` (prefer `_v174`), plus `frames/tutorial`, `frames/lategame`, `frames/playthroughs*`. Things listed as deliberate in `DECISIONS.md` (10 sets instead of 26, speed button kept, thief ATK, old eras ignored) are not reported.
Ratings: H/M/L = impact on faithfulness. Fix: easy / medium / hard.
Caveat: there are no original 1.7.4 frames for Character, Settings, Help, Replays and the Arena opponent list, so those screens cannot be judged against the original; only the HUD/nav shell and the older-era descriptions in `screens.md` are available.

## Top 10 differences overall

1. **Cards screen mode switch and layout (H, medium).** Ours: four text tabs "Cards / Deck / Training / Fusion", a "Your cards" title and a 5-column wrapped grid. Original: a "Dein Deck / Your deck" title, a 5-slot deck row on top, "Your cards 962/80" plus the "Mana needed: 129 / 560" bar, then **three icon-only buttons** (training, cards, fusion with red "!" badge) and a **horizontally scrolling row of large cards** (about 3 visible).
2. **Fusion screen is a different design (H, medium).** Ours: a list of recipe rows ("A + B = C", gold cost, warning "A card below its level cap gives a weaker result (Evolve bonus 78%)", green Fuse button). Original: header "Fuse cards", two framed slots "Slot 1 / Slot 2", coin + cost in the middle and one OK button, cards picked from the scrolling row below. The "Evolve bonus" wording and warnings do not exist in the original.
3. **Training screen differs (M-H, medium).** Ours has a red hint "Pick a card to train", "Tap a card" placeholders, a caption "Tap the card you want to train, then the cards to sacrifice.", a "3/9" counter badge and an ours-only result table (XP, sword/heart/anvil rows, "Tap to continue"). Original: header "Card Training", empty dark slots, a **skull icon** in the "Sacrifice stack", `0` + coin, OK, then the scrolling card row; result is the cavern + "LEVEL UP" ribbon + stat change.
4. **Pre-battle still has the "Your cards" drawer (H, easy-medium).** Ours (`qa-core-loop/16`, `17`, `qa-pvp/07`) shows a "Your cards / drag a card into your deck" panel under the player row. The original pre-battle has only enemy row, flaming Attack! bar, your row and the bottom nav (decision D5 and screens.md 1.4). The arena prebattle also adds "Mana needed" bar, which the original screens.md does not show on this screen.
5. **HUD and bottom nav shell (M-H, easy).** Ours has a back arrow left of "?" on every screen; the 1.7.4 HUD has only "?". Ours' 6th nav button is a brown character silhouette; the original is an **orange up-arrow** icon. Ours: first two nav slots are padlocks even when Arena/League are unlocked in places (e.g. the cards screens at level 5 show a padlock where the trophy/League would be, which is right only before level 6) - and the League screen at level 5 (`19-league`) is reachable with the padlock showing. The original has red "!" notification badges on nav buttons (cards, up arrow) that we only show on the character button.
6. **Landing feed content and art (M-H, medium).** Structure is right (daily-reward strip, event banners, portal). Differences: original banners are full-bleed painted art with an ornate frame ("LIMITED CHRISTMAS OFFERS!", "Visit our forum", "WISDOM / DOUBLE XP FOR YOUR CARDS 8:12:44", portal banner with the portal's card art and "The Dark Beyond / Dream of Power / Portal closes in:"). Ours: flat teal/glow-blue frames, an extra "Main Quest / Green Valley - Quest 1 / 1/100" banner and a "Card-piece Day" banner not seen in the original, and a toast "Daily reward (day 1): 2 stamina potions" over the daily strip. The daily strip lacks the original item icons (big potion, "240" gem stack, gold hex tokens, "..." then D24) and the left-aligned timer.
7. **Quest map framing (M, medium).** `03-quest-map` and `23-quest-map-after-win`: the map image stops at about 70 percent of the height and leaves a flat dark void above the nav; the original portal map fills the whole area. Title bar says "The Dark Beyond" with a countdown while the nodes are the main Green Valley quests (inconsistent), plus a "Portal archive" button that does not exist in the original (screens.md 1.9). Original bar is a full-width dark strip with purple gradient title text and countdown at right; ours is a blue glow plate. Original nodes are lighter grey-blue squares.
8. **Booster grid details (M, easy).** Ours: cards are huge (3 columns filling the width, large gaps), token icon is a **bronze coin**, back arrow + gems + coin + green reset button on a plain strip. Original: smaller cards with tighter spacing, token icon is a **purple/white triangle** (and a gem icon with 1000/250 when tokens are out), top bar the same idea. Our pack-name label ("Neophyte Pack") at top does not exist in the original frames. Gem cost shown as `50` (original frames show 250/1000). The face-up reveal in ours is shown large with a drawn card plate and then the grid is dimmed behind; original reveal is a blue-framed glowing card with the "Card added to set" plate. Original opening shows a small chest on the altar growing; ours shows a single pale card back (not a cabinet/lightning).
9. **Result flow: new card and card-level screens (M-H, medium).** Ours shows a modal "New card / You found Pouch Tearer! / Great!" for quest drops; original shows the card glowing full-screen with a NEW ribbon and the "Card added to set: X n/8" plate. Ours' result screens in the screenshot run end on a thin white sliver mid-flip (`22-battle-result-card`), so the card reveal animation is unverified. The "star Level n" card XP bar screen with deck cards left and levelled cards right (`k_card_xp_results.jpg`) is not present in any of our shots.
10. **Title screen (M, easy).** Ours: art zoomed and cropped (the EVOKER logo is much larger and the dragon head lower), a "Web recreation" watermark at top right, a black "Tap to continue" bar with a hand icon. Original: "Please wait..." dark band with a spinning white-purple pentagram across the middle, the logo smaller at the bottom with the grey version "1.7.4" at lower right, and no tap prompt. (A tap prompt may be needed for audio unlock; the pentagram band and version number are cheap wins.)

Other notable: our Collections screen shows "(1/10)" and card names/stat plates (original: art-only frames, "(4/26)" - sets deliberately 10); ours omits the golden flash on the new card.

## Per screen

### Title
Ours `qa-core-loop/01-title.png` vs `title-1_v174.jpg`.
- (M, easy) Crop/scale of the art and logo differ; logo is about 1.5x larger in ours and covers the Evoker's hands.
- (M, easy) "Tap to continue" strip with hand vs "Please wait..." band with pentagram; no `1.7.4` text.
- (L, easy) "Web recreation" watermark.
- Colour and art are right.

### Feed / landing (quest tab start page)
`qa-core-loop/02-landing-feed.png` vs `quest-hub-1_v174.jpg` and `frames/screens/quest-map-1_v174.jpg` (scroll position with WISDOM/Dark Beyond banners), `lategame/main_menu_events.jpg`.
- (M) Structure matches (daily strip, banners, countdowns in d:hh:mm:ss). Wording matches "DON'T MISS YOUR NEXT REWARD!" and "Portal closes in:".
- (M-H, medium) Banner art/frames: original ornate gold-bronze frames with painted event art; ours uniform blue neon outlines. Original portal banner shows 3 of the portal's cards fanned (ours 4 cards in blue frames, similar idea but different art treatment) and a painted swirl banner for "The Dark Beyond / Dream of Power".
- (M, easy) Remove the "Main Quest ... 1 / 100" banner? The original reaches the quest map via the compass; banner list has only events/portals. Also "Card-piece Day / CARD PIECES AT HALF PRICE" is invented (original has "x2 Day of the TOURNAMENT / DOUBLE PVP POINTS" with an orange x2 badge, "INFINITE WISDOM / DOUBLE XP", "Visit our forum").
- (M, easy) Daily strip: original has a timer under the first (large potion) icon, gem "240" tile at D2, hex-token tiles D3 and D24, and a "..." separator; ours shows empty first tile with "2", "D 3 / D 4 / D 21". The daily toast overlaps it.
- (L) Level plate in original reads `Lvl. star 79`, stamina and mana with the small orange/blue counters; ours matches.

### Quest map
`qa-core-loop/03-quest-map.png`, `23-quest-map-after-win.png`, `28-portal-map.png` vs `quest-map-2_portal_v174.jpg`, `tutorial/nb_0016_guide_map.jpg`.
- (M) Map art does not fill the viewport (dark void under the map) in the main view; the portal view (28) fills better and looks close.
- (M, easy) "Portal archive" button and "Return ->" label are ours; original title bar has only the title and countdown.
- (M, easy) Title bar says "The Dark Beyond" over the main-quest nodes in 03/23 while 28 says "Main Quest / Return" over the portal-style lava map: the labels look swapped.
- (L, easy) Current node: original rune circle sits on a grey square number plate (no blue colour); ours is a bright blue square with a white outline and a gold star on completed nodes. Our "Green Valley" tag is partially hidden behind the circle.
- (L) "Quest 2 unlocked!" toast is ours (no original equivalent seen).

### Quest (minion tapping)
`qa-core-loop/04-quest-1.png`, `05-quest-hit.png`, `14-gold-burst.png` vs `quest-1_ios2014.jpg`, `potion-dialog_2015.jpg`, `showdown-1_2015.jpg`.
- Matches well: percent bar, painted background, gold coins, PERFECT popup.
- (M, easy) Extra "Main Quest - Green Valley 1" plate (original has none).
- (M, easy) Bottom tray: original shows a **horizontally scrolling row of mini portraits** (your deck cards plus the current enemy portrait, highlighted); ours shows five slots with big padlocks and the two deck cards.
- (L, easy) Ours adds a red "Boss fight!" button and "All minions defeated!" text at the bottom; original (older frames) just goes into the boss intro. Unverified for 1.7.4.
- (L) Stamina potion dialog (`11`) is close to the original text; the "Pouch Tearer" toast over it is an extra.
- Tutorial: the qa shots do not show the ranger dialogue panel or the hand cursor, so the tutorial could not be compared.

### Boss intro
`qa-core-loop/15-boss-intro.png`, `32-boss-intro-31.png` vs `boss-intro-1_v130.jpg`.
- Matches very well (gold "Boss Fight N", rune circle, name plate, no button, no HP line).
- (L, easy) Card art frame in ours is grey, original has a bright silver frame with slightly larger card (about 10 percent).
- (L, easy) "Showdown!" variant for the last boss and the face-down card (2015 era) cannot be seen in our shots.
- (L) HUD back arrow, see top-10 item 5.

### Pre-battle
`qa-core-loop/16`, `17`, `18`, `36`, `qa-pvp/07` vs `prebattle-1_v130.jpg`.
- (H, easy-medium) "Your cards" drawer, see top-10 item 4. The original deck editing is on the Deck screen only.
- (M, easy) Enemy row cards: ours always shows two copies of the single enemy in separate slots, and the 5-slot rows have empty black placeholders; original shows only the filled card with the other slots drawn as dark empty frames, also with locks only on locked slots (OK in ours). Card stat strip at the top of ours is clipped like the original.
- (L) Attack bar matches well.

### Battle
`qa-core-loop/19`, `20`, `34`, `26`, `qa-pvp/08` vs `battle-0_tribebonus_v130.jpg`, `battle-3_hpbar_dmg_v130.jpg`, `battle-4_abilities_2016.jpg`, `arena-battle-1_2016.jpg`.
- Layout matches closely (portrait frame, name, round, heart bars, mini bars).
- (M, medium) "ROUND 1" shown immediately; original shows "ROUND n" only after the tribe-bonus moment (1.4). Our "Loading..." strip exists (34) and looks right.
- (M, easy) Background is heavily blurred and dark green in ours (quest 1) vs crisp painted swamp/landscape in the original (`battle-0`). The arena background (`qa-pvp/08`) is good.
- (M, easy) Player portrait: original shows a dark silhouette face with a white "?" (when no avatar); ours shows the blue "?" help button from the HUD.
- (L, easy) Ours has no hero-side avatar/frame for the opponent in the dark cases; fine.
- (M, easy) Skip fight: original is steel-blue, enabled, bottom-left, with no speed button; ours is greyed ("Skip fight" disabled-looking in 26/27/qa-pvp) and has a "1x" button (kept on purpose, but the greyed skip looks unlike the original's lit button).
- (M, medium) Speech panel with portrait ("No! My precious Flinger! Curse you, Evoker!") from the Worm Shaman is part of the original boss fight; not seen in our shots.
- (L) Damage numbers, hero-hit red flash, tribe bonus glow: not visible in our still frames; could not verify.

### Battle result (Victory / Defeat / loot)
`qa-core-loop/21`, `22`, `27`, `35`, `38` vs `result-1_victory_v130.jpg` (actually a boss-death frame), `result-2_card_levels_ios2014.jpg`, `defeat-1_2015.jpg`, `playthroughs-2/k_card_xp_results.jpg`, `tutorial/bz_0115_slot_unlocked.jpg`.
- (M) Our Victory banner is a blurred pale-gold plaque sized to fill the whole screen when captured (mid-animation); the original banner is a crisp gold cross plaque, about two thirds of the screen width, with thin serif "Victory". Needs a settled frame to judge; the text looks washed out.
- (M, medium) Loot reveals: original has a coin burst in a dark cavern (`bz_0115`) with no HUD overlay; ours does the burst over the quest landscape (14) and uses a modal for card drops. The glowing card with NEW ribbon + set plate is missing for quest drops (card piece in 35 is close: pink-framed glowing card, but no "Card added to set / Card piece" plate).
- (M, medium) The post-fight card level screen (deck cards left, star Level bars, levelled cards right, Proceed button) is not in our captured flow; `27` goes straight from Victory to the next screen.
- (L) Defeat banner: not captured. Draw case (`38`) cannot be compared (original has no draw frame).

### Level-up dialog
`qa-core-loop/06`, `07`, `08` vs `levelup-1_v130.jpg`.
- Matches very well (title, "Reached level N", Rewards column, "Points: x/12", heart/stamina/mana rows with -/+, Proceed).
- (L, easy) The reward column in ours shows the gem number "5" floating at the right of the crystal icon and the gold row at the bottom; original has the icon with the amount centred and a larger potion icon. Dialog is slightly lower and wider in ours; the original background is dimmed more.
- (L, easy) Initial row values: ours showed 1530/51/50 after spending 2 points while original starts from the full total; fine.
- Level Up ribbon (`06`): ours is a blue cyan ribbon; original (v1.3.0) ribbon is similar; original `Fused` is green. OK.

### Unlock popups
`qa-core-loop/09-unlock-fusion.png`, `25-unlock-cardslot.png` vs `screens.md 1.12` text (no 1.7.4 image).
- Wording matches ("Card Slot Unlocked!", "Your deck can now hold 3 cards.", "Card Fusing Unlocked!"). Dark dialog with red X looks in-style.
- (L, easy) "Quest 3 unlocked!" toast remains on screen behind the popup in ours.
- (L) In the original the fusion tutorial continues with the guide pointing to the Deck/Fusion buttons; not captured.

### Cards (collection grid)
`qa-cards-economy/01-cards-grid-80.png`, `02`, `03`, `04` vs `lategame/p900_full.jpg`.
- (H) Layout differs as described in top-10 item 1. Ours adds sort/filter chips (All, tribe icons, rarity chips "Common ... Ultimate") and "Sort: Level" not present in the original frame.
- (M, easy) Capacity label: ours "Your cards 80/100" in an input-like box partially covered by a toast; original "Deine Karten 962/80" is a dark pill in the left of the deck panel, red when over.
- (M) Card frame colours, stats strips and "Level 5 / 27" bar look right.

### Deck
`qa-cards-economy/11-deck-5-slots.png` vs `p900_full.jpg`, `tutorial/bz_0151_fusion_guide.jpg`.
- (H) Big title "Deck" vs original "Dein Deck" / "Your deck"; we have extra "No tribe bonus" strip and a 3-line help text "Drag cards into the slots..." (not in the original).
- (M) The "+" green slots: original empty slots are dark with padlock only when locked; empty available slot shows nothing/dark frame.
- (M) Mana bar text "Mana needed: 11 / 50" matches the original wording.
- Single scrolling row vs wrapped grid, see item 1.

### Training
See top-10 item 3 (`12-cards-training.png`, `qa-cards-economy/16`, `17`). Additional: our hand-cursor overlay appears on the Deck tab in 12 (tutorial hint), fine. Level-up result: original shows the card art with a "LEVEL UP" ribbon and `300/300 -> 326/326`; ours uses a table dialog with an extra "Cards in your deck cannot be sacrificed" banner and an anvil row (card-defence stat?) with 15 -> 15.

### Fusion
See top-10 item 2. The "Fused" ribbon (`21`) is good (green plaque, white-ish glow); original has a white flash behind it, ours shows the list through a green tint. After fusing, original goes to a cavern with the two cards merging and a blue result card with "Level 1 / 12"; ours goes to the card detail (`22`).

### Card detail
`qa-cards-economy/05-card-detail.png`, `06`, `22` vs `card-detail-2_ultimate_v174.jpg`, `card-detail-1_ios2014.jpg`.
- Matches very well: name plate, tribe icon, rarity colours, pips, level bar, stats strip, orange ability text.
- (M, easy) Extra "$" sell button next to the magnifier plus "Sells for 55 / Main Quest" chips (no equivalent in the original frames).
- (L, easy) Stat strip in ours is spaced differently (values closer together; mana icon and heart ordering is right).
- (L) A plus sign after the name ("Sentinel+", "Gremlin+") is ours/ported from client naming; fine.
- Card-piece detail with puzzle overlay and gem buy button (`pieces-detail_2016`) is not captured in ours.

### Collections
See `qa-cards-economy/23`, `24`, `26` vs `collection-1_v174.jpg`.
- (M, easy) Header "Main Quest (1/10)" / "The Dark Beyond (2/10)": original "The Dark Beyond (4/26)" (26 sets: deliberate, not reported), but the **first page is "Main Quest"** in ours with 17 cards and "31,700 Gems", which the original does not have.
- (M, easy) Cards: original grid has 4 x 2 art-only cards in rarity frames (no names, no stat plates; locked ones grey with a padlock); ours shows stats plates and names under each card, so cards are narrower/taller.
- (M, easy) Reward block: original is a compact row "Reward: / 4600 Gems" with a gem icon on a small padlock tile; ours has a large banner "Reward:" with ornamental plate, "4,600 Gems" (thousands separator; original "4600 Gems").
- (L, easy) Progress bar: original thin green bar with `8/8` small; ours thicker bar with "3/8" and the row is spaced differently.
- (L) Claimed state: ours "Claimed" tile with yellow frame; original golden flash and blue gem shower: not captured.

### Arena
`qa-pvp/01-arena-offers.png`, `02`, `03`, `04` vs `arena-1_early2014` (battle), `screens.md 1.8` text (early 2014 arena: rows with star/heart/drop and `i` + swords buttons).
- (M, easy) "EASY / NORMAL / HARD" chips and the "Opponents / Free reroll in 29:56 / New opponents: 10 (gem)" footer and "Each fight costs your deck mana: 2" line are not in the original (screens.md says none).
- (M, easy) Row stats: original `star 2, red heart 1740, blue drop 50`; ours `star 5, drop 27` with no heart value.
- (L) The card-piece-day banner is ours.
- Info popup (`02`) is close in spirit to the original (name, stats, swords) but layout is ours.
- League nav button (trophy) is active-looking here at level 6, correct.

### Pieces
`17-arena-pieces.png` vs `pieces-detail_2016.jpg`, `lategame/main_menu_events.jpg` (last panel: 4 x 2 grid of puzzle-covered cards with small swords buttons under each and a green "+" slot).
- (M-H, medium) Ours is a large "Empty slot / Buy first piece: 50 (gem)" detail plus a 4 x 2 grid of empty black slots with puzzle icon; original grid has the actual puzzle-overlaid card art, a small blue crossed-swords button under each and a green "+" button in the last slot; no big detail panel at the top. Tab label in original localisation "Peças"; English "Pieces".

### League
`19-league.png` vs `league-2_list_2016.jpg`, `league-1_2016.jpg`.
- Close match: orange title, timer under it, "i" button, rank/avatar/name/points, swords, gold outline for own row.
- (L, easy) Ranks 32/33/34 big white numbers (original small, grey "-" when 0 points; same). Timer plate and title size larger in ours.
- (M) The join/finish dialog (orange "BRONZE LEAGUE" plate, "Congratulations! Bronze League completed", "Your rank: 32", "Enter the next league:", "Join League") was not captured, so presence could not be verified.
- (L) Own row swords button greyed in ours (correct, can't attack self).

### Shop
`qa-cards-economy/28-shop.png`, `27-shop-gem-packs.png`, `38`, `39` vs `shop-1_v174.jpg`, `playthroughs/b5_lvl2_shop.jpg`.
- Matches well: "Need more Tokens? Visit the Shop!" banner, framed packs, "Look inside", "May contain" rarity squares.
- (M, medium) Banner art: original is a wide painted banner (cards and characters, ornate frame) with the pack name overlaid; ours uses three tilted cards on a cavern background in a coloured frame and a caption line "Uncommon, Rare and Heroic Cards" (original "1 Ultimate + Legendary Cards" style only on limited packs) and shows a gem price on the banner (original shows token counts/countdowns, price appears in the grid/open step).
- (M, easy) Missing "LIMITED" pack banners with countdown ("Offer ends in 4:19:12:36") and token count; original 3rd banner "Infinite Void".
- (L) Gem pack dialog (`27`) is an ours-only dark list; names/prices (Apprentice's Bundle 500, $4.99 ...) come from the research; acceptable. The pack banner in the original 1.7.4 shop for gems is the green "+" nav button; we match.

### Booster
See top-10 item 8 (`29`-`37`).

### Character / Daily / Settings / Help
`qa-cards-economy/40`, `43`, `45`, `50` and `24-help.png`: no 1.7.4 reference frames exist. Observations on style only: the screens use clean cards and green confirm buttons that are stylistically a bit different from the dark-bronze buttons used elsewhere (the green "+/Confirm" and "Claimed today" button), and the "Help" topic page (`24`) is long-text based while the original "?" button is a plain help button of unknown content. The 6th nav icon and level/stat-point flow are covered above (D1 says points are spent in the level-up dialog; the Character screen still has a full stat-point editor with Now/Add/After columns and a Confirm button, which is an addition: M, easy to hide).

## Screens that now match well
- Boss intro (gold "Boss Fight N", rune circle, name plate, no button).
- Level-up dialog (layout, wording, rewards column, points rows).
- Card detail (frame, plates, strip, wording).
- Battle layout (heart bars, mini bars, portrait frames, Attack bar, Loading strip).
- League list (orange title, timer, rows, own-row outline).
- Shop pack list ("Look inside", "May contain", token banner).
- Unlock popup wording and style; stamina potion dialog wording ("Your Stamina is too low. Would you like to use one of your Stamina potions?").
- Quest tapping screen (percent bar, coins, PERFECT).
- HUD plate itself (level, stamina, mana, gold, gems).
