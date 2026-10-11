# Gameplay feel: original vs our build (round 3, topic `gameplay-feel`)

Sources: reOM4K1bZRg (darklichgaming, 1280x720 screen recording of the phone in a ~404 px column, 30 fps, a webcam bubble covers the lower-left corner) and 8EaxSJt_wjc (Rob Hucker, 360x614, 22 fps; YouTube has nothing above 360p).
Both were stepped through at 8-15 fps in short segments. Frames are in `frames/gameplay-feel/` (names carry video id and second). Ours: `node tools/serve.js 8095` + CDP screencast at ~24 fps (new game, `debug.*`, quest 5, boss, battle).
Timings are read from 8 fps tiles, so +-0.1 s.

Overall: our battle player is already a close port (wind-up flash, small bolt flying straight, impact flash, red number, red strip on the HP bar, Defeat banner). The big feel differences are in the quest-tap flow, card drops, the Defeat HP count-down, the shield/ring look and the screen transitions.

## A. Differences, sorted by effect on feel

### 1. Card drop on a quest: glowing card on the scene, not a modal (high confidence)
- Original (reOM @ 0:28-0:31 and 1:28-1:45; frames `orig-tap-carddrop_reOM_0028`, `orig-carddrop-glint_reOM_0088-0105`): when the last minion of a wave dies, a lens-flare glint appears where it stood (~0.5-1.0 s). Then a white rectangle flashes at screen centre (0.25 s), turns into the card art with a bright glow and a rarity-coloured frame (green here) within ~0.25 s, holds ~1.0 s with no button, then shrinks and flies down into the minideck bar (~0.25 s). The next wave fades in straight after (dark silhouettes first, ~0.9 s). Total about 2.5 s, nothing to tap. The progress bar jumps with it (18 % -> 24 %).
- Ours (`ours-new-card-dialog.jpg`): a dark modal "New card / You found Gremlin! / [Great!]" with a red close X; the tapping stops until it is dismissed.
- Change: replace the dialog by a centre overlay: 250 ms white flash -> card (outer glow, frame colour by rarity) -> 1000 ms hold -> 250 ms fly to the minideck slot, non-blocking. Keep the dialog only for the tutorial's first card.

### 2. Defeat: both HP numbers keep counting down into the negative (high confidence; answers the user's question)
- YES, the player HP goes negative. reOM @ 5:51-5:54 (`orig-mass-death-defeat_reOM_0351`, `orig-defeat-negative-hp_reOM_0352`): after the last cards die the bottom HP reads `68 / 4140` (red), then a white starburst and the "Defeat" banner appear and the number runs on in red: `-136`, `-204`, `-272`, `-340`, `-408`, `-544`, `-680`, `-952`, `-1142 / 4140`. It is a fast tick-down of ~1.8 s that accelerates while the banner stamps in. The opponent's number at the top counts the same way (`110`, `223`, `385`, `495`, `715 / 3750`; the minus sign is hard to read at this resolution, it is red and runs in step with the other). The green bar is empty.
- Also reOM @ 5:51.45: all remaining cards of both rows vanish within one frame (50 ms) when the HP crosses zero. No death animation at that moment; they are simply removed.
- Ours (`ours-defeat.jpg`): the number is red and negative too but small and static (`-93 / 1,000`), no count-down; the Defeat banner pops in over a still board and cards stay.
- Change: when the last card of a side dies, tween the HP label from its current value to a final negative value over ~1.8 s (ease-in), red, on both bars; drop remaining cards at the white flash. Observed overshoot is 15-30 % of max HP (-1142 of 4140, -715 of 3750); use the sum of queued damage if the engine has it, else that range.

### 3. Quest tap: slash streak + "PERFECT", minion vanishes instantly, gold arrives as a coin shower (high / medium)
- reOM @ 0:30.8 (`orig-tap-slash_reOM_0031`): on tap an orange X-shaped slash (two crossing streaks + yellow spark burst) appears on the minion at once; the minion is gone at +0.13 s (one dark frame, no fade or ragdoll). "PERFECT" in gold sits above the slash for ~0.9 s; fast taps stack slashes and overlapping labels. A small white number (`24`, later `24 12`) appears at the top right of the scene (flying-money number toward the gold counter). Stamina drops by the quest's cost per tap (4 on quest 59: `228 -> 224`; 6 on quest 60: `240 -> 234`).
- Wave clear (reOM @ 4:46-4:50, `orig-waveclear-coins_reOM_0286`): ~25 gold coins burst out and tumble for ~1.3 s; the HUD gold counts up in 3-4 steps during the shower (8459 -> 8699 -> 8999 -> 9299 -> 9479, +1020), not per tap.
- Ours (`ours-tap_quest5.jpg`): green aim ring + slash + gold "PERFECT" + `+18` with a few coins per tap; no large coin shower with a counting HUD number.
- Change: keep the per-tap number but make it the white flying number; add a wave-end coin shower (20-30 sprites, 1.3 s, gravity) with the HUD gold counting in 3-4 steps over ~1 s; drop the green ring (not seen in the original).

### 4. Card pieces: not seen on taps, seen on the boss reward (medium)
- In ~6 minutes of tapping on quests 59/60 only full cards dropped (about 3 drops over ~4 waves: green frame @ 0:32, gold frame @ 1:28, unicorn with green frame @ 1:45). No puzzle outline on any tap drop.
- A piece appears after a boss victory (reOM @ 1:07-1:11, `orig-boss-piece-drop_reOM_0067`, `orig-victory-loot-flow_reOM_0070`): after the "Victory" plaque (~1.9 s, dissolves) and a ~0.9 s fade to black, the quest backdrop returns, a glint pulses ~1 s, then the card box appears as a dark card with a white puzzle-piece cut-out, glow, hold ~1.5 s; then the full card ("Armorer") fills the screen with the 4-piece puzzle overlay for ~0.5 s. Then it fades to the loot list: rows of `thumb + star + "Level 12 (MAX)"` appearing ~0.4 s apart, a `Continue` button after the last, fade to black, map.
- Frequency: one piece in the three boss rewards of the clip; no tap-drop frequency data.
- Ours: pieces come from the Pieces tab only; no piece drop display after a boss. Suggest the same overlay as the card drop, with the puzzle cut-out, and the full-card overlay of the 4 pieces.

### 5. Invulnerable / shield / ring looks (medium; ability names are not readable on the cards)
- 8Eax @ 1:45-1:55 (`orig-cyan-ring-and-light-pillar_8Eax_0106`): an enemy card carries a cyan bullseye (concentric rings) over its art with a cyan-white glowing frame that stays 5+ s while `-2000` and `-841` hit it. A persistent status icon, not a bubble. I did NOT find a golden glow with sparkles for invulnerable in either video, so the user's description cannot be confirmed or refuted here (gold sparkles appear only when cards shatter).
- Own card with a red "A" glyph and a pulsing red ring (8Eax 1:50-2:15), an attack-buff look. In reOM @ 5:35 (`orig-prefight-strengthen_reOM_0335`) a pre-fight buff shows the word `STRENGTHEN` over the target card with an orange X glyph and red rings, fading in ~1 s.
- Purple skull-and-spark swirl on an enemy card for ~1.5 s with a yellow fire burst on an own card (reOM @ 5:41-5:43, `orig-battle-poison-fire-projectiles_reOM_0341`): curse/poison style.
- Light pillars: vertical white-gold beams from the bottom plus a floor ring, ~1.2 s, with `-841` on every enemy card hit = area damage (8Eax @ 0:23-0:25 and 1:45).
- Ours per the code header: invulnerable_effec_* ring + energy sphere, suppress = blue rings, stun = red streaks. Not verified against these videos. Suggested check: compare with the cyan bullseye frame; if the user insists on gold, use gold frame + rising sparkles.

### 6. Attack animation (matches ours; details to keep)
- 8Eax @ 0:21-0:25 (`orig-pvp-attack-bolt-aoe_8Eax_0021`): the attacker does not move (no lunge). It gets a white-gold glow for ~0.4 s, a small yellow comet-shaped bolt (~25 px) flies straight to the target in ~0.35-0.5 s, impact = white/orange flash with a flat ring and sparks, red number centred on the target ~0.1 s after impact, pops, holds ~0.5 s, fades. About 1.0-1.5 s between attackers.
- reOM @ 5:44-5:47 (`orig-battle-numbers-projectiles_reOM_0344`): projectiles are coloured per tribe (orange fireball, blue arc, yellow flame trail) and travel diagonally between rows. The top HP number steps down at each hit (3750 -> 3570 -> 3510 -> 3450 -> 3390 -> 3330 -> 3210 -> 3090 ...), not smoothly.
- Ours (`ours-battle-attack.jpg`): same sequence including the red glowing strip with `-119` on the player HP bar. In reOM I never saw that strip; it appears once in 8Eax @ 0:42 (`-234`) with a light beam, so keep it only for direct hits on the player.
- Layout: ours has the two rows ~200 px apart with a lot of empty landscape; in the original the rows are 70-110 px apart (720p frame) and the name bars hug the rows. Ours adds a "1x" speed button next to "Skip fight"; the original has only "Skip fight" bottom-left.

### 7. Battle intro (matches, one thing to check)
- reOM @ 5:28-5:31 (`orig-boss-card-flies-in_reOM_0328`): the boss card from the boss intro shrinks and flies into its slot of the enemy row on the pre-battle screen (~0.35 s, with a blue lightning trail); the red "Attack!" bar scales out from the middle (~0.4 s) and the button pops in at +0.25-0.5 s. Check that ours animates the boss card into the slot.
- `ROUND 1` fades in top right ~2.6 s after Attack!; pre-fight abilities (buffs, curses) run before the first attack.

### 8. Screen transitions (medium)
- reOM @ 2:40-3:10 (`orig-screen-transitions-tunnel_reOM_0160`): leaving a screen = ~0.7 s fade to black; heavy screens (League, Deck) show a blurred dark-brown corridor backdrop for 3-4 s while loading, then fade in ~0.5 s. Tab screens (Deck/Training) cross-fade in ~0.3 s. After a fight: board dissolves into the loot list 0.7 s, fade to black 0.7 s, map fades in.
- Ours has its own router transitions; suggest ~0.6 s black fades for quest -> boss intro -> battle -> map. The tunnel is only a loading mask, skip it.

### 9. Map (low / medium)
- Original portal map (reOM @ 1:16 and 2:55, "The Dark Beyond" with a countdown `16:49:08` in the title bar): the current node is a big golden pentagram ring with the number, finished nodes are small grey rounded badges (`59`), later nodes are dots on the path; the map is centred on the current node. No overlapping nodes.
- Ours (`ours-map-32.jpg`, main map with 60 quests unlocked): all nodes are identical blue squares with a gold star. In the DOM no two nodes are closer than 70 px (32 at (1323,876), 33 at (1459,701): 221 px apart), so I could not reproduce overlapping 32/33 in the current build at 720x1280. If the user sees it, it is probably a narrower viewport or the scroll clipping (nodes at the left edge are cut off in the screenshot).
- Suggest: current = pentagram ring, done = grey badge, locked = dot; scroll so the current node sits at ~40 % height.

## B. New hard facts / numbers
- Tap stamina cost: quest 59 = 4 per tap, quest 60 = 6 per tap (player level 30, 246 stamina max, 114 mana max, 130 gems).
- Boss fight 60 "Battle Boar": enemy HP 3750 (player "Morden"-named opponent), player HP 4140; deck mana 66/114.
- Arena fight: "king jaheim" 3030 HP vs 4140; same ~1.5 s attacker cadence.
- Coin shower paid +1020 gold at once; per-tap flying number `24` on quests 59/60.
- Victory plaque ~1.9 s; Defeat: white star flash ~0.15 s, banner grows and drips ~1.5 s, holds, fades ~1.5 s.
- Level-up dialog (8Eax @ 1:30): `Level up! / Reached level 6 / Points: 12/12`, HP 2460, Attack 50, Mana 66 -> 78 by points, reward 300 gold, `Proceed`.

## C. Not found / could not verify
- Golden-glow-with-sparkles invulnerable: not visible in either video (only the cyan bullseye).
- Heal numbers, suppress and stun looks were not identified; ability names on cards are unreadable at 360p.
- Piece drop frequency on taps: none seen.
- Whether the negative HP is a client tween or the server's overshoot; either way the displayed values are negative.
- reOM's webcam circle hides the first enemy slot in every battle frame.
