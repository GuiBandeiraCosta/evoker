import Foundation
import Combine
import EvokerCore

/// The game store (`Evoker Web/src/ui/store.js createStore` plus the open / clock / debug wiring of `src/app.js`):
/// holds the single save, applies the pure game functions through `update`, autosaves after every change
/// (synchronously, on the main actor, a failed save is logged and never thrown to the UI) and publishes to SwiftUI.
/// Signature: docs/CONTRACTS.md section 4.1.
@MainActor
final class GameStore: ObservableObject {
    /// The save (nil = no save yet: the title screen asks for a name). Never mutated in place.
    @Published private(set) var state: GameState?
    /// The current UTC day ('YYYY-MM-DD'). Changes once per day through `tick()`, so the screens the web re-renders
    /// on a new day (app.js NEW_DAY_RERENDER: quest map, shop, arena, league) can observe it.
    @Published private(set) var today: String

    let deps: Deps
    /// The game clock (ms epoch); the only clock game logic ever sees.
    let clock: Clock
    let saveStore: SaveStore

    /// Runs after every publish with the previous and the new save (app.js `store.subscribe`: the audio player
    /// re-applies the volumes and plays `ui_use_potion` on a potion diff; the chrome refreshes).
    var onChange: ((GameState?, GameState?) -> Void)?
    /// Login notices raised by a new UTC day while the app stays open (`tick()`); `load`, `newGame` and
    /// `importJSON` return theirs instead.
    var onNotices: (([Notice]) -> Void)?
    /// Called when a save or delete fails (default: a console line). Never thrown to the UI.
    var onSaveError: ((Error) -> Void)?

    init(saveStore: SaveStore, deps: Deps, clock: @escaping Clock) {
        self.saveStore = saveStore
        self.deps = deps
        self.clock = clock
        self.state = nil
        self.today = JSDate.utcDay(clock())
    }

    /// `store.hasSave()`.
    var hasSave: Bool { state != nil }

    /// `now()` of app.js.
    var now: Int64 { clock() }

    // MARK: Opening

    /// `readSave()` + `openSave()`: reads the save, prunes removed content, runs `AppFlow.onOpen` (regen, daily
    /// reward, league settlement, raids), publishes and returns the notices; nil when there is no save.
    func load() -> OnOpenResult? {
        let t = clock()
        var loaded: GameState? = nil
        do {
            loaded = try saveStore.load(now: t)
        } catch {
            report(error, what: "load")
        }
        guard let s = loaded else { return nil }
        return open(s)
    }

    /// `debug.newGame` / the title screen: `StateOps.newGame` seeded from the clock, the iOS tutorial record
    /// (`TutorialRecord.newGame`: quest-based unlocks, name prompt at the first Arena visit), then the open hooks.
    @discardableResult
    func newGame(name: String) -> OnOpenResult {
        let t = clock()
        var s = StateOps.newGame(name: name, seed: Seeds.seedFromNow(t), now: t, deps: deps)
        s.tutorial.r3 = TutorialRecord.newGame
        return open(s)
    }

    /// `openSave()` of app.js on a given save: `pruneRemoved`, `onOpen`, then `set`. Also used after an import
    /// and after the debug `addDays`.
    @discardableResult
    func open(_ state: GameState) -> OnOpenResult {
        let t = clock()
        let pruned = StateOps.pruneRemoved(state, deps: deps)
        let r = AppFlow.onOpen(pruned, deps: deps, now: t)
        commit(r.state)
        return r.info
    }

    // MARK: Changing

    /// `store.set(next)`: replace the save wholesale (import, debug). Autosaves and publishes.
    func set(_ state: GameState) {
        commit(state)
    }

    /// `store.update(fn)`: apply a pure game function `(state, deps, now) -> (state, info)`; the store keeps the
    /// state, autosaves, publishes and returns the info part. A thrown error leaves the save untouched.
    /// Calling it without a save is a programming error (the web threw "store.update: no save loaded").
    @discardableResult
    func update<T>(_ fn: (GameState, Deps, Int64) throws -> (state: GameState, info: T)) rethrows -> T {
        guard let current = state else { preconditionFailure("GameStore.update: no save loaded") }
        let r = try fn(current, deps, clock())
        commit(r.state)
        return r.info
    }

    /// `store.update(fn)` for a function that returns only the new state.
    func updateState(_ fn: (GameState, Deps, Int64) throws -> GameState) rethrows {
        guard let current = state else { preconditionFailure("GameStore.updateState: no save loaded") }
        let next = try fn(current, deps, clock())
        commit(next)
    }

    /// `character-settings.js setSettings`: patch the settings; the result is normalised like the web
    /// (`normalizeSettings` / `normalizeVolumes`: speed 1 or 2, volumes clamped to 0..1 with two decimals).
    func updateSettings(_ change: (inout Settings) -> Void) {
        guard let current = state else { return }
        var settings = current.settings
        change(&settings)
        var next = current
        next.settings = GameStore.normalizedSettings(settings)
        commit(next)
    }

    /// `normalizeSettings` + `normalizeVolumes` of settings-view.js.
    static func normalizedSettings(_ settings: Settings) -> Settings {
        var out = settings
        out.speed = (settings.speed == 1 || settings.speed == 2) ? settings.speed : 1
        out.musicVolume = clampVolume(settings.musicVolume, fallback: 0.7)
        out.fxVolume = clampVolume(settings.fxVolume, fallback: 1)
        return out
    }

    /// `clampVolume(v, fallback)`: 0..1 with two decimals (`Math.round(x * 100) / 100`).
    static func clampVolume(_ volume: Double, fallback: Double) -> Double {
        guard volume.isFinite else { return fallback }
        let clamped = min(1, max(0, volume))
        return (clamped * 100 + 0.5).rounded(.down) / 100
    }

    // MARK: Export / import / reset

    /// The save as stored (`SaveCodec.serialize`: compact JSON, sorted keys, `lastSeen` touched). The share sheet
    /// uses the pretty variant `SaveFile.exportData` like the web's download.
    func exportJSON() throws -> Data {
        guard let s = state else { throw GameError("No save loaded") }
        return try SaveCodec.serialize(s, now: clock())
    }

    /// `importSave` of the Options screen: the web's validation (its messages are the thrown `SaveImportError`),
    /// `SaveCodec.parse` (lenient decode + `StateOps.migrated`), then the open hooks (`open`: prune, onOpen,
    /// set). Returns the notices of the open.
    @discardableResult
    func importJSON(_ data: Data) throws -> OnOpenResult {
        if case .failure(let error) = SaveFile.parse(data) {
            throw error
        }
        let t = clock()
        guard let parsed = try SaveCodec.parse(data, now: t) else {
            throw SaveImportError("Not an Evoker save file.")
        }
        return open(parsed)
    }

    /// `debug.reset`: drop the in-memory save, delete the file; `state` becomes nil (the title screen follows).
    func reset() {
        commit(nil)
        do {
            try saveStore.delete()
        } catch {
            report(error, what: "delete")
        }
    }

    // MARK: Clock

    /// app.js: regen every minute (`applyRegen`) and, when a later UTC day has started, the same on-open hooks
    /// as a login (daily reward, league settlement, raids; their notices go to `onNotices`). Call it from a 60 s
    /// timer and when the app returns to the foreground. The regen is committed only when it changes the save
    /// (the web re-saved every minute regardless); a clock set back changes nothing.
    func tick() {
        let t = clock()
        let day = JSDate.utcDay(t)
        var laterDay = false
        if day != today {
            laterDay = day > today
            today = day
        }
        guard let current = state else { return }
        let regenerated = PlayerOps.applyRegen(current, now: t)
        if regenerated != current {
            commit(regenerated)
        }
        if laterDay, let s = state {
            let r = open(s)
            if !r.notices.isEmpty {
                onNotices?(r.notices)
            }
        }
    }

    /// `flush` of app.js (visibilitychange / pagehide): write the save as it is. Call it when the app goes to
    /// the background; every change is already saved, so this only refreshes `lastSeen`.
    func flush() {
        persist()
    }

    // MARK: Daily event

    /// `ctx.event()`: the daily event on the save's clock (`PlayerOps.eventClock` adds the debug day shift);
    /// nil while the save's tutorial runs.
    var dailyEvent: DailyEvent? {
        return ShopOps.dailyEvent(now: PlayerOps.eventClock(state, now: clock()), state: state)
    }

    var dailyEventId: DailyEventId? { dailyEvent?.id }

    /// The debug API (`window.evoker.debug`).
    var debug: DebugActions { DebugActions(store: self) }

    // MARK: Internals

    /// Keep the state, autosave, notify (the web's `state = next; persist(); notify()`).
    private func commit(_ next: GameState?) {
        let previous = state
        state = next
        persist()
        onChange?(previous, next)
    }

    /// `persist()`: `writeSave(state)` through the SaveStore; nothing without a save.
    private func persist() {
        guard let s = state else { return }
        do {
            try saveStore.save(s, now: clock())
        } catch {
            report(error, what: "autosave")
        }
    }

    private func report(_ error: Error, what: String) {
        if let handler = onSaveError {
            handler(error)
        } else {
            print("GameStore: \(what) failed: \(error)")
        }
    }
}
