# Evoker iOS

A native iOS (17+) rewrite of **Evoker** — SwiftUI for the menus and deck building, SpriteKit for the battles,
and the game logic in its own Swift package with unit tests and golden tests recorded from the web version.
The reference implementation and all design documents live in `../Evoker Web/` (its `docs/design/*.md` are
binding for rules and numbers). The architecture plan is `docs/PLAN.md`.

## Structure

```
Evoker iOS/
├── Evoker.xcodeproj            the app project (scheme "Evoker": builds the app, tests EvokerCoreTests)
├── Evoker/                     app target (SwiftUI + SpriteKit)
│   ├── App/                    EvokerApp (@main), AppModel (store, deps, clock, assets, audio), Router, Theme
│   ├── Screens/                one view per screen: title, quest map, quest, boss intro, pre-battle, battle,
│   │                           cards (deck / training / fusion), card detail, collections, arena (+ pieces,
│   │                           replays), league, shop, booster opening, character (profile / daily / settings), help, lab
│   ├── Components/             HUD, nav bar, card faces, nine-slice frames, dialogs, popups, drag & drop
│   ├── Battle/                 SpriteKit battle scene, step player, effects, sounds, result overlay
│   ├── Persistence/            FileSaveStore (JSON in Application Support), export / import, GameStore
│   ├── Assets/                 AssetCatalog protocol + BundleAssetCatalog (manifest-driven)
│   ├── Audio/                  AudioPlayer (AVFoundation)
│   └── Assets.xcassets         AppIcon and AccentColor only
├── GameAssets/                 the single swappable art/sound catalog (generated, see below)
├── EvokerCore/                 Swift package: Core (rng, constants, stats, abilities, cards db), Models,
│   │                           Engine (the ported simulator), Game (pure game functions), Playback (timeline),
│   │                           Data (cards / abilities / quests / names JSON); Tests with the golden fixtures
├── Tools/                      Node / Python dev scripts (sync-data, gen-goldens, build-assets, make-icon, check-pbxproj)
└── docs/PLAN.md                architecture, module map, risks
```

## Requirements

- macOS with **Xcode 16 or newer** (the project uses Xcode 16's synchronized folders) and the iOS 17 SDK.
- An iPhone on iOS 17+ and a free Apple ID (for a personal signing team), or the iOS Simulator.
- Node 18+ for the data / asset / golden scripts (no npm dependencies).

## Build and run

```sh
cd "Evoker iOS"
node Tools/sync-data.mjs       # copies ../Evoker Web/data/*.json into the package (already done, re-run after data changes)
node Tools/build-assets.mjs    # fills GameAssets/ from ../Evoker Web/assets (card art, sprites, sounds, fonts) + manifest.json
open Evoker.xcodeproj          # select the "Evoker" scheme and your device, then Run (⌘R)
```

Running the EvokerCore tests: Product ▸ Test (⌘U) in Xcode, or on any machine with a Swift 5.9+ toolchain:

```sh
cd "Evoker iOS/EvokerCore"
swift test                     # unit tests + the golden replays (battles, stats, game sequences)
```

Regenerating the golden fixtures (only when the web game changes): `node Tools/gen-goldens.mjs`. Never edit the
files under `EvokerCore/Tests/EvokerCoreTests/Golden/` by hand.

If Xcode ever refuses the hand-written project file, `project.yml` regenerates an equivalent one with
[XcodeGen](https://github.com/yonaskolb/XcodeGen): `brew install xcodegen && xcodegen generate`.

## On the phone (first time)

1. Open `Evoker.xcodeproj`, select the **Evoker** target ▸ *Signing & Capabilities*, tick *Automatically manage
   signing* and pick your personal team (Xcode ▸ Settings ▸ Accounts ▸ add your Apple ID if needed). Change the
   bundle identifier if Xcode complains that `com.guiba.evoker` is taken.
2. Plug the iPhone in (or pair it over Wi-Fi), enable *Developer Mode* on the phone (Settings ▸ Privacy & Security),
   select the phone as the run destination and press Run.
3. The first launch is blocked until you trust the developer certificate: Settings ▸ General ▸ VPN & Device
   Management ▸ your Apple ID ▸ Trust. Launch again.
4. A free Apple ID signs the app for 7 days; rebuild from Xcode to renew it.

## Save files

The save is `Application Support/Evoker/evoker.save.v1.json` inside the app's sandbox, in the web game's format:
Options ▸ *Export save* shares it as JSON, *Import save* reads one back (a web export works too), *Reset progress*
starts over.

## Status

See the bottom of this file for the delivery notes of the current round and `docs/PLAN.md` §10 for the known
risks. The first-session tutorial *script* (ranger overlay, opening cinematic) is deferred; the early game
(quests 1–10 with the tutorial bosses, soul-card drops, quest-based unlocks, the name prompt at the first Arena
visit) plays like the 1.7.0 client without it.
