# Testing Evoker Web

Two layers: fast **unit tests** on Node's built-in runner for everything that is pure (data, stats,
battle engine, economy, UI helpers, the browser driver) and a **browser smoke test** that drives the
real app in headless Edge/Chrome through the Chrome DevTools Protocol. No npm dependencies are used
anywhere.

## 1. Unit tests (`node --test`)

```sh
npm test                               # node --test tests/  (tests/index.js imports every suite)
node --test "tests/*.test.js"          # the same, by glob
node --test tests/battle.test.js       # one suite
node --test --test-name-pattern="reflect" tests/battle.test.js
```

| File | Covers |
|---|---|
| `tests/stats.test.js` | `src/core/stats.js`: wiki checkpoints ±1, caps, sell/fusion/sacrifice formulas, evolve quality |
| `tests/abilities.test.js` | ability DSL validation, one handler per effect type, display text |
| `tests/battle.test.js` | `src/engine`: determinism, directions, deaths, rounds, every effect type, wiki examples, and the original client's unit tests replayed round by round |
| `tests/battle-player.test.js` | the playback timeline (`src/ui/battle/timeline.js`, `model.js`): events → timed steps, speed, skip |
| `tests/battle-ui.test.js` | post-battle flow (`battle-result-model.js`), player level-up hook, keyframe sampler, skip rule, boss intro, lethal-blow finale, loot steps |
| `tests/game-state.test.js` | `src/game/state.js`, `player.js`: new game, migration, deck slots, regen, level-ups, potions; persistence and purity |
| `tests/game-cards.test.js` | `collection.js`, `training.js`, `fusion.js`: inventory limit, selling, sorting, deck editing, card xp, training, fusion |
| `tests/game-quests.test.js` | `quests.js`, `rewards.js`: portal rotation, waves, taps, boss line-ups and fights, rewards |
| `tests/game-pvp.test.js` | `opponents.js`, `arena.js`, `pvp.js`, `pieces.js`: simulated players, Arena offers and fights, piece hunts, replays |
| `tests/league.test.js` | `league.js` and the League screen helpers: brackets, points, prizes, promotion, old saves |
| `tests/shop.test.js` | `shop.js` and the shop / booster helpers: packs, the 3×3 booster grid, offers, daily rewards, set collections, potion deal, the event on the save clock |
| `tests/tutorial.test.js` | `src/ui/tutorial` and its game layer: tutorial record, scripted quests 1-10 on the real engine, step script, lines, name prompt, opening |
| `tests/data.test.js` | `data/cards.json` built by `tools/build-cards.js`, `data/quests.json`, `data/names.json`, the fixture catalog |
| `tests/data-wiki.test.js` | the data re-checked against the raw wiki dumps and `docs/design/game-design.md` |
| `tests/integration.test.js` | the real data through the real modules (no stubs): quests, arena, boosters, random match-ups |
| `tests/ui.test.js` | pure parts of the UI foundation: formatting, countdown, stage fitting, bars, nav, the sprites the CSS and components reference, dev server |
| `tests/app.test.js` | the store (update info, subscribe, autosave), save parsing / export, `addDays` clock shifting, nav helpers |
| `tests/audio.test.js` | `src/ui/audio.js`: sound names and files, volumes, screen music, click sounds, settings helpers |
| `tests/menus.test.js` | level-up dialog and unlock popup helpers, the landing feed, portal gate, daily reward toasts, help texts |
| `tests/quest-ui.test.js`, `tests/cards-ui.test.js`, `tests/economy-ui.test.js`, `tests/pvp-ui.test.js` | pure helpers behind the quest map / quest, Cards, Shop / Booster / Character and Arena / Pieces / League screens |
| `tests/cdp.test.js` | `tools/cdp.js` and `tools/qa-lib.js`: browser discovery, launch/navigate/evaluate/click/screenshot/close, console capture, the in-process server |

`tests/index.js` imports every suite: Node 22 resolves `node --test tests/` through it, so a new test file must be
added there. Shared fixtures: `tests/fixtures/real.js` (the fixed clock `T0`, `deepFreeze` / `fz`, the real cards db,
`deps()` with the stub engine, `realDeps()` with the real one, save builders), `tests/fixtures/cards.js` (engine
fixtures), `tests/fixtures-game/` (the 21-card fixture catalog, stub engine and stats, `classicGame`). The game-*
files keep two kinds of groups: "(fixture catalog)" on the stubs and "§n" against `game-design.md` on the real data.

Conventions: `node:test` + `node:assert/strict`, one `test()` per behaviour, fixtures under
`tests/fixtures*/`. Game functions are pure `(state, deps, now, args) -> {state, ...info}` so tests pass
a fixed `now` and a seeded `rng` (`src/core/rng.js`) — never `Date.now()` or `Math.random()`.

`tests/cdp.test.js` launches a real browser; when no Edge/Chrome is installed those tests are skipped
(not failed). Point `EVOKER_BROWSER` at a Chromium-based executable to use another browser.

## 2. Browser smoke test (`npm run smoke`)

```sh
npm run smoke                                   # = node tools/smoke.js
node tools/smoke.js --headed                    # watch it in a visible window
node tools/smoke.js --base=http://localhost:8080/   # drive an already running server
node tools/smoke.js --out=/tmp/shots --slow=300 --verbose
```

What it does (`tools/smoke.js`):

1. Serves the project in-process on a free port (`tools/qa-lib.js`) and launches the browser headless at 720 × 1280.
2. Loads `/`, clears `localStorage` (fresh save), reloads and waits for `document.body.dataset.ready`.
3. Plays the start through real mouse events: *Tap to continue* → *Skip intro* and the scripted opening fight
   (*Attack*) → quest map (the name is asked later, at the first Arena entry) → quest 1 → taps minions until
   `state.quests.active.bossReady` → boss intro → pre-battle → *Attack!* → battle → *Skip fight* → result popup →
   back to the map.
4. Gives the save level 5, gems and gold through the debug API, then tours every screen and tab
   (quest-map, cards ×4 tabs, card-detail, collections, arena ×3 tabs, league, shop, character ×3 tabs,
   help, booster-open paid with gems, pre-battle reached from the arena) taking a screenshot of each.
5. Prints a table of steps (PASS/FAIL, duration, note), the number of screenshots and every console
   error or uncaught exception captured; exits **1** if any step failed or any error was logged.

Steps are independent: a failing step is recorded as FAIL (with a `<nn>-FAIL-<step>.png` screenshot) and
the run continues, so a missing screen shows up as one failed row instead of aborting the tour.

Screenshots are written to `tests/screenshots/<nn>-<name>.png` (old PNGs are deleted first; the folder is
kept by `.gitkeep`). Compare them with `exploration/research/reference/screenshots/` when judging fidelity.

### The driver (`tools/cdp.js`)

A ~560-line zero-dependency CDP client built on Node 22's global `WebSocket` and `fetch`:

```js
import { launch, findBrowser, freePort } from './tools/cdp.js';

const browser = await launch({ headless: true, width: 720, height: 1280 });
await browser.navigate('http://127.0.0.1:8080/');
await browser.waitFor('document.body.dataset.ready === "1"', 15000);
const level = await browser.evaluate(() => window.evoker.state().player.level);
await browser.click(360, 1000);                 // stage coordinates → converted via #stage's bounding rect
await browser.tap('.attack-bar .btn');          // centre of an element (scrolled into view)
await browser.type('Name'); await browser.press('Enter');
await browser.screenshot('tests/screenshots/x.png');
browser.console();  browser.errors();           // captured console messages / exceptions / log entries
await browser.close();                          // kills the process, deletes the temp profile
```

- `findBrowser()` — `EVOKER_BROWSER`, then Edge, then Chrome (Windows, Linux and macOS locations).
- `launch(opts)` — `--headless=new --disable-gpu --no-first-run --remote-debugging-port --user-data-dir=<temp>
  --window-size=WxH`, discovers the page target on `/json`, enables Page/Runtime/Log/Console and pins the
  viewport with `Emulation.setDeviceMetricsOverride`.
- `evaluate(exprOrFn, ...args)` — a string expression or a function serialised with JSON arguments;
  promises are awaited, page exceptions become rejections.
- `waitFor(exprOrFn, timeoutMs = 10000, intervalMs = 100)` — polls until truthy, resolves with the value.
- `click(x, y)` uses stage coordinates (720 × 1280); `clickClient(x, y)` uses viewport pixels.
- `send(method, params)` / `on(event, fn)` / `once(event, timeoutMs)` give access to any raw CDP command.

## 3. The debug API (`window.evoker`, architecture §8.5)

`src/app.js` exposes one global for QA scripts and the smoke test:

```js
window.evoker = {
  store, router, deps, db, version,
  ui, view, chrome, audio,              // the ctx.ui / ctx.view / ctx.chrome objects and the audio player
  go(id, params), goTop(id),            // navigation (see architecture §8.3 for the ids and params)
  state: () => store.get(),             // the current save (do not mutate)
  debug: {
    giveGold(n), giveGems(n), givePotions(stamina, mana), giveTokens(kind, n, portalId), setLevel(n),
    addCard(cardId, stage = 0, level = 1) /* → uid */, maxCards(), refill(),
    unlockQuests(n), unlockAll(), addDays(n) /* shifts the save's clocks */, reset(), newGame(name),
  },
};
```

`document.body.dataset.ready === '1'` once the first screen has rendered; the current screen's
`<div class="screen">` carries `data-screen="<id>"`, and `evoker.router.current()` returns `{ id, params }`.
Navigation calls return promises that resolve when the transition has finished; `evoker.router.busy` is
true in between.

Typical DevTools one-liners:

```js
evoker.debug.giveGems(500); evoker.go('booster-open', { booster: 'summoner', payWith: 'gems' });
evoker.debug.addCard('arch-angel', 2, 10); evoker.goTop('cards');
evoker.debug.setLevel(10); evoker.goTop('arena');
evoker.debug.addDays(1); evoker.go('character', { tab: 'daily' });
```

`debug.giveTokens(kind, n, portalId)` adds booster tokens (`neophyte | summoner | archmage | portalLow |
portalHigh`), `debug.maxCards()` raises every card to its level cap, `debug.unlockAll()` opens every feature and
deck slot, `debug.newGame(name)` replaces the save with a fresh one (no tutorial record) without reloading. Portals
follow the 7-day rotation; there is no hook to open one.

## 4. QA playtest scripts (`npm run qa`; one at a time: `npm run qa:core`, `qa:cards`, `qa:pvp`)

Three longer scripted playthroughs complement the smoke tour. They share the harness `tools/qa-lib.js` with the
smoke test (in-process server on a free port, headless browser, tolerant `step()` wrapper with timings, a screenshot
per step, exit 1 on a failed step or a console error) and the same flags
`--base=url --out=dir --headed --slow=ms --verbose`:

| Script | Steps | Screenshots | Covers |
|---|---|---|---|
| `tools/qa-core-loop.js` | 33 | `tests/screenshots/qa-core-loop/` | title boot, main map and landing feed, quest taps (gold per tap, player level-up dialog, Card Fusing unlock, card drop), Drink potion use / refuse / buy, boss intro, pre-battle drags and locked slot, battle 1x / 2x / skip, result popup, "Card Slot Unlocked!", portal banner and map, quest 31 (lava theme, card piece), Mana-needed bar, help pages, Escape rules, reload persistence |
| `tools/qa-cards-economy.js` | 39 | `tests/screenshots/qa-cards-economy/` | the deck screen with 80 cards (slider, swipe), card detail (zoom, sell, deck card), deck mode drags and locked slots, training (warnings, sacrifice stack, LEVEL UP), fusion (badge, FUSED), collections paging and reward, shop (gem packs, pack banners, 3×3 booster with token and gem picks, potion deal), character profile / avatar / name / stat points, daily calendar and streaks, settings, export / import / reset |
| `tools/qa-pvp.js` | 28 | `tests/screenshots/qa-pvp/` | arena offers (strongest card, info popup, new opponents after 30 minutes), fights with the post-battle flow, potion dialog, pre-battle drags, piece hunts (lose, win, complete for gems, first piece), replays, the League (join, standings, 3-fight limit, finish popups and promotions after `addDays(1)`, relegation) |

Random outcomes (card drops, boss rewards, battle results) are made deterministic by searching, on the
Node side with the same pure game functions, for a save seed that produces the wanted outcome and injecting
it with `evoker.store.set`, so the app's real code paths run.

## 5. Contact sheet (`npm run gallery`)

`node tools/make-gallery.js` writes `tests/screenshots/gallery.html`: every PNG from `tests/screenshots/` (smoke),
its QA sub-folders, the e2e suite's folder and the original's reference screenshots, with captions derived from the file
names. Open it through the dev server (`http://localhost:8080/tests/screenshots/gallery.html`) or from disk.

## 6. Writing a QA script

Scripts live in `tools/` and use the harness of `tools/qa-lib.js` (which drives `tools/cdp.js`). A minimal one
that checks the daily reward after a day has passed:

```js
// tools/qa-daily.js  —  node tools/qa-daily.js [--headed] [--out=dir]
import { createQa, bindApp, screenshotDir, assert } from './qa-lib.js';

const qa = createQa({ title: 'Evoker QA: daily', banner: 'QA DAILY', defaultOut: screenshotDir('qa-daily') });
const { step, shot } = qa;
const { bootFresh, debugCall, go, getState } = bindApp(qa);

qa.run(async (browser, base) => {
  await step('new game, one day later', async () => {
    await bootFresh(base);
    await debugCall('newGame', 'Daily');
    await debugCall('addDays', 1);
  });
  await step('daily calendar', async () => {
    await go('go', 'character', { tab: 'daily' });
    assert((await getState()).daily.streak >= 1, 'no daily claim');
    await shot('daily');
  });
});
```

`run` serves the project, launches the browser, runs the steps (a failing step gets a FAIL screenshot and the run
continues), prints the step table with timings plus the page's console errors and sets the exit code.

Guidelines:

- Prefer real input (`click`, `tap`, `type`) for the thing under test and the debug API for setup.
- Wait on state (`waitFor` + `evoker.state()` / `evoker.router.current()`), never on fixed sleeps alone;
  a short `sleep` after a transition is fine before a screenshot so lazy art has loaded.
- Always check `browser.errors()` at the end: a 404 for a missing asset is reported there as a `[network]`
  log entry and counts as a failure in the smoke test.
- Keep scripts tolerant like `tools/smoke.js` (`step()` wrapper) when they cover several screens, so one
  broken screen does not hide the state of the others.

## 7. End-to-end regression suite (`npm run test:e2e`)

```sh
npm run test:e2e                                  # node --test --test-concurrency=1 "tests/e2e/*.e2e.js"  (one browser at a time, ~4 min)
E2E_HEADED=1 node --test tests/e2e/league-fight.e2e.js   # one file, visible browser
```

`tests/e2e/` drives the real app in headless Edge/Chrome on the same driver as the smoke test, but as `node:test`
files: `harness.js` serves the project in-process and launches the browser once per file (`useApp()`), and
exposes the QA helpers (`ctx.app`, from `tools/qa-lib.js bindApp`) plus set-up (`freshGame`, `setDeck`), the
quest walk (`tapToBoss`) and the fight helpers (`attackAndWaitForRound`, `waitForResult`, `leaveResult`).
Tests are skipped, not failed, on a machine without a browser. Screenshots land in `tests/screenshots/e2e/`.
The suite is deliberately not part of `npm test` (slow, needs a browser); run it before handing work over.

**Rule: every bug that is reported gets a regression test here (or a unit test when the pure layer can pin it,
plus an e2e that covers the screen).** Name the bug and the date in the file header or the test name.

| Reported | Bug | Guarded by |
|---|---|---|
| 2026-10-10 | Viewing a card from a boss pre-battle and coming back left the boss intro's card stuck in the middle, Attack! hidden | `tests/e2e/prebattle-intro.e2e.js` |
| 2026-10-10 | The card detail must show the card that was tapped | `tests/e2e/prebattle-intro.e2e.js` |
| 2026-10-10 | League fights "skip to the end" | `tests/e2e/league-fight.e2e.js` (plays, ends `played`, no console exception) |
| 2026-10-10 | Reflecting cards dissolved before their bounced damage was drawn | `tests/battle-player.test.js` (reflect ordering) + `tests/e2e/battle-visuals.e2e.js` |
| 2026-10-10 | The opponent row's card numbers were cut off | `tests/e2e/battle-visuals.e2e.js` (strip clearance) |
| 2026-10-10 | "The cards just disappear and the game says I win" (League vs Imara, quest 3): the lethal blow was never shown, the finale replaced its step | `tests/e2e/lethal-finale.e2e.js` |
| 2026-10-10 | The victory presentation (starburst, banner) began while the HP numbers were still counting down; it must wait for them to settle | `tests/e2e/lethal-finale.e2e.js` (label final at the starburst and at the banner) |
| 2026-10-10 | The surviving cards must stay on the board through the finale and the victory (no wipe) | `tests/e2e/lethal-finale.e2e.js` (cards on the board at the banner) |
| 2026-10-10 | After a blow took a player below zero, the remaining attacks of the round were not drawn; every attack of the last round must play in order | `tests/e2e/lethal-finale.e2e.js` (missiles drawn = attacks logged in the last round) |
| 2026-10-10 | Card Lab (`?lab`, `src/ui/screens/lab.js`): test any card's behaviour in combat | `tests/e2e/card-lab.e2e.js` |
| 2026-10-11 | The tutorial's ranger stood on the Cards screen's training ("sacrifice") and fusion ("merge") modes for every player; only the tutorial overlay may show her | `tests/e2e/cards-modes.e2e.js` |

The battle screen sets `data-ended="played" | "skipped"` on its root when the fight ends (test hook).
