import SwiftUI
import EvokerCore

/// The screen stack (`src/ui/router.js` + `app.js goTop` / `chrome.js navTarget`) as a `NavigationStack` path.
/// The root screen is not part of `path`: it is the title before a session starts and the main quest map once a
/// save is open (`RootView` decides); `path` holds the screens pushed over it.
@MainActor
final class Router: ObservableObject {
    @Published var path: [Route] = []
    /// Bumped by `rerender()`: screens read it so that a store-independent change rebuilds them.
    @Published private(set) var generation: Int = 0
    /// The screen under the path (`RootView` keeps it in sync).
    @Published var root: Route = .title

    /// The screen on top.
    var current: Route? { path.last ?? root }
    var depth: Int { path.count + 1 }

    /// Push a screen.
    func go(_ route: Route) {
        path.append(route)
    }

    /// Pop the current screen; with nothing pushed, `fallback` replaces the top when it is not the root already
    /// (router.js back(fallback)).
    func back(fallback: Route = .questMap()) {
        if !path.isEmpty {
            path.removeLast()
        } else if fallback != root {
            path = [fallback]
        }
    }

    /// Replace the top screen (router.js replace). Replacing by the root screen pops everything instead.
    func replace(_ route: Route, animated: Bool = true) {
        let apply = {
            if route == self.root {
                self.path = []
            } else if self.path.isEmpty {
                self.path = [route]
            } else {
                self.path[self.path.count - 1] = route
            }
        }
        if animated {
            apply()
        } else {
            var t = Transaction()
            t.disablesAnimations = true
            withTransaction(t, apply)
        }
    }

    /// Jump to a nav screen: the stack becomes [] (the main map) or [screen] (app.js goTop / chrome.js navTarget).
    func goTop(_ nav: NavItem) {
        goTop(route: Router.target(for: nav))
    }

    /// `goTop` with an explicit route (the feed, a portal map, a tab).
    func goTop(route: Route) {
        if route == root {
            path = []
        } else {
            path = [route]
        }
    }

    /// Pop until `route` is on top (no-op when it is not on the stack).
    func popTo(_ route: Route) {
        guard let i = path.lastIndex(of: route) else { return }
        path = Array(path.prefix(i + 1))
    }

    /// Re-render the current screen in place.
    func rerender() {
        generation += 1
    }

    /// Where a nav button goes (`chrome.navTarget`).
    static func target(for nav: NavItem) -> Route {
        switch nav {
        case .league: return .league
        case .arena: return .arena()
        case .quest: return .questMap()
        case .cards: return .cards()
        case .shop: return .shop()
        }
    }

    /// Is this route one of the main tabs (`chrome.MAIN_SCREENS`: no back arrow)?
    static func isMainScreen(_ route: Route) -> Bool {
        switch route {
        case .questMap, .arena, .league, .cards, .shop: return true
        default: return false
        }
    }
}
