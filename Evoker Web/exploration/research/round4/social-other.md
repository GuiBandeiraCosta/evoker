# Round 4: social media / non-YouTube / non-wiki / non-forum sources

Result: **nothing new found for any of the 13 cards, the 3 unknown Dungeon Casino cards, or the Dec 2017 Holiday event.**
Every surviving outside source is either empty, login-walled, or only repeats store copy. Details below.

## Per card findings

None of the 13 cards (Dark Mage, Tomb Colossus, Siamese Orc, Army of Ghosts, Raptorial Fungus, Werewolf Dwarf,
Bone Dragon, Cursed Stag, Bouncer, Goblin Thieves, Umbral Dragon, Wheel of Fortune, Wizard Apprentice) appears in any
non-wiki, non-forum, non-YouTube source I could reach. Confidence in "no outside evidence reachable via these tools": medium-high.

Only byproducts worth knowing:

- Local wiki dump already contains more than the brief's table implies (not new evidence, just a pointer):
  - `exploration/research/wiki/Army_of_Ghosts.txt`: stage abilities are "+: Receives no damage round 3. ++: Receives no damage round 2. +++: Receives no damage round 2 and 3. ++++: Receives no damage after round 1." Portal "Dawn of Eternity and Dungeon Casinò" (so it was re-released in the casino portal). Stage 0: Italian "Non ha capacità speciali, per quanto si può dire".
  - `exploration/research/wiki/New_Card_Halloween_Event.txt` has a summary table with ++++ numbers (e.g. Raptorial Fungus "Does 12219 damage to the opposing player each round", Werewolf Dwarf "Receives no damage in even-numbered rounds", Bone Dragon "Return to life with attack points improve 14063").
  - Wiki cards found in Dungeon Casino portal files: Army of Ghosts, Bouncer, Goblin Thieves, Wheel of Fortune, Wizard Apprentice, Umbral Dragon (Umbral Dragon.txt mentions "casin"). So the 3 "unknown" cards may include re-released older cards (Army of Ghosts is one) rather than all-new ones; this is an inference, not sourced.
- Reddit: `r/Evoker` has only 10 submissions and 5 comments in the PullPush archive (2015-11 x6 info/FAQ posts; 2017-07-30 "A maxed-out Tulzakk."; 2019-03, 2019-06 "I miss Evoker…"; 2024-09 "Evoker"). None mention any of the cards. Fetched via `https://api.pullpush.io/reddit/search/submission/?subreddit=Evoker&size=100&sort=asc` (works from this machine; reddit.com itself returns "Blocked").
- r/ImaginaryWerewolves post "Werewolf-dwarf for Evoker by Artur Fast" (https://www.reddit.com/r/ImaginaryWerewolves/comments/zj1hsu/) is only concept art credit for Werewolf Dwarf (artist name Artur Fast); no mechanics. Confidence it is irrelevant to mechanics: high.

## Searched, nothing found

Wayback Machine (CDX API; it was intermittently "Temporarily Offline" / HTTP 429 during the run):
- `facebook.com/evoker*`: only one capture of the page, 2022-08-20, an empty shell. No `/posts`, `/photos`, `m.`, `mbasic.` captures. `facebook.com/EvokerGame*`, `facebook.com/EvokerCCG*`, `facebook.com/evokergame*`: no captures. `facebook.com/flaregames*`: only unrelated 2013 root and 2025 videos.
- `twitter.com/EvokerGame*`: nothing (there is no Evoker account; only `@flaregames`). `twitter.com/flaregames/status/*`: captures start 2018-08+ (shutdown era, 2019-2021 ones), none 2016-2017 checked; not Evoker card content.
- `pinterest.com/pin/*evoker*`: no captures. `instagram.com/evoker*`, `*.tumblr.com/*evoker*`, `discord.gg/*evoker*`: nothing.
- `evokergame.com/*`: only 2014-2016 WordPress shell and the single 2013 dev-blog post (`?p=1`), nothing about 2016+ cards.
- Forum topic 41462 (Holiday event Dec 2017): Wayback has three captures dated 2018-01-02 for `http://forums.flaregames.com:80/topic/41462-evoker-holiday-event/` but all are status 301 and replaying them gives 404, i.e. content NOT recoverable. Topic 38165 (Dungeon Casino) and 37794 (Discord): CDX was offline when queried; round 3 had already found them unarchived.

Live web (WebSearch; the tool's index is very poor for Evoker, returns mostly WoW/Minecraft/MTG/Yu-Gi-Oh noise):
- Queries (English): "Evoker flaregames Dungeon Casino new cards"; "Evoker card game Umbral Dragon OR Wheel of Fortune OR Bone Dragon OR Dark Mage flaregames"; "Evoker Bouncer Goblin Thieves Wizard Apprentice card"; "Evoker TCG Cursed Stag OR Raptorial Fungus OR Siamese Orc OR Tomb Colossus OR Army of Ghosts"; "Evoker flaregames Dungeon Casino event 2017 cards Wheel of Fortune Bouncer"; "Evoker game Holiday Event December 2017 flaregames new cards"; "Evoker Dungeon Casino portal Wheel of Fortune Goblin Thieves Bouncer" (fandom/taptap/mmos blocked); pinterest/discord variants; verbatim ability strings: "Lucky cards are healed at the end of the turn", "Stuns a random ally and a random foe" Evoker, "reduced by" "all cards with special abilities" "in round 1".
- German: "Evoker Kartenspiel flaregames Halloween 2016 neue Karte Dunkler Magier / Knochendrache / Werwolf-Zwerg". Spanish/Portuguese: "Mago Oscuro / Dragón Óseo / Dragão de Ossos / Mago Sombrio". Russian: "Умбральный дракон / Колесо фортуны / Костяной дракон". All returned nothing relevant.
- The only Evoker-relevant hits were the already-known wiki pages (evoker.fandom.com card pages), TapTap (https://www.taptap.io/app/14121: no card content, no 2017/2018 events), MMOs.com, AppGamer, GameFAQs data page, fileplanet/uptodown APK mirrors. WebFetch of toucharcade.com/games/evoker and appgamer.com returned 403.
- Social domain-filtered search (facebook/twitter/instagram/tumblr/pinterest) could not run (vk.com not allowed by the tool); the unfiltered variants found nothing.
- Not reachable/not tried: Facebook group `facebook.com/groups/evokerforum` (closed, login), `facebook.com/download/preview/859911397433824` (Godlike mechanics doc, login), VK, Brazilian Facebook/WhatsApp/Telegram groups (no public pages surfaced by any search), Discord (server from topic 37794 unnamed, no invite found).

## Suggestions for later rounds

- Re-run Wayback CDX for `forums.flaregames.com/topic/38165*` and `topic/37794*` when the Archive is back online (it was down mid-run), and check `archive.ph`/`archive.today` for forum topics 38165 and 41462.
- Evoker Br / BenitoLPGames etc. YouTube videos of the Dungeon Casino portal (another agent's area) remain the best chance for the 3 unknown cards and for Wheel of Fortune odds.
