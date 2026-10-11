# Evoker Web — Architecture and Implementation Contract

Companion to `game-design.md` (what) and `../research/evoker-research-brief.md` (why). Every module listed here
is a separate file with a stable interface so that modules can be built and tested independently.

---

## 1. Stack and conventions
- **No build step.** Vanilla ES modules (`type="module"`), modern browser APIs, CSS custom properties. No framework,
  no bundler, no TypeScript. JSDoc types on every exported function.
- **Runtime**: any modern browser (Chrome/Edge/Firefox/Safari 2023+). Served by `tools/serve.js` (Node ≥ 18, zero
  dependencies) — `npm start` opens http://localhost:8080. Opening `index.html` from `file://` is not supported
  (module imports), the README says so.
- **Tests**: Node's built-in test runner (`node --test tests/`) for everything that does not touch the DOM: data
  pipeline, stat formulas, battle engine, economy, AI. Pure modules must not import DOM or browser globals.
- **Formatting**: 2-space indent, semicolons, single quotes, `const` by default, no classes for data (plain objects),
  small pure functions, `export` named (no default exports). File names kebab-case.
- **Randomness**: never `Math.random()` in engine/economy code; use `src/core/rng.js` (`mulberry32(seed)` →
  `rng.next()`, `rng.int(n)`, `rng.pick(arr)`, `rng.chance(p)`). UI-only effects may use `Math.random()`.
- **Time**: all game logic receives `now` (ms epoch) as an argument; the game clock is `now()` in `src/app.js`
  (`ctx.now` for the screens). UI code reads `Date.now()` / `performance.now()` only for its own animation timing
  (battle player, effects, keyframe sampler, audio).
- **Assets**: `assets/cards/<slug>.jpg` (stage 0) and `<slug>+.jpg` … `<slug>++++.jpg`; missing stage art falls back
  to stage 0; missing art falls back to `assets/ui/card-placeholder.svg` with the tribe colour. `assets/ui/` holds
  SVG icons, frames and backgrounds; `assets/bg/` painted backgrounds (cropped from reference screenshots).

## 2. Folder layout
```
index.html                  shell: #app, the stylesheets below, loads src/app.js
css/
  fonts.css  tokens.css     the client's fonts; colours, fonts, spacing, z-index, rarity/tribe palettes
  main.css                  reset, layout (portrait stage), chrome (panels, buttons, HUD, nav, dialogs)
  cards.css                 card component (compact, battle, detail), frames by rarity, pips, arrows
  battle-fx.css             battle playback animations
  tutorial.css              tutorial overlay (text box, hand, drag arrow), the opening, the name popup
  components/               levelup.css (player level-up dialog), unlock.css ("… Unlocked!" popups)
  screens/*.css             one file per screen (app.css: boot error, shared screen bits)
src/
  app.js                    boot: data, deps, save, stage, store, chrome, audio, router, debug API (window.evoker)
  core/
    rng.js                  seeded PRNG
    constants.js            rarities, tribes, level caps, every tuning table (economy, quests, PvP, league)
    stats.js                statAt(), xp curves, sell value, fusion cost, evolve quality
    cards-db.js             loads data/cards.json, lookups, catalog queries
    abilities.js            ability DSL helpers: parse/validate, text rendering with values
  engine/
    battle.js               simulateBattle(config) → {events, result}  (pure)
    battle-state.js         builds fighter sides from card instances + player stats (pure)
    effects/                index.js (registry), handlers.js, extensions.js, helpers.js
    tribe-bonus.js
  game/                     pure rules on the save (state in, state out)
    state.js                save schema, newGame(), migrate(), selectors, deck slots, feature unlocks
    player.js               xp, level-up, stat points, regen, potions, tokens
    collection.js           add/sell/sort/filter, limit 100, deck editing, card xp
    training.js  fusion.js
    quests.js               quest lines (main + portals), portal rotation, minion waves, taps, boss fights
    rewards.js              reward rolls (shared)
    opponents.js            simulated player pool, AI decks
    pvp.js                  the shared PvP fight runner (Arena, Pieces, League): mana, fight, xp, replay
    arena.js  pieces.js  league.js
    shop.js                 boosters, potions, daily rewards, daily events, set collections
  ui/
    dom.js                  h(), mount(), sprite / icon helpers, number formats
    router.js               screen stack (push/pop/replace), transitions
    store.js                the store, save parse / serialize, clock shift of debug.addDays, nav targets
    chrome.js               HUD + nav per screen, Drink-potion flow (ctx.chrome)
    card-view.js            card definitions / instances → card view objects (ctx.view)
    audio.js                original sounds and music (docs/dev/audio.md)
    anim-player.js          keyframe animations of the client (assets/orig/animations)
    battle-player.js        plays the engine event log on the battle screen; skip; speed
    battle/                 timeline.js (event log → timed steps), model.js (board state per step),
                            assets.js (sounds, sprites), fx.js (effect primitives and board geometry)
    components/             hud.js, nav.js, card.js (compact/battle/detail), dialog.js, bars.js, buttons.js,
                            drag-drop.js, toast.js, countdown.js, stage.js, popup-levelup.js (player level-up
                            dialog), popup-unlock.js ("… Unlocked!" popups)
    tutorial/               index.js, manager.js (the step script on screen), progress.js (tutorial record, steps,
                            hints), lines.js, overlay.js, opening.js, intro-fight-script.js, name-popup.js
    screens/                index.js (screen id → `screen`), one module per screen id of 8.3 plus its helpers:
                            title.js; quest-map.js (+ quest-map-layout.js, quest-portal.js, quest-feed.js);
                            quest.js (+ quest-model.js, quest-fx.js); boss-intro.js; prebattle.js; battle.js
                            (+ battle-result.js, battle-result-model.js); cards.js (+ cards-helpers.js,
                            cards-state.js, cards-slider.js, cards-dnd.js, cards-ops.js); card-detail.js;
                            collections.js; arena.js (+ arena-pieces.js, pvp-widgets.js, pvp-view.js,
                            pvp-events.js, pvp-puzzle.js); league.js; shop.js (+ booster-view.js);
                            booster-open.js; character.js (+ character-profile.js, character-settings.js,
                            profile-view.js, daily-view.js, settings-view.js, save-file.js); help.js
data/
  cards.json                195 cards (generated by tools/build-cards.js from exploration/research/wiki-card-catalog.json
                            + data/abilities.json + data/card-overrides.json)
  abilities.json            hand-encoded ability definitions keyed by card id (section 3.3)
  card-overrides.json       manual fixes to wiki data (missing stats, typos), with a "reason" per entry
  quests.json               main quest (100) + portals (9×25): bosses, hp, stamina, gold, bands
  names.json                simulated player names, avatars list
  orig/                     tables extracted from the original client (loca, colours, sprite sheets, images)
assets/                     cards/ (wiki art), ui/ (svg icons), bg/, orig/ (the client's sprites, sounds, fonts,
                            animations, map tiles, minions)
tools/
  serve.js                  static dev server (`npm start`)
  build-cards.js            data pipeline → data/cards.json (idempotent, `npm run build:data`)
  cdp.js                    zero-dependency Chrome DevTools Protocol driver (8.6)
  qa-lib.js                 shared harness of the browser scripts: in-process server, browser, steps, screenshots
  smoke.js                  smoke tour (`npm run smoke`)
  qa-core-loop.js  qa-cards-economy.js  qa-pvp.js     the QA scripts (`npm run qa`)
  make-gallery.js           contact sheet of all screenshots → tests/screenshots/gallery.html
tests/                      node --test (section 6); screenshots/ = output of the browser tests
docs/                       STATUS.md, design/, dev/, app-flow.html
exploration/                research material (see exploration/README.md): apk/ (the unpacked client),
                            research/ (wiki, videos, reports, recovered art), tools/ (one-off extraction scripts)
```

## 3. Data model

### 3.1 `data/cards.json`
```jsonc
{
  "version": 1,
  "cards": [{
    "id": "arch-angel",             // slug of the name
    "name": "Arch Angel",
    "tribe": "neutral",             // dwarf | elf | orc | neutral
    "rarity": "uncommon",           // common | standard | uncommon | rare | heroic | legendary | ultimate
    "mana": 9,
    "dirs": ["direct"],             // subset of direct,left,right,ownLeft,ownRight ; [] = no attack
    "base": { "attack": 200, "hp": 500, "ability": 400 },   // stage 0, level 1 (ability null if none)
    "caps": [11, 15, 19, 23, 27],   // level cap per stage 0..4 (from rarity, overridable)
    "growth": {                     // stat value at the cap of each stage (null = unknown → derived)
      "attack": [null, null, null, null, null],
      "hp":     [null, null, null, null, null],
      "ability":[null, null, null, null, null]
    },
    "ability": { ... } | null,      // section 3.3, or {"byStage": [a0,a1,a2,a3,a4]} for evolving cards
    "set": "main" | "the-dark-beyond" | ...,
    "art": { "0": "Arch_Angel.jpg", "1": "Arch_Angel+.jpg", ... },   // file names present in assets/cards
    "categories": ["Unique"],       // wiki categories, informational
    "sourceText": "Increases the health points of his neighbors by ____."
  }]
}
```

### 3.2 Stat formula — `stats.js: statAt(card, stat, stage, level, evolveQuality = 1)`
Let `cap[s]` be the level cap of stage `s`, `V[s]` the known value at `cap[s]` (`growth[stat][s]`), `B` the base value.
1. Fill unknown `V[s]` with `B × M[rarity][s] × k` where `M` is the median multiplier table from the brief §3.2 and `k`
   scales it to the card's own curve: the median of `V[s'] / (B × M[rarity][s'])` over the stat's known checkpoints, else
   over the card's other growing stats (attack, hp and ability grow by the same factor on nearly every card), else 1.
   Flat and percent stats and base-0 stats are never used for `k`, nor is a wiki cap below `A[s]` (bad data, step 2);
   percent abilities take `k = 1`. (Round 4: leave-one-out error of filled caps median 5 % → 2 %, p90 27 % → 11 %.)
   If `B` itself is unknown (a few wiki gaps), `card-overrides.json` must supply it (the data build fails otherwise).
2. Level-1 value of stage `s`: `A[0] = B`, `A[s] = B × 1.15^s` (fusion reset factor, from the Werewolf Dwarf+ observation).
   If `A[s] > V[s]` (bad wiki data), set `V[s] = A[s] × 1.3`.
3. Within a stage interpolate with a slight power curve: `value = A[s] + (V[s] − A[s]) × t^1.1`, `t = (level−1)/(cap[s]−1)`
   (fitted on mid-level card faces from videos, exploration/research/round3/cardstats.md), rounded to an integer,
   then multiplied by `evolveQuality` (rounded). Percent abilities (Djinn, Medusa, Dark Mage, Wizard Apprentice) use the
   same interpolation on the percentage and are rounded to 1 decimal.
4. `attackAt`, `hpAt`, `abilityAt` are thin wrappers. Memoise per (cardId, stage, level).

Other formulas (all in `stats.js`, numbers from `game-design.md`): `cardXpToNext(card, level)`, `playerXpToNext(level)`,
`sellValue(card, stage, level)`, `fusionCost(rarity, stage)`, `sacrificeXp(card, stage, level)`, `evolveQuality(l1, cap1, l2, cap2)`.

### 3.3 Ability DSL (`data/abilities.json`)
```jsonc
{
  "arch-angel": {
    "text": "Increases the health points of his neighbors by {v}.",
    "effects": [ { "type": "maxHp", "target": "ownNeighbors", "amount": "value", "split": true, "when": "battleStart" } ]
  }
}
```
Common fields of an **effect**:
- `type` — see the table below.
- `target` — `self | opposite | ownNeighbors | ownLeft | ownRight | oppositeNeighbors | oppositeLeft | oppositeRight |
  allEnemies | allAllies | otherAllies | offensiveAllies | alliesOfTribe | offensiveAlliesOfTribe | ownPlayer |
  enemyPlayer | bothPlayers | randomAlly | randomEnemy | randomCard | randomCardAnySide` (+ `"tribe": "orc"` when needed).
- `amount` — `"value"` (the card's ability value at its level), `{ "flat": 200 }`, `{ "pct": 75 }` (percent of attack),
  `{ "mult": 3 }`, `{ "healed": true }`, `{ "perEnemyDeath": 100 }` (flat per enemy death last round), `{ "perDeath": "value" }`.
- `rounds` — omitted = every round; `{ "only": [1] }`, `{ "from": 4 }`, `{ "parity": "even" | "odd" }`, `{ "upTo": 2 }`.
- `split` — true when a "neighbours" buff is halved per neighbour.
- `when` — overrides the default phase: `battleStart | suspension | preAttack | attack | creatureHeal | playerHeal |
  deathTrigger | endOfRound`.
- `once` — true for revives and one-shot effects.
- `condition` — `{ "targetTribe": "orc" }`, `{ "hitEmptySlot": true }`, `{ "ifSurvivedRound": true }`, `{ "ifHealed": true }`.
- `cap` — max per hit for reflect effects (`"value"` or flat).
- `unreflectable` — for card-damage effects.

Effect types and the phase that applies them:

| type | meaning | phase |
|---|---|---|
| `strengthen` | add `amount` to target attack this round (or permanently with `"cumulative": true`) | preAttack |
| `attackMult` | multiply target attack this round by `mult` or `1 + pct/100` (`"mult": 0` = deals no damage) | preAttack |
| `strengthenOnDeaths` | add `amount.perEnemyDeath × enemy deaths last round` | preAttack |
| `strengthenOnHealed` | add heals received last round | preAttack |
| `reduceAbilityAttack` | −pct attack this round to every card with an ability on both sides except self | preAttack |
| `daze` | target cannot attack in the given rounds | preAttack (uses `rounds`) |
| `suspend` | target loses abilities in the given rounds | suspension |
| `stun` | daze + suspend | suspension |
| `indestructible` | target takes no damage in the given rounds | preAttack |
| `protect` | like indestructible with a tribe condition (Bone Oracle, Swarmkeeper) | preAttack |
| `maxHp` | raise target max hp and hp (cards) or player max/current hp (players) | battleStart |
| `heal` | heal target cards by amount | creatureHeal |
| `healPlayer` | heal own player | playerHeal |
| `healOnDeaths` | heal self by `amount × enemy deaths this round` if self survived | creatureHeal |
| `healBoost` | +pct to all heals of this side | battleStart |
| `damageCards` | damage every target card by amount each round (`unreflectable`) | attack (after own attack) |
| `damagePlayer` | damage enemy player / own player / both by amount each round | attack (after own attack) |
| `damagePlayerOnOppositeDeath` | when the opposite card dies: amount to enemy player | deathTrigger |
| `damagePlayerOnKill` | when a card this card damaged dies that round: amount to enemy player | deathTrigger |
| `damagePlayerOnDeath` | when self dies: amount to enemy player | deathTrigger |
| `damageCardsOnDeath` | when self dies: amount to every enemy card | deathTrigger |
| `reflect` | damage taken is dealt back to the attacking card (capped) | attack (reactive) |
| `reflectToPlayer` | damage taken is dealt to the enemy player, capped per hit | attack (reactive) |
| `selfDamage` | self takes amount each round | preAttack |
| `emptySlotBonus` | +/− flat damage when a direction hits an empty slot | attack |
| `bonusAttackOnDeath` | when self dies: extra attack — `{ "dirs": "opposite" | "all" | "oppositeNeighbors", "mult": 2 }` | deathTrigger |
| `dazeOnOppositeDeath` | when the opposite card dies: its neighbours dazed next round | deathTrigger |
| `revive` | once: return at full hp (`"attackFromValue": true` → attack = ability value) | creatureDeaths |
| `reviveAllies` | once, when self dies: all allies that died this round return at full hp | creatureDeaths |
| `kill` | end of round N: kill opposing card with `"pick": "highestAttack" | "lowestAttack"` or `"random": 2` | endOfRound |
| `swapStats` | round 1: random card swaps attack/hp | preAttack |
| `wheel` | each card ±amount at random | creatureHeal |
| `gamble` | Wizard Apprentice spell (±25 % allied attack, fail chance = value %) | preAttack |
| `poison` | own player loses amount in round N (Goblin Cook) | playerHeal (round 4) |
| `thiefOfTime` | special pattern (game-design §1.4) | suspension + preAttack |
| `none` | trainer cards | — |

`abilities.js` validates every entry at build time (unknown type/target → build error) and renders display text by
replacing `{v}` with the formatted ability value and `{pct}` with the percent.

### 3.4 Save schema (`game/state.js`)
```jsonc
{
  "version": 1, "createdAt": 0, "lastSeen": 0, "seed": 12345,
  "player": { "name": "", "avatar": 0, "level": 1, "xp": 0, "statPoints": 0,
              "stamina": 50, "staminaMax": 50, "mana": 50, "manaMax": 50, "hpMax": 1500,
              "staminaPotions": 2, "manaPotions": 1, "gold": 300, "gems": 0,
              "tokens": { "neophyte": 0, "summoner": 0, "archmage": 0, "portalLow": {}, "portalHigh": {} },
              "regenAt": 0, "questsDone": 0, "battlesWon": 0, "tournamentPoints": 0, "deckSlots": 2 },
  "cards": [ { "uid": "c1", "cardId": "envoy", "stage": 0, "level": 1, "xp": 0, "evolveQuality": 1 } ],
  "deck": [null, "c1", "c2", "c3", null],            // uids by slot
  "pieces": [ { "cardId": "guruk-the-destroyer", "owned": 2, "total": 6, "holderId": "sim-17" } ],
  "quests": { "main": { "unlocked": 1, "progress": { "quest": 1, "figuresLeft": 5, "waveIndex": 0 } },
              "portals": { "the-dark-beyond": { "unlocked": 1 } } },
  "sim": { "players": [...], "arena": { "offers": [...], "rerollAt": 0 }, "league": {...}, "day": "2026-10-07",
           "leagueTier": "bronze", "leagueJoined": false, "leaguePending": null, "leagueScore": 0, "leagueHistory": [] },
  "boosters": {},                                    // open 3×3 boosters by booster key (src/game/shop.js)
  "daily": { "streak": 0, "lastClaim": "" },
  "collections": { "claimed": [] },
  "replays": [ { "seed": 1, "attacker": {...}, "defender": {...}, "result": {...} } ],
  "settings": { "sound": false, "speed": 1, "raids": true, "reducedMotion": false },
  "tutorial": { "step": 0, "seen": ["fusion", "cardslot3"], "r3": {...} }   // seen: unlock popups shown; r3: src/ui/tutorial
}
```

## 4. Battle engine API (`engine/battle.js`)
```js
/**
 * @param {object} cfg
 * @param {FighterSide} cfg.attacker  { player:{name,hp,maxHp}, cards:[BattleCard|null x5] }
 * @param {FighterSide} cfg.defender
 * @param {number} cfg.seed
 * @param {object} [cfg.options] { maxRounds: 20 }
 * @returns {{ events: BattleEvent[], result: { winner: 'attacker'|'defender'|'draw', rounds, attackerHp, defenderHp, deaths } }}
 */
export function simulateBattle(cfg)
```
`BattleCard` is produced by `battle-state.js: toBattleCard(cardInstance, cardsDb)` (computes attack/hp/abilityValue
via `stats.js`, copies dirs and ability). `FighterSide` is built by `buildSide(playerLike, deckInstances, cardsDb)`
which also applies the tribe bonus to `maxHp`.

**Events** (append-only, in order; the UI plays them back):
```
{t:'battleStart', attacker:{...}, defender:{...}}
{t:'roundStart', round}
{t:'status', side, slot, status:'dazed'|'suspended'|'stunned'|'indestructible', on:true, source:{side,slot}}
{t:'buff', side, slot, stat:'attack'|'maxHp', delta, source}
{t:'attack', side, slot, targets:[{side, slot|null /* null = player */, damage, blocked, reflected}]}
{t:'damage', side, slot|null, amount, hp, cause:'attack'|'ability'|'reflect'|'death'|'poison'|'kill', source}
{t:'heal', side, slot|null, amount, hp, source}
{t:'death', side, slot, card}
{t:'revive', side, slot, hp, attack}
{t:'roundEnd', round, attackerHp, defenderHp}
{t:'battleEnd', winner, rounds, attackerHp, defenderHp}
```
The engine must be deterministic for a given `cfg` (same seed → identical events). It must never mutate `cfg`.

## 5. UI contract
- `src/app.js` owns the single `state` object (the save) and a `store` with `get()`, `update(fn)` (autosave +
  HUD refresh), `subscribe(fn)`. Screens export `screen = { render(ctx), onLeave?, noChrome? }`; the context is
  described in 8.1.
- Layout: a fixed **portrait stage** `#stage` of aspect 9:16, scaled with `transform: scale()` to fit the viewport
  (letterboxed on desktop with a dark vignette), logical size 720 × 1280 CSS px so all screens use absolute units.
  On phones it fills the width.
- Components return DOM nodes via `h(tag, props, ...children)`; no innerHTML with user data.
- Card component sizes: `compact` (collection grid, 120×168), `battle` (116×164 incl. stats strip), `detail`
  (full screen), `back` (face-down with tribe emblem).
- Every screen draws the HUD (`components/hud.js`) and the nav (`components/nav.js`) unless `ctx.noChrome`.
- Drag and drop (`components/drag-drop.js`): pointer events, works with mouse and touch; dragged card tilts −6°
  and glows blue; drop on a slot swaps/places; drop outside returns the card.
- Dialogs: `dialog.open({ title, body, buttons })` returns a Promise; the "Drink potion" dialog is a preset. The player level-up dialog and the unlock popups are `src/ui/components/popup-levelup.js` / `popup-unlock.js` (reached through `ctx.ui`).
- Countdown component renders `d:hh:mm:ss` like the original (`8:20:01:39`).

## 6. Testing requirements
`npm test` (`node --test tests/`, through `tests/index.js`) runs every suite in one process, one file per domain:

| file | covers |
|---|---|
| `stats.test.js`, `abilities.test.js` | stat checkpoints (wiki values ±1), caps, sell / fusion / sacrifice formulas; every ability validates, every effect type has a handler, display texts |
| `battle.test.js` | the engine against the original simulator rules (direction split, attack order, deaths at clean-up, 20 rounds, draws, tribe bonus, one scenario per effect type, the wiki's worked examples) and the original client's unit tests (`tests/fixtures/original-*.json`) |
| `battle-player.test.js`, `battle-ui.test.js` | playback timeline and board model; post-battle flow, keyframe sampler, skip rule, boss intro, lethal-blow finale, loot steps |
| `game-state.test.js`, `game-cards.test.js`, `game-quests.test.js`, `game-pvp.test.js` | `src/game` by domain (save and player; collection, training, fusion; quests; opponents, Arena, pieces), each on the fixture catalog and against `game-design.md` on the real data with deep-frozen inputs |
| `league.test.js`, `shop.test.js`, `tutorial.test.js` | the League; the shop, boosters and daily rewards; the tutorial (game layer, step script, the 1.7.0 video's outcomes) |
| `data.test.js`, `data-wiki.test.js` | the data pipeline and data files; the data re-checked against the raw wiki dumps and `game-design.md` |
| `integration.test.js` | the real data through the real modules (no stubs) |
| `app.test.js`, `ui.test.js`, `audio.test.js`, `menus.test.js`, `quest-ui.test.js`, `cards-ui.test.js`, `pvp-ui.test.js`, `economy-ui.test.js` | the DOM-free UI helpers, the store, the stylesheets and assets the components reference |
| `cdp.test.js` | `tools/cdp.js` and `tools/qa-lib.js` (skipped without an installed Edge / Chrome) |

Shared fixtures: `tests/fixtures/real.js` (clock, deep-freeze, real db and dependency bundles, save builders),
`tests/fixtures/cards.js` (engine fixtures), `tests/fixtures-game/` (21-card fixture catalog, stub engine and stats).
The inventory limit is 100 cards (extra reward cards are sold; boosters, fusion and pieces may exceed it).
Browser tests (dev-only, `tools/cdp.js` driving the installed Edge / Chrome, no Playwright): `npm run smoke` loads
the app, plays quest 1 to the boss, runs a battle with skip, opens every screen and captures screenshots to
`tests/screenshots/`; the QA scripts (`npm run qa`) play the core loop, the cards / economy screens and PvP
(`docs/dev/testing.md`). All must pass with zero console errors.

## 7. Performance and quality bars
- First paint < 1 s on a laptop from the local server; cards.json ≈ 300 KB; art lazy-loaded via `loading="lazy"`.
- Battle playback: 60 fps CSS animations only (transform/opacity); no layout thrash.
- Works at 360 px wide phones (stage scaling) and on a 1080p desktop (max stage height 100vh).
- Keyboard: Escape = back/close dialog; Enter = confirm. Focus outlines visible.
- No console errors or warnings in normal use; `'use strict'` modules; no global leaks besides `window.evoker` (debug).

---

## 8. Screen contract (binding for every screen module)

`src/app.js` boots the game and builds the context every screen receives. Screens are modules exporting
`{ render(ctx), onLeave?(ctx), noChrome? }` (see `src/ui/router.js`). `render` fills `ctx.root` (a `div.screen`)
and may return nothing; it may be `async`.

### 8.1 ScreenContext
```js
ctx = {
  root, screenId, params,            // from the router
  go(id, params?, {transition}?),    // push a sub-screen
  back(fallbackId?),                 // pop; with one screen on the stack, fallbackId replaces it
  replace(id, params?), rerender(), router,
  goTop(id, params?),                // jump to a nav screen: resets the stack to ['quest-map', id] (or ['quest-map' with params])
  store: {
    get(): state,                    // the save (never mutate it)
    update(fn): info,                // fn(state, deps, now) -> newState | { state, ...info }; sets the state, autosaves,
                                     // refreshes the HUD and returns `info` (the result minus `state`), or undefined
    set(state), subscribe(fn): unsubscribe,   // fn(state) after every update
  },
  deps: { db, stats, engine, rng, quests, names, abilities },   // what every src/game function takes as `deps`
  db,                                // same as deps.db
  now(): number,                     // ms epoch (the only clock)
  view: { cardView, defView, battleView, artUrlFor },           // src/ui/card-view.js
  chrome: {
    mount(opts): { hud, nav },       // appends the HUD (top) and the nav (bottom) to ctx.root; see 8.2
    refresh(),                       // re-read the store into the HUD (store.update does this automatically)
  },
  ui: { dialog, toast, showLevelUp, showPlayerLevelUp, showUnlocks, createCountdown, createDragDrop, stage },
                                     // showLevelUp(arg): a levelUpDetails entry, a level or an array of them = the player
                                     //   level-up dialog(s) (spend the points through the store, then the level's unlock
                                     //   popups); resolves when closed
                                     // showPlayerLevelUp(level, {index, count}): one player dialog (battle-result.js)
                                     // showUnlocks(list): unlock popups for feature ids / popup objects, marked seen
  event: () => dailyEvent,           // today's daily event object from src/game/shop.js (or null)
  sfx(name), music(name, opts?), audio,   // src/ui/audio.js: original sound names (docs/dev/audio.md); guarded no-ops if audio failed
}
```

### 8.2 Chrome
`ctx.chrome.mount({ active, back, help, hideNav, hideHud })`:
- `active`: nav id to highlight (`league | arena | quest | cards | shop`; `character` lights Profile or Options in
  the extended menu).
- `back`: `false` = no back handler; `true` = `ctx.back('quest-map')`; a function = custom handler. The arrow is only
  drawn on pushed sub-screens (`chrome.showsBackArrow`): the main tabs (`MAIN_SCREENS`: quest-map, arena, league,
  cards, shop) show "?" alone, and Escape runs the handler (the hardware back key).
- `help`: topic id for the help screen (`ctx.go('help', { topic })`); the `?` button opens it.
- HUD taps: the level / stamina / mana bar opens the profile (`character {tab: 'profile'}`); the money bar with the
  green `+` opens `shop` with the gem packs (`{ gems: true }`). The nav uses `ctx.goTop(id)` (`chrome.navTarget`: the
  middle button = `quest-map {}`, the extended menu's Album = `collections`, Profile / Options = `character`
  `{tab: 'profile' | 'settings'}`, Home = `quest-map {feed: true}`). Locked buttons follow `state.isUnlocked`
  (`nav.lockedNavItems`: a tutorial game opens Arena after quest 8 and League after quest 10, older saves at levels 4
  and 6) and show a toast ("Unlocks after quest n" / "Unlocks at level n").
- Layout: `.screen > .hud` (top), `.screen > .screen-body` (scrollable middle; screens create it), `.screen > .nav` (bottom).
  Screens with `noChrome: true` (title, battle, booster-open) draw neither.

### 8.3 Screen ids and params
| id | params | notes |
|---|---|---|
| `title` | — | key art + logo; "Tap to continue"; the first run plays the opening and starts a tutorial game with an automatic "user-<digits>" name (the name prompt comes at the first Arena entry); `noChrome` |
| `quest-map` | `{ line?: 'main' \| portalId, feed?: true }` | nav `quest`: `{}` = the main map (no back arrow); `{ line }` = that map (a portal map is pushed, back arrow → main map); `{ feed: true }` = the landing feed (daily strip, main quest, event, portal, Get Cards, next portal), shown at login and by the extended menu's Home; shows owed unlock popups |
| `quest` | `{ line, quest }` | minion taps, waves, rewards, then boss |
| `boss-intro` | `{ line, quest }` | "Boss Fight n" banner ("Showdown!" for a `showdown` node or a chapter's last quest), then → `prebattle` |
| `prebattle` | `{ mode, title, opponent, manaCost, fight, onDone }` | shared by quest/arena/pieces/league (8.4) |
| `battle` | `{ events, result, attacker, defender, rewards, levelUps, cardLevelUps, onDone }` | playback; `noChrome` |
| `cards` | `{ tab?: 'deck' \| 'training' \| 'fusion' }` | nav `cards`; the deck screen's three modes (anything else = deck), mode stripe + card slider |
| `card-detail` | `{ uid? , cardId?, stage?, level? }` | detail overlay screen with Sell / zoom |
| `collections` | `{ set? }` | set pages with locked silhouettes and the gem reward |
| `arena` | `{ tab?: 'arena' \| 'pieces' \| 'replays' }` | nav `arena` |
| `league` | — | nav `league` |
| `shop` | `{ gems?: true }` | nav `shop`; pack banners, potion deal, event offers; `gems` opens the gem packs |
| `booster-open` | `{ booster, portalId? }` | 3×3 grid of nine face-down cards; each pick pays 1 token or the pack's gem price; reset = new booster; `noChrome` |
| `character` | `{ tab?: 'profile' \| 'daily' \| 'settings' }` | pushed (back arrow), no tab bar: `profile` from the HUD bar / extended menu Profile (stat points of older saves below it), `settings` from Options, `daily` = the 21-day calendar |
| `help` | `{ topic }` | rules text per topic |

### 8.4 Fight protocol
1. The originating screen builds the opponent preview and navigates:
   `ctx.go('prebattle', { mode, title, opponent, manaCost, fight, onDone })` where
   - `opponent = { name, portraitUrl, level, hp, maxHp, faceDown, cards: (cardView|null)[5] }` (`faceDown: true` for PvP shows card backs with tribe emblems),
   - `manaCost` = the player's deck mana sum (0 for quests),
   - `fight()` runs the game function through the store and returns its info, e.g.
     `() => ctx.store.update((s, deps, now) => fightArena(s, deps, now, { offerIndex }))` → `{ battle: {events, result}, won, rewards, levelUps, cardLevelUps, ... }`,
   - `onDone(info)` is called after the result popup is dismissed (navigate back, show level-ups, etc.).
2. The pre-battle screen shows both rows, lets the player drag cards between the unlocked slots (the deck is saved
   through `src/game/collection.js` placeInDeck/removeFromDeck/setDeck), shows "Mana needed: x / y", and on Attack!
   checks mana (Drink-potion dialog when short), calls `fight()`, then `ctx.replace('battle', { ...info.battle, attacker, defender, rewards, levelUps, cardLevelUps, onDone })`.
3. The battle screen plays `events` with `src/ui/battle-player.js`, offers "Skip fight", then shows the result
   popup (Victory / Defeat / Draw, rewards, card XP) and finally calls `onDone(info)`.

### 8.5 Debug API (for the smoke test and QA)
`window.evoker = { store, router, deps, db, ui, view, chrome, audio, go, goTop, state: () => store.get(), version,
  debug: { giveGold(n), giveGems(n), givePotions(stamina, mana), giveTokens(kind, n, portalId?), setLevel(n),
           addCard(cardId, stage = 0, level = 1) → uid, maxCards(), refill(), unlockQuests(n), unlockAll(),
           addDays(n) /* shifts the save's clocks for daily tests */, reset(), newGame(name?) } }`
(`ui`, `view`, `chrome` are the objects of 8.1; `audio` is the player of `src/ui/audio.js`). Portals follow the 7-day
rotation; there is no debug hook to open one.
`document.body.dataset.ready = '1'` is set when the first screen has rendered; `data-screen` on `.screen` holds the id.

### 8.6 Browser automation (`tools/cdp.js`)
Zero-dependency Chrome DevTools Protocol driver using Node's built-in `WebSocket` (Node ≥ 22): launches the installed
Edge or Chrome headless with `--remote-debugging-port`, then `navigate(url)`, `evaluate(expr)`, `click(x, y)` (stage
coordinates are converted with `window.evoker.ui.stage.el.getBoundingClientRect()`), `screenshot(path)`, `console()` (captured
messages), `waitFor(expr, timeoutMs)`, `close()`. `tools/qa-lib.js` is the harness on top of it that the smoke test and
the three QA scripts share: `createQa` reads the command line (`--base`, `--out`, `--headed`, `--slow`, `--verbose`),
serves the project in-process (`startServer`, a free port) unless `--base` is given, launches the browser, runs named
steps with timings and screenshots and prints the summary / exit code; `bindApp` binds the `window.evoker`, DOM and
pointer helpers (go, state, debug calls, dismissing dialogs and overlays, drags, deck set-up, the minion walk to the
boss, the result popup). `tools/smoke.js` plays the first
quest, a battle, and opens every screen, saving PNGs under `tests/screenshots/` and failing on any console error.

## 9. Phase 3 additions (original client material)

- The engine (`src/engine`) is a literal port of the original simulator; its spec is `docs/design/original-engine.md`
  and the ability data model is `docs/design/ability-encoding.md`. Added event fields: `battleStart.seed`,
  `roundStart/roundEnd.attackerHp/defenderHp`, `roundEnd.cards`, `status.status` may be `stunned`, `buff.permanent`,
  `attack.targets[].dir`, `damage.blocked`, `swap`, `gamble`, `battleEnd.endedBy` (`playerHp | maxRounds | noAttack`).
- Chrome, cards, battle effects, quest map and quest screen draw the original sprites from `assets/orig/ui/` (see
  `docs/design/apk-assets.md`; nine-slice frames are generated into `assets/orig/ui/frames/` by `exploration/tools/make-frames.py`,
  card frames by `exploration/tools/make-card-frames.py`, map strips by `exploration/tools/build-map.py`, sprites by `exploration/tools/extract-sprites.py`).
- Audio: `src/ui/audio.js` (`docs/dev/audio.md`); fonts: `css/fonts.css` (Proxima Nova, CG Times, Roboto from the client).
