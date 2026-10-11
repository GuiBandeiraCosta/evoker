# Round 3 — screens: original look and behaviour vs our recreation

Evidence is cited as `video-id @ mm:ss`. Frames are in `exploration/research/round3/frames/screens/`, named by screen plus era.
Timestamps are accurate to about +-2 s. Our screenshots are `tests/screenshots/NN-*.png`.

## 0. Which client era each video shows

The videos span several client versions. The UI changed a lot between early 2014 and 2017, so check the era before copying anything.

| video | upload date | era / evidence |
|---|---|---|
| LQPUnzX9J5w | 2011-06-26 | CGI teaser of a pre-mobile prototype ("EVOKER Collectible Card Game", five coloured orbs, physical cards on a wooden table). Nothing usable for screens. |
| n0oc3BDjWHk, 3KjCivc4gxw | 2014-03 | **Early Android client** (title shows "1.1.7"). Old wizard tutorial NPC, round circular nav buttons, green-outlined "Skip fight", red player HP heart. |
| J25GbjkYMbg | 2014-09-13 | iOS, full first-session tutorial. Red ranger girl, square nav. Boss banner is plain red "Boss Fight N" text. |
| Svgtj4sYZRk | 2014-09-15 | Android, **title shows "1.3.0"**. Same flow as J25, but the boss banner is a gold ornate frame. Best 1080p source for the 1.3-era battle, level-up and fusion. |
| LnNVvKaTe-M | 2015-01 | Russian localisation of the same tutorial (Dragon Hunt portal banner). |
| osu4RhMVm3s | 2015-06 | The 2014-03 Android client (title "1.1.7"), re-uploaded. Old arena battle and Club Swinger piece tutorial. |
| wfk_KRqPbYU | 2015-07 | iOS review, level 5. Shows Defeat, the face-down "Showdown!" card, the stamina potion dialog and "Card Training". |
| 8EaxSJt_wjc | 2016-01 | Android, level 5-6. Title version number is partly legible and looks like "1.7.3" (low confidence). League screens, 5v5 PvP battles, Defeat. |
| JdrKM_3lmbQ | 2016-02 | Portuguese Android, level 28. Boss "46º Chefe", card-piece detail with a buy button. |
| VM3udsNuZHU | 2016-12 | 5v5 PvP with many abilities (6,750 HP opponent). |
| ZJWEYHQsVWU | 2017-12-27 | **Title shows "1.7.4", the same build as our APK.** Hub, portal map, shop, booster opening, set collection. **This is the authoritative source for the final UI.** |

I did not analyse audio. Sound cues are not covered.

---

## 1. Discrepancies, sorted by importance for faithfulness

### 1.1 Booster opening is a 3x3 pick-many grid, not a single-card flip (high confidence)

Frames: `booster-1_chest_v174`, `booster-2_grid_v174`, `booster-3_reveal_v174`, `booster-4_gem_cost_v174`. Source: ZJWEYHQsVWU @ 0:18-1:30 and @ 4:50-5:10.

Our `26-booster-open.png` / `27-booster-open-flip.png` show "Neophyte booster", a single card, a "Take" button and the text "Pick one of 8 cards". The original works like this:

1. **Intro.** A small glowing chest rests on a rune altar in the blue cavern. A beam of light hits it and it grows into a stained-glass card cabinet. Lightning cracks it, then a glowing card-back drops out.
2. **The grid.** The screen shows a **3x3 grid of nine card backs** over the cavern art. Every back shows a purple triangle token icon and the number `1` (the token cost per pick).
3. **Top bar.** It replaces the normal HUD with:
   - left: an orange back arrow;
   - a blue gem icon with the player's gem count (`2049`);
   - a purple triangle with the remaining token count (`17`, `16`, ... `0`);
   - a green rounded button at the right with a circular-arrow glyph (probably "reset / new booster").
4. **Picking.** The player taps any back.
   - The back flips to a face-up card, enlarged in the centre. The frame colour is the rarity: blue, purple, orange or red.
   - The card then shrinks into its grid slot.
   - The token counter drops by 1.
   - The player may keep picking until tokens run out (`17 -> 0` seen in one pack).
5. **Set banner.** For portal cards, a plate drops from the top: `Card added to set:` / `The Dark Beyond` / progress bar `5/8` (small text).
6. **Out of tokens.** The remaining backs change from `▲1` to a **gem icon with a price**.
   - `250` on Dark Beyond @ ~0:35.
   - `1000` on a different pack @ ~4:50.
   - Gems are spent per further pick.
7. **Reopen dialog.** When all nine are open (or tokens are used up), a dialog appears:
   - text: `Do you want to open a new booster?`;
   - a pack icon, an `OK` button and a red X in the corner.

New facts: nine cards per pack; one token (or 250 / 1000 gems) per pick; the picks are not "one of N".

### 1.2 Post-battle flow is graphical and sequential, not a "Rewards" text table (high confidence)

Frames: `result-1_victory_v130`, `result-2_card_levels_ios2014`, `levelup-1_v130`, `defeat-1_2015`. Sources: Svgtj4sYZRk @ 3:48 and @ 0:24; J25GbjkYMbg @ 2:12-2:25; wfk_KRqPbYU @ 1:56.

Our `09-battle-result.png` shows a Victory plaque plus a text table ("168 gold / 33 XP / Card XP: +21 per card / Bone Breaker: Level 1 -> 2 ... Tap to continue").

The original shows **no text list**. The steps, in order:

1. **Victory banner.** A gold cross-shaped plaque with "Victory" in thin serif text.
   - It scales and fades in over the frozen battlefield for about 2 s.
   - The boss HP bar is empty and red. The round counter stays at the last round.
   - The player's surviving cards stay on the field and the "Skip fight" button stays visible.
2. **Loot.** The screen dissolves to the landscape or a black cavern with a white glow. Then one of:
   - a gold-coin burst (particles with light rays, no number);
   - a glowing card (`NEW` ribbon) with the plate `Card added to set: Orc Grunt` and a progress bar `2/8`;
   - the full card detail.
3. **Card levels.** A dark screen with the HUD on top.
   - The deck cards are on the left, each next to a `★ Level n` XP bar.
   - The cards that levelled up are on the right.
   - A `Continue` (iOS, blue) or `Proceed` (early Android, green outlined) button is at the bottom.
4. **Card level-up.** If a card levelled up, it shows full-art with `Level up!` on top.
   - Rows: `★1 -> ★2`, attack `100 -> 121` (red) and HP `100 -> 121` (green).
   - `Tap to continue` with a hand icon.
5. **Player level-up.** If the player levelled up, there is a full-screen white flash with a `Level Up` ribbon, then a dialog (see §1.7).
6. **Return** to the quest or arena screen.

Defeat: a red, blood-spattered "Defeat" banner of the same shape (wfk_KRqPbYU @ 1:56; 8EaxSJt_wjc @ ~2:17). Then the same progression minus loot.

### 1.3 The login destination is a news/events hub, not the quest map (high confidence)

Frame: `quest-hub-1_v174`. Sources: ZJWEYHQsVWU @ 0:06-0:12; 8EaxSJt_wjc @ 0:02-0:08.

After "Please wait...", the first screen is a **vertical list of large banner cards** under the normal HUD. Seen in 1.7.4:
- A daily-reward strip, `DON'T MISS YOUR NEXT REWARD!`, with day icons `D2 D3 ... D24` and a countdown `7:12:56`.
- `LIMITED CHRISTMAS OFFERS!` / `Special deals until December 31st!`.
- `Visit our forum`.
- `INFINITE WISDOM  x2  DOUBLE XP FOR YOUR CARDS  8:12:45`.
- `The Dark Beyond  Dream of Power  Portal closes in: 4:19:12:44`.

In 8EaxSJt_wjc (2016):
- `Day of the TOURNAMENT x2  DOUBLE PVP POINTS  2:07:42`;
- `DRAGON HUNT  Let the Chase Begin`.

Tapping the portal banner opens that portal's map. The portal map has a title bar `The Dark Beyond` with a countdown `4:19:12:40` at the right.

Our flow goes "Tap to continue" -> quest map with a toast "Daily reward (day 1): ...". The original puts the events, daily reward and portals on a scrolling banner screen first. In 1.7.4 the star-compass nav button is the quest map. In the banner-list frame the nav shows no highlighted button, so this is probably the start page. Medium-high confidence.

### 1.4 Boss intro, pre-battle and the "Attack" transition differ (high confidence)

Frames: `boss-intro-1_v130`, `boss-intro-2_ios2014`, `boss-intro-3_2016`, `prebattle-1_v130`, `battle-0_tribebonus_v130`, `showdown-1_2015`.

**Boss intro** (Svgtj4sYZRk @ 3:20; J25GbjkYMbg @ 1:48; JdrKM_3lmbQ @ 0:44):
- A full-art landscape background with the **card face large in a spinning orange rune circle**.
- A title above the card:
  - `Boss Fight 4` on a gold ornate banner (1.3.0 and later); on iOS 2014 it is pink-red serif text;
  - `Showdown!` for the quest's final boss (e.g. Worm Shaman);
  - Portuguese `46º Chefe`, so the number is the quest number.
- The boss name sits in an ornate orange plate below the card.
- A red pentagram wipes in over the top row. The screen then auto-advances; there is no button.
- Our boss intro has dark plaques, a "Continue" button, a green "Boss HP 1,000" line, and an odd "Archer" chip overlapping the title. The original has none of these. Boss HP is revealed only inside the battle.
- In the 2015+ clients (wfk_KRqPbYU @ 1:36) the Showdown card can be **face-down** (a pentagram card back) while the name `Succubus` is shown. In 2014 it is face-up.

**Pre-battle** (Svgtj4sYZRk @ 3:24):
- There are no HP bars and no "Boss Fight 1" heading.
- The layout is the empty enemy row, the huge flaming `Attack!` bar between the rows, then your row. Locked slots show padlocks.
- The **bottom nav stays visible** and the HUD stays at the top. The enemy cards are face-up with a tiny stats strip on top (PvE) and are not tappable.
- The deck is edited on the **separate Deck screen**, not a "Your cards" drawer under the row. Our drawer ("drag a card into your deck", `07-prebattle.png`) does not exist in the original pre-battle.
- The original Deck screen has a **single horizontally scrolling row of large cards** under the deck slots, not our wrapped grid (`12-cards-deck.png`).

**Attack transition** (Svgtj4sYZRk @ 3:25-3:32):
1. The Attack bar plays a blue lightning flash.
2. The layout swaps to the battle layout.
3. A dim strip with a spinning pentagram and `Loading...` appears over the middle for about 1.5-2 s (server call).
4. The enemy portrait slot briefly shows a **glowing tribe icon**.
5. `TRIBE BONUS` text crossfades over the HP number while the HP counts up.
   - Worm Shaman `800/800 -> 960/960`.
   - The Showdown boss goes `1300 -> 1560`.
   - Both are exactly +20 %.
   - The player bar also rises in some frames, e.g. `1500 -> 1620` after a deck change.
6. `ROUND 1` appears at the right of the title bar. The "ROUND n" label is absent before this moment.

Our code shows the tribe bonus in pre-battle only. See `battle-0_tribebonus_v130.jpg`.

### 1.5 Battle presentation and pacing (high confidence)

Frames: `battle-1_v130`, `battle-2_v130`, `battle-3_hpbar_dmg_v130`, `battle-4_abilities_2016`, `arena-battle-1_2016`, `arena-battle-2_2016`, `arena-battle-3_2016`.

Layout is the same as ours: portrait frame + name + round at top, HP bar with heart, enemy row, your row, player name and `?` below, `Skip fight` bottom-left. Differences:

- **Skip fight.** It appears only after the tribe-bonus / loading phase. It is a steel-blue button in 1.3+ and a green-outlined one in early 2014. **There is no 1x/2x speed button** in any original frame; ours has `1x`.
- **Player HP bar.** Green in 1.3+ and red in early 2014. Our colours match 1.3+.
- **Mini HP bars.** Every card has a thin bar outside the card: above the enemy cards, below your cards. There is no stats text on the player's cards in battle, only a tiny strip. Ours matches roughly.
- **Damage numbers.** They are drawn in **red, bold, with glow, over the target card** (`-100`, `-230`, `-1315`, `-1664`) and fade as they rise.
  - A hit on the opponent hero also flashes a **red glowing strip across the whole HP bar** with the number (`-100`).
  - Healing shows green plus-signs and a green number.
  - Ours shows an arrow beam. In the original it is a thin golden bolt (a small yellow bullet that travels up, not a long beam) plus a bright burst on impact.
- **HP text colour.** The HP text turns **red** once the bar is low. It is red at `660/960` and white at `860/960` (threshold unclear, probably about 2/3).
- **Death.** The card shatters into two black halves with golden sparks, about 1 s.
- **Round counter.** It increments quickly when only one card is attacking. The two-digit "ROUND 10" overlay briefly stacks the old and new numbers (a vertical roll).
- **Ability FX** (VM3udsNuZHU @ 0:06-0:15; 8EaxSJt_wjc @ ~0:20-0:40):
  - ice blocks with the damage number on the victim;
  - a cyan target ring on the victim (a sniper-style marker);
  - a red anvil/"A" sigil in a pulsing red ring over a card (probably the stun/"daze" state);
  - pink-purple swirls;
  - golden light pillars;
  - the word `STRENGTHE...` floating on a buffed card.

**Pacing** (measured on Svgtj4sYZRk @ 3:32-3:55 and J25GbjkYMbg @ 3:10-3:30 at 0.5 s resolution):

| phase | original duration |
|---|---|
| Attack -> loading dim | ~1.5-2 s |
| Tribe-bonus count-up | ~1 s |
| One attack (bullet 0.5 s + burst 0.5 s + number 0.5 s, overlapping) | **~1.5 s** |
| Round 1, 3 cards vs 3 cards | ~10 s (about 6 hits plus deaths) |
| Round with a single remaining attacker | **~1 s per round** (Round 3 -> Round 11 in about 6 s) |
| Victory banner | ~2 s |
| Whole 5v5 PvP fight, 2-3 rounds | ~25-35 s without Skip (8EaxSJt_wjc @ 0:20-0:44, @ 1:44-2:18) |

Our `STEP_MS` (round 1100, attack 720, damage 560, death 950) makes empty or low-activity rounds about twice as slow as the original. Our 1x default is slower than what the video shows: single-attacker rounds in the original run about 1 s versus our >= 1.1 s round step plus an attack and a damage step.

### 1.6 Training, fusion and card detail (high confidence)

Frames: `training-1_2015`, `fusion-1_v130`, `fusion-2_v130`, `card-detail-1_ios2014`, `card-detail-2_ultimate_v174`.

- **Mode switch.** The deck / training / fusion modes are three **icon buttons** under the header. Left: training, a card with an arrow. Centre: cards. Right: fusion, two cards with "+", with a red "!" badge. Ours uses four text tabs "Cards / Deck / Training / Fusion".
- **Training screen.** Header `Card Training`. A big empty `Training slot` on the left, a skull icon `Sacrifice stack` on the right, a gold coin with `0` and a centre `OK` button. Early 2014 calls it `Enhance` with an `Enhance slot`.
  - Tutorial text: `Sacrifice weak cards to train strong ones.`, `Drag the Club Swinger to the Enhance slot.`, `Now place a weak card onto the Sacrifice stack.`
  - The gold cost updates when you add the sacrifice, e.g. `56`.
  - Confirming plays a blue cavern with beams, then the card reappears glowing with a gold `LEVEL UP` ribbon and the new stats, e.g. `300/300 -> 326/326`.
  - Our screenshot 13 has a long caption and a tip line, and tab-style navigation. Details differ.
- **Fusion screen.** Header `Fuse cards`, two framed slots `Slot 1` and `Slot 2` with a gold coin and cost in the middle (`0`, then `400`) and an `OK` button between them. After OK there is a white flash, a green `Fused` ribbon, a cavern scene with the two cards merging by beam, and a blue-lit result card with `Level 1 / 12`.
  - A mismatch gives a modal: `You need two of the same card at the same state of evolution to do this.` with an `OK` button.
  - Our fusion screen has a three-slot equation with `Fuse` plus warnings about "Evolve bonus". The original has neither.
- **Card detail.**
  - A dark name plate top-left, a tribe emblem top-right, and a very large art with a dark frame in the rarity colour.
  - Below it, the rarity label (`Standard`) with 5 pips, and a star with a thin `Level 1` bar.
  - A dark stats strip: sword `200`, heart `100`, drop `3`. The ability text is red or orange below. For the Ultimate card: `Every round, it does 1000 damage to each enemy card.`
  - A magnifier button.
  - Ours adds a "$" sell button and a footer ("Sells for 100 / Main Quest"). I did not see either in the original frames.
  - For a card piece (JdrKM_3lmbQ @ 1:56), the card art is covered in puzzle-piece outlines and the buy button reads `625` / `825` with a gem icon.

### 1.7 Level-up dialog (high confidence)

Frames: `levelup-1_v130`. Sources: Svgtj4sYZRk @ 0:24-0:33; J25GbjkYMbg @ 4:20.

- A white flash with a `Level Up` ribbon, then a dark dialog.
- Title `Level up!`, subtitle `Reached level 3`.
- Left column `Rewards`: an icon plus gold. The following are lifted from the frames:
  - Level 2: blue crystal cluster + `100` gold.
  - Level 3: orange potion + `150` gold.
  - Level 5: blue potion + `250` gold.
  - Level 6: bronze round token + `300` gold.
- Right column `Points: 12/12` with three rows: green heart `1620`, orange gem `54`, blue drop `54`. Each has `-` and `+` square buttons. The number rises as you spend: HP goes `1620 -> 1680 -> 1770 -> 1800` in +30 steps, and stamina and mana go up by 1.
- A `Proceed` button.
- Our stat points live only on the Character screen. There is no post-battle level-up modal in our screenshots, and ours has no reward icons per level.

### 1.8 Collections (set pages), shop and league (high confidence)

Frames: `collection-1_v174`, `card-detail-2_ultimate_v174`, `shop-1_v174`, `league-1_2016`, `league-2_list_2016`.

**Set collection.**
- A title bar `The Dark Beyond (4/26)` with left and right arrows. The `4/26` is the set index. There are **26 sets** in 1.7.4; ours show `(1/10)`.
- A thin green progress bar `8/8`.
- A `Reward:` row with text and a gem-pack icon.
- A 4x2 card grid. Owned cards show coloured art in a rarity-coloured frame. Unowned cards show greyscale with a padlock.
- Completing a set plays a golden flash on the newly acquired card and a blue gem shower.
- Set rewards read from the screen:

| set | position | reward |
|---|---|---|
| Dawn of Eternity | 1/26 | 5600 Gems |
| Dungeon Casino | 2/26 | 5000 Gems |
| Dread Empress | 3/26 | 4500 Gems |
| The Dark Beyond | 4/26 | 4600 Gems |

Ours shows `Main Quest (1/10)` with `31,700 Gems`, so a different structure.

**Shop (1.7.4, ZJWEYHQsVWU @ 0:16-0:20).**
- A top banner `Need more Tokens? Visit the Shop!`.
- Large framed banners, each with a `Look inside` button.
  - `LIMITED: SANTA's BOOSTER` / `1 Ultimate + Legendary Cards`.
  - `Neophyte Pack` / `May Contain:` + coloured rarity pips.
  - `Infinite Void` / `Offer ends in 4:19:12:36` with a token icon and a count.
  - `Dark Beyond Cards and other Mages`, `Empyrean`.
- 8EaxSJt_wjc @ 1:12: `Neophyte Pack`, `DRAGON STALKER`, `May Contain` + `9:13:06:30`, `DRAGONS and DRAGON HUNT Cards`.
- These are packs with countdowns and token prices (a `▲` icon and count), not our "Boosters / Portal" lists with percentages. Ours also has a "Today: Card-piece Day" banner not seen here.

**Early 2014 shop** (3KjCivc4gxw @ 4:55-5:05) is a **gem-purchase** screen with prices in Turkish lira.

| pack | gems | price |
|---|---|---|
| Apprentice's Bundle | 500 | TL13,46 |
| Wanderer's Purse | 1 000 | TL26,95 |
| Hero's Wallet | 3 500 + 5 potions | TL65,91 |
| Evoker's Treasure | 10,000 + Heroic card + 10 potions | TL134,85 |
| Master's Vault | 20 000 + Legendary card + 20 potions | TL269,73 |

The "best value" ribbon says `save TL269`.

**League.**
- A join dialog with an orange plate `BRONZE LEAGUE`, `Congratulations! Bronze League completed`, `Your rank: 32`, `Enter the next league:` / `Bronze League` / `[Join League]` (8EaxSJt_wjc @ ~0:09).
- League list: header `Bronze League` in orange, timer `0:23:45:10`. Rows:
  - rank number (`11` or `-`);
  - avatar (a `?` face if none);
  - name;
  - a red coin with points (`300`), and a blue drop with `x2`;
  - a crossed-swords attack button.
  - The row of the current player has a gold outline.
- Our league (`20-league.png`) uses an orange 1:1 title and a different row layout, with a card-piece banner on top.

**Arena** (3KjCivc4gxw @ 1:05-1:12; 3KjCivc4gxw @ 4:12).
- Tabs `Arena | Pieces | Replays`.
- Rows have a green, yellow or red tint with:
  - a face art;
  - the name;
  - `★ 2`, a red heart `1740`, a blue drop `50`;
  - an orange `i` button and a blue crossed-swords button.
- There is no EASY / NORMAL / HARD chip and no "Opponents / New opponents: 10" footer (ours).
- Tapping the swords shows a `Matching enemy...` bar with a spinning pentagram.
- Tapping `i` opens an info card with name, star level, heart, drop and a gold or coin stat.
- Replays: `Won  08.03.2014 22:58:27` plus an eye button.
- The pieces slots are labelled `EMPTY` with grey puzzle-icon buttons below.

### 1.9 Quest (minion) screen (medium-high confidence)

Frames: `quest-1_ios2014`, `quest-map-1_v174`, `quest-map-2_portal_v174`. Sources: J25GbjkYMbg @ 0:03-0:30; Svgtj4sYZRk @ 0:05-0:30.

Differences against our `04-quest.png`:
- Original: percent progress bar `43%` / `100%` under the HUD (purple on a dark track); **no "Wave 1 / 2 - 3 minions left" caption and no "3 per minion" badge**.
- The painted landscape is full-bleed with small minion sprites standing in it.
- A tray of five mini portraits sits just above the nav (your deck minions plus the current enemy portrait).
- Each tap makes a white spark.
- When all minions fall, a golden loot orb bursts into coins, or a glowing card appears.
- `PERFECT` pops up in gold on some taps.
- A small number (e.g. `30`, `20`, `9`, `5`) is drawn near the top-centre while tapping. Its meaning is unknown, perhaps a combo or a drop-timer.
- Tutorial dialogue comes from a red-haired ranger. (In the 2014-03 client it was an old wizard.) It is a dark text panel with yellow text, with her portrait overlapping the panel at left.
- Our quest has an extra speech panel, "daily reward" toast and tips that do not exist in the original.

Portal map frame: the map is a vertical painted world. Nodes are small dark square numbered plates. The current node has a golden rune circle. A bar at the top says `The Dark Beyond` with a countdown at right. There is no "Portal archive" button (ours).

### 1.10 Title screen (medium)

Frame: `title-1_v174`. Source: ZJWEYHQsVWU @ 0:00-0:04.

The 1.7.4 title is the red dragon breathing fire and the hooded Evoker with a glowing hand. A dark band `Please wait...` sits across the middle with a spinning white pentagram. The `EVOKER` logo is at the bottom, with the version `1.7.4` in small grey text at the lower right. No "Tap to continue" prompt appears in the video. The title auto-advances when loading ends. Ours waits for a tap and has no pentagram band. The earliest era shows a `FLARE GAMES` splash first (3KjCivc4gxw @ 0:00-0:10).

### 1.11 HUD (medium)

- 1.7.4 HUD: a `?` button at left only. No back arrow on the main tabs. Our HUD has back `<` plus `?`.
- Gold and gems share a right-hand plate: gold on top, gems below, with a green `+` at the right edge. This matches ours.
- Level plate: `Lvl. ★ 79`, an orange stamina line `4  560/560`, a blue mana line `0  207/230`.
- Early iOS J25GbjkYMbg still shows a back arrow plus `?`.

### 1.12 Other small items

- **Stamina potion dialog** (wfk_KRqPbYU @ 2:20): header `Drink potion`; text `Your Stamina is too low. Would you like to use one of your Stamina potions?`; `3 potions` counter; button `Use potion now`; a small X at the corner. Ours has a similar dialog.
- **Card slot unlocked** (J25GbjkYMbg @ 2:24): dialog `Card Slot Unlocked!`, a golden padlock, `Your deck can now hold 3 cards.`, `OK`. (Later localisation: "Открыта ячейка для карты! / Возможное количество карт в вашей колоде: 4.")
- **Card capacity** `Your cards 4/40` in 2014; `15/80` in 2016; `81/100` in 1.7.4. The cap rose over time. Ours shows `8/80`.
- **Loading overlay.** The pentagram + `Loading...` / `Matching enemy...` / `Please wait...` overlay appears on every server call: Attack, arena match, fusion. Not present in ours.
- **Level-up of a piece card.** `You have collected enough pieces.` / `[Assemble card now]` (3KjCivc4gxw @ 2:50).

---

## 2. Verbatim strings gathered (new text not necessarily in our client dump)

Tutorial lines (the ranger or the Worm Shaman). They are verbatim from J25GbjkYMbg, Svgtj4sYZRk and LnNVvKaTe-M.

Ranger (J25GbjkYMbg @ 0:01-6:30, Svgtj4sYZRk @ 0:00-4:20):
- `The Shaman's orcs are in our way! Smite them!`
- `Puny minions are no threat to you, Evoker.`
- `One had a soul card! It will help fight our foe.`
- `Ha! His Throat-Cutter is fatally wounded!`
- `The Shaman has fled! He dropped a soul card.`
- `But he's taking your Envoy with him, Evoker.`
- `I think he went this way! After him!`
- `Your Throat-Cutter is stronger than the Envoy.`
- `You'll beat the Shaman's Bone Breaker now!`
- `Fuse identical cards to increase their power.`
- `Now drag the other card onto the second slot.`
- `We need to fuse a card to take him on!`
- `Looks deadly... arrange your cards with care.`
- `Perhaps my healing magic can save him.`

Worm Shaman (red hood, bottom-left of the screen during battle):
- `Your next victory will not come so easily, Evoker.`
- `Not bad, but I'm just getting warmed up.`
- `No! My precious Flinger! Curse you, Evoker!`
- `No more running. This time I will either crush you or die trying!`
- `Bah! You won't win with your cards in that order!`

Early-2014 wizard (n0oc3BDjWHk, osu4RhMVm3s):
- `Welcome to the world of magic. Your first lesson will involve killing some orcs.`
- `Nice kill!`
- `You conjured your first creature. Good work! Creatures will fight for you.`
- `Travel to the next region by tapping on it.`
- `We need the second piece of the Club Swinger. Let's take it from another conjurer.`
- `Tap the highlighted battle button to challenge other players for a Club Swinger piece!`
- `Exchange the weakest card with your new Club Swinger.`
- `This is much better! Now give it an experience boost by sacrificing one of your weaker cards.`

Other strings: `Card added to set:` + set name, `Card Slot Unlocked!`, `Reached level N`, `Points: 12/12`, `Proceed`, `Continue`, `TRIBE BONUS`, `Skip fight`, `Showdown!`, `Boss Fight N`, `Loading...`, `Matching enemy...`, `Please wait...`, `Do you want to open a new booster?`, `Need more Tokens? Visit the Shop!`, `Look inside`, `May Contain:`.

Early tutorial first-session HUD values (J25GbjkYMbg): start `Lvl 1`, stamina `46/50` then falling, mana `50/50`, gold `200`, gems `0`. Gold climbs by minion drops (212 -> 230 -> 324 ... in about 70 s).

Tutorial boss / card order: Quest 1 boss `Throat-Cutter`; Quest 2 `Bone Breaker`; Quest 3 `Lurking Goblin`; Quest 4 `Flinger`; Quest 5 `Showdown! Worm Shaman` (fought three times with HP `800`, `960` after tribe bonus). Cards rewarded: `Orc Grunt` (set 2/8), `Dwarven Apprentice`, `Elven Novice` (`2/8`), `Falconer` (Standard, 200 atk, 200 hp, 4 mana).

---

## 3. What I looked for but could not find

- Character, Help and Settings screens are not shown in any of these videos. **No frames, no comparison.** Our `22/23/24/25` are unverified.
- Daily-reward claim popup. Only the strip on the hub is visible.
- The Replays tab content beyond a single early-2014 row.
- The "Pieces" tab with a populated slot (only `EMPTY` slots and a `+` appear).
- Quest "Drink potion" dialog beyond the one in wfk_KRqPbYU @ 2:20.
- The meaning of the small number shown at the top while tapping minions.
- Sound cues (audio not analysed).

## 4. Frame index

`frames/screens/`: `title-1_v174`, `quest-hub-1_v174`, `quest-map-1_v174`, `quest-map-2_portal_v174`, `quest-1_ios2014`, `boss-intro-1_v130`, `boss-intro-2_ios2014`, `boss-intro-3_2016`, `showdown-1_2015`, `prebattle-1_v130`, `battle-0_tribebonus_v130`, `battle-1_v130`, `battle-2_v130`, `battle-3_hpbar_dmg_v130`, `battle-4_abilities_2016`, `arena-battle-1_2016`, `arena-battle-2_2016`, `arena-battle-3_2016`, `result-1_victory_v130`, `result-2_card_levels_ios2014`, `defeat-1_2015`, `levelup-1_v130`, `fusion-1_v130`, `fusion-2_v130`, `training-1_2015`, `card-detail-1_ios2014`, `card-detail-2_ultimate_v174`, `pieces-detail_2016`, `collection-1_v174`, `shop-1_v174`, `league-1_2016`, `league-2_list_2016`, `arena-1_early2014`, `potion-dialog_2015`, `booster-1_chest_v174`, `booster-2_grid_v174`, `booster-3_reveal_v174`, `booster-4_gem_cost_v174`.
