# Round 4 – flaregames forum (Wayback) – post-April-2016 cards

Method: Wayback CDX over `forums.flaregames.com/topic/*` (2016–2019, 15,624 captured URLs, of which ~3,300 distinct topics >= ID 28000;
the forum hosted several games, Evoker = forums 62 (index), 63 Official Announcements, 64 General Discussion, 65 Support), the forum-list
pages of 63/64 (to pick out the Evoker topic IDs), then raw captures (`https://web.archive.org/web/<ts>id_/<url>`) of every Evoker topic that
is archived. Text was extracted with a small node script; nothing was executed from the downloads.
All URLs below are Wayback captures; replace the host part as shown (`web.archive.org/web/<ts>/http://forums.flaregames.com:80/...`).

## TL;DR (what is new compared with the fan wiki text)

1. **Level-1 numbers from a player who posted card screenshots** (topic 36678, Mar 2017): Siamese Orc ability is a **flat +800 attack for both
   neighbours in round 1** (L1), Raptorial Fungus does a **flat 1500 damage to the player each round** (L1), Army of Ghosts at stage 0 shows
   **"yeti's ability"** (i.e. the Yeti fusion-evolving ability family; the stage-0 Yeti has no ability).
2. **Bone Dragon level table** (topic 35181): attack stays 100, HP 200 -> 1144, ability value 3000 -> 3314 over levels; another player says
   "It is enormous larva - 100 attack, 200 HP and 3000 attack after revive", i.e. the same pattern as the original Enormous Larva card
   (which exists in the 1.7.4 client, so its revive code can be reused).
3. **Werewolf Dwarf**: first-hand description "invincible in odd rounds - 2nd, 4th, etc." (sic; examples are the even rounds) and ~11-12K HP,
   low attack, straight attack (topic 35181).
4. **Cursed Stag** = a Basilisk clone: 0 attack, ability text identical to Basilisk ("The card opposite does no damage for 2 rounds"),
   L1 2K HP, attack grows only on fusion in steps of ~200 (topics 35181, 37481, 37868).
5. **Tomb Colossus**: "Legendary and has no ability at all" (topic 34623) – the wiki is right, no hidden ability.
6. **Dungeon Casino**: Umbral Dragon observably can kill **already dead cards** and (per one player) **own cards as well**; two Bouncers can
   pick the **same** targets; a "Gambler" card exists ("8k health and 36% kill chance at ++"). No stats/ability text for the other casino cards
   was written on the forum.
7. **Nothing at all is archived** for the Dec-2017 Holiday event (topic 41462 – only 301-redirect captures), the post-2018 Discourse forum has
   no Evoker category, and the forum-65 Support section was never archived. No new cards after Dungeon Casino are mentioned anywhere.

---------------------------------------------------------------------------------------------------

## Per card

### Dark Mage (announced as "Dying Dreams – Weekly Halloween Card (31st Oct)", 31 Oct 2016)

- Official announcement is **image only**: topic 33933, "Your weekly Halloween card has arrived: Dying Dreams" + `monthly_2016_10/mage.jpg`
  (the image is not archived). `https://web.archive.org/web/20170219164014/http://forums.flaregames.com:80/topic/33933-dying-dreams-weekly-halloween-card-31st-oct/`
- Player test/description (topic 34554, `https://web.archive.org/web/20171222131201/http://forums.flaregames.com:80/topic/34554-and-this-dark-mage-thing-is-an-ultimate-seriously/`):
  - jukka (Nov 2016): "seen 55 lvl ++++ card. It's impressive: 18,5K attack, 10,5K hp. And im not sure if this card was perfectly trained before
    fusing. So on 63 it has at least 20K attack." (wiki ++++ L54 table: 21091 / 11264 – consistent.)
  - SilentZero: "its ability is quite like the Medusa, but the Medusa's ability finally 50%, the Dark Mage only 20%." (i.e. the % rises with
    fusion/level to 20 % at the top; matches the wiki "15 % L1 … 20 %".)
  - jukka: "the Mage & Tomb were good cards with great attack range".
  - Pairing talk: "I'm thinking of a Magmamancer next to it" / "Agree, Mage can be used the same way, as MY's classic combo with Magma."
- **Not answered anywhere**: whether it reduces its own attack, own cards, order vs. other buffs. The forum never tests this. The
  "seems to deal more damage each round" wiki comment has no counterpart on the forum.
- Drop info: ultimate with card pieces (rare): "spent almost 300 bottles of stamina ... only got 6th of Dark Mage" (topic 34618).
- Confidence: ability % range **medium**; everything else **nothing found**.

### Tomb Colossus (7 Nov 2016)

- Official post image only (`monthly_2016_11/grabkoloss-image_1024` – "Grabkoloss" is the German name; not archived). Topic 34559
  `https://web.archive.org/web/20161110160530/http://forums.flaregames.com:80/topic/34559-tomb-colossus-weekly-halloween-card-7th-nov/`
- jukka (topic 34623, `https://web.archive.org/web/20171222131206/http://forums.flaregames.com:80/topic/34623-drops-are-absolute-crap/`):
  "new Tomb card is Legendary and has no ability at all. And its droprate seems to be the same as Dark Mage had: extremely rare."
- invoker (topic 34554): "It's legendary, by the way, not ultimate ... Kind of like Chimera of Dwarves." (Chimera = plain high-attack card.)
- Stats (++++): 14658 attack / 8401 HP (topic 37688, copied from the fan wiki).
- Confidence: **high** that there is no ability (one first-hand "no ability at all" + wiki + the "chimera" comparison).

### Siamese Orc (14 Nov 2016)

- Official post image only (`monthly_2016_11/siameseorc.jpg`, not archived). Topic 34677
  `https://web.archive.org/web/20170218233223/http://forums.flaregames.com:80/topic/34677-siamese-orc-weekly-halloween-card-14th-nov/`
- Player "Fryderyk" posted L1 stats from screenshots in topic 36678 (post #147874, March 2017),
  `https://web.archive.org/web/20170618172443/http://forums.flaregames.com:80/topic/36678-halloween-cards-on-wikia/`:
  > SIAMESE ORC … Type:Legendary Orc / Atk: 1600 (vs left and right enemy) / Hp: 2200 / Mana Cost: 25 / Ability: + 800 atk for his neighbours in 1st round
- So: **flat value** (800 at L1; wiki ++++ value 5183), **round 1 only**, **both neighbours**, attack pattern left+right (matches wiki). Confidence
  **high** for flat/round-1/neighbours (stated as a plain number from a screenshot); the screenshot itself (`monthly_2017_03/image.png.*`) is not archived.
- Same flat-value pattern as Dwarf King / Wrath Bringer: "Increases the damage dealt by his neighbors by 2091" (Dwarf King L14, topic 37868).

### Army of Ghosts (~21 Nov 2016)

- Official post image only (`geisterarmee-image_1024`). Topic 34797
  `https://web.archive.org/web/20170219164031/http://forums.flaregames.com:80/topic/34797-army-of-ghosts-new-card-now-available/`
- Topic 36678 (post #147878): "ARMY OF GHOSTS … Type: Legendary Neutral / Atk: 2200 / Hp: 1500 / Mana Cost: 21 / **Ability: yeti's ability**".
- Topic 39497 "Do abilities improve or change with fusion?" (Aug 2017, `https://web.archive.org/web/20171111082306/http://forums.flaregames.com:80/topic/39497-do-abilities-improve-or-change-with-fusion/?preview=1`):
  > "Bog Yeti, Sand Yeti, Mountain Yeti, Magmamancer, and Army of Ghosts have evolving abilities. ARE THERE ANY OTHERS not in that list?"
  > reply (1341393): "You got the gang right there. They're the only ones so far."
- A level-15/15 Mountain Yeti is listed as "Has no special abilities" (topic 37868) – consistent with the Italian stage-0 text "Non ha capacità speciali".
- Wiki ++++ (New_Card_Halloween_Event): "Receives no damage after round 1." Stage 1-3 texts are **not** on the forum.
- Inference (medium): Army of Ghosts uses the same fusion-evolving ability machinery as the Yeti family (Mountain Yeti is in the APK), so the
  per-stage table can be modelled on the Yeti/Magmamancer one; the end-stage text is the wiki's.
- Only 5 cards ever had evolving abilities as of Aug 2017 (list above) – high confidence for "no other card besides these five".

### Raptorial Fungus (28 Nov 2016)

- Official post image only (`raptorialfungus.jpg`). Topic 34876
  `https://web.archive.org/web/20170219164927/http://forums.flaregames.com:80/topic/34876-raptorial-fungus-new-weekly-card-nov-28th/`
- Topic 36678 (post #147881): "RAPTORIAL FUNGUS … Type: Legendary Neutral / Atk: 0 / Hp: 1700 / Mana Cost: 23 / Ability: **Does 1500 damage
  to the opposing player each round**" (L1). Wiki ++++: 12219 per round, 7835 HP.
- First-hand use (topic 38081, iamdip, May 2017, `https://web.archive.org/web/20170618175228/http://forums.flaregames.com:80/topic/38081-need-help-with-cards/`):
  "I managed to drop a couple of fungus and mammoth cards … and shuffled them to make a direct player damage deck, its working out super so far …
  [Raptorial Fungus] its my favorite card so far." (confirms a repeated direct damage to the player; no statement about death/reflection.)
- Not answered: does it stop when the card dies / reflect / block. Confidence for 1500 flat per round at L1: **high** (screenshot-based list); rest: nothing found.

### Werewolf Dwarf (5 Dec 2016)

- Official post image only (`werewolfdwarf.jpg`). Topic 35098
  `https://web.archive.org/web/20170219164218/http://forums.flaregames.com:80/topic/35098-werewolf-dwarf-new-weekly-card-dec-5th/`
- Topic 35181 "Other new cards" (`https://web.archive.org/web/20170305132955/http://forums.flaregames.com:80/topic/35181-other-new-cards/`),
  jukka, Dec 2016:
  > "werewolf is upgraded Garpy: he is invincible in odd rounds - 2nd, 4th, etc. attack is straight. it's tanky card with about 11-12K hp & low attack range."
  (screenshot `wp_ss_20161207_0002.png` by another player – not archived.) "Garpy" = the original Gargoyle-style card; the player's "odd" is clearly
  a slip, the examples he gives are rounds 2, 4 = even; the wiki text says even.
- Wiki ++++ 7451 / 11932 (copied to topic 37688 as well) fits "11-12K hp".
- "invincible" = takes no damage (nothing says it cannot die otherwise; it simply never receives damage in even rounds). Confidence **medium-high** (single player + wiki).
- Comparison point: the tank "Wolf Beast" in the same threads: "Takes no damage in the first round of a fight." (topic 37868). The Werewolf text is the even-round version.

### Bone Dragon (12 Dec 2016)

- Official post image only (`bonedragon.jpg`). Topic 35173
  `https://web.archive.org/web/20170214215500/http://forums.flaregames.com:80/topic/35173-bone-dragon-new-weekly-card-dec-12th/`
- Topic 35181, invoker (post #133683, 17 Dec 2016), stats by level (attack, HP, ability value):
  > 100, 200, 3000 / 100, 284, 3028 / 100, 371, 3056 / 100, 459, 3086 / 100, 550, 3116 / … / 100 836 3211 / 100 936 3245 / … / 100 1144 3314
  jukka (#133899): "Bone has more than 20K hp on ++++. And his ability (attack bonus) is over 14K. Initial attack is poor."
  Mko (#133088, earlier): "It is enormous larva - 100 attack, 200 HP and 3000 attack after revive. I can't believe it is ultimate".
- So L1 is attack 100, HP 200, ability value 3000 (wiki: "100 atk, revives with +3100" is attack 100 + 3000? – the wiki's 3100 equals base 100 + 3000).
  The ability value grows with level (3000 -> 3314 by ~L25) and to ~14,063 at ++++ (wiki).
- Wording mirrors **Enormous Larva** (original client card: "returns to life with improved attack"), so the revive HP/attack rule can be taken from the
  Larva implementation in the APK. Nobody on the forum tested the revive HP. Confidence: stats **high** (first-hand table), "same rule as Larva" **medium** (one-line comparison).

### Cursed Stag (19 Dec 2016)

- Official post image only (`cursedstag.jpg`; the teaser was "a blurred version of the last card"). Topic 35218
  `https://web.archive.org/web/20170219102217/http://forums.flaregames.com:80/topic/35218-cursed-stag-last-weekly-card-dec-19th/`
- Topic 35181: "Stag has 2k health. 0atk (but can attack if his damage is buffed, attacks forward). Ability is the same as basilisk." And jukka:
  "Here is my ++ version. The strange thing is about attack: it raises only when card is fused. And only per 200 points … This cards cannot be dazed,
  or they ignore dazing effect … If Stag was a suspender for two rounds … Flares made a mistake, giving Stag simple dazing ability."
- Topic 37481 "Cursed Stag" (May 2017, `https://web.archive.org/web/20170618154302/http://forums.flaregames.com:80/topic/37481-cursed-stag/?preview=1`):
  "It is same as basilisk but cost 25 mana" / "No, its ability stays same, it is just basilisk that costs 25 mana, only has more HP." / "It gains small amounts of attack when its fused."
- Topic 37868 card dump (`https://web.archive.org/web/20170618163246/http://forums.flaregames.com:80/topic/37868-help-with-building-my-strongest-rotation-for-my-deck/`):
  > Cursed Stag – Level 14/14 – ATK 0/DEF 3513 – Mana 25 – The card opposite does no damage for 2 rounds.
  > Basilisk+++ – Level 22/23 – ATK 456/DEF 2291 – Mana 9 – The card opposite does no damage for 2 rounds.
- "Which 2 rounds" is not stated; because it is described as identical to Basilisk (an original card), the Basilisk implementation (rounds 1-2) applies.
  The player's "dazing" + "suspender for two rounds" wording implies the stag is a *daze* (non-attacking) effect on the directly opposite card, not a stun that
  prevents abilities. Confidence **high** for "identical to Basilisk", ability opposite = the card across.
- Note: the wiki says ATK 1600 at ++++ and HP ~20.7K; topic 37688 lists the Stag as 1600 atk / 22000 hp.

---------------------------------------------------------------------------------------------------

## Dungeon Casino (29 May – 5 Jun 2017)

Official post (topic 38165, only text): "8 new Card with a new game-mechanic. 25 new Event Quest. 2 unique Event Boosters. We call it 'Dungeon Casino' …
The Event will run from May 29th, 2017 at 10:00 UTC until June 5th, 2017 10:00 UTC." (first post 22 May: "special Event running in Evoker starting next Week").
`https://web.archive.org/web/20170708082117/http://forums.flaregames.com:80/topic/38165-new-event/`  – **no card names or ability texts** in the official post.

Main player thread: "About the 'Dungeon Casino' cards", topic 38327,
`https://web.archive.org/web/20170618171621/http://forums.flaregames.com:80/topic/38327-about-the-dungeon-casino-cards/?preview=1` (all quotes below from here):
- "They all seem to work on luck and decrease the tactical element of the game. The so-called new 'game mechanic' seems to be praying to God." (iamdip) –
  the "new game mechanic" = **randomness** (confidence high).
- iamdip (29 May): "There might be something going on with that **gambler** card though. During portal quests I encountered one that has **8k health and 36% kill chance at ++** I think.
  If its 12k plus health and like 60% or better kill chance at ++++ it might be something." -> a casino card with a "kill chance" percentage that scales with fusion (**medium**, one observation).
- Another player: "Gambler looks fine to me, but I cant find any use of the legendaries though …" and "Dwarf deck. I think Keeper of treasure and tundugar Ironeye blend well with the
  2 new legendary cards. Not so broken, but I can see a possible theme." -> the casino set has (at least) two new Legendary dwarf-theme cards (Wizard Apprentice is a Dwarf Legendary;
  Bouncer is Neutral Legendary, so the second is probably the "hooded gambler" from the round-3 video) (**low**, inference).
- Umbral Dragon: "killing two cards at the end of round 2" (text confirmed). Markosph: "Umbral kills 2 random… **Why does he kill already dead cards?** Shoudnt work like Dwarf Judge or Colossus? Can he kill itself???"
  (the "Why does he kill already dead cards" is a first-hand observation that the targets are picked among all 10 slots incl. dead ones) and reply: "I think he can end up killing himself because of the word 'random'".
- Booster info: "in the current case one ultimate per booster is guaranteed" (the 2 unique event boosters). Card library raised to 100 "Library went up to 100 cards???"
- A player posted a "Few Boosters opening YouTube" link: `https://www.youtube.com/watch?v=rcpO2L5iEO8` (video now "unavailable"; not archived by Wayback).

Umbral Dragon follow-up, topic 38430 "umbra dragon" (`https://web.archive.org/web/20170618170124/http://forums.flaregames.com:80/topic/38430-umbra-dragon/`):
> "The card says kills 2 random cards at the end of round 2, but does this include my deck as well as opponents?" -> "Yeah, that seems to be the case."
(**medium-low**: a reply by a player, not a documented test; but it agrees with the "kills already dead cards / can kill itself" reading: targets are drawn from all cards on the board.)

Bouncer – two threads (Aug 2017):
- Topic 39601 "Card BOUNCER – About Your Ability" (`https://web.archive.org/web/20171111092612/http://forums.flaregames.com:80/topic/39601-card-bouncer-about-your-ability/?preview=1`), JonathanBRA:
  > "when there are two BOUNCER cards, they sometimes cancel the same cards, that of the enemy and the ally. … In the case of UMBRAL DRAGON, which kills two cards randomly at the end of the second round, if there are two UMBRAL DRAGON, will they kill the same cards?"
  1341393: "They may, they may not. That's the way randomness is." and "For the dungeon casino cards with random on their ability, I would guess the cards targeted are determined before combat takes place, and the ability happens after combat" (explicit speculation – **low**).
  -> First-hand: each Bouncer draws independently (two Bouncers can hit the same ally and/or enemy) – **medium**; "cancel" = stun; targets are one ally *and* one enemy.
- Topic 39570 "New Card Bouncer++++ Full" (`https://web.archive.org/web/20171111092755/http://forums.flaregames.com:80/topic/39570-new-card-bouncer-full/`): a ++++ screenshot (`monthly_2017_08/5985caed4f9c7_Bouncer.png`) – **the image is not archived** (Wayback stub), so no numbers.
  Not answered: same targets in rounds 1 and 2 (the "random ally/foe in round one and two" wording).

Goblin Thieves, Wheel of Fortune, Wizard Apprentice: **no forum thread discusses them** (searched titles and the text of every Evoker topic after 29 May 2017). Goblin Thieves appears only as a quest boss in the round-3 video notes.

The 3 unknown Dungeon Casino cards: the forum names only "gambler" (above). The round-3 video note already lists the set (Goblin Thieves, rare ogre/troll, rare waitress, heroic tavern crowd, Wheel of Fortune, Bouncer, hooded gambler, Umbral Dragon);
the forum adds nothing on the rare ogre/waitress/tavern cards. The wiki category page `Category:Evolving_Ability` was quoted as "definitely missing things like the Casino portal and cards" (topic 39497, 2 Aug 2017) – the wiki was incomplete for the casino cards even then.

---------------------------------------------------------------------------------------------------

## Dec 2017 Holiday event and later

- Official announcement list (forum 63, capture 2017-12-25, `https://web.archive.org/web/20171225150828/http://forums.flaregames.com:80/forum/63-official-announcements/?page=0`) ends with topic 41462 "Evoker Holiday Event" (titles only). 
  CDX for `forums.flaregames.com/topic/41462*` returns only HTTP 301 captures (20180102133717, 20180102134539, 20180102134933); fetching them gives 404 -> **no text recoverable**.
- No topic after ID 41462 for Evoker is archived; no shutdown thread archived. After Aug 2018 the forum moved to Discourse: the category list (`/c/…`, 2019-07-19) has only Olympus Rising, Royal Revolt 2, Off-topic, Forum feedback – **no Evoker category**.
- Nothing mentions new cards between Jun 2017 and Dec 2017 other than Dungeon Casino. Topic 39497 (Aug 2017) says the wiki is "missing … Casino portal and cards" and only knows 5 evolving-ability cards.

---------------------------------------------------------------------------------------------------

## Other useful side facts from the same threads (not in the brief)

- Halloween cards were reachable as pieces only; "tons of heroic cards on 25th quest" crowded out drops (topic 35181). The Christmas 2016 event (topic 35355) "Special Booster … three guaranteed Halloween Cards".
- Halloween teaser (topic 32713, 14 Oct 2016): "our team is currently working on eight more cards fitting the cold and stormy season" – there were exactly 8 weekly cards (Dark Mage … Cursed Stag).
- Card dump at max level with exact numbers for original cards (topic 37868, 8 May 2017), e.g. Dwarf King L14 "Increases the damage dealt by his neighbors by 2091", Rock Detonator++ L29 "Deals 1489 more damage in the first round" – these confirm that "increase by X" abilities are **flat** numbers that scale with level.
- Card inventory cap: "Library went up to 100 cards" (topic 38327, ~1 Jun 2017) – already known from round 3.

## Images

`exploration/research/round4/frames/forum/` is **empty on purpose**: every Evoker forum image (card announcement art, Werewolf/Stag/Bouncer/Fungus screenshots, `monthly_2016_1x/*`, `monthly_2017_0x/*`) is a Wayback "not archived" stub.
A CDX listing of `content.invisioncic.com/Mflaregames/` (612 archived files in total) contains no Evoker card image.

---------------------------------------------------------------------------------------------------

## Searched, nothing found

CDX queries (all through `https://web.archive.org/cdx/search/cdx`, `fl=timestamp,original,statuscode`, `collapse=urlkey` unless stated):
- `url=forums.flaregames.com/topic/*&from=2016&to=2019&filter=statuscode:200` (15,624 rows; 3,284 distinct topic IDs >= 28000, filtered by title keywords and by the Evoker forum list pages).
- `url=forums.flaregames.com/forum/&matchType=prefix` (665 rows) -> Evoker = forums 62/63/64/65 only (no German/French/Spanish/Portuguese/Italian/Russian Evoker sections; other-language posts are in 64, e.g. topic 38657 "cartas", not archived). Forum 65 (Support) never archived.
- `url=forums.flaregames.com/topic/41462*`, `…/topic/38327*` (all captures), `forums.flaregames.com&matchType=host&from=20180101` (5,000 rows, all Royal Revolt 2 / Olympus Rising, no Evoker), `…/c/`, `…/categories`, `…/t/*` (Discourse: no Evoker).
- `content.invisioncic.com/Mflaregames/&matchType=prefix` (images) – no Evoker card images.
- `evokergame.com/*` (service returned its "temporarily offline" page; round 3 found captures only until 2016-05), `flaregames.com/games/evoker*` (one capture, 2016-01-12), `flaregames.com/evoker-magic-trading-card-game/` (2016-01-31), `flaregames.com/news*` (2019+ only, unrelated), Play/App Store/Helpshift after 2018-04 (no captures/offline).
- `evoker.wikia.com/wiki/New_Card_Halloween_Event*`, `…/Bouncer*`, `…/Dungeon_Casino*`, `…/Special:Forum*`, `…/Gambler*` – no captures returned (wiki history belongs to another agent; the wiki text dump already exists).

Evoker topic IDs **read in full** (captures from 2016-10 to 2017-12): 32713, 33240, 33559, 33755, 33933, 34546, 34554 (+page 2), 34559, 34616, 34618, 34619, 34623, 34677, 34797, 34876, 35049, 35098, 35173, 35181, 35218, 35355, 35401, 35830, 36678, 36868, 37399, 37450, 37481, 37619, 37679, 37688, 37794, 37808 (pages 1–2), 37868, 37878, 37889, 37929, 38074, 38081, 38120, 38154, 38165, 38327, 38350, 38430, 38897, 39107, 39403, 39495, 39497, 39570, 39601, 39611, 39811, 39839, 39888, 40080, 40123, 40238, 40243, 40248, 40268, 40366, 40504, 40565, 40713, 40738, 40830, 33178. Keyword-grepped for all 13 card names, "gambler", "casino", "holiday" and "umbra".
Not archived (listed on the forum index pages, no captures): 33404 "new card ideas", 34373 "new card piece", 34568 "card pieces grr", 34674, 34708 "Tomb Colossus", 34805 "guidance on quest 24-25", 34991, 38496, 38533, 38657 "cartas", 38693, 38712, 38742, 41462 Holiday event, and all topics of forum 65.
Findings that could not be obtained: the YouTube booster-opening video `rcpO2L5iEO8` (unavailable), the ++++ Bouncer screenshot (not archived), all card art/screenshot images.
