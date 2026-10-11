# Round 4: gameplay videos of the Halloween 2016 cards

Method: about 55 YouTube videos from 2016-11 to 2018-08 (Evoker Br, fukfukara, Marcus The Prince, Retro4ever, Bao Nguyen and others) were downloaded at 360-480p
and scanned with OpenCV multi-scale template matching against the card art in assets/cards (Dark Mage, Army of Ghosts, Bone Dragon, Siamese Orc, Raptorial Fungus).
Hits were checked by eye. Videos were deleted afterwards. Frames: `exploration/research/round4/frames/videos-halloween/`.
Note: YouTube started blocking yt-dlp ("confirm you are not a bot") late in the session, so a few videos could not be fetched (listed at the end).

## Bone Dragon (best result)
**Revive mechanic seen in a real fight, with numbers. Confidence: high.**
- Video: https://www.youtube.com/watch?v=Z0xxEbOBDKs ("EvokerBr - Dragon Hunt", uploaded 2018-02-06, Portuguese client, Evoker Br's own account).
- Card detail screen at about 6:20 (380 s): Bone Dragon, Ultimate, Level 5/15: attack 100, HP 550, mana 30. In-game text (pt): "Ao morrer pela primeira vez, o Dragao de Ossos ressuscita com ataques aprimorados" (= "The first time it dies, Bone Dragon resurrects with improved attacks"). Frame: `bonedragon_detail_L5_Z0xxEbOBDKs_0380s.png`.
- In the fight (Dragon Hunt vs "Grimnack", 8:38-9:20) the card shows a 4th stat badge "3116" (ability value; wiki L1 = 3100, so +4 per level gives 3116 at L5).
  - Before death (527 s, `bonedragon_before_zoom_0527s.png`): attack 100, HP 550, badge 3116.
  - Killed in round 1 (534 s, `bonedragon_dead_zoom_0534s.png`): HP displayed as **-4318** (overkill shown as negative HP).
  - Revive (545-551 s, `bonedragon_revive_sequence_0545-0551s.png`, full frame `bonedragon_fight_Z0xxEbOBDKs_0545s_full.png`): a skull animation plays, the HP number counts up from -4318 (-3460, -2602, -1744, -888 ...) to **550 (base HP at that level, i.e. full heal)**, and attack becomes **3216 = 100 base + 3116 ability value**.
  - Conclusion: revive HP = full base HP; attack after revive = base attack + ability value. Happens in the same round (round 1 in this video).
  - A second fight in the same video (vs "Doza", about 10:05-11:05) shows the dragon dying again later and not coming back, consistent with "the first time".

## Siamese Orc (confidence: high for a flat value)
- Video: https://www.youtube.com/watch?v=4v5C3dKr8N4 (Marcus The Prince, "Evoker Episode 2 - Free Legendary!!", uploaded 2016-12-24, English client), detail screen at about 9:02 (542 s).
- Frame `siameseorc_detail_L3_4v5C3dKr8N4_0542s.png`: Siamese Orc, Legendary, Level 3/14: attack 1650, HP 2302, mana 25, text: **"Increases the damage done by his neighbors by 850 in the first round."**
  So the bonus is a flat number (850 at L3), first round only, for "his neighbors" (plural).
- Also visible as art only in booster openings: https://www.youtube.com/watch?v=r6cMPhmdRyE, https://www.youtube.com/watch?v=Q-fyeJuiWWw (about 2:26). No numbers there.
- No fight footage of Siamese Orc found.

## Dark Mage (top priority, only partial: no fight found)
- Card-list screens, Evoker Br (owns two copies): https://www.youtube.com/watch?v=7BxPEkmoD84 ("Dica para roubar pedaco de carta", upload date not retrievable, March 2018 by channel order) at 3:00 and 4:03, and https://www.youtube.com/watch?v=-xw0xifj2vE (Dread Empress resumo, 2018-03-08) at 4:27-4:29.
  Frames `darkmage_L1_L4_cardlist_7BxPEkmoD84_0243s_zoom.png`, `darkmage_cardlist_7BxPEkmoD84_0243s_full.png`, `darkmage_L1_and_unknown490_xw0xifj2vE_0269s_zoom.png`.
  - Dark Mage L1/15: attack **1500**, HP **2000**, mana 30, ability badge **15%**.
  - Dark Mage L4/15: attack about 1700 (blurry), HP **2087**, badge **15%** (the percentage did not change from L1 to L4).
  - These are base values in the card list, not a fight.
- **No fight with Dark Mage found** in any of the videos (real template hits only at card-list screens). The own-attack question and before/after round-1 numbers remain open. Confidence that Dark Mage is absent from fights in these videos: medium (small thumbnails in 240-360p videos could be missed).
- Side find in the same frame: an unknown Ultimate (red frame, mana 30, L1/15, attack 1800, HP 1800, ability badge "490", art of a hooded red-robed mummy/skeleton figure in front of a stone pillar). Not one of the 8 Halloween cards; probably from a later set (Dungeon Casino or Holiday 2017). Worth identifying.

## Cursed Stag, Werewolf Dwarf, Tomb Colossus, Army of Ghosts, Raptorial Fungus
- No footage found. (Assets for Cursed Stag, Werewolf Dwarf and Tomb Colossus are only 100x100 crops, so template matching was not possible for them; weak Raptorial Fungus hits at 0.77 in https://www.youtube.com/watch?v=X1dZBH_UyD4 at 0:03-0:07 looked like false positives.)
- Analogues of older cards with the same mechanic wording, seen in the same videos:
  - Grimnack+++ (Legendary, L41, 6245/6246, mana 23): "A carta adversaria nao causa dano na primeira rodada" ("The opposite card does not cause damage in the first round"). Frame `grimnack_detail_Z0xxEbOBDKs_0464s.png` (https://www.youtube.com/watch?v=Z0xxEbOBDKs at 7:44). Same mechanic family as Cursed Stag, so "opposite" = the card directly across.
  - Harpy (Rare, L1, 720/720, mana 14): "Nao recebe dano em rodadas de numero par" ("Takes no damage in even-numbered rounds"), https://www.youtube.com/watch?v=RSHOt0g6T6o at about 0:30 (Evoker Br, Divine Peace, 2018-02-12). Same mechanic as Werewolf Dwarf's "indestructible in even rounds": suggests the original effect is "takes no damage".
- "EvokerBr - Divine Peace (Colossus vs Army of Ghosts)" (RSHOt0g6T6o) is about Divine Peace-set cards (tripod "Colossus", Lava Toad, Flameling, Minotaur, Harpy); no Army of Ghosts art matched.

## Searched, nothing found
- YouTube searches (ytsearch25): evoker dark mage / halloween 2016 / bone dragon / cursed stag / werewolf dwarf / army of ghosts / siamese orc / tomb colossus / raptorial fungus / magic card game 2017 / 2018 / flaregames 2017 / dungeon casino / kartenspiel / mago oscuro / mago sombrio / halloween event / holiday event 2017 / jogo de cartas halloween / juego de cartas halloween / flaregames evoker / fusion ultimate / Turkish, Russian, Japanese variants. Results are flooded by WoW, Minecraft and Hearthstone Evoker.
- Channels listed: fukfukara (18 Turkish "Random PvP" clips, Feb-Mar 2018, high-level decks, no Halloween cards identified), Evoker Br (31 uploads).
- Downloaded and scanned: almost all Evoker Br uploads, Marcus The Prince ep. 1 and 2, Retro4ever, Bao Nguyen x3, Tekno Valiz, Super Animacao, Vamos saber jogar, Halison costa, Katsin TV, Henry LocXipo (Dec 2016), Zephaniah Sigur, Marcio Falcao, FloW Evoker pack opening, j networks, guigui jjg, all fukfukara clips.
- Not downloaded (YouTube bot block): https://www.youtube.com/watch?v=dQcnOrf1BFI (Dying Dreams resumo, 7:48), HmEvbJ3gU4w (unrelated figure review), and a few others. Ff-jbLef40M ("Testando a Colossus", 12:32), TCvUZk_3hQ4 (Dark Beyond), X1dZBH_UyD4 (70 random battles, Apr 2017) were scanned but not watched fully by eye; a manual pass could still find Dark Mage fights.
- No Dailymotion or Vimeo checks done.
