# Evoker Web

A faithful, single-player, offline web recreation of **Evoker** (flaregames, 2013-2018), the portrait
collectible card battler with five-card line-ups that fight automatically. Collect the original's 195
cards (the Dungeon Casino set is left out) on the quest map, train and fuse them, place them in a row, press *Attack!* and watch the fight
resolve, then duel simulated players in the Arena, hunt card pieces and climb the daily League.

The game servers closed in August 2018; this project rebuilds the game from the fan wiki's card data,
the archived store pages, original screenshots and, since day 2, the original Android client itself:
its battle simulator was recovered from the Lua bytecode and ported literally (`docs/design/original-engine.md`),
and its UI sprites, fonts, palette, map, sounds and texts are used directly (`docs/design/apk-assets.md`).
See `exploration/research/evoker-research-brief.md` for the sources, `docs/design/game-design.md` for every rule
and number, `docs/design/architecture.md` for the code contract and `docs/STATUS.md` for the current state.
`tests/screenshots/gallery.html` is a contact sheet of every screen next to the original's.

## Running

Requirements: Node 18+ (Node 22 for the browser tests; no npm dependencies, no build step) and a modern
browser (Chrome/Edge/Firefox/Safari 2023+).

```sh
npm start            # static server on http://localhost:8080/
npm test             # node --test tests/  (650+ unit tests, ~8 s)
npm run test:e2e     # end-to-end regression suite, tests/e2e/*.e2e.js (headless Edge/Chrome, ~3 min)
npm run build:data   # regenerate data/cards.json from the wiki catalog (tools/build-cards.js)
npm run smoke        # browser smoke test (tools/smoke.js, needs an installed Edge/Chrome)
npm run qa           # the three QA playtest scripts (tools/qa-*.js; one: npm run qa:core | qa:cards | qa:pvp)
npm run gallery      # tests/screenshots/gallery.html from the screenshots the browser tests wrote
```

Open http://localhost:8080/ for the game. **http://localhost:8080/?lab opens the Card Lab**: pick any card at any stage and level, the lab puts it in
the middle of your row with two plain allies and five plain attackers opposite (weak or strong), lets you change
every slot, fights it on the real battle screen and lists the engine's event log - the save is not touched.
Its effect showcase has one "Show" per effect type a card can have (25): the card, rows and seed that show it. Opening `index.html` directly from `file://` does not work because the app uses ES modules.
The game is fully offline: no network calls at runtime, the save lives in `localStorage`
(`evoker.save.v1`) and is autosaved after every change.

## How to play

1. **Title** - tap *Tap to continue*. A new game plays the opening (intro lore, the scripted fight against the
   Worm Shaman) and the tutorial of the 1.7.0 client: you start with the Envoy, 200 gold and two deck slots; the
   ranger guides you through the first ten quests. Your name is asked on the first Arena visit.
2. **Quest map** - the middle button of the bottom bar. The main quest's 100 nodes on the painted world map
   (current quest in the golden rune circle) and, at the top, the running **portal** banner with its countdown
   (nine portals, 25 quests and an 8-card set each, one open at a time for 7 days; an ended portal waits for
   its next turn). The landing feed (next daily reward, event, portal, shop) greets you at login and sits
   behind the orange arrow's *Home* button.
3. **Quest** - tap the minions: each tap costs stamina (2 on quest 1, up to 7 later), pays gold and player XP.
   When stamina runs out the *Drink potion* dialog offers a potion (or sells one for gems).
4. **Boss fight** - the boss intro ("Boss Fight n" / "Showdown!"), then the **pre-battle** screen: the enemy row on
   top, your deck below (drag cards between slots); press *Attack!*.
5. **Battle** - five against five, fully automatic, up to 20 rounds, the original client's rules
   (`docs/design/original-engine.md`). *Skip fight* from quest 3. Then the loot, card XP and level-ups.
6. **Cards** - the deck screen with three modes: deck edit ("Your Deck", "Your cards n/100", "Mana needed"),
   **Training** (sacrifice cards for XP, paid in gold) and **Fusion** (two copies at the same stage become a "+"
   card); drag cards up from the slider of big cards. Tap a card for its detail with *Zoom* and *Sell*.
7. **Profile / Options** - tap the level / stamina / mana bar at the top for your profile (avatar, name, best card,
   stats); the orange arrow at the right of the bottom bar opens the Album (card sets), Profile, Options (volumes,
   battle speed, raids, reduced motion, export/import, reset) and Home.
8. **Shop** - Neophyte, the current and the next portal's packs, Summoner and Archmage: each booster is a 3x3
   grid of face-down cards, each pick paid with a pack token or gems. Gem packs are display-only.
9. **Arena** (after quest 8) - three simulated opponents (green / yellow / red) that cost your deck's mana;
   **Pieces** - hunt the missing pieces of a card; **Replays** - re-watch the last fights.
10. **League** (after quest 10) - a 24-hour league of ~50 simulated players (Bronze, Silver, Gold; the top 3
    move up), 150 points per win, prizes down to rank 29.

Stamina and mana regenerate one point per real minute. Every day has an event (Infinite Wisdom, Drinking
Contest, Card-piece Day, Double League Points, Great Potion Deal, Get the Best Cards, Golden Day). The *?* button
opens the rules for that screen. Rules and numbers: `docs/design/game-design.md`.

### Controls

| Input | Effect |
|---|---|
| Tap / click | everything: nodes, minions, cards, buttons, "Tap to continue" |
| Drag (mouse or touch) | move cards between the deck slots and the card slider (Cards) or the collection drawer (pre-battle); drag a card out of a slot to remove it |
| HUD | the level / stamina / mana bar opens the profile; the gold / gems bar with the green **+** opens the gem packs; the back arrow (sub-screens only) goes back; **?** opens help |
| `Escape` | back (the hardware back key: also on the main tabs, which have no arrow), close a dialog or popup; in a battle: skip to the result |
| `Enter` / `Space` | confirm a dialog, continue past the title screen, dismiss the result or level-up popup |
| `1x` / `2x`, *Skip fight* | battle playback speed (remembered in Options) and skip |

The stage is a fixed 720 x 1280 portrait canvas scaled to the window, so it plays the same on a phone and
on a desktop (letterboxed).

## Folder map

```
index.html          shell: <div id="app">, loads src/app.js and the stylesheets
css/                fonts.css + tokens.css (the client's fonts, palette), main.css (stage, chrome, HUD, nav,
                    dialogs, toasts), cards.css (card component), battle-fx.css (battle animations),
                    tutorial.css, components/ (level-up dialog, unlock popups), screens/*.css
src/app.js          boot, router, state store, autosave, clock tick, Escape handling, window.evoker
src/core/           rng, constants (every tuning table), stat formulas, cards database, ability DSL
src/engine/         pure battle simulation (event log) and the effect handlers of the original simulator
src/game/           save schema, player, collection, training, fusion, quests, rewards, opponents, pvp (the
                    shared PvP fight), arena, pieces, league, shop (pure: (state, deps, now, args) -> {state, ...})
src/ui/             dom.js helpers, router.js, store.js, chrome.js (HUD + nav), card-view.js, audio.js,
                    anim-player.js, battle-player.js + battle/ (timeline, board model, sounds, effects),
                    components/ (hud, nav, card, dialog, bars, buttons, drag-drop, toast, countdown, stage,
                    popup-levelup, popup-unlock), tutorial/ (the first-session tutorial and opening),
                    screens/ (one module per screen id, larger screens split into helper modules)
data/               cards.json (195 cards, generated), abilities.json, card-overrides.json, quests.json, names.json,
                    orig/ (tables extracted from the original client)
assets/orig/        the original client's sprites, fonts, sounds, animations, map tiles, minions
assets/ui/          SVG icons, tribe emblems, card frames, placeholder art
assets/bg/          painted backdrops (title, quest map, valley, horizons); see assets/bg/README.md
assets/cards/       card art (<slug>.jpg, <slug>+.jpg ... <slug>++++.jpg)
tools/              serve.js (dev server), build-cards.js (data pipeline), import-art.js, cdp.js (browser
                    driver), qa-lib.js (shared harness of the browser tests), smoke.js, qa-core-loop.js,
                    qa-cards-economy.js, qa-pvp.js, make-gallery.js
tests/screenshots/  output of the browser tests (smoke at the top level, one folder per QA script)
tests/              node --test suites, one file per domain (game-*, battle*, league, shop, tutorial, data*, UI
                    helpers, browser driver); shared fixtures in tests/fixtures/ and tests/fixtures-game/
docs/               STATUS.md (hand-off state), design documents, dev notes, app-flow.html (how the app flows)
exploration/        everything found rather than written: the original client (apk/), the research
                    (research/: wiki dump, videos, reports, recovered art) and the one-off extraction tools
```

## UI foundation

- Everything is drawn on a fixed **720 x 1280 portrait stage** (`src/ui/components/stage.js`) scaled to the
  viewport, so every screen uses absolute stage pixels.
- Components are plain DOM factories built with `h()` from `src/ui/dom.js`; no framework, no innerHTML.
- The look (slate carved-stone panels, steel-blue bevelled buttons, flaming Attack! bar, colour-coded
  numbers: attack red, health green, mana cyan, level yellow, ability orange) follows the original's
  screenshots in `exploration/research/reference/screenshots/`; colours live in `css/tokens.css`.
- Game logic never touches the DOM or the clock: every `src/game` function is `(state, deps, now, args)`
  and randomness comes from the seeded `src/core/rng.js`, so fights can be replayed exactly.

## Debug API

`src/app.js` exposes `window.evoker` for the browser tests and for poking at the game from DevTools:

```js
evoker.state()                       // the current save (do not mutate)
evoker.go('cards', { tab: 'deck' })  // push any screen (ids and params: docs/design/architecture.md 8.3)
evoker.goTop('arena')                // jump to a nav screen
evoker.store / router / deps / db / ui / view / chrome / audio / version

evoker.debug.giveGold(n)                      evoker.debug.giveGems(n)
evoker.debug.givePotions(stamina, mana)       evoker.debug.giveTokens(kind, n, portalId?)  // neophyte | summoner | archmage | portalLow | portalHigh
evoker.debug.setLevel(n)                      evoker.debug.addCard(cardId, stage = 0, level = 1) // -> uid
evoker.debug.maxCards()                       evoker.debug.unlockAll()  // every card at its cap; every feature and slot open
evoker.debug.refill()                         evoker.debug.unlockQuests(n)
evoker.debug.addDays(n)                       // shifts every clock in the save: daily reward, league, raids
evoker.debug.newGame(name)                    evoker.debug.reset()      // wipes the save and reloads
```

`document.body.dataset.ready === '1'` once the first screen has rendered; the current screen's element
carries `data-screen="<id>"` and `evoker.router.current()` returns `{ id, params }`.

## Testing

Details in `docs/dev/testing.md`.

- **Unit tests** - `npm test` (or `node --test "tests/*.test.js"`): data integrity, stat formulas, the
  ability DSL, the battle engine (every effect type, the wiki's worked examples), the economy and game
  modes, UI helpers, and the browser driver. 646 tests, no browser needed except for `tests/cdp.test.js`,
  which skips itself when no Edge/Chrome is installed.
- **Smoke test** - `npm run smoke`: serves the project in-process, drives headless Edge/Chrome through the
  Chrome DevTools Protocol (`tools/cdp.js`, zero dependencies; harness `tools/qa-lib.js`), plays the opening, quest 1
  and its boss fight with real clicks, then opens every screen and tab; 30 steps, a screenshot each, fails on any
  console error.
- **QA playtests** - `npm run qa` runs three longer scripted playthroughs that use real clicks, drags and
  key presses and only use the debug API for set-up:
  `tools/qa-core-loop.js` (33 steps: quests, potions, drags, battle, level-ups, unlocks, portals, help,
  reload), `tools/qa-cards-economy.js` (39 steps: deck screen, training, fusion, collections, shop, boosters,
  character, daily rewards, settings, export/import/reset) and `tools/qa-pvp.js` (28 steps: arena, pieces,
  replays, league). Each accepts `--base=url --out=dir --headed --slow=ms --verbose` and exits 1 on a failed
  step or console error.
- **Contact sheet** - `npm run gallery` writes `tests/screenshots/gallery.html` from all of the above plus the
  original's reference screenshots.

## Credits and notes

- The original **Evoker** was designed and published by flaregames GmbH (2013-2018). This project is a
  non-commercial fan recreation made for personal use and study; it is not affiliated with or endorsed by
  flaregames, and the name *Evoker*, the card art, the key art and the original screenshots belong to their
  respective owners.
- Card data, ability texts, level caps, stat checkpoints and the card artwork come from the Evoker fan wiki
  (evoker.fandom.com), kept by the game's community; the data pipeline (`tools/build-cards.js`) records
  every manual correction in `data/card-overrides.json`.
- The UI sprites, fonts, sounds, animations, map tiles, minion and boss images under `assets/orig/` and the
  disassembled client code under `exploration/apk/` come from the original 1.7.4 Android client (flaregames'
  property; verified signature, never installed or executed; see `docs/design/apk-assets.md`). Backdrops in
  `assets/bg/` were cropped from the original's screenshots; the SVG icons in `assets/ui/` are fallbacks.
- The battle rules are the original client's own simulator, ported from its bytecode and checked against the
  client's unit tests. Numbers that only lived on the server (card stats beyond the wiki's checkpoints, XP
  curves, prices, AI opponents, the portal schedule) are documented decisions in `docs/design/game-design.md`.
- Please do not redistribute the artwork; keep the project for your own use.
