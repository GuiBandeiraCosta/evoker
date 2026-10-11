# Cross-module contracts (binding for every work package)

Companion to `PLAN.md` §4–§5. The shared Swift models and protocols already exist in
`EvokerCore/Sources/EvokerCore/{Models,Protocols.swift,Core,Game/GameAPI.swift}` — read them before writing code;
the names below are the ones every package must use. Changing a shared signature requires a note at the end of
this file (section "Changes") so the reviewer and the other packages can follow.

## 1. Ownership

| Package | Writes | Reads only |
|---|---|---|
| A engine | `EvokerCore/Sources/EvokerCore/Core/{Stats,Abilities}.swift`, `Engine/**`, `Playback/**`, their tests | `Models`, `Protocols.swift`, `Game/GameAPI.swift` |
| B game | `EvokerCore/Sources/EvokerCore/Game/**` (replaces the stubs of `GameAPI.swift` module by module), `Tools/gen-goldens-game.mjs`, `Tests/.../GoldenGameTests.swift` + game unit tests | `Core`, `Engine`, `Models` |
| C battle | `Evoker/Battle/**`, `Evoker/Screens/BattleScreen.swift`, `Evoker/Screens/BattleResultView.swift` | everything else |
| D menus | `Evoker/App/**` (except `EvokerApp.swift`, `Route.swift` which exist), `Evoker/Screens/**` (except battle), `Evoker/Components/**` | everything else |
| E persistence | `Evoker/Persistence/**` | everything else |
| F assets | `Tools/build-assets.mjs`, `Tools/make-icon.py`, `GameAssets/**`, `Evoker/Assets/**` (except `AssetCatalog.swift` which exists), `Evoker/Audio/**` (except `AudioPlaying.swift`), `Evoker/Assets.xcassets/AppIcon.appiconset/AppIcon.png` | everything else |

Nobody edits `Models/*`, `Protocols.swift`, `Core/{JSMath,Mulberry32,Constants,CardsDb}.swift`, `Route.swift`,
`AssetCatalog.swift`, `AudioPlaying.swift`, `BattlePresentation.swift` or `project.pbxproj` without recording the
change in "Changes" below. Additions (new types, new files) are free.

## 2. Build and test environment

- EvokerCore builds with any Swift 5.9+ toolchain (`swift build`, `swift test` in `Evoker iOS/EvokerCore`). On this
  Windows machine a toolchain may be available through the environment script
  `C:\Users\guiba\AppData\Local\Temp\claude\c--Users-guiba-Desktop-Evoker-Card-Game\6a7288c0-24d6-492d-a877-9e48b45f5e8e\scratchpad\swift-toolchain\swift-env.ps1`
  (PowerShell: `. <that path>`; Git Bash: `source <same folder>/swift-env.sh`). If the file does not exist, no
  compiler is available: write the code with extra care (explicit types, no clever generics, no new APIs) and say
  so in your report.
- The app target (SwiftUI / SpriteKit) can only be compiled on a Mac. Keep to well-known iOS 17 APIs, explicit
  types, `@MainActor` on observable objects and views' side effects, Swift 5 language mode (no strict concurrency
  constructs that need Swift 6), no third-party packages.
- Never run `swift build` from inside the `Evoker Web` tree; never modify `Evoker Web`.
- Line endings LF, 4-space indentation, `public` API in EvokerCore, `internal` by default in the app.

## 3. EvokerCore API the app relies on

Besides `Models/*` and `Game/GameAPI.swift` (one `enum` namespace per web module: `StateOps`, `PlayerOps`,
`CollectionOps`, `TrainingOps`, `FusionOps`, `QuestOps`, `RewardOps`, `OpponentOps`, `PvpOps`, `ArenaOps`,
`PieceOps`, `LeagueOps`, `ShopOps`, `StoreHelpers`, `AppFlow`), package A provides:

```swift
public struct Stats: StatsProviding { public init() }                // Core/Stats.swift
public struct BattleEngine: BattleSimulating { public init() }       // Engine/BattleEngine.swift
public enum Abilities {                                              // Core/Abilities.swift
    public static func validate(_ ability: AbilityDef?) -> [String]
    public static func hasAbility(_ ability: AbilityDef?, stage: Int) -> Bool
    public static func formatValue(_ n: Double?) -> String           // "12,345", one decimal for percents, "?" for nil
    public static func renderAbilityText(_ ability: AbilityDef?, value: Double?, stage: Int) -> String
    public static func effectTypesOf(_ ability: AbilityDef?) -> [BuffType]
    public static func effectDirs(_ ability: AbilityDef?, stage: Int) -> [CatalogDirection]    // blue arrows
    public static func healDirs(_ ability: AbilityDef?, stage: Int) -> [CatalogDirection]      // green arrows (card-view.js healDirsFor)
    public static func buffsForStage(_ ability: AbilityDef?, stage: Int, abilityValue: Double?, cardDirs: [CatalogDirection]) -> [Buff]
    public static func toOriginalDirs(_ dirs: [CatalogDirection]) -> [OriginalDirection]
    public static func toCatalogDirs(_ dirs: [OriginalDirection]) -> [CatalogDirection]
}
public enum TribeBonus {                                             // Engine/TribeBonus.swift
    public static let multiplier = 1.2
    public static func hasTribeBonus(_ tribes: [Tribe?]) -> Bool
    public static func bonusTribe(_ tribes: [Tribe?]) -> Tribe?
}
public enum Timeline {                                               // Playback/Timeline.swift
    public static func fromEvents(_ events: [BattleEvent], speed: Double = 1) -> [PlaybackStep]
    public static func roundFactor(_ round: Int) -> Double
    public static func stepDuration(kind: StepKind, baseMs: Int?, factor: Double?, speed: Double) -> Int
    public static func tribeBonuses(_ start: BattleEvent) -> [TribeBonusMoment]
    public static func lethalStep(_ events: [BattleEvent], steps: [PlaybackStep]? = nil) -> Int   // -1 = none
    public static func countdownValue(from: Int, to: Int, k: Double) -> Int
    public static func orderDeathsAfterReflects(_ events: [BattleEvent]) -> [BattleEvent]
}
extension BoardModel {                                               // Playback/BoardModel.swift
    public static func initial(events: [BattleEvent]) -> BoardModel
    public mutating func reduce(_ event: BattleEvent)
    public static func final(events: [BattleEvent]) -> BoardModel
}
public enum Summaries {                                              // Engine/Summary.swift (summariseBattle)
    public static func lines(_ events: [BattleEvent]) -> [String]
}
```

`BattleState` (Engine/BattleState.swift) exposes `toBattleCard`, `buildSide`, `resolveBuffs`, `normaliseBuff`,
`normaliseDirs`, `toOriginalDirs` as `public static` functions; `BattleEngine` forwards to them.

## 4. App-side contracts

### 4.1 GameStore (package E implements, D and C consume)

```swift
@MainActor final class GameStore: ObservableObject {
    @Published private(set) var state: GameState?
    let deps: Deps
    let clock: Clock                                  // () -> Int64 ms epoch
    init(saveStore: SaveStore, deps: Deps, clock: @escaping Clock)
    var hasSave: Bool { get }
    /// Reads the save, runs AppFlow.onOpen, publishes; nil when there is no save.
    func load() -> OnOpenResult?
    func newGame(name: String) -> OnOpenResult
    func set(_ state: GameState)                      // replace wholesale (import, debug); autosaves
    /// Apply a pure game function; autosaves and publishes; returns the info part.
    @discardableResult func update<T>(_ fn: (GameState, Deps, Int64) throws -> (state: GameState, info: T)) rethrows -> T
    func updateState(_ fn: (GameState, Deps, Int64) throws -> GameState) rethrows
    func exportJSON() throws -> Data
    func importJSON(_ data: Data) throws -> OnOpenResult
    func reset()                                      // deletes the save, state = nil
    /// Regen + new-day work; call from a 60 s timer and when the app comes to the foreground.
    func tick()
    var now: Int64 { get }                            // clock()
    var dailyEvent: DailyEvent? { get }               // ShopOps.dailyEvent(now: PlayerOps.eventClock(state, now), state: state)
    var dailyEventId: DailyEventId? { get }
    /// Debug helpers (port of window.evoker.debug): giveGold, giveGems, givePotions, giveTokens, setLevel, addCard, maxCards,
    /// refill, unlockQuests, unlockAll, addDays — each a method that goes through `update`/`set`.
    var debug: DebugActions { get }
}
```

### 4.2 AppModel (package D)

```swift
@MainActor final class AppModel: ObservableObject {
    let store: GameStore
    let assets: AssetCatalog
    let audio: AudioPlaying
    let router: Router                                // @Published path: [Route]; go, back, replace, goTop, rerender
    var pendingBattles: [UUID: BattlePresentation]    // Route.battle(id:) looks here
    var pendingBossIntro: (line: String, n: Int)?     // one-shot
    static func live() -> AppModel                    // FileSaveStore + real Deps(db, Stats(), BattleEngine(), quests, names) + BundleAssetCatalog.shared + AudioPlayer
}
```

Views get the model with `@EnvironmentObject var model: AppModel`; the store with `model.store`. `Deps` is built once:
`Deps(db: CardsDb(json:), stats: Stats(), engine: BattleEngine(), rng: { Mulberry32($0) }, quests:, names:)` from
`Bundle.module`-style resources of EvokerCore (`DataLoader.loadCardsDb()`, `loadQuests()`, `loadNames()` — package A
adds `Core/DataLoader.swift` that reads `Data/*.json` from the package resource bundle).

### 4.3 Asset helpers (package F implements, C and D consume)

```swift
final class BundleAssetCatalog: AssetCatalog { static let shared: BundleAssetCatalog }   // manifest-driven, caches UIImage
struct AssetCatalogKey: EnvironmentKey { static let defaultValue: AssetCatalog = BundleAssetCatalog.shared }
extension EnvironmentValues { var assets: AssetCatalog }

struct SpriteImage: View { init(_ name: String) }                       // the sprite at its natural size, resizable()
struct NineSliceImage: View { init(_ name: String, capInsets: EdgeInsets) }  // resizable(capInsets:, resizingMode: .stretch)
struct CardArtView: View { init(card: CardDef, stage: Int) }            // the stage art, aspect fill, placeholder fallback
extension Font { static func evoker(_ role: FontRole, size: CGFloat) -> Font }   // registered client fonts
enum Palette { /* colours of css/tokens.css and apk-assets.md as static Color constants: xp, stamina, mana, health, gold, rarity(_:), tribe(_:) ... */ }
extension SKTexture { static func sprite(_ name: String, assets: AssetCatalog) -> SKTexture? }   // SpriteKit textures through the catalog
```

### 4.4 Audio (package F implements)

`final class AudioPlayer: AudioPlaying` — AVAudioPlayer pool for effects, one looping player for music with a short
crossfade, honours `Settings.sound / musicVolume / fxVolume`; `apply(_:)` is called by the store on every change.
`ScreenMusic.name(for:)` (exists) gives the music per route. Click sounds: the nav / HUD / button components call
`model.audio.sfx("ui_button_circular")` etc. themselves (audio.js soundForClick table: nav buttons
`ui_button_switch`, map nodes `ui_button_map`, cards `ui_button_card`, close `ui_button_card_close`, attack
`ui_button_attack`, generic `ui_button_circular`).

### 4.5 Router (package D)

```swift
@MainActor final class Router: ObservableObject {
    @Published var path: [Route]                      // the root is Route.questMap() once a save exists; title before
    func go(_ route: Route)                           // push
    func back(fallback: Route = .questMap())          // pop; with one entry, replace it by the fallback
    func replace(_ route: Route)                      // replace the top
    func goTop(_ nav: NavItem)                        // reset to [.questMap()] / [.questMap(), route] (chrome.navTarget)
    func rerender()                                   // bump an @Published counter
    var current: Route? { get }
}
```

Main tabs (quest map, arena, league, cards, shop) show no back arrow; pushed screens show one. Escape/hardware back
does not exist on iOS: the HUD back arrow and swipe-back are the only ways back (disable the interactive pop on the
battle and booster screens).

## 5. Reporting

Every package ends with a report (the workflow collects it): files written, public API added, how it was verified
(`swift test` output summary or "not compiled: no toolchain"), deviations from the web behaviour with the reason,
open issues for the integrator. Never claim a test passed that was not run.

## 6. Changes

(append here: date, package, what changed and why)

- 2026-10-11, package A (engine): `Models/Battle.swift` — `BattleCard` and `CardSnapshot` gained an optional
  `tribeName: String?` (init parameter with default nil, so no caller changes). The web keeps unknown race names
  verbatim (the original client tests use "Orks" / "Elfen" / "Zwerge") and the engine counts them as their own race;
  the typed `Tribe` cannot hold them. Decoding fills `tribeName` (lower-cased) when the JSON tribe is not one of the
  four tribes (the `Tribe` field is then `.neutral`); encoding writes `tribeName ?? tribe` under `tribe`. Real cards
  never set it. Needed by `GoldenBattleTests.testOriginalClientUnitTests` (battleStart / death snapshots of raw cards).
- 2026-10-11, package A: added `Core/JSPow.swift` (`JSMath.pow`): V8 12.4's fdlibm-derived `Math.pow`, bit-exact with
  node 22. The host `pow` differs in the last ulp on about 5 % of inputs and the stat formulas round values that sit on
  `.5` boundaries, so every port of a web `**` / `Math.pow` must use `JSMath.pow`, never Foundation's `pow`.
- 2026-10-11, package A: `TribeBonus` also offers the string-based `hasTribeBonus(names:)` / `bonusTribeName(names:)` /
  `hasTribeBonus(cards:)` the engine uses; the typed `[Tribe?]` overloads of the contract are unchanged.

- 2026-10-11, package E (persistence): no shared signature changed. `GameStore` (Evoker/Persistence/GameStore.swift)
  implements 4.1 as written and adds, for the app model to wire: `onChange: ((GameState?, GameState?) -> Void)?`
  (after every publish: audio `apply(settings)`, potion-diff sfx), `onNotices: (([Notice]) -> Void)?` (login notices
  raised by a new UTC day in `tick()`), `onSaveError`, `@Published today: String` (the web's NEW_DAY_RERENDER hook),
  `open(_:)` (prune + onOpen + set), `flush()` (call on scenePhase background), `updateSettings(_:)` (setSettings with
  the web's normalisation). `FileSaveStore()` is the default store for `AppModel.live()`. Settings-screen views:
  `ExportSaveLink`, `ImportSaveButton`, `ResetProgressButton`, `SaveTransferButtons` (Evoker/Persistence/SaveTransfer.swift).

- 2026-10-11, package C (battle): `Evoker/Battle/BattlePresentation.swift` gained three defaulted fields so the result flow can be faithful without touching callers: `deckBefore: [DeckCardSnapshot] = []` (prebattle.js `deckSnapshot(state)` taken before the fight, for the XP bars; empty = reconstructed from the save after the fight), `defenderPortrait: String? = nil` (a sprite stem such as a boss portrait; nil = the avatar sprite of `defenderAvatar`, then `default_player`), `theme: String? = nil` (battle.js THEMES id; nil = derived from mode/line, so a lava quest >= 31 needs `theme: "lava"` from the pre-battle screen). New type `DeckCardSnapshot` (same file) with `DeckCardSnapshot.deck(of: state)`. Package D should fill `deckBefore` (and `theme`, `defenderPortrait`) when it builds the presentation.

- 2026-10-11, package B (game layer): no shared signature changed. `Game/GameAPI.swift` is gone; its enums live in
  `Game/{State,Player,Collection,Training,Fusion,Quests,Rewards,Opponents,Pvp,Arena,Pieces,League,Shop,StoreHelpers}.swift`
  (`AppFlow` is in StoreHelpers.swift). Notes for the integrator and the reviewer:
  - `StateOps.migrated` also sets `sim.leagueJoined` / `sim.leagueTier` to nil when the raw save has no `sim` object
    at all (the web's deepDefaults rule); the decoder alone only did it for a `sim` object without the keys.
  - `SaveCodec.parse` → `StateOps.migrated`; the app must call `StateOps.pruneRemoved` afterwards (app.js openSave).
  - `StoreHelpers.addDays` = shiftClocks + the `daily.dayShift` bump of the debug API; the app runs `AppFlow.onOpen` after it.
  - Game goldens (`Tests/EvokerCoreTests/Golden/game-*.json`, `Tools/gen-goldens-game.mjs`): fight infos keep only
    `battle.result`, a quest node only `{n}`; `game-migrate.json` compares the whole save except that an old league is
    normalised like the `League` decoder does (`v` 1, `profiles` {}, platinum → gold).
  - Build environment on this Windows machine: the vcvars-style variables of swift-env.sh (WindowsSdkDir, VCToolsInstallDir,
    …) make the driver pass `-windows-sdk-root` / `-visualc-tools-root`, which together with the patched SDKSettings.plist
    trips an LLVM assertion in every compile; unsetting them (`swb.sh` in the scratchpad) makes `swift build` / `swift test` work.

- 2026-10-11, package D (menus / deck UI): no shared signature changed; additions only. `AppModel`
  (App/AppModel.swift) exposes beyond 4.2: `dialogs: DialogCenter`, `toasts: ToastCenter`, `levelUps: LevelUpCenter`,
  `event: DailyEventId?` / `dailyEvent`, `sfx(_:)`, `toast(_:icon:duration:)`, `update(toastOnError:_:)` /
  `updateState(toastOnError:_:)` (store wrappers that turn a thrown `GameError` into a toast), `presentBattle(_:replacing:)`,
  `battleFinished(_:)`, `showLevelUps(_:)`, `showUnlocks(_:)`, `catchUpUnlocks()`, `offerPotion(kind:amount:)`,
  `maybeAskName()`, `celebratePiece(cardId:)`, `clockTick` (a 1 s counter the countdowns observe), `sessionStarted`.
  `Router` adds `root` (the screen under the path: `.title` until the title is tapped, then `.questMap()`),
  `goTop(route:)`, `popTo(_:)` and `replace(_:animated:)`. `Route.battle(id:)` is rendered as package C's
  `BattleScreen(id:)`. The menus draw sprites through `AssetCatalog.image(_:)` with these stems that the manifest
  must resolve: the stitched nine-slice frames of `Evoker Web/assets/orig/ui/frames/*.png` by file stem
  ("hud_nineframe", "ironframe", "small_white", "small_yellow", "glowgold", "glowblue", "glowred", "button_default",
  "button_green", "button_danger", "button_inactive", "quadbutton", "quadbutton_shop", "bigbutton03",
  "bigbutton03_inactive", "bigbutton04", "bigbutton04_inactive", "backbutton", "smallbutton", "menubar_button",
  "resourcebar", "moneybar", "progressbar", "progressbar_knob"), the `assets/bg` paintings by stem ("title",
  "horizon-valley", "horizon-sunset", "horizon-swamp", "boss-valley", "quest-valley"), the map strips "world-N-M"
  (+ `data("map/layout.json")`), the minion cut-outs "orc-1" … "neutral-7", and "guide-ranger" / "pack-frame" from
  `assets/ui`. Package D uses `Font.evoker` but not SpriteImage / NineSliceImage / CardArtView / Palette (its own
  `Sprite`, `StretchedSprite`, `NineSlice`, `TiledSprite`, `CardArt` views in App/Theme.swift and
  Components/CardFaceView.swift call the catalog directly through `AppModel.assets`).

- 2026-10-11, EvokerCore integrator: no file of the package needed a change. Verified on a clean build (`rm -rf .build`)
  with the Swift 6.4 Windows toolchain: `swift build` (0 compiler warnings) and the full `swift test` — 286 tests,
  0 failures across all 17 suites (Abilities, Engine, GameCards, GamePvp, GameQuests, GameState, GoldenBattle,
  GoldenGame, GoldenStats, JSMath, League, Models, Rng, Shop, Stats, Store, Timeline); golden files untouched. The
  section 3 signatures match the sources (`Abilities.*`, `TribeBonus.*`, `Timeline.*`, `BoardModel.*`, `Summaries.lines`,
  `Stats`, `BattleEngine`; extra `stage: Int = 0` / `abilityValue: Double? = nil` defaults are source-compatible
  additions), all 15 game namespaces of the former `Game/GameAPI.swift` exist as `public enum`s in `Game/*.swift`
  with no stub left, every `**` of the web is `JSMath.pow`, every file is LF / 4-space. Both the prescribed
  `swift-env.sh` + `swift build` command and `scratchpad/swb.sh` now compile without the LLVM assertion noted by
  package B. `node Tools/check-pbxproj.mjs` → "project.pbxproj looks consistent". Where the text above still says
  `Game/GameAPI.swift`, read `Game/{State,…,StoreHelpers}.swift`.

- 2026-10-11, app-side integrator (static consistency pass over `Evoker/`, no compiler for the app target). Fixes:
  - `Evoker/Battle/BattleHUDNodes.swift`: removed the duplicate `plainNumber(_ n: Int)` (App/Theme.swift keeps the
    `Int` overload; the `Double` one stays here) — an "invalid redeclaration" otherwise.
  - `Evoker/Screens/BattleResultView.swift`: removed package C's second `PiecesOverlay` (duplicate type of
    Components/CardFaceView.swift); the result's detail card uses the shared one with `compact: false`. `SetPlateView`
    computed its slide offset with an uninitialised `let x` assigned inside `if` branches of a `TimelineView` builder
    closure (not allowed in a result builder); it is a helper function now.
  - `Evoker/Battle/BattlePlayer.swift`: `import Combine` (the file uses `ObservableObject` / `@Published` without SwiftUI).
  - `Evoker/Assets/BundleAssetCatalog.swift`: `imagePath` resolves the stitched frames by their bare stem
    (`"button_default"` → `manifest.ui["frames/button_default"]`, then `manifest.frames[stem].path`). Package D names
    every nine-slice frame, the HUD bars and the menubar plates that way; before this every one of them fell back to
    a flat shape.
  - `Evoker/App/AppModel.swift`: the glue the packages asked for — `FontRegistrar.shared.registerAll()` in `live()`,
    `store.onChange` → `audio.apply(settings)` on a settings change (app.js
    store.subscribe), `store.onNotices` → the login toasts, `store.flush()` on scenePhase background; the music per
    screen restarts after a battle (the battle screen silences it, `applyMusic` forgets the last route on `.battle`).
  - `Evoker/Screens/FightRunner.swift`: every presentation now carries `deckBefore` (prebattle.js deckSnapshot, taken
    before the fight so the result's XP bars are exact), the quest theme (`swamp` / `lava` ≥ 31 / `valley`) and a
    `defenderPortrait`: the boss card id for a quest, `avatarCardId(avatar, names:)` for a simulated player.
    `BattleScene.portraitImage` resolves that stem as a sprite first, then as a card id through the catalog's card
    art (the web drew an SVG avatar icon; the card art is the picture the menus already use for players — a guess).
  Verified: `swiftc -parse` on all 66 app files (0 failures), every file LF / 4-space; the `Namespace.member(label:)`
  cross-check of the app against EvokerCore's public API (0 problems over 255 core types) and inside the app;
  `node Tools/check-pbxproj.mjs` ("looks consistent"); every static sprite stem the app names resolves in
  `GameAssets/manifest.json` after the frames fix (the only remaining misses are card ids and animation names, which
  are resolved through other lookups). Not verifiable here, for the first Xcode build to look at: the private
  `@State` / `@EnvironmentObject` properties with memberwise initialisers (SwiftUI's documented pattern), the
  `ForEach(Array(x.enumerated()), id: \.offset)` closures with `let` bindings, `Picker` sections inside
  `.pickerStyle(.menu)` (LabScreen), `SKView.texture(from:)` / `SKAction.customAction` in the death shatter and the
  tribe-bonus count, `withCheckedContinuation` inside the `@MainActor` dialog / tap gates, and the memberwise
  `CountdownText(...) { onEnd }` trailing closure in LeagueScreen.
