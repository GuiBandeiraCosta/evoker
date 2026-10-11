# Round 3 – social / official posts / store listings (topic: `social`)

Method: Wayback Machine CDX + raw fetches (`id_`) of the flaregames forum (forums.flaregames.com, Evoker section = forum 62:
63 Official Announcements, 64 General Discussion, 65 Support & Help), evokergame.com, flaregames.com game page, Google Play
(com.flaregames.craftedevil) and App Store (id637436624) snapshots, plus web search. The Wayback Machine went "temporarily offline"
twice during the run, so some pages could not be fetched (listed at the end).

Handles / URLs found:
- Official Facebook page: `facebook.com/evoker` (named in the App Store description: "http://facebook.com/evoker"). The only archived capture
  (2022-08-20) is an empty shell ("Evoker - Home"); no posts are recoverable from Wayback. mbasic/m. variants are not archived.
- Twitter: only the generic `@flaregames` (App Store description). No Evoker account. No Instagram/G+ Evoker content archived.
- Site `evokergame.com` (WordPress, 2013-12 .. 2016-05), `flaregames.com/games/evoker/`, support `flaregames.helpshift.com/a/evoker/`
  (only the shell is archived), `feedback.flaregames.com`.
- Forum: `forums.flaregames.com/forum/62-evoker/` (Invision, Evoker section created ~Jan 2016; moved to `/c/` Discourse after 2018).

Evidence is cited as URLs of the Wayback captures (`web.archive.org/web/<ts>/<url>`); the key topic IDs are given as `forum topic NNNN`.

---------------------------------------------------------------------------------------------------

## 1. Discrepancies between the original and our recreation (sorted by importance)

| # | Topic | Original (evidence) | Our recreation | Confidence |
|---|---|---|---|---|
| 1 | **League structure** | Not a 24 h league against 8 bots. Players describe *leagues that "close"* ("after the bronze league closure I'll attack PQ18"), with a *ranking by points* and **prizes for the top 3 in Bronze/Silver** ("any place that I can get another 10 potions", "win ... 5 potions of mana"), **gems for a top-2 place in Gold** ("win a top 2 spot in gold league" is cited as a gem source; the wiki also lists league prizes as a gem source). Gold-league leaders reach ~10,000+ points; scores like 10832 / 2500 / 2439 / 2222 are quoted. **League points do not come only from league fights**: "league points are not just coming from league pvp battles, but for card pieces and arena battles too" (forum topic 28092, 2016). There are "Double PvP points" days ("it's twice the points for pvp wins now"). Strategy post: wait until the last ~30 minutes, tail the leaders. Leagues are a recurring multi-hour/day event; Bronze, Silver, Gold exist (platinum is not mentioned anywhere in the forum). Players also call it "tournament". | Daily 24 h league, 8 simulated players, league points only from league fights, 150 pts/win, Bronze→Platinum by cumulative score. | Medium-high that points also come from arena + piece-hunt fights and that prizes are potions at the lower tiers; low on exact numbers. |
| 2 | **Card inventory cap** | **80 cards** at least from Mar 2016 ("Having only 80 slots for keeping unused cards", forum topic 8982, Apr 2016; "as soon as you reach 80 cards, all others will be liquidated into coins"). **Raised to 100 in ~June 2017** ("I checked today the max cards is now 100", reply dated 4 Jun 2017, topic 38350; the thread title also asks for "additional space for 80 cards and additional level for level 200", i.e. player level cap **200** is confirmed). | Not modelled (no cap found in `src/`). | High for 80 (2016) and 100 (mid 2017). |
| 3 | **Event length / portal length** | **From Oct 2016 all events last exactly one week** ("On a side note, we have also changed the duration of all events to one week", Evoker Halloween Celebration post). Before that portals ran 1–2 weeks. Event start times are Monday (see §3), event start/end are announced in UTC (2017: "14 Apr 2017 00:00 UTC – 18 Apr 2017 00:00 UTC"; "29 May 2017 10:00 UTC – 5 Jun 2017 10:00 UTC"; the Summer event 2016 used German time). | Portal open 7 days, cycling. Matches the post-Oct-2016 rule. | High. |
| 4 | **Event cards come as pieces in quests 24 and 25 of the event portal + "Big Boosters"** | Halloween 2016: "drop the card pieces ... in the event quests 24 and 25 and Big Boosters may rarely contain complete Halloween cards". Dungeon Casino 2017: "25 new Event Quest, 2 unique Event Boosters, 8 new cards with a new game-mechanic". So an event portal = **25 quests** with the event card pieces on quests 24 and 25. | Portal quests 1–25 exist; where pieces drop is not specified. | High. |
| 5 | **Stamina/mana growth** | Level 34 account: **220 stamina and 112 mana** (forum topic 37808); "You gain more access to stamina, mana, and health" per level. Consistent with 12 free points per level-up but shows players put the majority into stamina (50 base + 12×33 = 446 points total; 220+112 = 332 spent on the two plus HP). | Same rule (12 points/level; 1 stamina or 1 mana per point, 30 HP per point). | Medium. |
| 6 | **Android client versions after 1.7.4** | There is **no client update after 1.7.4 (Play: 21 Apr 2016; iOS: 26 Apr 2016)**: Play snapshot of 14 Mar 2018 and App Store snapshot of 1 Dec 2017 still show 1.7.4. All 2016–2018 content (Halloween cards, Dungeon Casino, 100-card cap, 8-card new mechanic) was delivered server-side/data-driven. Useful: the 1.7.4 client we have is the *final* client. | n/a | High. |

(Where the recreation already matches – daily rewards, 80-card concept at wiki level, trainer cards at Easter 2016 – nothing was added.)

---------------------------------------------------------------------------------------------------

## 2. Client version list (number + date) – for the APK hunter

Google Play, `com.flaregames.craftedevil` ("Updated" field in the archived listing; package name was originally "craftedevil"):

| Version | Play "Updated" | Source capture |
|---|---|---|
| **1.1.6** | 21 Feb 2014 (size 42M, Android 2.2+, 5,000–10,000 installs) | web.archive.org/web/20140222015849/play.google.com/store/apps/details?id=com.flaregames.craftedevil |
| 1.5.0 | 29 Nov 2014 (Uptodown, per earlier research) | – |
| 1.6.0 | 2 Feb 2015 (Uptodown); iOS 1.6.0 = 29 Jan 2015 | – / App Store 20150211 capture |
| 1.6.1 / 1.6.2 | 5 Feb 2015 (Uptodown) | – |
| 1.6.3 | 12 Feb 2015 (Uptodown) | – |
| **1.7.0** | 19 Mar 2015 (Play and iOS agree) | …/20150525140652/… |
| **1.7.1** | 21 Jul 2015 | …/20150820183419/… |
| 1.7.2 | not seen in any capture | – |
| **1.7.3** | 2 Nov 2015 (Play); iOS 17 Nov 2015 | …/20160321064742/… , iTunes 20151211220707 |
| **1.7.4** | 21 Apr 2016 (Play, 44M, "Requires Android 2.3 and up"); iOS 26 Apr 2016 (56.4 MB, later 71.8 MB) – **last version** | …/20161007020728/… and still current on …/20180314141941/… |

"What's New" texts (verbatim):
- 1.1.6 (Play): "BOOM! New Tournaments / BLING! Daily Events / BAM! Localized Game-Content" (gives dates for *tournaments (leagues)*, *daily events* and *localisation* – all three existed by Feb 2014).
- 1.6.0 (iOS): "Now in Japanese, Korean, Brazilian Portuguese and Traditional Chinese. Various improvements, polishing and bug fixing."
- 1.7.0 (iOS/Play): "Now with new improved in-game help function. Various improvements, polishing and bug fixing." (the Helpshift FAQ `flaregames.helpshift.com/a/evoker/` is the "in-game help").
- 1.7.1 Play: same text as 1.7.0. 1.7.3 iOS: "Some minor bugfixes. If you have any questions or suggestions please go to: https://flaregames.helpshift.com/a/evoker/". 1.7.3 Play / 1.7.4 Play: "Various improvements, polishing and bug fixing." 1.7.4 iOS: "Some minor bugfixes."

Store metadata: Google Play ~81,251 ratings (early 2018), installs **1,000,000–5,000,000**, rated Teen, "Offers in-app purchases", IAP range **$2.99 – $122.35 per item**, contact Erbprinzenstraße 27, 76133 Karlsruhe. iOS rated 9+, iOS 6.0+, 12 languages (English, Chinese, French, German, Italian, Japanese, Korean, Portuguese, Russian, Spanish; later also Dutch, Turkish), iOS rating ~4.3 (751 ratings, Dec 2017). iOS title history: "Evoker - A Magic Fantasy Game" → "Evoker - Magic Trading Card" (2015-16) → "Evoker - A Magic Trading Card Game (TCG)" (2017).

Release: the dev blog `evokergame.com/?p=1` (post "Hello world!", **10 Dec 2013**, by "Gunnar"): "If you read this, we have finally left stealth mode and EVOKER has been released to the wider world after being in 'beta' for some time." The Play review (7 Feb 2018) of a user says "The old evoker was way better. The drag and aim spells against enemies was a lot more fun ... I was sad when it went away. Now im more disappointed its back" – i.e. an earlier (2013 beta/1.0) version apparently had a *different, drag-and-aim spell battle*; the TCG autobattler is the 2014+ design (low confidence, single review).

---------------------------------------------------------------------------------------------------

## 3. Hard facts: events and card releases (flaregames forum, "Official Announcements" – signed "Your Evoker Team")

All dates are the stated start dates; times are from the posts.

| Event | Dates | Cards / rewards (verbatim facts) | Source |
|---|---|---|---|
| **Dying Dreams** (portal) | Mon **25 Jan 2016** | Scorpion Rider (Legendary): "stuns her enemy in the first Round". Sentinel (Ultimate): "can heal all your Cards". Story with "Evoker kills ..." dialogue ending "The Sentinel collapses. Silently, the Gates of Horn & Ivory swing open.... To be continued...." | topic 8309 |
| **The Dark Beyond** | Mon **8 Feb 2016** | Wilderness Shaper (Ultimate): "can attack all Cards at the same time". Magmamancer (Heroic). Story: Gates of Horn & Ivory; boss order = Bone Oracle/Airborne Parasite, Moon Prophetess, Totem Carver, Fungus Lord, Magmamancer/Guardian of Time, Loremaster, Dwarven Sage, Sentinel, Wilderness Shaper. | topic 8479 |
| **Dawn of Eternity** | Mon **7 Mar 2016** | Mountain Yeti (Ultimate): "what happens after he completed his Evolution?" (ability changes with fusion); Lightning Spirit (Ultimate): "A Storm is coming in." Story ends with the Thief of Time time-loop. | topic 8939 |
| Other 2016 portals named in the announcement list | Desert Twilight (7404), Dwarven Rage (7646), "Christmas is coming" (7789, Dec 2015 Christmas event), Dragon Hunt (7944), Divine Peace (8163), Dread Empress (8661) – the pages are not archived. A player thread "1000 gold for winning 25th level of Dread Empress" (8918) says the **last (25th) quest of a portal gives 1000 gold**. | – |
| **Easter 2016** | **26–28 Mar 2016** ("special offers"); cards collectible 25–28 Mar | 3 trainer cards that exist **only during the event**: Lich King (Heroic, "+ ~4000 xp"), Crystal Ghost (Legendary, "+ ~9000 xp"), Blood Dragon (Ultimate, "+ ~20000 xp"). Daily rewards: 25th Lich King, 26th Easter Token, 27th Crystal Ghost, 28th Easter Token. One Easter booster with guaranteed: **1x Ultimate, 4 Feeder (guaranteed in Blood Dragon), 4x Legendaries**. "there will be no use in preserving the Tokens, they will be useless after the Event." | topic 11154 |
| **Summer event 2016** | 18 Jun 2016 00:00 – 20 Jun 00:00 (German time) | "a Free Summer Token every day"; special booster "with one guaranteed ultimate"; "More Tokens in 2 special packages that can be bought"; "The Boosters run for one more additional day". | topic 28462 |
| **Halloween Celebration** | **31 Oct 2016 – 26 Dec 2016** | Teasers in Oct (a hand-drawn card sketch and a GIF of the card creation; "eight more cards"). Pieces of the Halloween cards (Legendary and Ultimate) drop in **event quests 24 and 25**; **Big Boosters** "may rarely contain complete Halloween cards". **One new card every Monday**. Cards in order: **Dying Dreams** (31 Oct), **Tomb Colossus** (7 Nov), **Siamese Orc** (14 Nov), **Army of Ghosts** (21 Nov – post undated), **Raptorial Fungus** (28 Nov), **Werewolf Dwarf** (5 Dec), **Bone Dragon** (12 Dec), **Cursed Stag** (19 Dec; "our teaser was a blurred version of the last card"). Note: this "Dying Dreams" is a *different* card than the Jan-2016 portal name. | topics 32713, 33240, 33755, 33933, 34559, 34677, 34797, 34876, 35098, 35173, 35218 |
| **Christmas event 2016** | **24–31 Dec 2016** | "one Special Booster with one Ultimate guaranteed. The others will be Legendary with three guaranteed Halloween Cards"; "one token per day on the 24th, 25th and 26th when they login"; "Three 'Special Premium Token Package' will also be available for purchase at the shop". | topic 35355 |
| **Easter 2017** | **14 Apr 2017 00:00 UTC – 18 Apr 2017 00:00 UTC** | Login bonus on the 14th, 16th and 17th; "a free Blood-Dragon card on the 15th"; special Booster Pack: "An ultimate card, 6 Legendary cards (event and default), A feeder card (legendary or ultimate)". Signed "- Nikko". | topic 37399 |
| **Dungeon Casino** | **29 May 2017 10:00 UTC – 5 Jun 2017 10:00 UTC** | "8 new Cards with a new game-mechanic, 25 new Event Quests, 2 unique Event Boosters". Banner `Evoker_forum_banner.jpg`. "get your dress chic". | topic 38165 |
| Holiday event 2017 | Dec 2017 ("Evoker Holiday Event") | page not archived | topic 41462 |

Daily rewards: "Daily login rewards" were announced in topic 8466 (not archived); the wiki says first given 3 Feb 2016; a league-thread poster confirms "we don't have daily login rewards. That was just added later on."
Daily events that players mention: **Infinite Wisdom / double XP day**, **double PvP points** ("twice the points for pvp wins"), **drinking contest / "big drink"** (potion half price), **card-piece event**, **Heroes package** (half-price gems), "Great potion deal". The Easter 2016 trainer cards were ~4k/9k/20k xp sacrifice values (rarity Heroic/Legendary/Ultimate).

---------------------------------------------------------------------------------------------------

## 4. Hard facts: prices and economy

App Store IAP list (top in-app purchases, 2015–2017 captures; USD):
- 2015 (Feb–Dec): Apprentice's Bundle **$4.99**, Wanderer's Purse **$9.99**, Hero's Wallet **$24.99**, Evoker's Treasure **$24.99**, (later) Evoker's Treasure **$49.99**, Master's Vault **$99.99**.
- Dec 2017 listing also shows "Event Package $9.99", Evoker's Treasure $24.99, Master's Vault $44.99, Wanderer's Purse $4.99, Apprentice's Bundle $2.99 (promo/sale tiers).
- Google Play IAP range: **$2.99 – $122.35 per item**.
- Forum, topic 37878 ("Packed price"): "for 500 gems I must pay 5,99 EUR (iPhone) ... my husband must pay the same 4,99 (Android)". So **500 gems = EUR 5.99 on iOS, EUR 4.99 on Android** (2017); iOS tier prices were thus not the same as Google Play prices.
- Forum, topic 37808: offered bundle of "about **2400 gems**" containing "5 archmage token, summoner token and potion".
- Gems at endgame: players hold 18k–36k gems at level 51–75 without paying; "3k gems" at level 39.
- Android reviews (2016–2018): "you have to wait a long time to fill up your mana & stamina", "I can battle once in the quest and once against another player then I have to wait an hour or longer" (suggests regen ≈ 1 per minute with low early caps, matches wiki), "Statistically, in order to get a full legendary card, you would need around 800 USD" (player estimate).

Other economy facts from the forum:
- Fusion costs: a perfect ++++ needs 16 level-max base cards (1→2→4→8→16, "32 plain cards, 16 '+', 8 '++', 4 '+++', 2 '++++'" – i.e. 31 level-ups); fused cards must be maxed first or stats are lost ("train 2 cards to 14/14 and fuse them to a 14/24 ... final 44/54 and max out to 54/54" – shows a Legendary: base cap 14, +24, ++34(?), +++44, ++++54).
- "Quest 51 costs only 78 stamina to reach the boss fight"; "Q71 has good stamina/card ratio and you can receive the gold token"; "Q90"/"PQ15" hard at level 34; "Level 15 players with 30 quests done".
- Early arena matchmaking is by player level; reviewers complain level-5 players meet Ultimates in Bronze ("ridiculously powerful cards") – no strength-based matching.
- Potions: bought for 40 gems (20 during the drinking contest) per wiki; League prize "5 potions of mana"/"10 potions" (see §1).
- Forum software banned posting links to "third party sites that offer free gems" – irrelevant.

---------------------------------------------------------------------------------------------------

## 5. Shutdown (medium confidence – one search-engine summary of the official Facebook page, not verified in the page itself)

A web-search tool summary of `facebook.com/@evoker/` stated: "Evoker services were shut down on **Wednesday August 22, 2018** by end of the day, after **more than five years of magical card battling**. The shutdown was **announced on July 23, 2018**. From **July 24, 2018**, the game was no longer downloadable for new players and **in-app purchases were disabled**." I could not retrieve the verbatim post (Facebook is login-walled and not archived). Everything else (Wikipedia-style "shut down on 22 August 2018") agrees with the date. The Play listing was still live on 14 Mar 2018 and the forum "Official Announcements" list in the 25 Dec 2017 capture ends with the Dec 2017 holiday event (no shutdown thread was archived).

Forum community facts of interest: a Discord server thread exists (topic 37794, not archived), an unofficial Facebook community (topic 7330), and players noted "Flare Games will terminate the game service if there aren't enough folks playing" (1 Apr 2016, joke-ish).

---------------------------------------------------------------------------------------------------

## 6. Official site copy (evokergame.com, 2014) – tutorial/lore text

- Tagline: "Evoker | A fantasy battle card game for iOS and Android". "Play Evoker, a mighty new fantasy collectible card game for iOS and Android! As a Summoner you fight magical battles against an army of enemies, powerful bosses and other players."
- Features: "Hone your Summoner skills, step by step in solo quests / Level your character, playing through ever new quests / Decide for yourself which skills you want to boost / Collect creatures from the elves, orcs and dwarves, and reinforce them, using dragons, elementals, and demons / Grow your creatures' combat strength through battle experience / Make your creatures even more powerful through clever combinations / Challenge other players and rob them of their treasure".
- "About the game": "The world of Evoker is archaic and rough. The wild Orc tribes call it 'Xulotl', the 'bleeding disc'. The elvish name is 'Uma re'ena', which translates as 'the eternal tree'. And up in the north, in the icy mountains where the Dwarves dig, the world is known as 'the first anvil' or 'Domank Hrun' in the dwarven tongue. The player is cast in the role of an EVOKER, a summoner of creatures, a practioner of magic. It is his goal to become the mightiest ruler of all, but... there is a dreadful enemy." Google Play 2014 description: "Summon magical creatures in your fight against the evil Lord Morder".
- flaregames.com page (Jul 2014): "Evoker is a beautiful deck-building fantasy game with lots of original art."
- The 2016-17 Play/App Store description: "Join thousands of REAL players in this epic trading card game full of magic and fantasy. Summon powerful creatures. Fight hundreds of glorious adventures. Develop deadly strategies and challenge the world's mightiest players! • Win great new cards in regular events • Hundreds of quests • Challenging boss fights • Thousands of magical creatures to collect • Epic multiplayer battles".
- Event story texts (forum posts 8309/8479/8939) are full in-game quest dialogues (companion banter; "Evoker kills X"); useful for flavour. Lore: Morden is the main antagonist (a cactus on the 100th quest carries a paper marked "Morden" – the Cactus Minion is a joke), Thief of Time / Guardian of Time arc across the three Jan–Mar 2016 portals.

---------------------------------------------------------------------------------------------------

## 7. Things I looked for but could not find

- Official Facebook/Twitter/Instagram/G+ posts (all login-walled; the only capture of facebook.com/evoker is an empty shell). The shutdown post text is unconfirmed.
- Forum topics not in the Wayback Machine: 8466 Daily Login Rewards, 7383 Evoker in-game events (the master list), 7404/7646/7789/7944/8163/8661 (Desert Twilight, Dwarven Rage, Dragon Hunt, Divine Peace, Dread Empress), 41462 (Holiday event 2017), 7540 "Stamina regen", 7486 "Stamina or mana", 9001 "unused portal tokens", 8778/8863 ultimate probability, 8848 potion sale, 27542, 30530 "will we get patch notes", 30758 portal time changes, 29704 "is Evoker dead", 37794 Discord, 35219 "Evoker card stats". The support sub-forum (65) was never archived. No Helpshift FAQ articles archived.
- No XP-per-level table, no level-up reward list, no exact stamina/mana caps or regen timers from official sources (only: Lv34 = 220 stamina / 112 mana; "78 stamina to reach the quest-51 boss"; Q71 good stamina/card; wiki says 1/min).
- No patch-note posts for client versions (only the store "what's new" lines above). No press kit. No second-hand dev Q&A.
- Event images: none could be downloaded (the forum image URLs return Wayback "not archived" stubs); `frames/social/` is therefore empty. The URL list in §8 is for a retry.

---------------------------------------------------------------------------------------------------

## 8. Image URLs (Wayback `im_` form: `https://web.archive.org/web/2im_/http://<url>`)

- Easter 2016 trainer cards: content.invisioncic.com/Mflaregames/monthly_2016_03/{lichking,kristallgeist,blutdrache}.png.*
- Halloween weekly cards: monthly_2016_10/mage.jpg…, monthly_2016_11/{grabkoloss-image_1024,siameseorc,geisterarmee-image_1024,raptorialfungus}…, monthly_2016_12/{werewolfdwarf,bonedragon,cursedstag}.jpg…
- Christmas 2016 poster: monthly_2016_12/winter_event.jpg…
- Dungeon Casino banner: monthly_2017_05/Evoker_forum_banner.jpg…
- Jan–Mar 2016 portal card art: forums.flaregames.com/uploads/monthly_01_2016/post-31887-0-19234900-1453449501.png (Sentinel), …/monthly_02_2016/post-31887-0-24718200-1454661235.png (Wilderness Shaper), …/monthly_2016_03/bergyeti_es5.png.* (Mountain Yeti).
- Google Play listing (2018-03-14 snapshot) contains the store screenshots and the "Teen"/IAP block.
