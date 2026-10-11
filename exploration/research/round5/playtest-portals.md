# Playtest: portals, portal shop, daily events, landing feed (port 8115)

Screenshots: `C:\Users\guiba\AppData\Local\Temp\claude\c--Users-guiba-Desktop-Evoker-Card-Game\5f60a16a-f52a-4277-bb01-5d3db216a6a8\scratchpad\playtest\portals\` (abbreviated `SS\` below).

## 1. What I played

- `debug.newGame('Tester')` (no tutorial record, so no tutorial to finish), `setLevel(15)` (later `setLevel(60)`), `giveGold(50000)`, `giveGems(20000)`, 5 strong cards via `addCard` (stage 4, lvl 50) as the deck, `unlockQuests(100)`, `refill`.
- Portal "The Dark Beyond" (running portal of this save): quests 1-10 played through the UI (13-17 minion taps each, boss, result popup). Portal progress was then patched through the store to done = 23 / unlocked = 24 (saves about 14 quests x 4 min on a loaded machine). Quests 24 and 25 were played through the UI, but the minion wave was patched down to 1 minion first (active quest `waves` / `figuresTotal`), then the boss was fought for real. The first two attempts at Q24 were lost (see note A); Q24 was then won with `hpMax` patched to 8000 (to compensate for `setLevel` giving no stat points).
- Portal end / rotation: `addDays(7)` x 9 (rotation walked through all 9 portals and back to The Dark Beyond) and `addDays(1)` for the daily reward. Daily events: `debug.addDays` shifts only the save, and `dailyEvent(now)` uses the real clock, so the event never changes with `addDays`. To see other event days I mocked `Date.now` in the page (+1 ... +19 days) and called `addDays(0)` (runs the on-open hooks). Events seen: Infinite Wisdom, Drinking Contest, Golden Day, Card-piece Day, Double League Points, Get the Best Cards, Great Potion Deal.
- Real UI used: main map banner, portal map, quests, boss intro / prebattle / battle (skip) / result popup, shop and booster grid, feed via menu -> Home, Arena banner, League join + one fight, Pieces tab, potion dialog, Album pages.
- Note: my first browser (and its save) was killed by the machine mid-test; I restored the save from the browser profile. The machine was heavily loaded by other agents, so a quest took 4-10 min; this is not a game problem.

## 2. Bugs / differences

### P1 - Portal map opens at the top-left, not centred on the current node (minor/major)
- Steps: portal done up to Q23 (or Q24/Q25 done), main map -> tap the portal banner.
- Expected: the map scrolls to the current node (code in `quest-map.js` "scroll to the current node": horizontal centre, 40 % of the height; the original frame `quest-map-2_portal_v174.jpg` has node 23 centred). The main map does this (scroll 3669,423 measured).
- Actual: portal map `.qm-body` scroll stays (0,0) (checked for 2.4 s). Node 24 at (1266,1890), node 25 at (1094,1901) of a 1913x2115 map, so with a late quest the player sees only quests 1-10 and must hunt for the current node.
- Screenshot: `SS\12-portal-reenter.png` (current = 24, view still at quest 1-10). Suspect `scrollTo()` at the end of the `quest-map.js` build running while the pushed screen is not yet laid out (the main map is opened via `goTop`, the portal via a push with transition).

### P2 - Portal high token in the loot popup uses the Neophyte token art, no name (cosmetic)
- Steps: win Q25 for the first time (high token drop). Expected: the portal's high token (the shop shows a triangle token, "Empyrean"). Actual: a round bronze disc identical to the Neophyte token, while the low token drop (Q6) is a silver pyramid. Neither shows a name or count. `SS\q25-r1-skip.png`, `SS\q6-r1-skip.png`, shop icons in `SS\21-shop-top.png`.

### P3 - Event/daily countdown format differs between feed and Arena/League (cosmetic)
- Feed event banner and daily strip: `0:10:20:25` (d:hh:mm:ss). Arena and League banner for the same event: `10:19:37` (h:mm:ss). The original shows the event banner as h:mm:ss (frame `quest-hub-1_v174`: daily strip `7:12:56`; `quest-map-1_v174`: "WISDOM ... 8:12:44"), so the feed should drop the leading `0:` day field (only the portal timer is d:hh:mm:ss). `SS\32-feed.png`, `SS\34-arena.png`.

### P4 - Event banner and daily timer freeze at 0:00:00:00 at UTC midnight (minor)
- Steps: stay on the feed with the clock 6 s before UTC midnight. Expected: the banner changes to the new day's event and the daily strip updates. Actual: both timers stick at `0:00:00:00` and the old event ("Infinite Wisdom") stays until the screen is re-entered; the new daily reward is only claimed on the next open. `SS\61-midnight-feed.png`.

### P5 - Last-quest bonus gold (1000) is credited silently (minor)
- Steps: win Q25 of the portal. Gold +1097 in total (1000 bonus + about 97 minion gold), but the result popup only shows the token drop; there is no "+1,000" step. Docs 4.2 say the last quest "pays 1000 gold on top" - credited, but invisible. `SS\q25-r1-skip.png`, `SS\q25-r2-continue.png`.

### P6 - Negative HP shown in the battle bars (cosmetic)
- Final frames show `-21,927 / 3,965` (`SS\06-result-a.png`) and my own `-270 / 1,740` (`SS\14-q24-battle.png`). Expected: clamp at 0 (original HP bars never go below 0).

### P7 - Dungeon Casino portal has a 6-card set (minor/data)
- Collections page for Dungeon Casino: `1/6`, all other portals `x/8` (game-design says "each an 8-card set"). Check `data/quests.json` (`cards.length` is 6 for dungeon-casino). Set reward is still 5000 gems.

### P8 - Ended portal still reachable through the route (info)
- There is no UI path to an ended portal map (good), but `router.go('quest-map', {line: 'dawn-of-eternity'})` shows the map without timer and node 1 can still start a quest of the ended portal (`quests.active.line` = the ended portal). A quest left active when its portal ends has the same exposure. Worth a guard in `quest.js` / `quests.js`.

### P9 - Debug API limits event testing (info)
- `debug.addDays` never changes the daily event (derived from the real clock), so "events across days" cannot be tested with the API alone. A `debug.setDay(n)` / clock override would help QA.

### Notes (not bugs, for context)
- A: `debug.setLevel` gives no stat points / HP (`hpMax` stays 1500-1740), so the Q24 boss (10,205 HP, attackers up to 5,500) kills the player in round 1 even with legendary lvl 50 cards (lost twice). With `hpMax` 8000 Q24 was won. A normally levelled player would have points to spend on HP; fine.
- Mouse drag does not pan the portal map (wheel / touch scroll only); I did not test a touch swipe.
- Card piece drops: none dropped in about 12 played portal quests (15 % per boss win from Q4). Roll table checked in Node over 4000 rolls: Q4 15.3 % piece, Q24 16 %, Q3 0 % (as expected). So only unverified in the UI, not broken.
- A blank "boss-intro" screen appeared once after I corrupted `quests.active` myself (bossReady false, waves patched); no console error. Probably reachable only through my patch.

## 3. Things that look right

- Main map banner: portal name + d:hh:mm:ss countdown, ticks every second, tapping enters the portal (`SS\01-main-map.png`). Banner timer equals the feed "Portal closes in", the shop "Offer ends in" and the "Coming soon" timers (all the same remaining time, all tick).
- Portal map: 25 nodes on painted sockets, rune ring on the current node, done nodes blue, locked sockets as unnumbered dots; name banner has a countdown only for the running portal; back arrow returns to the main map.
- Portal quests: stamina and gold per tap (about 57 gold at Q1 up to 97 at Q25), boss line-up, boss HP 3,965 + 260 x n (Q1 3,965, Q2 4,225, Q24 10,205), loot popup steps (Victory -> loot -> card XP), level-up dialogs, token drops (low token Q6/Q8/Q9, neophyte token, mana potion, 50 gems); first win of Q25 always gives the high token; `firstWins` / `unlocked` / `done` bookkeeping consistent.
- Shop: Neophyte, the running portal's two packs ("Offer ends in", token counts match the save), the next portal's two packs "Coming soon" with the same countdown, Summoner, Archmage; "Look inside" opens the 3x3 grid, one token spent per pick (3 -> 2 -> 1).
- Portal end (`addDays(7)`): the next portal opens in the documented order (Dark Beyond, Dawn of Eternity, Desert Twilight, Divine Peace, Dragon Hunt, Dread Empress, Dwarven Rage, Dying Dreams, Dungeon Casino, back to Dark Beyond); the old portal's packs leave the shop; its tokens stay in the save (low 3 / high 1); when it came back all 25 nodes were still done and its packs and token counts reappeared. No popups or console errors during the 9 jumps.
- Landing feed (menu -> Home): daily strip with timer, Main Quest banner, event banner with x2 badge on double events, portal banner with card fan and countdown, Get Cards (-> shop), next-portal teaser; the portal banner taps into the portal map; event/daily/next-portal banners are inert.
- Daily events verified: Infinite Wisdom doubles card XP (158 vs 79 in the same Arena fight), Drinking Contest potions 20 gems (dialog "Buy for 20"), Golden Day gold per tap x1.5 (54 vs 36), Card-piece Day first piece 50 gems, Double League Points 300 per league win, Get the Best Cards "-50 %" badges and 175 gems per Summoner pick (350 / 2), Great Potion Deal banner in the shop (60 gems -> +2 stamina +1 mana, then gone). Event name, subtitle and x2 badge match between Arena banner and feed.
- Daily reward after `addDays`: streak counting and gap reset correct (D1 after a 7-day gap, D2 next day with the toast "Daily reward (day 2): 1 stamina potion, 1 mana potion"), the strip rolls forward.
- No console errors or warnings during the whole session.
