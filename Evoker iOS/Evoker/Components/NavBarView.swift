import SwiftUI
import EvokerCore

/// Bottom navigation ported from the 1.7.4 client's menubar (`src/ui/components/nav.js`): the hud_bottombg01 strip
/// with five icon buttons on the menubar_button plates (League, Arena, Quest map, Cards, Shop), the padlock plate
/// while a feature is locked, the "!" / deck_full badges, and the orange extendmenu arrow that slides the extended
/// menu (Album, Profile, Options, Home) up over the buttons.

enum ExtendItem: String, CaseIterable, Identifiable {
    case album, profile, options, home
    var id: String { rawValue }
    var sprite: String { "icon_\(rawValue)" }
    var label: String {
        switch self {
        case .album: return "Album"
        case .profile: return "Profile"
        case .options: return "Options"
        case .home: return "Home"
        }
    }
}

extension NavItem: Identifiable {
    public var id: String { rawValue }

    /// Sprite stem of the icon (`NAV_ITEMS.sprite`).
    var sprite: String {
        switch self {
        case .league: return "icon_liga"
        case .arena: return "icon_pvp"
        case .quest: return "icon_map"
        case .cards: return "icon_deckedit"
        case .shop: return "icon_shop"
        }
    }

    var label: String {
        switch self {
        case .league: return "League"
        case .arena: return "Arena"
        case .quest: return "Quest map"
        case .cards: return "Cards"
        case .shop: return "Shop"
        }
    }

    /// The `isUnlocked` feature that opens the button.
    var feature: Feature {
        switch self {
        case .league: return .league
        case .arena: return .arena
        case .quest: return .quests
        case .cards: return .cards
        case .shop: return .shop
        }
    }

    /// Stage x of the button (`.nav-btn.<id> { left }`).
    var x: CGFloat {
        switch self {
        case .league: return 19
        case .arena: return 138
        case .quest: return 260
        case .cards: return 381
        case .shop: return 505
        }
    }
}

/// `navBadges`: the badges of the menubar.
struct NavBadges {
    enum CardsBadge { case none, new, full }
    var cards: CardsBadge = .none
    var league = false
    var profile = false
    var album = false
    var extend = false

    init() {}

    init(state: GameState, deps: Deps) {
        if state.cards.count >= Constants.collectionLimit {
            cards = .full
        } else if StateOps.isUnlocked(state, .fusion) && !FusionOps.fusionCandidates(state, deps: deps).isEmpty {
            cards = .new
        }
        league = StateOps.isUnlocked(state, .league) && !(state.sim.leagueJoined ?? false)
        profile = state.player.statPoints > 0
        album = !ShopOps.albumNewCards(state, deps: deps).isEmpty
        extend = profile || album
    }
}

enum NavLocks {
    /// `lockedNavItems`: the buttons still locked in a save (no save: Arena and League).
    static func locked(_ state: GameState?) -> Set<NavItem> {
        guard let s = state else { return [.league, .arena] }
        return Set(NavItem.allCases.filter { !StateOps.isUnlocked(s, $0.feature) })
    }

    /// `navLockHint`: "Unlocks after quest 8" on a tutorial game, "Unlocks at level 4" otherwise.
    static func hint(_ state: GameState?, item: NavItem) -> String {
        if let s = state, let quest = Constants.featureUnlockQuests[item.feature], StateOps.unlocksByQuest(s) {
            return Strings.unlocksAfterQuest(quest)
        }
        return Strings.unlocksAtLevel(Constants.featureUnlockLevels[item.feature] ?? 1)
    }
}

struct NavBarView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.stage) private var stage
    var active: NavItem?
    var activeExtended: ExtendItem?
    var locked: Set<NavItem>
    var badges: NavBadges
    @Binding var extended: Bool
    var onSelect: (NavItem) -> Void
    var onSelectExtended: (ExtendItem) -> Void
    var onLocked: (NavItem) -> Void

    var body: some View {
        ZStack(alignment: .topLeading) {
            // the extended menu panel (bottombg_extended) slides up over the five buttons
            ZStack(alignment: .topLeading) {
                StretchedSprite("bottombg_extended")
                HStack(spacing: 0) {
                    ForEach(ExtendItem.allCases) { item in
                        navButton(sprite: item.sprite, active: activeExtended == item, plate: "menubar_button", locked: false,
                                  badge: badgeFor(item)) {
                            model.sfx("ui_button_circular")
                            extended = false
                            onSelectExtended(item)
                        }
                        .at(extendX(item), 25, 106, 109)
                    }
                }
                .frame(width: 600, height: 296, alignment: .topLeading)
            }
            .frame(width: 600, height: 296)
            .offset(x: 15, y: extended ? -4 : 150)
            .opacity(extended ? 1 : 0)
            .allowsHitTesting(extended)
            .animation(.easeInOut(duration: 0.25), value: extended)
            // the strip
            ZStack(alignment: .topLeading) {
                Color(hex: 0x1b1d1f)
                StretchedSprite("hud_bottombg01")
                    .frame(height: Stage.navHeight)
                    .frame(maxHeight: .infinity, alignment: .top)
                ForEach(NavItem.allCases) { item in
                    let isLocked = locked.contains(item)
                    navButton(sprite: item.sprite, active: active == item, plate: item == .shop ? "menubar_button_shop" : "menubar_button",
                              locked: isLocked, badge: badgeFor(item)) {
                        if isLocked {
                            model.sfx("ui_button_circular")
                            onLocked(item)
                        } else {
                            model.sfx("ui_button_circular")
                            onSelect(item)
                        }
                    }
                    .at(item.x, 20, 106, 109)
                }
                Button(action: { model.sfx("ui_button_circular"); extended.toggle() }) {
                    ZStack(alignment: .topLeading) {
                        Sprite(extended ? "extendmenu_arrow_down" : "extendmenu_arrow_up")
                            .frame(width: 48, height: 83)
                            .shadow(color: .black.opacity(0.8), radius: 2, x: 0, y: 2)
                        if badges.extend {
                            BadgeView(full: false).offset(x: 2, y: -30)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressScaleStyle())
                .at(642, 33, 48, 83)
            }
            .frame(width: Stage.width, height: Stage.navHeight + stage.safeBottom, alignment: .topLeading)
        }
        .frame(width: Stage.width, height: Stage.navHeight + stage.safeBottom, alignment: .topLeading)
        .shadow(color: .black.opacity(0.6), radius: 4, x: 0, y: -2)
        .zIndex(10)
    }

    private func extendX(_ item: ExtendItem) -> CGFloat {
        switch item {
        case .album: return 33
        case .profile: return 175
        case .options: return 319
        case .home: return 461
        }
    }

    private func badgeFor(_ item: NavItem) -> NavBadges.CardsBadge {
        switch item {
        case .cards: return badges.cards
        case .league: return badges.league ? .new : .none
        default: return .none
        }
    }

    private func badgeFor(_ item: ExtendItem) -> NavBadges.CardsBadge {
        switch item {
        case .profile: return badges.profile ? .new : .none
        case .album: return badges.album ? .new : .none
        default: return .none
        }
    }

    private func navButton(sprite: String, active: Bool, plate: String, locked: Bool, badge: NavBadges.CardsBadge, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            ZStack(alignment: .topLeading) {
                if locked {
                    StretchedSprite("menubar_button_locked")
                } else {
                    if plate == "menubar_button" {
                        NineSlice(Theme.Frames.menubarButton)
                    } else {
                        StretchedSprite(plate)
                    }
                    Sprite(sprite + (active ? "_glow" : "_active"))
                        .frame(width: 106, height: 109)
                }
                switch badge {
                case .none: EmptyView()
                case .new: BadgeView(full: false).offset(x: 61, y: -18)
                case .full: BadgeView(full: true).offset(x: 64, y: -15)
                }
            }
            .frame(width: 106, height: 109)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressScaleStyle())
    }
}

/// The "!" badge (badge.png) or the deck_full badge of the cards button.
struct BadgeView: View {
    let full: Bool
    @State private var pulse: Bool = false

    var body: some View {
        Sprite(full ? "deck_full" : "badge")
            .frame(width: full ? 50 : 56, height: full ? 50 : 56)
            .scaleEffect(pulse && !full ? 1.12 : 1)
            .onAppear {
                if !full {
                    withAnimation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true)) { pulse = true }
                }
            }
            .allowsHitTesting(false)
    }
}
