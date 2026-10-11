# Round 4 – wiki deep dive (comments, history, images, discussions, Wayback)

Source: evoker.fandom.com via `api.php` (HTML pages return 403 to curl, the API works with a browser User-Agent).
Raw data was kept in the scratchpad, not in the project. Evidence images: `exploration/research/round4/frames/wiki/`.

Key technical facts:
- Article comments are stored as pages in the Talk namespace (`Talk:<Page>/@comment-<user>-<yyyymmddhhmmss>`),
  forum posts as `Board Thread:` / `Thread:` pages. `allpages` over all namespaces gives 1896 pages, 635 of them comments.
  I pulled all of them (also via the Discussions API: 200 posts, last 2019-01-26). The comment API (`ArticleCommentsController`)
  only returns the Dark Mage comment as well.
- Page history exists for all pages (revisions fetched with content). Wayback has almost nothing (see bottom).

## Headline findings

1. **Two official in-game card screenshots with ability text exist on the wiki** (hi-res uploads). These are the only
   first-hand "official text" found, and they pin down two open questions:
   - **Siamese Orc+ (L24/24): "Increases the damage done by his neighbors by 1778 in the first round."**, attack 2698, HP 4249, mana 25.
     So the value is a **flat number added to the neighbours' damage, round 1 only**; ability value by level (wiki table): L1 800, L14 1178,
     L24 1778, L34 2604, L54 5183. Card art shows blue left/right arrows (ability targets = both neighbours) and two red diagonal arrows (own attack).
     Confidence: high. File `siamese_orc_plus_L24_official_text.png`
     (source: https://static.wikia.nocookie.net/evoker/images/b/b7/Siameseorclv24max.png/revision/latest?cb=20180317042952,
     uploaded by user ASSTOUNDING 2018-03-17, English client).
   - **Raptorial Fungus (L1/14): "Does 1500 damage to the opposing player each round."**, attack 0, HP 1700, mana 23, red "direct" arrow on art.
     Flat damage each round to the opposing *player* (not card). Table: L1 1500, L14 2459, L24 3903, L34 5915, L44 8617, L54 12219.
     Confidence: high for text; "stops when dead / reflected" still unknown.
     File `raptorial_fungus_L1_official_text.png` (https://static.wikia.nocookie.net/evoker/images/e/ea/Raptorialfungusunevolvedsplash.png/revision/latest?cb=20180321182023, ASSTOUNDING 2018-03-21).
2. **French in-game text of three more cards** (Gothar31 and Mephistt screenshots, French client):
   - Werewolf Dwarf L9/14: "**Ne subit aucun dégât lors des rounds pairs.**" = "Takes no damage in even rounds." Wording is "takes no damage",
     not "cannot die" -> damage is nullified in rounds 2, 4, ...; confidence high. File `werewolf_dwarf_L9_french_text.png`
     (https://evoker.fandom.com/wiki/File:Wp_ss_20170416_0002.png, user Mephistt, 2017-04-18; attack 1869, HP 2039 at level 9, mana 22).
   - Cursed Stag++ (L24): "**La carte opposée n'inflige aucun dégât pendant 2 rounds.**" = "The opposite card does not inflict damage for 2 rounds."
     attack 400, HP 7499, mana 25. Rounds not specified ("pendant 2 rounds" = for 2 rounds, almost certainly the first two). File `cursed_stag_pp_french_text.png`
     (https://evoker.fandom.com/wiki/File:IMG_1875.PNG, Gothar31 2017-11-30). The same French sentence is the caption in the first revision of the page
     (rev 9090, 2017-11-25). Confidence: high for text, none for which rounds.
   - Tomb Colossus L1/14: attack 2100, HP 2700, mana 24, and **the ability panel is empty** (other cards, e.g. Arch Angel in
     https://evoker.fandom.com/wiki/File:16326950_1240224896015454_317968915_o.jpg, show an orange ability line at the same place). So **Tomb Colossus has no ability** – confidence high.
     File `tomb_colossus_L1_no_ability_text.png` (https://evoker.fandom.com/wiki/File:IMG_1808.PNG, Gothar31, 2017-10-25; also shows French "Niveau 1 / 14").
   - Side finding from these screenshots: the small hexagon icon top right is the **tribe icon**, not the attack direction (Dwarf = green diamond on
     Werewolf Dwarf / Wizard Apprentice, Orc = red axe, Elf = three blue arrows on Dark Mage, Neutral = flame). Red arrows on the art = attack directions,
     blue arrows = targets of the ability. Dark Mage art has only the red up arrow (Direct); Siamese Orc has red diagonals; Wizard Apprentice art:
     see `wizard_apprentice_plus_icon.png` (the wiki's "Left/Front/Right" for Wizard Apprentice is Gothar31's own reading, I could not see arrows on the art; no arrows visible in the three screenshots I looked at).
3. **A whole list of unknown post-2016 cards** with ability text and ++++ stats sits in the history of a page that was later blanked:
   `Cards in portal Neutral Monster` (Longevity, 2017-09-05, rev 8978, blanked to "None" on 2017-09-17, rev 8999). See "Unknown cards" below.
   The earlier revision of `New Card Halloween Event` also lists two more cards (Soul Chaos, Creator of Time) that were removed.
4. Army of Ghosts: the per-fusion text (+ no damage round 3, ++ round 2, +++ rounds 2 and 3, ++++ no damage after round 1) is already in the dump
   (it was first written 2017-02-08 by anonymous IP 62.4.65.26 in rev 8578, category Indestructible/Evolving Ability; the Italian "Abilità speciali" heading only replaced the English one on 2017-08-04). Nothing newer or more precise exists in history.

## Per card

### Dark Mage
- Comment (https://evoker.fandom.com/wiki/Talk:Dark_Mage/@comment-196.22.212.210-20170828062432), anonymous IP 196.22.212.210, 2017-08-28 06:24 UTC, verbatim:
  "I have come up against this card a few times, and it would seem that it it deals more damage each round much like Thief of Time...Not the only card the developers have dropped the ball on."
  Only comment on the page; no test numbers. Note this is a PvP observation of an *opponent's* Dark Mage (a direct attacker whose own attack is not reduced would not do "more each round" unless buffed by something else) – weak evidence, low confidence.
- Q&A board, anon 88.102.71.106, 2017-03-12 06:27 UTC (https://evoker.fandom.com/wiki/Board_Thread:Questions_and_Answers/@comment-176.253.27.115-20170308105707/@comment-88.102.71.106-20170312062723),
  verbatim: "Hi, you can find dark mage in Dying dreams. Ability: the attack power of all cards with special abilities is reduced by 15-19% in the firs round. I have +++ dark mage: 12000 attack, 7300 toughness and its an elf card."
  (the question, anon 176.253.27.115 2017-03-08: "i saw somethinf in a duel somebody had the ultimate card dark mage, and i cannot find this card in th deck illustrator"). Confidence medium for stats (wiki +++ table says 13988/7946 at L51; 12000/7300 would be a lower level). Shows card appeared in duels by March 2017 and is a Dying Dreams portal card.
- History: first text (WrathOfTheUltimateHADES 2017-04-08, rev 8655): "Weakens all cards with abilities by____ for the first round". Rev 8714 (Longevity 2017-04-22) rewrote it to the current text.
  Stats (Simplicissi 2017-04-20): L1 1500/2000 ability 15%; L15 2892/2464 15%; L27 5333/3728 16%; L39 8903/5498 17%; L51 13988/7946 18%; L63 21091/11264 19% (the 20% in the infobox table of New Card Halloween Event is a rounding/earlier value; the table at the L63 row says 19%, the Halloween page 20%). No revision says whether Dark Mage affects itself or own cards.
- **Medusa page** (Maja79, 2017-04-28, https://evoker.fandom.com/wiki/Medusa, rev 8739), already in dump: "(By the same consequent rule combination with single Dark Mage reduce attack by 82% and with two by 85,8%)". Unexplained numbers: Medusa L45 (50%) × Dark Mage 20% multiplicatively would give 60%, not 82%. Treat as unreliable/unexplained; low confidence. The Medusa page also says Medusa's own ability applies to itself and triggers after all strengthening effects – this is the closest documented precedent for Dark Mage ("applies to itself" and "after all strengthening"). Medusa is a documented pre-2016 card, so these Medusa rules are from the 2015–2016 era.
- Images 1.png, 2.png, 3.png, 4.png, 5.png, 2-3.png (Alex2076, Italian client, "Livello 1 / 27/27"): only card art of Dark Mage, + , ++++ with level text, no ability panel, no fight. Nothing useful beyond the Italian UI. Not saved.

### Tomb Colossus
- No ability (see headline 2). Page history: Gothar31, created 2017-12-01; infobox first says "attack = 1 Direction (Front)", portal "The Dark Beyond". Stats L1 2100/2700, L14 3207/3069, L24 4928/3943, L34 7296/5077, L44 10483/6535, L54 14658/8401. Earlier (2017-04-08) WrathOfTheUltimateHADES (https://evoker.fandom.com/wiki/Talk:Bone_dragon, 2017-04-08 09:50) wrote: "Tomb Collosus is some kind of a chimera card no abillities good stats." Confidence high.

### Siamese Orc
- Official text, flat value, round 1 (headline 1). History: first version (HADES 2017-04-08) "strengthens both neighbours for ___ damage in the first round"; ASSTOUNDING 2018-03-15 changed it to the in-game wording after seeing the card. Left/right neighbours = both (blue arrows left and right).
- Comments: anon 190.3.24.65, 2018-05-23: "A good card to place in font of Bloodsoaken Totem, surrounded by two Tundugars or Scorpions" (neighbour buff used on direct-damage neighbours). anon 2604:2000:51C2:2000:4565:6C99:FAD7:F465, 2018-03-07: "Anyone else think this card really sucks for a legendary or at least needs a buff?" then "on second thought, i made a couple cute comps with it". No numbers.
- Images Siameseorc+splash.png / Siameseorc++splash.png / splash.png (ASSTOUNDING) – same type of full screenshot; I only inspected the L24 one. The ++ one gives ability 2604, + 1778 (table).

### Army of Ghosts
- See headline 4. Comment/message wall: anon 2804:18:5801:EEE2:84F5:1F81:12FB:31DB edited the page 2017-08-08 (stats). Board thread "haloween cards" (anon 62.4.65.26 2016-11-30 "When will they available here?"; reply 2017-02-13 "I try to edit the new haloween cards but i am not able to integrate it in the card table. Anyone help me? Army of Ghosts created."; reply 2017-03-30 "Hi i start to edit the new cards from the hallowen event. But I have not the permission to ... http://evoker.wikia.com/wiki/Army_of_Ghosts"). The same IP created the page with the 4 fusion lines, so a French-speaking(?) player observed or read them from the card in-game; reliability: first-hand, medium-high.
- Portal: infobox (Alex2076, 2017-10-30): "Dawn of Eternity and Dungeon Casinò" – Army of Ghosts was also in the Dungeon Casino portal.
- Stats L1 2200/1500, L14 2881/2181, L24 4076/3271, L34 5688/4763, L44 7830/6766, L54 10640/9416. Earlier unrelated draft numbers (attack14 3200/life 1980) were placeholders.
- Italian screenshots 2-1.png, 3-0.png, 4-0.png, 5-0.png (Alex2076 2017-08-04) are the +, ++, +++, ++++ card faces with art only (no ability panel).

### Raptorial Fungus
- Official text (headline 1). Comment thread 2017-06-30/07-02 (anons 197.87.171.226, 197.89.220.237, 197.87.171.48): "Has this card been removed?" / "no, you will find it when "Desert Twilight portal" come back" / "yes, this is a special card (halloween). don't worry you can get it as other legendary card in "Desert Twilight"" -> the card was only in Desert Twilight and in the Sept 2017 "Neutral Monster" portal list (see below). Nothing on blocking/death.
- Player decks: https://evoker.fandom.com/wiki/Board_Thread:Questions_and_Answers/@comment-27716181-20160417201934 : WrathOfTheUltimateHADES 2017-04-07: "i am now tying a deck with voodoo witch+++ Raptorial fungus ++++ loremaster ++++ raptorial fungus ++++ voodoo witch++++ it works fine but i must try further"; anon 91.213.10.2 2017-04-11: "funguses are very offensive for direct damage and usually do not survive 1st round" (they die in round 1 against direct attackers, i.e. the damage they do before dying is what counts; says nothing of numbers); anon 190.3.24.65 2018-05-03: "voodoo witch+++ Raptorial fungus ++++ loremaster ++++ raptorial fungus ++++ voodoo witch++++" beats a direct deck, "I use to lose against the Moon Dragon or Astral Navigator when I fall to guess their position" (Moon Dragon + fungus combination troubles). Medium confidence, tangential.

### Werewolf Dwarf
- Official French text (headline 2). History: first text "is invincible in the even numbered rounds" (HADES 2017-04-08) -> corrected to "indestructible" within minutes. Table (Halloween page): "Receives no damage in even-numbered rounds." Stats L1 1600/1500, L14 2066/2434, L24 2841/3727, L54 7451/11932. Mana 23 -> 22 (corrected 2017-04-11 by IP 37.201.32.106). Confidence high that it is a damage immunity (no damage taken), no evidence about reflect or ability triggers.

### Bone Dragon
- Wiki page title is `Bone dragon` (lowercase d). Special Ability section written by Moritain 2018-02-15 (https://evoker.fandom.com/wiki/Bone_dragon, rev 9221): "The card revives the first time it dies, adding its special ability to its attack total." Moritain also commented on Dragon Hunt 2018-02-15: "This portal also drops the ulitmate card, Bone Dragon." and played the portal himself.
- The earlier table text (Halloween page, Longevity 2017-04-22): "Return to life with attack points is 14063" (++++) -> corrected 2017-06-13 by IP 14.187.45.97 to "Return to life with attack points improve 14063". Table: ++++ attack 500, life 20992, ability 14063; L1 attack 100 life 200 ability 3100. Reading "attack after revival = the ability number (L1 3100, L63 14063)" vs Moritain's "added to its attack" (100+3100) are not distinguishable; revive HP is not documented anywhere. Poster 2017-04-08: Bone Dragon L1 life first 925 then corrected to 200 by IP 85.113.226.56 (the 925 was probably a mid-level value). Confidence low-medium.
- Player quote (General Discussion, Moritain-era user 34705807, 2018-02-15): "I do remember getting 4 Bone Dragon ultimate cards for approximately 10000 gems." (rarity/portal acquisition only).

### Cursed Stag
- Official French text (headline 2). Divine Peace comment, user 34705807 = Moritain, 2018-02-15 15:59 (https://evoker.fandom.com/wiki/Talk:Divine_Peace/@comment-34705807-20180215155934): "This portal offers a 9th Legendary Card, [[Cursed Stag]] , a 2 round dazer. On my first portal playthrough, I received it as both a card peice and again in the booster pack." -> categorised Dazer (https://evoker.fandom.com/wiki/Category:Dazer). Also on the Halloween page "The card opposite does no damage for 2 rounds" and a placeholder name "Opps Neutral" (see below).
- Stats (Gothar31): attack L1 0, L14 0, L24 200, L34 400, L44 800, L54 1600; HP L1 2000, L14 3513, L24 6035, L34 9476, L44 13728, L54 20692. Screenshot Cursed Stag++ at "Niveau 24": attack 400 HP 7499.
  (so the table's ++ values seem to be the level-34 values, while the displayed card at level 24 of a ++ card shows 400/7499: level 24 of a ++ card is below max, so no contradiction).
  The Stag has attack 0 at base -> consistent with Wiki note "Stag hasn't any attack" (HADES 2017-04-08). Which 2 rounds: unknown.

### Bouncer
- Page created by ASSTOUNDING 2018-03-10 (rev 9237), "created page for dungeon casino card, bouncer": "Stuns a random ally and a random foe in round one and two." Attack 1 direction (direct). Stats table L1 0/2000, L14 756/2757, L24 1917/4318, L34 3488/6388, L44 5781/9282, L54 9146/13146 (added by IP 93.231.244.32 2018-03-19). Category Suspender. The wording is copied from the in-game card text (ASSTOUNDING's other pages quote in-game text). File `Bouncer-full.png` (1440x2560 screenshot, player level 76 UI) shows only the art; ability panel not visible. Confidence medium (secondhand transcription of in-game text).
- No comments on Bouncer.

### Goblin Thieves
- Created as "Godlin Thieves" (typo, from the video title) by Longevity 2017-10-01, then moved to Goblin Thieves on 2017-10-06. Ability text "Switch heath and attack of a random card" (first typo version "Witch heath and attack...") -> "Switch health and attack of a random card." (2017-10-01/03). Stats L1 350/350, L11 699/700, L15 1023/1023, L19 1415/1415, L23 1891/1892, L27 2465/2465 (Longevity 2017-10-01/02; levels: 11/15/19/23/27 since Uncommon; the first template had level- = 11 ... level++++ = 27).
  Initial category Regenerator (later removed). The page embeds a video file "Godlin Thieves Evolution" = YouTube id UvxOMZZGgW8 ("Godlin Thieves (Orc) Evolution Uncommon", 148 s, published 2017-10-02); it is **unavailable** now (yt-dlp: "Video unavailable"). Same wiki user also embedded "Thief of Time Evolution" and "Scapmaster Evolution" (2017-09-24/26, ids not collected) – these are card-evolution art showcases, likely no battle footage.
  Images Gl2.png, Gl3.png, Glthie4.png, Glthie5.png, Godlin Thieves.png are card faces (art + level text). Not viewed in detail. Confidence on the wording: medium.

### Umbral Dragon
- Edit war (history, 29 revisions). Longevity 2017-06-04: ability = "Kills 2 random card at the end of round 2." (infobox) and "Kill 2 card random after round 2." Stats L1 1500/1500 ... L63 13327/13328. Vandalism by anon 89.103.182.50 (2017-09-28: "Gets rekt"), Longevity blanked the page 2017-09-29 ("Replaced content with ちっくそ", moved to "Empty"). Comment 2017-07-29 by Longevity to Alex2076: "please don't edit with information not true! Thanks" and Alex2076 "I corrected everything" – a dispute about Alex2076's (Italian) statistics edits, no card text.
- Restored by VIRuzRU 2018-04-17 (rev 9298–9310): "Kills 2 random cards at the end of the second round." and rev 9310: "**Can kill 2 enemy card or 1 enemy and 1 ally or 2 ally cards.**" (previous rev 9299: "Can kill both enemy and allied card."). VIRuzRU's comment: "sorry, my english is bad". This is the only statement that it can hit allies; VIRuzRU is probably a second language writer who observed it (or played the card). Confidence medium-low (single editor, no screenshot). Infobox portal "Dungeon Casino" ("Casino Dungeon" in VIRuzRU's version).

### Wheel of Fortune
- Gothar31 (French UI) 2017-12-01 created: infobox portal "Casino Donjon" (French name), rarity "Heroïc", mana 20, race Elf, ability "Come to try your luck! Lucky cards are healed at the end of the turn. The others know a different fate ..." (this is an English translation of the French card flavour text; the ellipsis shows the line was cut). Stats table (LifeAbility): L1 life 2000 ability 900; L13/14 life 2604 ability 1503; L21/24 life 3869 ability 2169 (the ability number is presumably the heal amount; attack 0). Categories Healer and **Card Damager** (so Gothar31 assumes the unlucky cards take damage). Screenshot IMG_1883.PNG is art only. No other source on the odds. Confidence: text high; mechanics unknown. The "Heroïc" spelling and level steps 13/21/29/37/45 (older table) show Gothar31 first copied a wrong template.

### Wizard Apprentice
- Gothar31 2017-11-30/12-01. Infobox: Dwarf, Legendary, mana 25, "All directions (Left, Front, Right)" then "3 directions (Left, Front, Right)", portal "Casino Donjon" -> Dungeon Casino. Ability "Releases a powerful reinforcement spell, but at _% chance that things go wrong". Table: L1 attack 1500 life 1500 **ability 6%**; L14 2508/2005 **19%**; L24 4090/2945 **29%**; L34 6217/4159 **39%**; L44 9142/5821 **49%**; L54 13161/8131 **59%** (these percentages come from a screen that shows the "_%" in the text). Observation: the percentage *rises* with level, so it is the spell *strength* (or something that scales up), not the failure chance, unless failure chance also rises; the card text as quoted contradicts a failure chance rising to 59%. The wiki text is Gothar31's translation. Page history also shows that the page was created as a rename of `Unique` -> `Evoker Wiki:Cursed Stag` -> Wizard Apprentice (so the Cursed Stag stats first typed there). Confidence: numbers high, interpretation open.
- Screenshots IMG_1879/1881/1854/1873/1902 are art + name only (Wizard Apprentice+, ++, +++, ++++) – icon green diamond = Dwarf tribe.

## Unknown cards found (new)

**A. "Cards in portal Neutral Monster" – Longevity, 2017-09-05** (https://evoker.fandom.com/wiki/Cards_in_portal_Neutral_Monster ; content in rev 8978 only; accessible through the API `prop=revisions&revids=8978`). "There are 8 unique cards. Collecting all 8 earns a 5500 gem reward." with quest numbers per card. Quote of the table (name / ++++ attack / ++++ life / ability / rarity / mana / race):

| Card | atk ++++ | life ++++ | ability ++++ text | rarity | mana |
|---|---|---|---|---|---|
| Ratius (Quest 1,2,3) | 2004 | 1591 | Raises the attack power of each of your other offensive neutral by 1322 | Uncommon | 10 |
| Dark Dragon (6,7,9) | 3081 | 3082 | If Dark Dragon dies, each of your offensive neutral gains 3081 attack power | Rare | 15 |
| Myteris Rumbo (4,5,8) | 1102 | 4011 | Heals each of your other neutral by 3006 health points | Rare | 15 |
| Marui (10,11,12) | 1 | 12741 | The attack value of each of your offensive neutral increases by 1024 per round | Heroic | 19 |
| Raptorial Fungus (13,14,15) | 0 | 7835 | Does 12219 damage to the opposing player each round | Legendary | 23 |
| "Opps Neutral" (17,18,19) | 9133 | 11276 | The card opposite does no damage for 2 rounds | Legendary | 25 |
| Heras (20,22,24) | 0 | 15440 | Heals 15440 of your health points each round. After round 2 she kills the opposing cards with attack power is 0. | Ultimate | 30 |
| Typhon (21,23,25) | 19941 | 19969 | None | Ultimate | 30 |

Footer: "Player can get Raptorial_Fungus in portal "Desert Twilight"". These cards are not in our 260-page dump nor in the 1.7.4 APK. Icon files `10 Ratius.jpg`, `15 Dark Dragon.jpg`, `15 Myteris Rumbo.jpg`, `19 Marui.jpg`, `24 Opps Neutral.jpg`, `30 Heras.png`, `30 Typhon.png` (100x100, Longevity 2017-09-05) are still on the wiki. Interpretation: a portal called "Neutral Monster" (all-Neutral card set, apparently on another regional server – Longevity's Dread Empress edit says "2017 6/26~7/3 KR", IP 211.201.57.2 is Korean; Longevity also made the Halloween table, so the Halloween values (e.g., Dark Mage 21091) are from his server and the same numbers appear on the English wiki, i.e. identical cards). "Opps Neutral" is a placeholder name for a Legendary 25 card with the Cursed Stag ability text but different stats (9133/11276 vs Cursed Stag 1600/20692); the rows for Fungus show the identical text of the English wiki ("Does ... damage to the opposing player each round"). Reliability: medium (a single editor's table, later blanked by himself, possibly because it was a test server/region); stats may belong to a different server version. This is the **only evidence of abilities for these cards**; whether they ever existed on the western server is unknown ("History Temple" portal page was blank "None" too, rev by Longevity 2017-09-22, i.e. a second portal he was cataloguing).
**B. `New Card Halloween Event` rev 8729 (Longevity, 2017-04-22; removed in rev 8730 12 minutes later)** listed two more cards besides the 8 known:
- Soul Chaos: Dwarf, Legendary, mana 21, attack 0, life ++++ 10703, portal Dawn of Eternity, ability "In round 1, ??? card opposite. In round 2, ????? him neighbour." (unreadable, he did not know the verbs).
- Creator of Time: Elf, Legendary, mana 25, attack ++++ 7116, life 11944, portal Dying Dreams, ability "The health points ??? reduced xx% after ???."
Icons `21 - Soul Chaos.png` and `25 - Creator of Time.png` exist (100x100, 2017-04-22). Neither is among the 8 Halloween cards of the brief (the Halloween list is 8 cards: Dark Mage, Tomb Colossus, Siamese Orc, Army of Ghosts, Raptorial Fungus, Werewolf Dwarf, Bone Dragon, Cursed Stag); so they were probably older/other cards that Longevity saw in a sorted list. Confidence low.
**C. Dungeon Casino**: the wiki never got a Dungeon Casino portal page (only a bullet "* Dungeon Casino" on `Portals` by ASSTOUNDING 2018-04-16, rev 9292). The wiki has only the 5 known Casino-only cards (Bouncer, Goblin Thieves, Umbral Dragon, Wheel of Fortune, Wizard Apprentice) plus Army of Ghosts listed as "Dawn of Eternity and Dungeon Casinò". No page names the 3 missing cards. User requests: anon comment on Portals, 2017-09-25 197.89.220.240: "Where can I find this info on the Dungeon Casino Portal?"; Message wall to Godlike Evoker 2018-06-04 by Ingla ("Sebastian"): "Hi, I'd like to post some information and stats about Dungeon Casino portal, but I have no permissions. Can you help me please?" (no answer; the wiki had no active admins). Last edit of any card page: Raven Shaman 2018-08-11. Anon comment on `Cards` 2017-11-14 168.194.161.207: "new cards???" and on 2018-08-10 "R.I.P. Evoker." (shutdown was 2018-08-22). Nothing on the Holiday event Dec 2017.

## Other findings
- Moon Dragon test by user 27870291 (2016-04-07, Talk:Bog Yeti) is pre-2016 era (relevant to deaths prevented "by Moon Dragon, not resurrected; death triggers not triggered") – already likely known; quote: "As a general rule, the effect of Moon Dragon prevents deaths (and fully heals) rather than resurrects. As another example, creatures ressurected by Moon Dragon don't trigger death triggers." Might be relevant to modelling Bone Dragon's "revive" (a different mechanism though).
- Fandom Discussions/forum: 23 threads, 200 posts in total, last real posts 2016-04; later posts are bot welcome messages. No blog posts exist (namespace 500 empty; `Blog:Recent posts` only a stub). Forum mentions of the cards only the board threads listed above.
- Deleted files (cannot be fetched): `Screenshot 2017....png` series (Alex2076; Bone Dragon, Dark Mage, Raptorial Fungus, Werewolf Dwarf screenshots, 2017-04 to 2017-06), `Scr2-5.png` (Longevity 2017-09-24), `Lvl1.jpg`. File upload log is available but these files are removed from the wiki; the Wayback has none.

## Searched, nothing found
- Other-language wikis: `<lang>.evoker.fandom.com`, `evoker.fandom.com/<lang>/`, `evoker-it/es/fr/ru/de/ccg`, `evokercardgame` – all return 404 from the API (do not exist); langlinks/interwiki of Dark Mage, Army of Ghosts, Cards: none. Italian is only Alex2076's editing inside the English wiki (headings "Statistiche", "Abilità speciali").
- Wayback CDX for `evoker.wikia.com/wiki/` (102 URLs, last real content 2016-04, plus Quests/Events Dec 2017, `Category:Dazer` 2017-12-28, Werewolf_Dwarf redirect 2019) and `evoker.fandom.com/wiki/` (18 URLs, 2021–2024 snapshots of Cards, Chimera, Dread Empress, Evoker_Wiki, Guruk, Warg_Rider; comment API snapshot only for Warg_Rider). No snapshot of Dark Mage, Bouncer, Wheel, Wizard Apprentice, Umbral Dragon, Army of Ghosts, any comment page, Special:RecentChanges (2018-12-06 atom feed is empty). `Game_Mechanics` and `Lore` pages (Dec 2017 snapshots) not fetched (timeouts) – not in our dump either; probably old redirects.
- Wiki blog posts, user pages: no blog namespace content; user pages are empty profile stubs.
- Comment API (`getComments`/`getThread` equivalents) for the 13 card pages: only Dark Mage, Raptorial Fungus, Siamese Orc, Umbral Dragon, Bone dragon have comments (all quoted above); Tomb Colossus, Army of Ghosts, Werewolf Dwarf, Cursed Stag, Bouncer, Goblin Thieves, Wheel of Fortune, Wizard Apprentice have none.
- The YouTube video behind "Godlin Thieves Evolution" (UvxOMZZGgW8) is unavailable; searching for the uploader's channel via yt-dlp search found nothing relevant.
- Not examined: Siamese Orc +/++ splash text (identical format), Goblin Thieves/Umbral/Wheel/Casino images beyond card faces (Gl2, Gl3, Glthie4/5 = art with level text, not opened).
