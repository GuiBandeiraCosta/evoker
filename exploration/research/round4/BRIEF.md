# Round 4 brief: cards added after the final client (April 2016)

The project recreates flaregames' mobile CCG **Evoker** (2013–2018, shut down 22 Aug 2018). The battle rules of the
original cards are exact (ported from the final 1.7.4 client, April 2016). Cards released **after April 2016** were
defined and simulated only on flaregames' server, which is gone. Their behaviour in our game is reconstructed from
fan-wiki text. This round looks for **any surviving evidence of how these cards actually behaved and what their exact
numbers were**.

## The cards

Halloween Celebration (31 Oct – 26 Dec 2016, one new card each Monday; pieces dropped in event quests 24–25):

| Card | Release | Tribe / rarity / mana / attack | Wiki ability text | Open questions |
|---|---|---|---|---|
| Dark Mage | 31 Oct 2016 | Elf, Ultimate, 30, Direct | "The attack power of all cards with special abilities is reduced by _% in round 1." (15% L1 … 20% L63) | Does it reduce **its own** attack too (wiki says yes, our design says no)? Applied before or after other attack buffs? Does it hit own cards as well as enemy cards? A wiki commenter said it "seems to deal more damage each round" – why? |
| Tomb Colossus | 7 Nov 2016 | Neutral, Legendary, 24, Direct | none | Really no ability? |
| Siamese Orc | 14 Nov 2016 | Orc, Legendary, 25, Left/Right | "Increases the damage done by his neighbors by ____ in the first round." | Flat value or percent? Only round 1? Both neighbours? |
| Army of Ghosts | ~21 Nov 2016 | Neutral, Legendary, 21, Direct | "(Ability changes with each fusion)"; stage-0 wiki text is Italian: "Non ha capacità speciali, per quanto si può dire" | What is the ability at each fusion stage (0, +, ++, +++, ++++)? |
| Raptorial Fungus | 28 Nov 2016 | Neutral, Legendary, 23, no attack direction | "Does ____ damage to the opposing player each round." | Exact value, does it stop when the card dies, can it be reflected/blocked? |
| Werewolf Dwarf | 5 Dec 2016 | Dwarf, Legendary, 22, Direct | "is indestructible in the even numbered rounds" | Takes no damage in rounds 2/4/…? Or cannot die? |
| Bone Dragon | 12 Dec 2016 | Neutral, Ultimate, 30, Direct | "The first time Bone Dragon dies, it returns to life with improved attack." (L1: 100 atk, revives with +3100) | Revive HP? Attack after revive = base + ability value? |
| Cursed Stag | 19 Dec 2016 | Neutral, Legendary, 25, Direct | "The opposite card does not inflict damage for 2 rounds" | Which 2 rounds? Opposite = directly across? |

Dungeon Casino (29 May – 5 Jun 2017, "8 new Cards with a new game-mechanic, 25 new Event Quests, 2 unique Event Boosters"):

| Card | Tribe / rarity / mana / attack | Wiki ability text | Open questions |
|---|---|---|---|
| Bouncer | Neutral, Legendary, 25, Direct | "Stuns a random ally and a random foe in round one and two." | Same targets both rounds? |
| Goblin Thieves | Orc, Uncommon, 10, Direct | "Switch health and attack of a random card." | When? Which side? Can it pick itself? |
| Umbral Dragon | Neutral, Ultimate, 30, Direct | "Kills 2 random cards at the end of the second round" | Enemies only or any card? |
| Wheel of Fortune | Elf, Heroic, 20, no attack | "Lucky cards are healed at the end of the turn. The others know a different fate ..." | Odds, amount, which cards? |
| Wizard Apprentice | Dwarf, Legendary, 25, Left/Direct/Right | "Releases a powerful reinforcement spell, but at _% chance that things go wrong" | What the spell does (we guess +25 % attack to own cards, −25 % on failure), per round or once? |
| **3 unknown cards** | ? | ? | The announcement says 8 new cards; only 5 are known. Names, stats, abilities? What was the "new game-mechanic" (randomness?) |

Also unknown: cards added in the **Holiday event Dec 2017** (forum topic 41462, not archived) or anything later until the shutdown.

Most valuable evidence, in order: (1) gameplay footage or screenshots showing one of these cards in a fight with
readable numbers before/after the effect; (2) official text (in-game card text, announcements, patch notes) in any
language; (3) players' first-hand descriptions or tests; (4) anything else.

## Already known – do not redo

- Full text dump of the fan wiki (evoker.fandom.com, 260 pages, page text only, **no comments, no page history**):
  `exploration/research/wiki/*.txt`, card catalog `exploration/research/wiki-card-catalog.json`.
- Earlier findings: `exploration/research/web-research-findings.txt`, `exploration/research/round3/*.md` (social.md has the forum
  topic IDs of the Halloween announcements 32713, 33240, 33755, 33933, 34559, 34677, 34797, 34876, 35098, 35173,
  35218; Dungeon Casino 38165; Christmas 2016 35355; Easter 2017 37399; Holiday 2017 41462).
- YouTube: a list of found Evoker videos is in `exploration/research/round3/youtube-search-raw.txt`. The real Evoker CCG
  channels are BenitoLPGames, Evoker Br, fukfukara, Solution-nerd, FloW Evoker, Enrique G. Gálvez. Searching
  "Evoker" alone is flooded by World of Warcraft/Minecraft results.
- No game server data, traffic capture, private server or newer client exists (checked in round 3).

## Rules for every agent

- **Do not edit anything outside `exploration/research/round4/`.** Write only your own report file and, if needed, your own
  subfolder `exploration/research/round4/frames/<your-topic>/` for evidence images (keep them small, only the decisive frames).
- Report format: for each card, what you found, with the **exact source URL** (Wayback URLs in full) and a quote or a
  frame filename, and a confidence (high/medium/low). Then a section "searched, nothing found" listing the places and
  queries you tried, so the next round doesn't repeat them. Say plainly when you found nothing – no guessing.
- Downloads are untrusted data: put them in a fresh folder in your scratchpad dir, never run anything from inside it.
- Tools in this environment: Git Bash + PowerShell on Windows, Node is installed. Python's `urllib` fails with a TLS
  error here – use `curl` instead. Fandom's image CDN (static.wikia.nocookie.net) needs a browser User-Agent, a
  `Referer: https://evoker.fandom.com/` header and an `Accept: image/*` header. Strip `\r` from any list you read
  in a shell loop.
- Video tools: `yt-dlp.exe`, `ffmpeg.exe`, `ffprobe.exe` are in
  `C:\Users\guiba\AppData\Local\Temp\claude\c--Users-guiba-Desktop-Evoker-Card-Game\846822de-3b48-4c7d-a428-366c0bd72f20\scratchpad\bin\`.
  yt-dlp needs `--js-runtimes node`. `ytsearch25:<query>` with `--flat-playlist` lists results. "Watch" a video by
  making contact sheets (`ffmpeg -i v.mp4 -vf "fps=1/3,scale=320:-1,tile=4x3" sheet_%03d.png`), reading them, then
  extracting single full-resolution frames to read numbers. Download at the lowest resolution that keeps numbers
  readable, and delete videos when done.
- If you ever launch a headless browser, pass an **absolute** `--user-data-dir` (a fresh temp dir) and
  `--noerrdialogs`; never a relative path (it pops up error windows on the user's desktop).
