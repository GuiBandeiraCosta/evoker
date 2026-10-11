import SwiftUI
import EvokerCore

/// The window content: the stage canvas, the navigation stack over the router's path, and the overlays (toasts,
/// dialogs, the level-up dialog). The root screen is the title before a session starts and the main quest map
/// after (`Router.root`).
struct RootView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase
    private let ticker = Timer.publish(every: 60, on: .main, in: .common).autoconnect()
    private let seconds = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            // each screen scales itself (ScreenView → StageCanvas); the overlays share one transparent canvas
            NavigationHost(router: model.router)
            StageCanvas(opaque: false) {
                ZStack {
                    ToastLayer(center: model.toasts)
                    DialogLayer(center: model.dialogs)
                    LevelUpLayer(center: model.levelUps)
                }
            }
        }
        .overlay(alignment: .topLeading) {
            if UITestHooks.enabled { UITestStateReadout() }
        }
        .background(Color.black.ignoresSafeArea())
        .environmentObject(model.store)
        .environmentObject(model.clock)
        .onReceive(ticker) { _ in model.tick() }
        .onReceive(seconds) { _ in model.secondTick() }
        .onChange(of: scenePhase) { _, phase in model.scenePhaseChanged(phase) }
    }
}

/// `NavigationStack` over the router's path; every route builds its screen through `ScreenView`.
struct NavigationHost: View {
    @ObservedObject var router: Router

    var body: some View {
        NavigationStack(path: $router.path) {
            ScreenView(route: router.root)
                .navigationDestination(for: Route.self) { route in
                    ScreenView(route: route)
                }
        }
        .background(Theme.bg)
    }
}

/// Screen id → view (architecture.md §8.3).
struct ScreenView: View {
    let route: Route
    @EnvironmentObject private var model: AppModel

    var body: some View {
        canvas
            .toolbar(.hidden, for: .navigationBar)
            .navigationBarBackButtonHidden(hidesBackGesture)
            .background(Theme.bg.ignoresSafeArea())
    }

    /// The battle lays itself out on the whole screen (BattleLayout); every other screen is a 720 x 1280 canvas.
    @ViewBuilder
    private var canvas: some View {
        if case .battle = route {
            screen
        } else {
            StageCanvas { screen }
        }
    }

    /// The battle and booster screens must not be popped by the edge swipe.
    private var hidesBackGesture: Bool {
        switch route {
        case .battle, .boosterOpen, .title: return true
        default: return false
        }
    }

    @ViewBuilder
    private var screen: some View {
        switch route {
        case .title:
            TitleScreen()
        case .questMap(let line, let feed):
            if feed {
                QuestFeedScreen()
            } else {
                QuestMapScreen(line: line ?? "main")
            }
        case .quest(let line, let n):
            QuestScreen(line: line, n: n)
        case .bossIntro(let line, let n):
            BossIntroScreen(line: line, n: n)
        case .prebattle(let request):
            PrebattleScreen(request: request)
        case .battle(let id):
            BattleScreen(id: id)
        case .cards(let tab):
            CardsScreen(tab: tab)
        case .cardDetail(let target):
            CardDetailScreen(target: target)
        case .collections(let set):
            CollectionsScreen(setId: set)
        case .arena(let tab):
            ArenaScreen(tab: tab)
        case .league:
            LeagueScreen()
        case .shop(let gems):
            ShopScreen(openGems: gems)
        case .boosterOpen(let booster, let portalId):
            BoosterOpenScreen(booster: booster, portalId: portalId)
        case .character(let tab):
            CharacterScreen(tab: tab)
        case .help(let topic):
            HelpScreen(topic: topic)
        case .lab:
            LabScreen()
        }
    }
}

