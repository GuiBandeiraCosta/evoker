import SwiftUI
import EvokerCore

/// The chrome every menu screen mounts (`src/ui/chrome.js mount`): the HUD on top, the nav at the bottom, the
/// screen body between them; the back arrow on pushed screens, "?" → the help topic, the HUD bars → profile /
/// gem packs, the nav → `goTop`, the extended menu → album / profile / options / home.
enum BackAction {
    /// No back handler (the main tabs).
    case none
    /// `ctx.back(fallback)`.
    case pop(fallback: Route)
    /// A custom handler (a quest abandons itself).
    case custom(() -> Void)

    var isNone: Bool {
        if case .none = self { return true }
        return false
    }
}

struct ChromeOptions {
    var active: NavItem? = nil
    var activeExtended: ExtendItem? = nil
    var back: BackAction = .none
    var help: String = "quest-map"
    var hideNav: Bool = false
    var hideHud: Bool = false
    /// Gold shown in the HUD instead of the save's (the quest screen's counter).
    var goldOverride: Int? = nil
}

struct ScreenChrome: ViewModifier {
    @EnvironmentObject private var model: AppModel
    @Environment(\.stage) private var stage
    let options: ChromeOptions
    @State private var extended: Bool = false

    private var showBack: Bool {
        if options.back.isNone { return false }
        return true
    }

    @ViewBuilder
    func body(content: Content) -> some View {
        let state = model.store.state
        let hud = state.map { HUDData(state: $0, stats: model.deps.stats) } ?? HUDData()
        let hudH = options.hideHud ? 0 : Stage.hudHeight + stage.safeTop
        let navH = options.hideNav ? 0 : Stage.navHeight + stage.safeBottom
        ZStack(alignment: .topLeading) {
            Theme.bg
            content
                .frame(width: Stage.width, height: max(0, stage.size.height - hudH - navH))
                .clipped()
                .offset(y: hudH)
            if extended {
                Color(hex: 0x141414, alpha: 0.55)
                    .frame(width: Stage.width, height: stage.size.height)
                    .contentShape(Rectangle())
                    .onTapGesture { extended = false }
                    .transition(.opacity)
            }
            if !options.hideHud {
                HUDView(data: hud, showBack: showBack,
                        onBack: { goBack() },
                        onHelp: { model.router.go(.help(topic: options.help)) },
                        onProfile: { openProfile() },
                        onShop: { model.router.goTop(route: .shop(gems: true)) },
                        goldOverride: options.goldOverride)
            }
            if !options.hideNav {
                NavBarView(active: options.active, activeExtended: options.activeExtended, locked: NavLocks.locked(state),
                           badges: state.map { NavBadges(state: $0, deps: model.deps) } ?? NavBadges(),
                           extended: $extended,
                           onSelect: { item in model.router.goTop(item) },
                           onSelectExtended: { item in selectExtended(item) },
                           onLocked: { item in model.toast(NavLocks.hint(state, item: item), icon: "lock_small") })
                    .offset(y: stage.size.height - navH)
            }
        }
        .frame(width: Stage.width, height: stage.size.height, alignment: .topLeading)
        .animation(.easeInOut(duration: 0.25), value: extended)
    }

    private func goBack() {
        if extended { extended = false; return }
        switch options.back {
        case .none: break
        case .pop(let fallback): model.router.back(fallback: fallback)
        case .custom(let fn): fn()
        }
    }

    /// The profile, pushed unless it is already showing.
    private func openProfile() {
        if case .character(let tab) = model.router.current ?? .title, tab == .profile { return }
        model.router.go(.character(tab: .profile))
    }

    private func selectExtended(_ item: ExtendItem) {
        switch item {
        case .album:
            if case .collections = model.router.current ?? .title { return }
            model.router.go(.collections())
        case .profile:
            let target = Route.character(tab: .profile)
            if model.router.current == target { return }
            if case .character = model.router.current ?? .title { model.router.replace(target); return }
            model.router.go(target)
        case .options:
            let target = Route.character(tab: .settings)
            if model.router.current == target { return }
            if case .character = model.router.current ?? .title { model.router.replace(target); return }
            model.router.go(target)
        case .home:
            model.router.goTop(route: .questMap(feed: true))
        }
    }
}

extension View {
    /// Mount the HUD and the nav around this screen body (`ctx.chrome.mount(opts)`).
    func chrome(_ options: ChromeOptions) -> some View {
        modifier(ScreenChrome(options: options))
    }

    func chrome(active: NavItem? = nil, activeExtended: ExtendItem? = nil, back: BackAction = .none, help: String, hideNav: Bool = false, hideHud: Bool = false, goldOverride: Int? = nil) -> some View {
        modifier(ScreenChrome(options: ChromeOptions(active: active, activeExtended: activeExtended, back: back, help: help, hideNav: hideNav, hideHud: hideHud, goldOverride: goldOverride)))
    }
}

/// A screen title line (`.screen-title`).
struct ScreenTitle: View {
    let text: String
    var orange: Bool = false

    var body: some View {
        Text(text)
            .font(Theme.font(40))
            .foregroundColor(orange ? Theme.orange : Theme.headline)
            .shadow(color: .black.opacity(0.8), radius: 1, x: 0, y: 2)
            .padding(.top, 18)
            .padding(.bottom, 10)
            .frame(maxWidth: .infinity)
    }
}

/// The full-screen painted background of the menu screens (fullscreen_background at 125 %).
struct FullscreenBackground: View {
    var tint: Color = Color(hex: 0x17110b)

    var body: some View {
        ZStack(alignment: .top) {
            tint
            StretchedSprite("fullscreen_background")
                .frame(width: Stage.width * 1.25, height: Stage.width * 1.25 * 1280 / 720)
                .offset(x: -Stage.width * 0.125)
                .frame(width: Stage.width, alignment: .top)
                .clipped()
        }
        .ignoresSafeArea()
    }
}
