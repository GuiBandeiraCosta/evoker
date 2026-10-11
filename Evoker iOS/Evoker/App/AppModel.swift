import SwiftUI
import Combine
import EvokerCore

/// The app object every screen gets through the environment (`src/app.js` boot + ctx): the store, the asset
/// catalog, the audio player, the router, the dialog / toast / level-up presenters, the one-shot battle and boss
/// intro hand-offs, the clock-driven housekeeping (`store.tick`) and the music per screen.
@MainActor
final class AppModel: ObservableObject {
    let store: GameStore
    let assets: AssetCatalog
    let audio: AudioPlaying
    let router: Router
    let dialogs = DialogCenter()
    let toasts = ToastCenter()
    let levelUps = LevelUpCenter()
    /// Battles handed from the pre-battle screen to `Route.battle(id:)`.
    var pendingBattles: [UUID: BattlePresentation] = [:]
    /// One-shot: the boss intro the pre-battle plays the card flight of (consumed by the pre-battle screen).
    var pendingBossIntro: (line: String, n: Int)?
    /// The title was tapped: the root screen is the quest map from now on.
    @Published var sessionStarted: Bool = false
    /// Bumped on every store change so that views observing the model re-render.
    @Published private(set) var generation: Int = 0
    /// The one-second clock the countdowns observe (a separate object, so the rest of the UI does not re-render
    /// every second).
    let clock = ClockTicker()

    private var cancellables: Set<AnyCancellable> = []
    private var unlockFlowRunning = false
    private var lastMusicRoute: Route?

    init(store: GameStore, assets: AssetCatalog, audio: AudioPlaying) {
        self.store = store
        self.assets = assets
        self.audio = audio
        self.router = Router()
        store.objectWillChange
            .sink { [weak self] _ in
                guard let self = self else { return }
                self.objectWillChange.send()
                self.generation &+= 1
            }
            .store(in: &cancellables)
        store.$state
            .sink { [weak self] next in
                self?.updateRoot(hasSave: next != nil)
            }
            .store(in: &cancellables)
        router.$path
            .sink { [weak self] path in
                self?.applyMusic(path.last ?? self?.router.root ?? .title)
            }
            .store(in: &cancellables)
        router.$root
            .sink { [weak self] root in
                guard let self = self else { return }
                if self.router.path.isEmpty { self.applyMusic(root) }
            }
            .store(in: &cancellables)
        router.objectWillChange
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &cancellables)
        // app.js store.subscribe: the audio player follows the save's settings (the potion click of audio.js
        // diffSounds is played by the screens that drink the potion, so it is not repeated here)
        store.onChange = { [weak self] previous, next in
            guard let self = self, let s = next else { return }
            if previous?.settings != s.settings { self.audio.apply(s.settings) }
        }
        // a new UTC day while the app stays open: the login notices as toasts (app.js onOpen)
        store.onNotices = { [weak self] notices in self?.showNotices(notices) }
        updateRoot(hasSave: store.state != nil)
    }

    /// The production model: file save store, the real dependency bundle, the bundle asset catalog, AVFoundation audio.
    static func live() -> AppModel {
        FontRegistrar.shared.registerAll()
        let db = try! DataLoader.loadCardsDb()
        let quests = try? DataLoader.loadQuests()
        let names = try? DataLoader.loadNames()
        let deps = Deps(db: db, stats: Stats(), engine: BattleEngine(), quests: quests, names: names)
        let store = GameStore(saveStore: FileSaveStore(), deps: deps, clock: { Int64(Date().timeIntervalSince1970 * 1000) })
        let model = AppModel(store: store, assets: BundleAssetCatalog.shared, audio: AudioPlayer())
        model.boot()
        return model
    }

    /// Open the save (regen, daily reward, league settlement, raids) and show the login notices as toasts.
    func boot() {
        if let r = store.load() {
            showNotices(r.notices)
        }
        audio.apply(store.state?.settings ?? Settings())
        applyMusic(router.current ?? .title)
    }

    // MARK: Convenience

    var deps: Deps { store.deps }
    var db: CardsDb { store.deps.db }
    var now: Int64 { store.now }
    var state: GameState? { store.state }
    /// Today's daily event on the save's clock (`ctx.event()`).
    var event: DailyEventId? { store.dailyEventId }
    var dailyEvent: DailyEvent? { store.dailyEvent }

    func sfx(_ name: String) { audio.sfx(name) }

    func toast(_ text: String, icon: String? = nil, duration: Double = 2.2) {
        toasts.show(text, icon: icon, duration: duration)
    }

    /// Message of a thrown game error (`err.message`).
    func errorText(_ error: Error) -> String {
        if let g = error as? GameError { return g.message }
        return "\(error)"
    }

    /// Apply a game function through the store; a thrown error becomes a toast and nil.
    func update<T>(toastOnError: Bool = true, _ fn: (GameState, Deps, Int64) throws -> (state: GameState, info: T)) -> T? {
        do {
            return try store.update(fn)
        } catch {
            if toastOnError { toast(errorText(error)) }
            return nil
        }
    }

    /// Apply a state-only game function; false (and a toast) when it threw.
    @discardableResult
    func updateState(toastOnError: Bool = true, _ fn: (GameState, Deps, Int64) throws -> GameState) -> Bool {
        do {
            try store.updateState(fn)
            return true
        } catch {
            if toastOnError { toast(errorText(error)) }
            return false
        }
    }

    // MARK: Session

    private func updateRoot(hasSave: Bool) {
        let root: Route = (hasSave && sessionStarted) ? .questMap() : .title
        if router.root != root { router.root = root }
    }

    /// Title tap without a save: a new game with the automatic name (title.js), then the quest map.
    func startNewGame() {
        let seed = Seeds.seedFromNow(now)
        let r = store.newGame(name: NamePopup.autoName(seed: seed))
        sessionStarted = true
        updateRoot(hasSave: true)
        router.path = []
        showNotices(r.notices)
        catchUpUnlocks()
    }

    /// Title tap with a save: the session starts on the landing feed (title.js).
    func startSession() {
        sessionStarted = true
        updateRoot(hasSave: store.state != nil)
        router.path = [.questMap(feed: true)]
    }

    /// Regen and the new-day work; from the 60 s timer and the foreground transition.
    func tick() {
        guard store.state != nil else { return }
        store.tick()
    }

    /// One-second clock for the countdowns.
    func secondTick() {
        clock.tick &+= 1
    }

    func scenePhaseChanged(_ phase: ScenePhase) {
        switch phase {
        case .active:
            audio.resume()
            tick()
        case .background:
            audio.suspend()
            store.flush()
        default:
            break
        }
    }

    // MARK: Music per screen (audio.js screenMusic)

    private func applyMusic(_ route: Route) {
        if case .battle = route {
            // the battle scene sets its own cues and silences the music when it leaves: the next screen restarts it
            lastMusicRoute = nil
            return
        }
        if let last = lastMusicRoute, last == route { return }
        lastMusicRoute = route
        if let name = ScreenMusic.name(for: route) {
            audio.music(name)
        }
    }

    // MARK: Notices (app.js noticeText)

    private func showNotices(_ notices: [Notice]) {
        for (i, n) in notices.enumerated() {
            guard let t = noticeText(n) else { continue }
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: UInt64((600 + i * 900) * 1_000_000))
                self?.toasts.show(t.text, icon: t.icon, duration: 3.2, daily: n.type == "daily")
            }
        }
    }

    private func noticeText(_ n: Notice) -> (text: String, icon: String)? {
        func name(_ id: String) -> String { db.get(id)?.name ?? id }
        switch n.type {
        case "daily":
            var parts: [String] = []
            let gems = n["gems"]?.intValue ?? 0
            let stamina = n["stamina"]?.intValue ?? 0
            let mana = n["mana"]?.intValue ?? 0
            let count = n["count"]?.intValue ?? 1
            if gems > 0 { parts.append("\(gems) gems") }
            if stamina > 0 { parts.append("\(stamina) stamina potion\(stamina > 1 ? "s" : "")") }
            if mana > 0 { parts.append("\(mana) mana potion\(mana > 1 ? "s" : "")") }
            if let tok = n["tokens"]?.stringValue { parts.append("\(count) \(tok) token\(count > 1 ? "s" : "")") }
            let day = n["day"]?.intValue ?? 0
            var icon = "hud_gemiconsingle"
            if gems > 0 { icon = "hud_gemiconsingle" }
            else if let tok = n["tokens"]?.stringValue, let kind = TokenKind(rawValue: tok) { icon = tokenSprite(kind) }
            else if stamina > 0 { icon = "potion_stamina2" }
            else if mana > 0 { icon = "potion_mana2" }
            return ("Daily reward (day \(day)): \(parts.joined(separator: ", "))", icon)
        case "league":
            var text = Strings.leagueFinished(rank: n["rank"]?.intValue ?? 0)
            if let cardId = n["cardId"]?.stringValue { text += ", \(name(cardId))" }
            if let gems = n["gems"]?.intValue, gems > 0 { text += ", \(gems) gems" }
            if let potions = n["potions"]?.arrayValue, !potions.isEmpty { text += ", \(potions.count) potion\(potions.count > 1 ? "s" : "")" }
            return (text, "icon_liga_active")
        case "raid":
            return (Strings.pieceStolen(name(n["cardId"]?.stringValue ?? "")), "fx_alldieskull01")
        default:
            return nil
        }
    }

    // MARK: Battles

    /// Store a presentation and open the battle screen (replacing the pre-battle, like `ctx.replace('battle')`).
    func presentBattle(_ p: BattlePresentation, replacing: Bool = true) {
        pendingBattles[p.id] = p
        dialogs.dismissAll()
        if replacing {
            router.replace(.battle(id: p.id))
        } else {
            router.go(.battle(id: p.id))
        }
    }

    /// The battle screen finished its result flow: navigate per `completion`, then the owed level-up dialogs
    /// and unlock popups (battle-result.js showPlayerLevelUps + the quest map's catch-up).
    func battleFinished(_ p: BattlePresentation) {
        pendingBattles[p.id] = nil
        switch p.completion {
        case .questMap(let line):
            router.goTop(route: line == "main" ? .questMap() : .questMap(line: line))
        case .arena(let tab):
            router.goTop(route: .arena(tab: tab))
        case .league:
            router.goTop(route: .league)
        case .replays:
            router.goTop(route: .arena(tab: .replays))
        case .lab:
            if router.path.contains(.lab) { router.popTo(.lab) } else { router.goTop(route: .lab) }
        }
        let details: [LevelUpDetail] = p.levelUpDetails.isEmpty
            ? p.levelUps.map { LevelUpMath.detail(forLevel: $0, state: store.state) }
            : p.levelUpDetails
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            try? await Task.sleep(nanoseconds: 500_000_000)
            if !details.isEmpty { await self.showLevelUps(details) }
            await self.showPendingUnlocks()
            switch p.mode {
            case .league:
                if p.result.attackerWon && p.rewards.leaguePoints > 0 {
                    self.toast("+\(p.rewards.leaguePoints) league points!", icon: "pvp_points")
                }
            case .pieces:
                if let piece = p.rewards.piece, piece.completed == true, let cardId = piece.cardId {
                    await self.celebratePiece(cardId: cardId)
                }
            default:
                break
            }
        }
    }

    // MARK: Level-ups and unlocks

    /// The player level-up dialogs in order (points of a multi-level jump per level, the last one takes the rest),
    /// each followed by its unlock popups (`showLevelUp`).
    func showLevelUps(_ details: [LevelUpDetail]) async {
        let valid = details.filter { $0.level >= 2 }
        for (i, d) in valid.enumerated() {
            guard let player = store.state?.player else { return }
            let last = i >= valid.count - 1
            let budget = LevelUpMath.dialogBudget(unspent: player.statPoints, levelPoints: d.statPoints, last: last)
            let instant = store.state?.settings.reducedMotion ?? false
            let final = await levelUps.run(detail: d, budget: budget, player: player, instant: instant, sfx: { [weak self] n in self?.sfx(n) })
            if final.hp + final.stamina + final.mana > 0 {
                updateState(toastOnError: false) { s, _, _ in try PlayerOps.spendStatPoints(s, alloc: final) }
            }
            await showUnlocks(UnlockPopups.specs(for: d.unlocked))
        }
    }

    /// Show several unlock popups in order, remembering each as seen (`showUnlockPopups`).
    func showUnlocks(_ specs: [UnlockPopupSpec]) async {
        for spec in specs {
            updateState(toastOnError: false) { s, _, _ in UnlockPopups.markSeen(s, ids: [spec.id]) }
            sfx("ui_unlock")
            var r = DialogRequest()
            r.title = spec.title
            r.width = 560
            r.body = { _ in AnyView(UnlockPopupBody(spec: spec)) }
            r.buttons = [DialogButton(Strings.ok, value: "ok")]
            _ = await dialogs.open(r)
        }
    }

    /// Unlock popups the save still owes (the quest map's `catchUpUnlocks`), once each.
    func catchUpUnlocks() {
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 500_000_000)
            await self?.showPendingUnlocks()
        }
    }

    func showPendingUnlocks() async {
        guard !unlockFlowRunning, let state = store.state else { return }
        unlockFlowRunning = true
        defer { unlockFlowRunning = false }
        let pending = UnlockPopups.pending(state)
        if !pending.silent.isEmpty {
            updateState(toastOnError: false) { s, _, _ in UnlockPopups.markSeen(s, ids: pending.silent) }
        }
        if pending.show.isEmpty { return }
        await showUnlocks(pending.show)
    }

    // MARK: Potions (chrome.js offerPotion)

    /// Offer a potion for a bar that is too low: the Drink-potion dialog, then the choice through the store.
    /// True when the bar was refilled.
    func offerPotion(kind: PotionKind, amount: Int = 0) async -> Bool {
        guard let state = store.state else { return false }
        let ev = event
        let np = PlayerOps.needsPotion(state, kind: kind, amount: amount, event: ev)
        let choice = await dialogs.drinkPotion(kind: kind, count: np.potions, gemPrice: np.price, gems: state.player.gems)
        if choice == "use" {
            if updateState({ s, _, _ in try PlayerOps.drinkPotion(s, kind: kind) }) {
                sfx("ui_use_potion")
                toast(kind == .mana ? Strings.manaRefilled : Strings.staminaRefilled, icon: kind == .mana ? "potion_mana2" : "potion_stamina2")
                return true
            }
            return false
        }
        if choice == "buy" {
            let price = PlayerOps.potionPrice(event: ev)
            if state.player.gems < price {
                toast(Strings.notEnoughGems, icon: "hud_gemiconsingle")
                return false
            }
            if updateState({ s, _, _ in try PlayerOps.buyAndDrinkPotion(s, kind: kind, event: ev) }) {
                sfx("ui_use_potion")
                toast(Strings.potionBought(price), icon: "hud_gemiconsingle")
                return true
            }
            return false
        }
        return false
    }

    // MARK: Name prompt (name-popup.js)

    /// Ask for the name when this save has not chosen one yet (first Arena entry).
    func maybeAskName() async {
        guard let state = store.state, NamePopup.needsName(state) else { return }
        var r = DialogRequest()
        r.width = 620
        let initial = state.player.name
        r.body = { handle in AnyView(NamePopupBody(initial: initial, handle: handle)) }
        guard let typed = await dialogs.open(r) else { return }
        let cleaned = NamePopup.clean(typed)
        updateState(toastOnError: false) { s, _, _ in
            var next = cleaned.isEmpty ? s : PlayerOps.editProfile(s, name: cleaned, avatar: nil)
            if var r3 = next.tutorial.r3 {
                r3.named = true
                next.tutorial.r3 = r3
            }
            return next
        }
    }

    // MARK: Pieces celebration (arena-pieces.js celebrate)

    /// Full-card celebration popup when a hunt completes.
    func celebratePiece(cardId: String) async {
        guard let def = db.get(cardId) else { return }
        let face = CardFaceModel.fromDef(def, stage: 0, level: 1, deps: deps)
        sfx("quest_reward_card")
        var r = DialogRequest()
        r.title = Strings.cardComplete
        r.width = 560
        r.body = { _ in AnyView(PieceCelebrationBody(face: face)) }
        r.buttons = [DialogButton(Strings.great, value: "ok", variant: .green)]
        _ = await dialogs.open(r)
    }
}

/// A counter that advances once a second (`RootView` drives it); countdown texts observe it.
@MainActor
final class ClockTicker: ObservableObject {
    @Published var tick: Int = 0
}

/// Body of the "Card complete!" popup: glow, sparks, the card, its name and the line of text.
struct PieceCelebrationBody: View {
    let face: CardFaceModel
    @State private var glow: Bool = false

    var body: some View {
        VStack(spacing: 14) {
            ZStack {
                Sprite("reward_glow_yellow")
                    .frame(width: 460, height: 460)
                    .opacity(glow ? 1 : 0.6)
                    .scaleEffect(glow ? 1.12 : 1)
                CardFaceView(face: face, size: .compact)
                    .scaleEffect(1.7)
            }
            .frame(height: 300)
            Text(face.name)
                .font(Theme.font(36))
                .foregroundColor(Theme.rarity(face.rarity))
                .shadow(color: .black.opacity(0.9), radius: 1.5, x: 0, y: 2)
            Text(Strings.allPiecesCollected)
                .font(Theme.font(22))
                .foregroundColor(Theme.text)
                .multilineTextAlignment(.center)
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true)) { glow = true }
        }
    }
}
