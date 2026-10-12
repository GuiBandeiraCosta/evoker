# Evoker Web — Status (2026-10-12, publishing)

## How to play

```sh
cd "C:\Users\guiba\Desktop\Evoker Card Game"
npm start            # static server, no dependencies
```

Open http://localhost:8080 in Chrome, Edge or Firefox. The game saves itself in the browser's localStorage
(`evoker.save.v1`); the orange arrow at the right of the bottom bar → Options has music/FX volume, export/import of
the save and a reset.
Sound starts after the first tap (browser autoplay rule).

Other commands: `npm test` (658 unit tests), `npm run test:e2e` (end-to-end regression suite, one test per reported bug,
`docs/dev/testing.md` §7), `npm run smoke` (plays the opening and the first quest and opens every
screen in a headless browser, 30 steps), `node tools/qa-core-loop.js`, `node tools/qa-cards-economy.js`,
`node tools/qa-pvp.js` (scripted QA playthroughs with screenshots: 33/33, 39/39 and 28/28 steps after the day-3 playtest round),
`node tools/make-gallery.js` (rebuilds `tests/screenshots/gallery.html`).

**Testing snapshot**: `C:\Users\guiba\Desktop\Evoker Card Game - testing` is a frozen copy of the build from
before round 5, kept for testing with its conveniences (Portal archive, the feed on the Quest button, Character tabs, …):
`node tools/serve.js 8081` there, then http://localhost:8081 (its own port, so its save is separate). This folder
is the evolving game.

## Day 2: the original client

The genuine Android client 1.7.4 was obtained from two mirrors (identical SHA-256), its signature verified
(flaregames GmbH certificate), and unpacked without ever being installed or run. It is a Corona SDK app, so its
contents were fully recoverable:

- **Battle rules**: the real simulator was disassembled from Lua bytecode and the web engine is now a literal port
  of it (18 ability types, exact phase order, event loop, 20 % tribe bonus, end conditions). It reproduces all 64
  of the client's own simulator unit tests. Spec: `docs/design/original-engine.md`; ability data model:
  `docs/design/ability-encoding.md`.
- **Look**: 645 original UI sprites (HUD, nav, buttons, frames, bars, card frames and plates, puzzle pieces,
  battle effects, banners), the original fonts (Proxima Nova, CG Times) and colour palette, the original quest
  map (stitched back from 420 tiles by edge matching), the minion cut-outs and boss portraits, the arena backdrop.
- **Sound**: all 201 original effects and music loops, wired to UI clicks, screens, battles and rewards.
- **Text**: the intro lore, name prompt and the client's own UI strings.

Inventory: `docs/design/apk-assets.md`. Raw material: `exploration/apk/` (APK, extracted assets, disassembled
modules, data tables, tools), `assets/orig/`, `exploration/apk/data/`.

## Round 3: closer to the original (evening of day 2)

Research by subagents: 29 gameplay videos (2014–2017, incl. a Dec-2017 recording of the final client), the
flaregames forum and store pages through the Wayback Machine, and the other client versions 1.7.0–1.7.3 (now in
`exploration/apk/versions/`). Findings: `exploration/research/round3/*.md` with evidence frames; the binding choices are in
`exploration/research/round3/DECISIONS.md`; what still differs from the original is in `exploration/research/round3/remaining-gaps.md`.
Key facts: 1.7.4 is the final client; all later content, card stats, quests and prices came from the server
(`evoker.trackingflaregames.net`, never archived), and live fights were simulated on the server.

Changes:
- **Stats**: growth within a stage is `start + (cap − start)·t^1.1` (fits 21 mid-level card faces from videos to
  0.3 %; the old geometric curve was off by up to 52 %). Siren is Uncommon. Tamer's caps derived from its L7 row.
- **First session**: scripted opening fight vs the Worm Shaman (ported from the client's `script_intro_fight.json`)
  and the burning-tower intro; start with Envoy + Master Brewer, 200 gold, 0 gems, 2 deck slots; the quest-1
  forced loss and the drag-into-deck lesson; original ranger/Worm Shaman lines; name asked at first Arena entry;
  a returning player lands on the landing feed (daily reward, events, portal, shop banners).
- **Progression**: player XP from minion taps; the original "Level up! / Points x/12" dialog (gold 50 × level, gems
  and potions at some levels); "… Unlocked!" popups; unlocks fusion 2, arena 4, training 5, league 6 (a tutorial game
  since round 5: after quests 3 / 8 / 9 / 10); deck slots open after quests 2/4/7; collection cap 100.
- **Quests**: stamina per tap 2 → 7 by quest, flat gold per tap with "Perfect!" bursts; client training-price formula.
- **Battle**: original pacing (attacker every 1.5 s, rounds speed up), boss intro artwork that auto-advances, the
  Loading → tribe-bonus (+20 %) → ROUND 1 sequence, red damage numbers, the original result flow (banner → loot →
  "★ Level n" card XP bars → level-ups).
- **League**: Bronze/Silver/Gold, 50 players, ties share ranks, prizes to rank 29, top 3 promote, +150 per league
  win; Arena/Pieces wins add opponent-dependent points (Arena 20/60/120 by row colour, Pieces ~30, scaled by level gap;
  the stake is shown on the Arena rows). League length 24 h confirmed (league-timing.md).
- **Shop**: 3×3 face-down booster grid paid per pick (token or gems), the original pack banners; gem packs are
  display-only.

Answered (day 3): player XP comes from taps (client code: quest `xpGain` per tap); leagues last 24 h; Arena/Pieces
league points vary by opponent. Gem packs stay display-only. Player HP may show negative values after an overkill.

## Round 5: "exactly like the app" (2026-10-09)

The user played the original and asked for the final 1.7.x client's look and behaviour, removing our own
conveniences where the original had none. Reference: the user's 2016 screenshots in
`exploration/research/round3/frames/user/`, the client's layout modules and strings. Four agents (tutorial, cards, menus,
map/shop) and an integration pass:
- **Navigation**: the middle nav button goes straight to the quest map (the landing feed is shown at login and
  through Home); the orange up-arrow opens the extended menu (Album, Profile, Options, Home); main tabs have no
  back arrow ("?" alone, Escape = back), sub-screens do; tapping the HUD's level / stamina / mana bar opens the
  profile (best card, stats with Bonus column, Quest, Battles won, Your cards, Support). The Character tab bar is
  gone (Profile and Options are pushed screens). Nav padlocks and badges follow `state.isUnlocked`, so a tutorial
  game opens the Arena after quest 8 and the League after quest 10.
- **Cards**: the client's deck screen with its three modes (deck, training, fusion) over a mode stripe and the big
  card slider that starts at the left end; drag and drop only.
- **Map / shop**: no Portal archive — only the running portal's banner + timer on the map; an ended portal can't be
  entered until the rotation brings it back (its progress and tokens stay in the save, its packs leave the shop).
  Shop = Neophyte, current portal, next portal ("Coming soon" + countdown), Summoner, Archmage banners.
- **Arena**: opponent rows like the user's screenshot (difficulty-coloured frame and name, level, HP, info, attack);
  Pieces as a 4-per-row puzzle grid.
- **Tutorial** (1.7.0 video): "Showdown!" on quests 5 and 10, no "Quest n unlocked!" toast; player level-ups at
  quest 3 / 5 / 8 / 10 like the video (XP table for levels 1–4: 47, 47, 92, 94; level 5+ unchanged); a fusion gives
  the full stage stats (the video's fused Throat-Cutter counts up to 230 / 115 — no evolve penalty for low-level
  inputs); no daily reward on a new game's first day (the calendar starts the next day).
- Fixed in integration: the Options screen's settings (speed / toggles / volumes) had lost their save function.

## Playtest round (day 3)

Six QA agents played the round-5 build end to end in headless Edge and wrote reports
(`exploration/research/round5/playtest-*.md`): the tutorial (opening to quest 10, compared frame by frame with the 1.7.0
video), progression (new game to level 10), battles (playback traced every 40 ms), cards and shop, portals / daily
events / landing feed, and PvP (Arena, Pieces, Replays, League). Fixed afterwards by three agents plus an integration
pass:
- **Battle**: plain digits in fights; effects of dead cards no longer drawn in the corner; the per-round player
  max-HP re-application folded into one silent step; reward token sprites and portal token names; the piece-win and
  last-portal-quest bonus loot steps; the pre-battle bar reads "Mana needed: deck cost / max mana" like the client.
- **Tutorial**: no daily event while it runs (the event, its banner, prices, potion deal, league double points and
  double card XP all start after the tutorial); flat gold per tap in quests 1-10; the scripted "amateur mage"
  Baltasar holds the tutorial piece; Q9 without tribe bonus; in-fight lines timed from their round; alpha sparkle
  frames; Q8's enemy order of the video; the early card-XP curve fitted on the video's card levels (Master Brewer
  level 1 until the Q5 win, game-design §2.7).
- **Sets**: the main-line album sets Dwarven Apprentice, Elven Novice, Orc Grunt and Arborearch, read off the /26
  client's album pages in two videos (`exploration/research/round5/starter-sets.md`): "Card added to set: Orc Grunt 1/8"
  after quest 1 like the video, album pages after the portals, and the album "!" badge for set cards not shown yet.
- **Menus / portals**: the portal level gate ("Reach user level 8 to enter portals."), the portal map centred on the
  current node, ended portals unreachable by route, the daily event following `debug.addDays`, daily-reward toasts
  with their own icons, help texts that disagreed with the game.

Deliberately left as they are: the deck screen's card row starts at the right edge (as in the client's slider);
quest 13's difficulty (its boss comes from the wiki data); the two village landscapes for every quest; dropping a
card on a locked deck slot is silent (as in the client). The slower early card levels make the quest 13-26 stretch
somewhat harder than in the playtest. Checks at the end: 649 unit tests, smoke 30/30, QA 33/33, 39/39, 28/28, no
console errors.

## Refactor (day 3/4)

A clean-up of the whole code base with no change the player can see: same screens, timings, sounds, numbers,
seeded RNG order and save format (`evoker.save.v1`; fields only old saves carry stay readable). Plan and evidence:
a read-only survey (dead exports, import cycles, unused CSS, duplicated tables, leaks), then five packages in
parallel (game logic, UI shell / battle playback / CSS, quest screens / tutorial, cards / PvP / shop screens,
tools) and a final pass over tests, hand-offs and docs.

- **Game logic**: one source of truth for every tuning number (`src/core/constants.js`, regrouped); dead and
  leftover code removed (manual portal, rerolls, level-based deck slots — old saves are still sized by
  `legacyDeckSlots`); the import cycle of the PvP modules (arena ↔ league ↔ rewards ↔ pieces) broken by
  `src/game/pvp.js` (the shared PvP fight).
- **UI**: the battle player split into `src/ui/battle/` (timeline, board model, assets, effects) and the larger
  screens into helper modules (quest map / quest, cards, arena / PvP, character, battle result); the re-export
  barrels removed; `screens/index.js` is a plain id → screen map; dead CSS rules and the unused card level-up popup
  deleted; no import cycle left.
- **Tools**: one shared harness for the smoke test and the QA scripts (`tools/qa-lib.js`, in-process server).
- **Tests**: 27 files → 24 domain files (`game-state`, `game-cards`, `game-quests`, `game-pvp`, `battle-ui`,
  `league`, `shop`, `tutorial`, `menus`, `data-wiki`, …; no round names), shared fixtures in
  `tests/fixtures/real.js`; 649 → 646 tests (only tests of deleted code went: the unused boss-portrait table, two
  that P1–P5 removed with their code).
- **Bugs fixed on the way**: Enter / Escape no longer swallowed by a dialog that a navigation had force-closed;
  the router drops the DOM and context of left screens instead of keeping up to 20 of them; the landing feed's day
  timer stops when the feed is left before its first tick; the finished-league re-render no longer hits whatever
  screen is current; the card-detail zoom key listener and the boss-intro sound timer are cleared when leaving.

Lines before → after: src 22,884 → 22,123; css 4,682 → 4,528; tests 11,214 → 11,221 (reorganised, 3 fewer files);
tools 7,862 → 7,337 (js 6,104 → 5,579, py unchanged); dev 891 → 429. Checks: `npm test` 646/646, smoke 30/30,
QA 33/33, 39/39, 28/28, the battle playback recorder identical to the pre-refactor build, no console errors.

## What is in

- 195 of the 200 original cards (the five Dungeon Casino cards were removed on request; stats per level and fusion stage from the fan wiki, abilities in the original buff
  model, original artwork for 837 card/stage images), 4 tribes, 7 rarities, the 100-quest main line and the
  8 portals with their 8-card sets, bosses and rewards.
- Every screen of the original: title with intro, quest map with portals, quest (minion taps, waves, rewards,
  potions), boss intro, pre-battle with drag-and-drop deck placement, animated battle with original effects and
  sounds, cards (collection, deck, training, fusion), card detail, set collections, arena, card-piece hunts,
  replays, daily league, shop and booster opening, profile, options, daily reward calendar, set album, help.
- Simulated players for Arena/Pieces/League, daily events and login rewards, real-time stamina/mana regeneration,
  player and card XP, fusion economy.

## Known rough spots (none blocking)

- Quests use only the two village landscapes from the APK (peaceful, then burned). The original changed the landscape
  per quest (cave, snow, swamp, …), but those paintings came from the server and are lost; the user chose to keep
  the two villages rather than rebuild landscapes from video frames.
- Numbers the client never contained (they lived on the server): card stats come from the fan wiki (83 cards
  complete; a partly known card's missing stage caps follow its own curve — rarity table × its median ratio —
  and the 36 cards with no checkpoints use the plain rarity table; growth curve video-verified;
  `exploration/research/round4/level-data-gaps.md` lists every gap), boss decks past quest 60, simulated opponents
  and some prices are reasoned guesses (`docs/design/game-design.md`, round-3 reports).
- Quest nodes sit on the painted sockets and follow the painted roads (hand-checked routes in exploration/tools/build-map.py,
  100 main + 4×25 portal sockets); the numbering direction (west end = quest 1) is our assumption, and the section
  names are fixed blocks of 17 quests, so a name may not match the painted terrain. The 8 portals share 4 map paintings.
- Cards released after the 2016 client (Dungeon Casino set, Thief of Time, etc.) use documented engine extensions.
- Arena and replay rows show an empty inset box that the original filled with reward icons.
- Touch drag-and-drop works with pointer events but was only verified with mouse automation.

## Where things are

- `exploration/research/` — research brief, full wiki dump, original screenshots, raw findings.
- `docs/design/` — game-design.md (rules/numbers), architecture.md (module and screen contracts),
  original-engine.md, ability-encoding.md, apk-assets.md.
- `docs/dev/` — testing.md, audio.md. `tests/screenshots/gallery.html` — gallery of the automated runs.
- `src/` — game (`core`, `engine`, `game`, `ui`); `data/` — cards, abilities, quests; `assets/` — card art,
  original UI/sfx/fonts/map under `assets/orig/`.

## 2026-10-11: ranger bug, repository cleanup, flow page

- Fixed (reported with screenshots): the tutorial's ranger stood at the bottom left of the Cards screen in its
  training and fusion modes for every player. The static `.cards-guide` image is gone (only the tutorial overlay
  draws her); regression `tests/e2e/cards-modes.e2e.js`, registry `docs/dev/testing.md` §7.
- **Repository layout.** Everything that was found rather than written now lives under `exploration/`
  (`exploration/README.md`): `apk/` (was `research-apk/`), `research/` (was `docs/research/`), `tools/` (the five
  Python extraction scripts and `import-art.js`, formerly in `tools/`). `data/orig/` was deleted: four of its files were
  byte-identical copies of `exploration/apk/data/`, `prepackaged-map.json` joined them there, `round3/clients.json`
  sits next to its report. Browser-test screenshots moved from `tools/screenshots/` to `tests/screenshots/` and the
  contact sheet is `tests/screenshots/gallery.html` (`npm run gallery`). The `dev/` component gallery was removed
  (superseded by the real screens, the smoke screenshots and the Card Lab). The unreferenced `assets/ui/potion-stamina.jpg`
  and `guide-ranger-cut.png` went too. A code-only zip of the pre-cleanup tree is on the Desktop
  (`Evoker Card Game - pre-cleanup-2026-10-11.zip`).
- **Code reduction** (three agents, one area each, no player-visible change): test-only exports and dead CSS removed,
  duplicated helpers merged (`keyActivate`, `mapDirs`, the stun handlers calling `no_buff` / `no_damage`, shop's
  shuffle = `opponents.shuffle`, the QA scripts' step boilerplate into `tools/qa-lib.js`), `screen:leave` dispatched by
  the router instead of four `onLeave` copies. Lines: src 22,609 → 21,948; css 4,570 → 4,556; tools 5,506 → 5,470;
  tests 12,030 → 11,948. Tests: 660 → 658 (the two tests of deleted helpers `db.random` and `clearStatCache`).
- **`docs/app-flow.html`**: a visual page that explains how the application flows (boot, screen model, navigation graph, state,
  the quest loop, the battle pipeline, tutorial, economy, PvP, data pipeline, assets, tests). Open it through the dev
  server (`http://localhost:8080/docs/app-flow.html`).
- Checks at the end: `npm test` 658/658, smoke 30/30, e2e 8/8, QA 33/33, 39/39, 28/28, `build-cards --check` clean.
- Known doc drift, not fixed: `docs/design/architecture.md` §3.3 still shows the older `effects` ability format (the
  real model is `docs/design/ability-encoding.md`) and §3.4's save example has pre-round-5 start values (300 gold,
  potions); `constants.PLAYER_START` is the truth (200 gold, 0 potions).

## 2026-10-10: reported bugs, regression suite, CLAUDE.md

- Fixed: the boss intro's card stayed stuck in the middle of a boss pre-battle after viewing a card and coming back
  (the screen was rebuilt with `params.intro`; now one-shot and the flight cannot strand the screen).
- Fixed: a reflecting card dissolved before its bounced damage was drawn (the engine logs the death first; the
  timeline now orders the death after the reflects it sources - `orderDeathsAfterReflects`).
- Fixed: the opponent row's card numbers were covered by the frame overlay (the top stat strip now mirrors the
  bottom one's clearance).
- Fixed: "the fight skips to the end / the cards just disappear and I win" - a fight ending on a lethal blow replaced
  the killing step with the finale, so the blow was never drawn and the board vanished with the loser's bar still full.
  Now the whole last round plays in order (the engine finishes the round after the HP crosses zero), the bars go
  negative on the hits, the cards stay, and only then come the starburst and the banner (user's choices; the
  original wiped the board the moment the HP crossed zero).
- Removed (user's request): the Dungeon Casino portal and its five cards (Bouncer, Goblin Thieves, Umbral Dragon,
  Wheel of Fortune, Wizard Apprentice) - the gambling effects were more confusing than fun. `data/card-overrides.json`
  `$removed` lists them, the build drops them, `state.js pruneRemoved` cleans old saves on load, Army of Ghosts keeps
  only Dawn of Eternity. The engine keeps the wheel/gamble/swap handlers (unused). 195 cards, 8 portals.
- New: the Card Lab (`?lab`): any card at any stage/level in a minimal scenario on the real battle screen with the
  engine log listed after (`src/ui/screens/lab.js`, `tests/e2e/card-lab.e2e.js`).
- Art: the fusion-stage images recovered from the wiki (42) and the generated stand-ins (112) are wired in
  (`exploration/research/round4/art-wired.txt`): 197/200 cards now have five distinct stage images (the three trainer
  cards cannot fuse). Wizard Apprentice has its real art; Cursed Stag, Tomb Colossus and Werewolf Dwarf got a full
  base art (mirrored from their recovered + image) instead of a 100x100 icon; screenshot-sized art was cropped.
- New: `tests/e2e/` (node:test on the repo's headless driver, `npm run test:e2e`), the rule that every reported bug
  gets a regression test (registry table in `docs/dev/testing.md` §7), `CLAUDE.md` at the root, the battle
  screen's `data-ended` test hook, and `stats.js` fallbackScale (missing stage caps follow the card's own curve).

## 2026-10-12: publishing (Cloudflare Pages)

- New: `tools/stage-site.js` copies the runtime entries (`index.html`, `css/`, `data/`, `src/`, `assets/`; 2874 files,
  184 MB, no `.md`) into the git-ignored `dist/` and writes `_headers` (code and data `no-cache`, art cached a week).
  `npm run stage` / `npm run preview` (serves `dist/` on 8090 through `serve.js --root=dist`) / `npm run deploy`
  (stage, then `wrangler pages deploy` via `npx`, project `evoker`, production branch `main`). README "Publishing"
  has the one-time account setup. No dependency, no build step: the game still runs from the source tree.
- Verified: `npm run smoke --base` against the served `dist/` passes 30/30 with no console errors and the server
  logged no 404, so the staged copy is complete. `tests/stage-site.test.js` pins the entry list, the filter, the
  headers and the scripts.
- Not done yet (the user's call): the Cloudflare login and the first upload. Nothing was pushed to GitHub; the
  repository keeps both `Evoker Web/` and `Evoker iOS/`, only the web folder is published.
- Hosting facts to remember: the site must sit at a domain root (the HTML, CSS and JS use absolute `/assets/...`
  paths); saves are per browser in `localStorage`, the settings screen's export / import is the backup path; no
  service worker, so the game needs a connection to load; Arena and League stay simulated locally.

## 2026-10-12: five requests (HUD, opening fight, pacing, drag scrolling)

- HUD: the "?" sat in its plate's top-left corner on the phone and the stamina / mana bars looked shifted (user's
  screenshot). Not reproducible in Edge, Firefox or desktop WebKit (Playwright) at any scale; the likely causes are
  WebKit's button layout and iOS text inflation. Fixed defensively: the icon is centred by the button's flex box (no
  absolute positioning inside a `<button>`), buttons drop the platform theme (`appearance: none`), `html` sets
  `text-size-adjust: 100%`. Pinned in `tests/ui.test.js`. Worth a re-check on the phone.
- Opening fight: it drew its own orb missiles ("shooting weird balls"). `renderFight` (src/ui/tutorial/opening.js)
  now plays the script through the real fight's effects (`createFx` of src/ui/battle/fx.js: attacker glow, beam.png
  bullet, impact bursts, red HP strip, floating numbers, shatter) - the same primitives battle-player.js uses, so
  the opening looks like every other fight. The script's events, sounds and timings are unchanged; `introTarget`
  maps its keys to the board. The orb / damage-text CSS of tutorial.css is gone. Verified frame by frame in WebKit.
- Pacing (user's choices, recorded next to the constants and in game-design.md): the fight's "Loading..." strip
  is gone (`LOADING_MS` 1500 -> 0; first cut to 600 ms, then removed on the user's second request the same day); wave end: coin shower 1300 -> 800 ms (`GOLD_SHOWER`), card drop glint 600 -> 400,
  hold 1000 -> 700, the next wave's fade-in 900 -> 450 ms (`CARD_DROP`). The tap feedback itself is unchanged.
- "The Worm Shaman heals his left neighbour instead of his right one." The heal itself follows the original simulator
  (the opponent's row is indexed from the opponent's own left, so an enemy's right neighbour is to the screen's left)
  and the client's comp_card_v3 turned the arrow overlay of enemy cards by 180 degrees for that reason. Our top-row
  arrows were only flipped vertically: the Shaman's green arrow pointed to the screen's right while he healed the
  left card, and every diagonal attack / buff arrow of the top row was off the same way. cards.css now turns the top
  row's arrows (`.side-top .arrow.ownRight` on the left edge etc.); the effects are unchanged. Pinned in
  `tests/battle.test.js` (heal per row) and `tests/ui.test.js` (arrow rules). The user chose to keep the original's
  convention (2026-10-12) and asked that it hold everywhere: every enemy row is drawn with `side: 'top'` (fight board,
  pre-battle, opening fight, and now the Arena replay line-up dialog too); the card detail stays the album view (the
  card's own side, as in the client); all 40 cards whose text names a side are encoded with that side
  (`tests/data.test.js`).
- Phone-style scrolling (`src/ui/drag-scroll.js`, installed on the stage in app.js): every scrollable area is
  dragged with the mouse like on a phone, with the client's inertia (x0.95 per frame, the slider's rule), the click
  after a drag is swallowed, the scrollbars are hidden (`#stage *`). Touch keeps the browser's native panning. The
  card drag-and-drop wins when it picks a card up; in the pre-battle drawer a sideways move scrolls the drawer and an
  upward move picks the card up (`shouldStart` with the slider's `isSwipe`). Tests: `tests/drag-scroll.test.js`,
  `tests/e2e/drag-scroll.e2e.js`.

## 2026-10-12 (later): potions at the start, console cheats

- New players start with 5 stamina + 5 mana potions (`PLAYER_START`; the original gave none - the user's choice,
  recorded in game-design.md §3 and §9). Pins updated in `tests/data-wiki.test.js`, `tests/game-state.test.js`,
  `tests/tutorial.test.js`.
- Console cheats ("easter eggs"): `src/ui/cheats.js`, exposed as `window.cheats` (and `evoker.cheats`), a console
  hint at boot ("Psst... type cheats.help()"). gold / gems / potions / refill / level / card(name, stage, level) /
  names / allCards(stage) / maxCards / unlockAllLevels / skipTutorial / days(n) / god / reset. A thin layer over the
  debug API and the pure game functions: every cheat goes through store.update and re-renders the screen, so the HUD
  follows at once. README "Debug API" documents them; `tests/cheats.test.js` covers them on a real save.
- The "Loading..." strip of the fight is gone entirely (`LOADING_MS` = 0, second request of the day).
