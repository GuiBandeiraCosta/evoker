# Round 3: League length and league points (arena / pieces / double days)

Frames: `frames/league-timing/`. Sources: flaregames forum (Wayback captures of forums.flaregames.com, Evoker "General Discussion" = forum 64), videos 0FHHEDEqb1I (Evoker Br/"GamePlay", 2016-05) and 8EaxSJt_wjc (2016-01, client 1.7.3), the unpacked 1.7.4 Lua client (`exploration/apk/lua`), the local wiki dump.
Wayback was "temporarily offline" for part of the run; several Evoker topics (e.g. 28675, 32525, 34568, 8467) have no usable capture.

## Q1. How long did a league last?

**Answer: 24 hours (a league never runs longer than 24 h). Confidence: high for "24 h maximum / one league = about one day", medium-low for "starts at a fixed time of day" (see below).**

Evidence
1. Forum topic 32157, "Joining a league, sometimes no point." (General Discussion, 2016-09-16..10-01), http://forums.flaregames.com/topic/32157-joining-a-league-sometimes-no-point (Wayback 20171222125803):
   - Darth8rown: "Ive just joined a fresh league as part of the regular every day routine. The difference this time is that I noticed after joining that this league as 14 hours left to run. Seriously, what is the point!!!"
   - 1341393: "Plus, I'm usually slumbering by the time the league finishes..."
   - CyberSpider: "I myself would rather join a league with 14 hours compared to 24 hours."
   - jukka: "i'd prefer to play two 12-hours leagues than one whole day league."
   - Stimmed: "starting from the bottom, after 18 battles, I always end up near the top."
   So a full league is 24 h ("a whole day"), players routinely join every day, and you can join one that is already partly elapsed (14 h left).
2. Client string format: `ui.components.league.comp_league_top_bar` formats the timer as `%d:%02d:%02d:%02d` (d:hh:mm:ss), counts down per second from the server `timeout`, shows `FINISHED` at zero (`game.leaguemanager`: timer fires -> `requestLeagueInfo` + `leagueFinished`). Other strings: "Tournament finished: Collect your reward!", "Take your Reward and enter the next League:", "Join League", "You can access the leagues upon completing level 10" (en loca). The length itself is server data, not in the client.
3. Every timer seen is below 24 h and the d field is always 0:
   - 8EaxSJt_wjc @ 0:09: `0:23:45:11`, 15 min after a league started (all rows 0 points). Wiki screenshot "Evoker-bronze-league.jpg" (level 5): `0:23:47:56`.
   - 0FHHEDEqb1I @ 0:58 / 3:00 / 3:52 / 5:06: `0:17:09:12`, `0:17:07:11`, `0:17:06:18`, `0:17:05:04` (frames `0FHH_league_timeline_a/b.jpg`). The countdown follows real time (122 s between the first two). Max 23:47:56 observed.
4. Wiki (local dump `exploration/research/wiki/Leagues.txt`) is empty ("."), so it adds nothing. The rules popup in 0FHH @ ~1:08 (PT) says only "Apos cada torneio, os tres jogadores com mais pontos avancam..." (no duration; text is server-sent, not in `loca_en`).
5. Forum 28092 (10-12 June 2016, Wayback 20160613140238) players describe the same cadence: "tail the league leaders up until the last 30 minutes" before the end, and move Bronze -> Silver the same day ("wait to start Silver league"), consistent with one league per day.

Start/end time of day: **not pinned.**
- Events and the daily reward are on a server clock: in 0FHH @ 0:19-0:20 the daily-reward strip reads `0:11:13` and "Sabedoria Infinita x2" reads `1:11:03` (`0FHH_event_vs_daily_timers.jpg`), i.e. daily events end exactly 1 h after the daily-reward reset (same relation in Evoker Br ET5ite: reward 20:07:28 vs "Dia do Torneio x2" 21:07:13, and portal closing `4:07:07:13`).
- The league end does not line up with that clock. 0FHH: league ends reset + ~16:57. 8EaxSJt_wjc: banner "Day of the TOURNAMENT x2 ... 2:07:41" at 0:03 and league `23:45:11` at 0:10, so the league ends ~21 h 37 min after that event ends, a different offset (about 5.7 h apart from 0FHH, assuming the same event-to-reset rule). So leagues are not all cut at one fixed daily time. Best reading: each league is a 24 h window that begins when that league (group) is created (the 8Eax and wiki-screenshot players both joined within ~15 min of a start, the 8Eax one right after "Bronze League completed, Your rank: 32 / Enter the next league: Join League"). Players who join later get the remaining time (the 14 h case). This is inference (medium-low).
- "Day of the Tournament x2" itself is a one-day (daily-event) banner; countdown seen 21:07:13 and 2:07:41, i.e. it runs to the daily event boundary.

## Q2. League points from arena and piece wins; losses; what "double" does

**Answer: League fight win = +150 (certain). Arena wins and Piece (card-piece) wins also add league points, but in variable amounts that are NOT 150 (observed non-multiples of 150; exact formula unknown). Losses: no evidence of points (assume 0). Double PvP points day = x2, 300 per league win (certain for league fights; not shown for arena/pieces).**
Confidence: +150 high; "arena and pieces also count" high (3 sources); "amount varies" medium-high; exact arena/piece numbers and loss behaviour: could not be determined.

Evidence
1. Forum 28092 (Wayback 20160613140238), 1341393: "league points are not just coming from league pvp battles, but for card pieces and arena battles too." and "Well, it's twice the points for pvp wins now". DEATHCORE: "...it's just because of fighting between in there and card piece, boosted by double pvp points." 1341393 describes the strategy "I do the rounds of pvp for card pieces, check back on my score, then compute how I would end up if I battle league players and win."
2. Forum 32157, CyberSpider (2016-09-26) answering edguy ("If i win i get always 150 points. No matter do i have all fife cards or only three cards"): "You gain the 150 league points for wins in league battles, Some days you get double/300 per win. To answer the question though... You can get various amounts of league points for wins while battling for card pieces or wins in the arena." jukka: "@CyberSpider is right". Same thread: edguy "how can someone have example 62 points in league?" (small scores exist). Also 28092, Demnogonis asks how many points an arena/piece win gives ("is there a way to know how many points you take after a victory in arena or for pieces? i always thought that is depends by level card and level between me and my opponent") and gets no number.
3. Video 0FHHEDEqb1I (league list, Evoker Br, real time): player GAMEPLAY-BR 1050 -> 1200 -> 1350 -> 1500 = +150 per league win. Meanwhile the leader michaelushka moves 1759 (0:58) -> 1878 (3:00) -> 1899 (3:52) -> 1930 (5:06) = +119, +21, +31, i.e. gains that are not 150 (arena/piece wins by another player, or a different mechanism). Scores in the list that are not multiples of 150: 745, 700, 253, 198, 180, 153, 59, 58 (`0FHH_league_timeline_a/b.jpg`, cardstats `league_bronze_list.jpg`).
4. Client 1.7.4 (`ui.components.comp_enemy_entry`): each arena opponent row has an optional `pvpPoints` label with the league-points ring icon (`pvp_points.png`), created only if the server sends `pvpPoints`. So the arena row shows the points at stake per opponent (per-opponent value, plausible reason for the variable amounts); I could not find a frame of a 2016 arena list with a league active to read the numbers (frames of the Arena tab in the videos I scanned showed only the Pieces tab or an inactive list). Piece-fight rows (`ctrl_pvp_piece_list`) show no points in code. The result screen (`pvpcardresult_screen`) only handles gold/gems/potions/card XP/piece; it shows no league points.
5. Wiki `Arena__PvP_.txt`: "Fighting in the Arena costs Mana and can get you Tournament Points." and for Pieces "Fighting for Card Pieces also costs Mana and can get you Tournament Points."; Game_Basics: "Mana is used for all Arena or Tournament fights"; Player_Stats: "Battles won - is count of all won battles in League, Arena and Pieces battles."
6. Double day (8EaxSJt_wjc, `8Eax_doubleday_banner_timer_300pts.jpg`): banner "Day of the TOURNAMENT x2 / DOUBLE PVP POINTS 2:07:41"; after the player's first league win (level 5 -> 6) the list shows the player's own row and five other players at exactly `300` points, rank 11 (shared). 300 = 2 x 150, so double day doubles the league win to 300. Forum 32157: "Some days you get double/300 per win." Banner wording is "DOUBLE PVP POINTS" (PT "PONTOS DE PVP EM DOBRO"), and forum users say "twice the points for pvp wins" and treat it as boosting card-piece/arena points as well (DEATHCORE: "card piece, boosted by double pvp points"), but no frame shows an arena/piece amount on a double day.
7. Losses: no source mentions points for a loss. League points are described only for wins everywhere ("wins in league battles", "points for wins"). Not determined (treat as 0).
8. Side facts: no daily login rewards before ~Feb 2016 (1341393); matchmaking for card pieces by level of whoever holds the piece (forum 27170: levels +-10-20, 99-103 usual at lvl 101). Gold-league scores of ~10 000+ (10832 quoted, several players tied) and Bronze/Silver top-3 prize talk are in `social.md`.

## For the recreation
- League length 24 h, countdown d:hh:mm:ss (d=0), joinable late, a league can be joined with less time left (14 h example).
- League win +150 (300 on "Day of the Tournament x2" days); arena and piece wins add smaller, variable league points (observed order of magnitude 20-120, unknown formula; a sensible guess is a per-opponent value shown on the arena row, higher for harder/higher-level opponents); losses 0.
- Double-PVP day: confirmed x2 for league fights only.

## Could not be determined
Exact arena/piece point values and formula; whether a loss gives points; whether double day doubles arena/piece points; the true start time of a league (fixed daily time vs created when its group fills); the end-of-day boundary of the "Day of the Tournament" event beyond the observed countdowns. Wayback gaps: topics 28675, 32525, 34568, 8467 and 28092 page 3 not retrievable; fandom Leagues page is empty in both the dump and the Wayback copy (evoker.wikia.com/wiki/Leagues, 2016-01-05 and 2017-12-25).
