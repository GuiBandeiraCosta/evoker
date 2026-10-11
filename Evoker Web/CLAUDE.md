# Evoker Web — working notes for Claude

A faithful single-player web recreation of **Evoker** (flaregames' mobile CCG, 2013–2018, servers closed Aug 2018).
Personal, unpublished project. The battle engine is a literal port of the original client's Lua simulator; the UI
uses the original sprites, fonts, sounds and layouts recovered from the 1.7.4 APK. Everything the client never
contained (card stats, prices, quests, cards released after April 2016) is reconstructed from research.

## Stack and layout

- Vanilla ES modules, **no npm dependencies, no build step**. Node 22 for tests. Served statically (`npm start`,
  http://localhost:8080/). `file://` does not work (modules).
- `src/core` (data, stats, abilities), `src/engine` (the ported simulator — treat `docs/design/original-engine.md`
  as binding), `src/game` (pure state functions `(state, deps, now, args) -> {state, ...}`), `src/ui` (screens,
  router, battle player), `data/` (cards, abilities, quests), `assets/` (card art; originals under `assets/orig/`),
  `tools/` (dev server, data build, headless-browser driver + QA scripts), `tests/` (unit + e2e; `tests/screenshots/`
  is browser-test output), `docs/design/` (rules and contracts), `exploration/` (everything found rather than written:
  `apk/` the unpacked client, `research/` sources, wiki dump, round reports, recovered art, `tools/` the one-off
  extraction scripts; never ship from here, the game never loads it at runtime).
- Stage is 720×1280 CSS px scaled to fit; screens are built with `h()` (src/ui/dom.js), navigation through the
  router (`ctx.go / back / rerender`; `back()` **rebuilds** a screen from its id + params, so one-shot params
  must be consumed — see `prebattle.js`).
- Line endings are mixed (some files CRLF). When editing by script, preserve the file's existing EOL.

## Commands

```sh
npm start            # dev server (often already running on 8080)
npm test             # unit tests, node --test tests/ (~8 s) — must stay green
npm run test:e2e     # browser regression suite, tests/e2e/*.e2e.js (~3 min, headless Edge/Chrome)
npm run smoke        # 30-step browser smoke test
npm run qa           # three long QA playtests (qa:core | qa:cards | qa:pvp)
npm run build:data   # regenerate data/cards.json from the wiki catalog + data/card-overrides.json
```

## Rules of the house

1. **Every reported bug gets a regression test** before/with the fix: a unit test when a pure module can pin it
   (engine, timeline, stats, game functions) and an e2e test in `tests/e2e/` for anything on a screen. Register
   it in the table in `docs/dev/testing.md` §7 with the date. Reproduce in the headless browser before fixing —
   the QA harness (`tools/qa-lib.js`, `tools/cdp.js`, `window.evoker.debug`) makes most flows scriptable.
2. Faithfulness beats taste: when the original's behaviour is documented (`docs/design/*.md`, `exploration/research/
   round3/*.md`, videos), follow it; say so when something is a guess and record the guess in the docs.
3. Keep tests green: `npm test`, `npm run smoke`, and the relevant QA script after UI changes; `npm run test:e2e`
   after bug fixes.
4. Don't add dependencies or a build step. Don't edit `data/cards.json` by hand — change
   `data/card-overrides.json` / `exploration/research/wiki-card-catalog.json` and rebuild.
5. Game functions are pure and deterministic: pass `now` and a seeded rng, never `Date.now()` / `Math.random()`
   in `src/game` or `src/engine`.
6. Headless browser work: always an **absolute** `--user-data-dir` (the driver does this); never a relative one.

## Where the knowledge is

- `docs/STATUS.md` — hand-off state, open questions, rough spots. Update it when a round of work ends.
- `docs/design/game-design.md` (rules/numbers), `architecture.md` (module/screen contracts, stat formula §3.2),
  `original-engine.md` (binding engine spec), `ability-encoding.md`, `apk-assets.md`.
- `docs/dev/testing.md` — all test layers, the debug API, QA script conventions, the bug→test registry.
- `exploration/research/round4/` — the 2026-10 research on post-2016 cards (SUMMARY.md), level-data gaps, recovered and
  generated fusion-stage art (not wired in; the user decides).

## Testing a card by hand

`http://localhost:8080/?lab` (or `window.evoker.go('lab')`) opens the Card Lab (`src/ui/screens/lab.js`): any card at any
stage/level, auto-built allies and opponents, the real battle screen, the engine log afterwards. Use it to check a
card's ability before and after touching `data/abilities.json` or the engine.

## Gotchas

- The battle player turns any exception during playback into `skip()` (jump to the result) — check
  `browser.errors()` when a fight "skips". A fight that ends on a lethal blow plays the whole last round (bars go
  negative, cards stay), then the starburst and the banner (user's choice since 2026-10-10; the original wiped the
  board at once). Guarded by `tests/e2e/lethal-finale.e2e.js`.
- `card-detail` is reached through the drag-drop helper's `onTap`; the prebattle boss intro is one-shot.
- Stat values for stages missing in the wiki follow the card's own curve (stats.js `fallbackScale`).
