# Evoker iOS

A native iOS (17+) rewrite of **Evoker** — SwiftUI for the menus and deck building, SpriteKit for the battles,
and the game logic in its own Swift package with unit tests and golden tests recorded from the web version.
The reference implementation and all design documents live in `../Evoker Web/` (its `docs/design/*.md` are
binding for rules and numbers). The architecture plan is `docs/PLAN.md`, the cross-module contracts and the
change log of every work package `docs/CONTRACTS.md`.

## Structure

```
Evoker iOS/
├── Evoker.xcodeproj            the app project (hand-written for Xcode 16: synchronized folder "Evoker", local package
│                               EvokerCore, folder reference GameAssets); scheme "Evoker" builds the app and tests EvokerCoreTests
├── project.yml                 XcodeGen fallback that regenerates an equivalent project (see "If Xcode rejects the project")
├── Evoker/                     app target (SwiftUI + SpriteKit) — everything in this folder is in the target
│   ├── App/                    EvokerApp (@main), AppModel (store, deps, clock, assets, audio), Router, Route, Theme, Strings
│   ├── Screens/                one view per screen: title, quest map, quest, boss intro, pre-battle, battle (+ result),
│   │                           cards (deck / training / fusion), card detail, collections, arena (+ pieces, replays),
│   │                           league, shop, booster opening, character (profile / daily / options), help, card lab
│   ├── Components/             HUD, nav bar, card faces, nine-slice frames, bars, dialogs, popups, toasts, drag & drop
│   ├── Battle/                 SpriteKit battle scene, step player, effects, sounds, HUD nodes, reward animations
│   ├── Persistence/            GameStore (autosave, open flow), FileSaveStore, export / import, debug actions
│   ├── Assets/                 AssetCatalog protocol, BundleAssetCatalog (manifest-driven), fonts, palette, sprite views
│   ├── Audio/                  AudioPlayer (AVFoundation), the sound-alias table, music per screen
│   └── Assets.xcassets         AppIcon and AccentColor only (the game art is in GameAssets)
├── GameAssets/                 the single swappable art / sound / font catalog + manifest.json (generated, ~180 MB,
│                               2.7k files; copied as-is into the app bundle)
├── EvokerCore/                 Swift package (Foundation only): Core (JS math, rng, constants, stats, abilities,
│   │                           cards db, data loader), Models, Engine (the ported simulator), Game (pure game
│   │                           functions, one file per web module), Playback (timeline, board model),
│   │                           Data/ (cards, abilities, quests, names JSON); Tests/ with the golden fixtures
├── Support/                    only the Info.plist that XcodeGen writes (git-ignored); empty otherwise
├── Tools/                      Node / Python dev scripts, no npm dependencies:
│                               sync-data.mjs, gen-goldens.mjs (+ gen-goldens-game.mjs), build-assets.mjs,
│                               make-icon.py, check-pbxproj.mjs
├── .github/workflows/ios.yml   reference copy of the CI workflow (the live one is at the repository root, see way B)
└── docs/                       PLAN.md (architecture, module map, risks), CONTRACTS.md (contracts + change log)
```

## Requirements

- **To build and run:** a Mac with **Xcode 16 or newer** (the project file uses Xcode 16's synchronized folders
  and object version 77) and the iOS 17 SDK it ships with; an iPhone on iOS 17+ or the iOS Simulator.
- **To put it on a phone:** a free Apple ID (personal signing team) — way A below — or, without a Mac, a GitHub
  account and AltStore / Sideloadly on Windows — way B.
- **For the scripts:** Node 18+ (the data / asset / golden scripts have no npm dependencies); Python 3 with Pillow
  only for `make-icon.py`; a Chromium browser (Edge or Chrome) only for the SVG step of `build-assets.mjs`.
- **For `swift test` outside Xcode:** any Swift 5.9+ toolchain (macOS, Linux or Windows); the package has no
  UIKit dependency.

The scripts read the web game from `../Evoker Web/`, so keep the two folders side by side (the git repository root
is the parent folder `Evoker Card Game/` that contains both).

## Build and run

```sh
cd "Evoker iOS"
node Tools/sync-data.mjs          # copies ../Evoker Web/data/*.json into EvokerCore/Sources/EvokerCore/Data (re-run after a data change)
node Tools/build-assets.mjs       # fills GameAssets/ from ../Evoker Web/assets and writes manifest.json (idempotent; see below)
node Tools/check-pbxproj.mjs      # optional: sanity check of the hand-written project file
open Evoker.xcodeproj             # select the "Evoker" scheme and a destination, then Run (⌘R)
```

Both generated inputs are committed (`EvokerCore/.../Data/*.json`, `GameAssets/`), so a fresh checkout builds without
running the scripts; run them after the web game's data or assets change.

`build-assets.mjs` copies the card art, the original client sprites, sounds, fonts, map strips, minions, portraits
and keyframe animations, rasterises the web UI's SVG icons at 3x through a headless Edge / Chrome (found
automatically on Windows, macOS and Linux, or set `EVOKER_BROWSER=/path/to/chrome`), prunes stale files and checks
every manifest path. `--no-svg` skips the browser step and keeps the committed PNGs; `--verbose` lists every file.

### Tests

- In Xcode: Product ▸ Test (⌘U) runs `EvokerCoreTests` through the scheme (the app target has no tests of its own
  yet; `README` lists the manual smoke tour below).
- Anywhere with a Swift toolchain:

  ```sh
  cd "Evoker iOS/EvokerCore"
  swift build
  swift test                      # 286 tests in 17 suites: unit tests + the golden replays (battles, stats, game sequences)
  ```

  (On the Windows toolchain the environment notes of `docs/CONTRACTS.md` §2 and §6 apply.)

### Regenerating the goldens

`node Tools/gen-goldens.mjs` replays the web engine / stats / game functions and rewrites
`EvokerCore/Tests/EvokerCoreTests/Golden/*.json` (`rng`, `seeds`, `stats`, `battles-original`, `battles-cards`,
`battles-random`, `game-*`). Run it only when the web game changes on purpose, then `swift test`; never edit the
golden files by hand.

### The app icon

`python Tools/make-icon.py` (Pillow) renders `Evoker/Assets.xcassets/AppIcon.appiconset/AppIcon.png` (1024 px, no
alpha) from the original logo over the key art. The result is committed.

### If Xcode rejects the project

`project.yml` regenerates an equivalent project with [XcodeGen](https://github.com/yonaskolb/XcodeGen):

```sh
brew install xcodegen
cd "Evoker iOS" && xcodegen generate     # replaces Evoker.xcodeproj; writes Support/Info.plist (git-ignored)
```

The generated project uses classic groups and an Info.plist file instead of the synchronized folder and the
generated plist, otherwise it is the same (same settings, same scheme, same package test target). Restore
`Evoker.xcodeproj` from version control to go back to the hand-written one.

## Getting it on an iPhone

### A. With a Mac (Xcode + a free Apple ID)

1. Install Xcode 16+ from the App Store and open it once so it installs the iOS platform (accept the components
   prompt, or Xcode ▸ Settings… ▸ Components).
2. Xcode ▸ Settings… ▸ Accounts ▸ **+** ▸ Apple ID ▸ sign in. A plain Apple ID is enough: it appears as
   "*Your Name* (Personal Team)".
3. Open `Evoker iOS/Evoker.xcodeproj`. Wait until the local package has resolved (the activity bar shows
   "Resolving Package Graph" the first time).
4. In the Project navigator click the blue **Evoker** project ▸ TARGETS ▸ **Evoker** ▸ **Signing & Capabilities**
   ▸ tick *Automatically manage signing* ▸ Team: your Personal Team. If Xcode says the bundle identifier is not
   available, change `com.guiba.evoker` (same tab, *Bundle Identifier*) to anything unique, e.g.
   `com.yourname.evoker`.
5. On the iPhone: Settings ▸ Privacy & Security ▸ **Developer Mode** ▸ on ▸ restart (iOS 16+; the switch only
   appears after the phone has been connected to Xcode once — connect, then look again). Connect the phone by USB
   and tap *Trust This Computer*.
6. In the toolbar choose the scheme **Evoker** and your iPhone as the destination (Window ▸ Devices and
   Simulators if it is not listed; wireless debugging can be enabled there too). Product ▸ **Run** (⌘R). The first
   run takes a few minutes while Xcode prepares the device and compiles everything.
7. If the launch stops with *Untrusted Developer*: on the phone Settings ▸ General ▸ **VPN & Device Management** ▸
   *Developer App* ▸ your Apple ID ▸ **Trust** ▸ Trust, then open Evoker from the home screen.
8. A free Apple ID signs the app for **7 days**; run it from Xcode again to renew (the save stays). Free accounts
   can have at most 3 sideloaded apps installed at once and register 10 new app IDs per week.

### B. Without a Mac (GitHub Actions + AltStore or Sideloadly on Windows)

The CI workflow builds the app on a macOS runner and publishes an **unsigned** `.ipa`; AltStore or Sideloadly then
sign it on your PC with your free Apple ID and install it over USB.

1. Push the repository to GitHub (a private repository is fine). The workflow file must be at
   `.github/workflows/ios.yml` **of the repository root**, i.e. `Evoker Card Game/.github/workflows/ios.yml` — it is
   there; `Evoker iOS/.github/workflows/ios.yml` is an identical reference copy (keep them in sync). The scripts need
   `Evoker Web/` in the same repository.
2. On GitHub: **Actions** tab ▸ enable workflows if asked ▸ *iOS build and tests* ▸ **Run workflow** (it also runs
   on every push that touches `Evoker iOS/`). Three jobs: `EvokerCore tests`, `App build (iOS Simulator)`, then
   `Unsigned .ipa`. A run takes roughly 10–20 minutes; on a private repository macOS minutes count 10× against the
   free quota (2000 min/month → about 200 macOS minutes), so trigger it deliberately.
3. When the run is green, open it ▸ **Summary** ▸ *Artifacts* ▸ download **Evoker-unsigned-ipa** and unzip it: the
   file inside is `Evoker-unsigned.ipa` (~180 MB, it contains the whole `GameAssets` folder). Artifacts are kept
   14 days.
4. Install it from Windows, either way:
   - **Sideloadly** (simplest): install iTunes (needed for the USB driver; the Microsoft Store version is fine),
     then [Sideloadly](https://sideloadly.io). Plug the iPhone in, open Sideloadly, drag `Evoker-unsigned.ipa` onto
     it, type your Apple ID, **Start**, enter the password (and the two-factor code when asked). On the phone:
     Settings ▸ General ▸ VPN & Device Management ▸ your Apple ID ▸ Trust; on iOS 16+ also Settings ▸ Privacy &
     Security ▸ Developer Mode ▸ on ▸ restart (the switch appears after the first install attempt).
   - **AltStore**: install iTunes and iCloud **from apple.com** (not the Microsoft Store versions), then
     [AltServer](https://altstore.io) for Windows. AltServer tray icon ▸ *Install AltStore* ▸ your iPhone ▸ Apple
     ID. On the phone trust the developer as above, open **AltStore** ▸ *My Apps* ▸ **+** ▸ pick
     `Evoker-unsigned.ipa` (copy it to the phone with iCloud Drive / the Files app first, or use the tray icon's
     *Sideload .ipa*).
5. **7-day renewal**: a free Apple ID signs the app for 7 days. Sideloadly: repeat step 4 before it expires (the
   save file is kept when the same app is reinstalled). AltStore: it refreshes the app by itself while AltServer runs
   on a PC in the same Wi-Fi, or tap *Refresh All* in AltStore ▸ My Apps. Export the save from Options first if you
   want to be safe (see below). The same 3-apps / 10-IDs-per-week limits as way A apply.

## Save file

One JSON file in the app's sandbox, in the web game's `evoker.save.v1` format (sorted keys; a web export imports on
iOS and vice versa):

```
Library/Application Support/Evoker/evoker.save.v1.json          the save
Library/Application Support/Evoker/evoker.save.v1.json.bak      the save before the last write
Library/Application Support/Evoker/evoker.save.v1.corrupt.json  the last file that failed to parse (kept aside)
```

Writes are atomic and happen after every change (and when the app goes to the background). Character ▸ **Options**:
*Export save* shares `evoker-save-<date>.json` (AirDrop, Files, Mail…), *Import save* reads one back (same
validation and messages as the web's save-file screen), *Reset progress* deletes it. The Options screen also opens
the **Card Lab** (any card at any stage / level against auto-built rows, the real battle scene, the engine log).

## What is deferred

The first-session **tutorial script** of the web game (the ranger overlay, the opening cinematic and the scripted
fight of `Evoker Web/src/ui/tutorial/`). Its *data* is in: the tutorial bosses of quests 1–10, the soul-card drops,
the quest-based feature unlocks and the name prompt at the first Arena visit, so a new game plays the 1.7.0 early
game without the hand-holding. Multiplayer is out of scope by design.

## Status and known risks

State of the first round (2026-10-11), written on a Windows machine without Xcode:

- **EvokerCore** (engine, stats, abilities, game functions, playback timeline) builds and its 286 tests pass with a
  Swift 6.4 toolchain in Swift 5 mode (`swift test`): the golden replays of the 64 original client unit tests, one
  fight per card, 40 random fights, every stat table and the recorded game sequences (new game → quests → bosses,
  arena / league / pieces, shop, cards, migration of web saves) match the web engine event by event.
- **The app target** (SwiftUI menus, SpriteKit battle, persistence, asset catalog, audio) has **not been compiled**:
  UIKit / SpriteKit / SwiftUI do not exist on Windows. Every file was parse-checked (`swiftc -parse`), the pure
  Foundation files were type-checked against the real EvokerCore module, and two review passes cross-checked every
  `Namespace.member(label:)` the app uses against the package's public API, every symbol between app files, duplicate
  type names, missing imports, and every sprite / sound / animation name against `GameAssets/manifest.json`
  (all resolve). **Expect the first Xcode build to report a handful of SwiftUI / SpriteKit typing errors**; the
  places most likely to need a touch are listed in `docs/CONTRACTS.md` §6 (the integrator and review entries) — none
  of them is a design problem. Way B's `App build` job is that first compile when no Mac is at hand.
- The hand-written `project.pbxproj` was checked against Xcode 16's template and by `Tools/check-pbxproj.mjs`, but
  it has not been opened by Xcode yet; `project.yml` is the fallback.
- `GameAssets/` is ~180 MB, so the app is a sideload-sized bundle; `build-assets.mjs` is the place to downscale
  later, and the catalog behind `AssetCatalog` can be swapped.

Manual smoke tour once it runs: title → new game → quest 1 (tap minions, boss intro, pre-battle drag & drop,
battle, result) → Cards (deck / training / fusion) → Shop (open a Neophyte booster) → Arena (name prompt, offers,
pieces) → League → Character (profile, daily, options: volumes, export / import, reset, Card Lab) → Help.
