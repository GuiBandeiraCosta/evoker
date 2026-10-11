import SwiftUI
import EvokerCore

/// The Quest tab's landing feed (`src/ui/screens/quest-feed.js`, the client's landing page): the daily-reward strip
/// "DON'T MISS YOUR NEXT REWARD!", the main quest, today's event with its countdown, the current portal ("Portal
/// closes in:"), the "Get Cards" booster promo and the next portal's teaser.
struct QuestFeedScreen: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Group {
            if let state = model.store.state {
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(spacing: 16) {
                        ForEach(Array(banners(state).enumerated()), id: \.offset) { item in
                            bannerView(item.element, state: state)
                        }
                    }
                    .padding(.top, 14).padding(.horizontal, 14).padding(.bottom, 30)
                }
                .background(
                    ZStack {
                        Color(hex: 0x0d0f11)
                        Sprite("horizon-valley", contentMode: .fill).frame(width: Stage.width).clipped()
                    }
                )
                .chrome(active: .quest, back: .none, help: "quest-map")
            } else {
                Color.black
            }
        }
        .onAppear { model.catchUpUnlocks() }
    }

    enum Banner {
        case daily(items: [(day: Int, reward: DailyReward, gap: Bool)], endsAt: Int64)
        case quest(quest: Int, total: Int, section: String)
        case event(DailyEvent, headline: String, double: Bool, endsAt: Int64)
        case portal(line: String, name: String, cards: [String], endsAt: Int64)
        case shop
        case nextPortal(line: String, name: String, cards: [String], startsAt: Int64)
    }

    /// `dailyStrip`: the next streak days, "…", the last day of the 21-day cycle, the next claim time.
    private func dailyStrip(_ state: GameState) -> (items: [(day: Int, reward: DailyReward, gap: Bool)], endsAt: Int64) {
        let d = state.daily
        let today = JSDate.utcDay(model.now)
        let next = (d.lastClaim == today || d.lastClaim == JSDate.previousDay(today)) ? d.streak + 1 : 1
        let cycle = max(1, ShopOps.dailyRewards.count)
        let cycleEnd = Int((Double(next) / Double(cycle)).rounded(.up)) * cycle
        var items: [(day: Int, reward: DailyReward, gap: Bool)] = []
        var day = next
        while day < next + 3 && day <= cycleEnd {
            items.append((day, ShopOps.dailyRewardFor(day: day), false))
            day += 1
        }
        if let last = items.last, last.day < cycleEnd {
            items.append((cycleEnd, ShopOps.dailyRewardFor(day: cycleEnd), last.day < cycleEnd - 1))
        }
        return (items, JSDate.utcDayStart(model.now) + JSDate.dayMs)
    }

    /// `feedBanners`.
    private func banners(_ state: GameState) -> [Banner] {
        var out: [Banner] = []
        let strip = dailyStrip(state)
        out.append(.daily(items: strip.items, endsAt: strip.endsAt))
        let total = model.deps.quests?.main.nodes.count ?? 100
        let current = min(total, max(1, state.quests.main.unlocked))
        let sec = (model.deps.quests?.sections ?? []).first { current >= $0.from && current <= $0.to }
        out.append(.quest(quest: current, total: total, section: sec?.name ?? ""))
        if let ev = model.dailyEvent {
            out.append(.event(ev, headline: EventBannerInfo.headline(ev.id), double: EventBannerInfo.isDouble(ev.id), endsAt: JSDate.utcDayStart(model.now) + JSDate.dayMs))
        }
        let run = PortalGate.runningPortal(state, deps: model.deps, now: model.now)
        if let r = run {
            let def = QuestOps.questLine(deps: model.deps, lineId: r.portalId)
            out.append(.portal(line: r.portalId, name: r.name, cards: Array((def?.cards ?? []).prefix(4)), endsAt: r.endsAt))
        }
        out.append(.shop)
        if let r = run, let next = r.next {
            let def = QuestOps.questLine(deps: model.deps, lineId: next.portalId)
            out.append(.nextPortal(line: next.portalId, name: next.name, cards: Array((def?.cards ?? []).prefix(4)), startsAt: next.startsAt))
        }
        return out
    }

    @ViewBuilder
    private func bannerView(_ b: Banner, state: GameState) -> some View {
        switch b {
        case .daily(let items, let endsAt):
            FeedFrame(background: AnyView(LinearGradient(colors: [Color(hex: 0x145058, alpha: 0.95), Color(hex: 0x0e343c, alpha: 0.95)], startPoint: .top, endPoint: .bottom))) {
                VStack(spacing: 12) {
                    Text(Strings.dontMissReward).font(Theme.font(28)).foregroundColor(Color(hex: 0xe9f4fb))
                    HStack(alignment: .bottom, spacing: 14) {
                        ForEach(Array(items.enumerated()), id: \.offset) { item in
                            if item.element.gap {
                                Text("…").font(Theme.font(34)).foregroundColor(Color(hex: 0xe9f4fb)).padding(.bottom, 20)
                            }
                            DailyStripItem(day: item.element.day, reward: item.element.reward, next: item.offset == 0, endsAt: endsAt)
                        }
                    }
                }
                .padding(.top, 12).padding(.horizontal, 10).padding(.bottom, 14)
            }
        case .quest(let quest, let total, let section):
            FeedFrame(background: AnyView(feedImage("world-0-0", tint: Color(hex: 0x0a1e14, alpha: 0.4))), onTap: { model.router.replace(.questMap()) }) {
                ZStack(alignment: .bottomTrailing) {
                    VStack(spacing: 6) {
                        Text(Strings.mainQuest).font(Theme.font(40)).foregroundColor(Color(hex: 0xe9f4fb))
                        Text(section.isEmpty ? "Quest \(quest)" : "\(section) - Quest \(quest)").font(Theme.font(26)).foregroundColor(Color(hex: 0xe9f4fb))
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 150)
                    Text("\(quest) / \(total)").font(Theme.num(22)).foregroundColor(Theme.gold).padding(.trailing, 64).padding(.bottom, 10)
                    Sprite("back_icon_active").frame(width: 36, height: 36).scaleEffect(x: -1, y: 1).padding(.trailing, 14).padding(.bottom, 57)
                }
            }
        case .event(let ev, let headline, let double, let endsAt):
            FeedFrame(background: AnyView(feedImage("boss-valley", tint: Color(hex: 0x14100a, alpha: 0.7)))) {
                ZStack(alignment: .topTrailing) {
                    VStack(spacing: 6) {
                        Text(ev.name).font(Theme.title(50)).foregroundColor(Color(hex: 0xffcf6a))
                        Text(headline.uppercased()).font(Theme.font(26)).foregroundColor(Color(hex: 0xe9f4fb))
                        CountdownText(endsAt: endsAt, style: .hms, font: Theme.num(24), color: Color(hex: 0xe9f4fb))
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 190)
                    if double { X2Badge(size: 74).padding(.top, 10).padding(.trailing, 12) }
                }
            }
        case .portal(let line, let name, let cards, let endsAt):
            FeedFrame(background: AnyView(feedImage("world-1-0", tint: Color(hex: 0x0a0618, alpha: 0.6))), onTap: { enterPortal(line, state: state) }) {
                ZStack(alignment: .top) {
                    CardFan(cardIds: cards, dim: false).padding(.top, 14)
                    VStack(spacing: 4) {
                        Spacer()
                        Text(name).font(Theme.title(46)).foregroundColor(Color(hex: 0xffe39a))
                        HStack(spacing: 10) {
                            Text(Strings.portalClosesIn).font(Theme.font(24)).foregroundColor(Color(hex: 0xe9f4fb))
                            CountdownText(endsAt: endsAt, style: .dhms, font: Theme.num(24), color: Color(hex: 0xe9f4fb))
                        }
                    }
                    .padding(.bottom, 14)
                }
                .frame(height: 330)
            }
        case .shop:
            Button(action: { model.sfx("ui_button_circular"); model.router.goTop(.shop) }) {
                ZStack(alignment: .top) {
                    StretchedSprite("eventbanner_cardboost02")
                    Text(Strings.getCards)
                        .font(Theme.font(36))
                        .foregroundColor(Color(hex: 0xffb441))
                        .shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 2)
                        .frame(width: (Stage.width - 28) * 0.78, height: 62)
                        .background(StretchedSprite("header_framer_big"))
                        .padding(.top, 30)
                }
                .frame(width: Stage.width - 28, height: (Stage.width - 28) * 403 / 649)
                .contentShape(Rectangle())
            }
            .buttonStyle(PressScaleStyle())
        case .nextPortal(_, let name, let cards, let startsAt):
            FeedFrame(background: AnyView(feedImage("world-2-0", tint: Color(hex: 0x180606, alpha: 0.65))), onTap: { model.toast(Strings.opensSoon(name), icon: "icon_map_active") }) {
                ZStack(alignment: .top) {
                    CardFan(cardIds: cards, dim: true).padding(.top, 14)
                    VStack(spacing: 4) {
                        Spacer()
                        Text(name).font(Theme.title(46)).foregroundColor(Color(hex: 0xffe39a))
                        HStack(spacing: 10) {
                            Text(Strings.comingSoon).font(Theme.font(24)).foregroundColor(Color(hex: 0xe9f4fb))
                            CountdownText(endsAt: startsAt, style: .dhms, font: Theme.num(24), color: Color(hex: 0xe9f4fb))
                        }
                    }
                    .padding(.bottom, 14)
                }
                .frame(height: 270)
            }
        }
    }

    private func feedImage(_ name: String, tint: Color) -> some View {
        ZStack {
            Color(hex: 0x10202a)
            Sprite(name, contentMode: .fill)
            tint
        }
        .clipped()
    }

    private func enterPortal(_ line: String, state: GameState) {
        if PortalGate.canEnterPortals(state) {
            model.router.replace(.questMap(line: line))
        } else {
            Task { @MainActor in await model.dialogs.alert(title: Strings.portalsTitle, message: Strings.portalsLocked) }
        }
    }
}

/// A feed banner frame: the glowblue nine-slice over a painted background (`.feed-banner`).
struct FeedFrame<Content: View>: View {
    let background: AnyView
    var onTap: (() -> Void)? = nil
    @ViewBuilder let content: () -> Content
    @EnvironmentObject private var model: AppModel

    init(background: AnyView, onTap: (() -> Void)? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.background = background
        self.onTap = onTap
        self.content = content
    }

    var body: some View {
        let inner = content()
            .frame(width: Stage.width - 28 - 28)
            .background(background)
            .clipped()
            .padding(14)
            .background(Color(hex: 0x10202a))
            .overlay(NineSlice(Theme.Frames.glowBlue))
            .shadow(color: .black.opacity(0.7), radius: 10, x: 0, y: 6)
        if let tap = onTap {
            Button(action: { model.sfx("ui_button_circular"); tap() }) { inner.contentShape(Rectangle()) }.buttonStyle(PressScaleStyle())
        } else {
            inner
        }
    }
}

/// One item of the daily strip: reward frame (small_yellow; glowgold for tomorrow's big one), "D n" or the timer.
struct DailyStripItem: View {
    let day: Int
    let reward: DailyReward
    let next: Bool
    let endsAt: Int64

    var body: some View {
        let ic = DailyRewardText.icon(reward)
        VStack(spacing: 4) {
            ZStack(alignment: .top) {
                Color.black.opacity(0.45)
                Sprite(ic.sprite).frame(width: (next ? 146 : 104) * 0.86, height: (next ? 146 : 104) * 0.86).frame(maxHeight: .infinity)
                if let amount = ic.amount, amount > 1 {
                    Text(fmtNumber(amount)).font(Theme.num(20)).foregroundColor(Color(hex: 0xe9f4fb)).shadow(color: .black, radius: 2).padding(.top, -2)
                }
            }
            .frame(width: next ? 146 : 104, height: next ? 146 : 104)
            .overlay(NineSlice(next ? Theme.Frames.glowGold : Theme.Frames.smallYellow))
            if next {
                CountdownText(endsAt: endsAt, style: .hms, font: Theme.num(24), color: Color(hex: 0xe9f4fb))
            } else {
                Text("D \(day)").font(Theme.font(20)).foregroundColor(Color(hex: 0xe9f4fb))
            }
        }
    }
}

/// A small fan of card arts (`cardFan`).
struct CardFan: View {
    let cardIds: [String]
    let dim: Bool
    @EnvironmentObject private var model: AppModel

    var body: some View {
        let defs = cardIds.compactMap { model.db.get($0) }
        let mid = Double(defs.count - 1) / 2
        ZStack {
            ForEach(Array(defs.enumerated()), id: \.offset) { item in
                let i = Double(item.offset) - mid
                CardArt(def: item.element, stage: 0)
                    .frame(width: 116, height: 164)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.rarityThumb(item.element.rarity), lineWidth: 4))
                    .cornerRadius(6)
                    .shadow(color: .black.opacity(0.85), radius: 8, x: 0, y: 8)
                    .saturation(dim ? 0.6 : 1)
                    .brightness(dim ? -0.3 : 0)
                    .rotationEffect(.degrees(i * 7))
                    .offset(x: i * 128, y: i * i * 12)
            }
        }
        .frame(height: 200)
    }
}

/// The orange "x2" badge of the double events.
struct X2Badge: View {
    var size: CGFloat = 58

    var body: some View {
        Text("x2")
            .font(Theme.font(size * 0.43))
            .foregroundColor(.white)
            .shadow(color: .black.opacity(0.8), radius: 1, x: 0, y: 1)
            .frame(width: size, height: size)
            .background(RadialGradient(colors: [Color(hex: 0xffc046), Color(hex: 0xf08a00), Color(hex: 0xb45400)], center: UnitPoint(x: 0.4, y: 0.35), startRadius: 0, endRadius: size * 0.6))
            .clipShape(Circle())
            .shadow(color: Color(hex: 0xff9600, alpha: 0.9), radius: 10)
    }
}

/// `pvp-events.js`: headline, double flag and art of the daily events' small banner.
enum EventBannerInfo {
    static func headline(_ id: DailyEventId) -> String {
        switch id {
        case .infiniteWisdom: return "Double XP for your cards"
        case .doubleLeaguePoints: return "Double PvP points"
        case .drinkingContest: return "Cheap potions all day"
        case .cardPieceDay: return "Card pieces at half price"
        case .greatPotionDeal: return "3 potions for 60 gems"
        case .getTheBestCards: return "Boosters 50 % off"
        case .goldenDay: return "+50 % gold"
        }
    }

    static func isDouble(_ id: DailyEventId) -> Bool {
        id == .infiniteWisdom || id == .doubleLeaguePoints
    }

    static func artCardId(_ id: DailyEventId) -> String {
        switch id {
        case .infiniteWisdom: return "dwarven-sage"
        case .doubleLeaguePoints: return "gladiator"
        case .drinkingContest: return "master-brewer"
        case .cardPieceDay: return "keeper-of-the-treasure"
        case .greatPotionDeal: return "alchemist"
        case .getTheBestCards: return "dark-mage"
        case .goldenDay: return "keeper-of-the-treasure"
        }
    }
}

/// `daily-view.js describeDailyReward / dailyRewardIcons` and the strip's `dailyRewardIcon`.
enum DailyRewardText {
    static func describe(_ r: DailyReward) -> String {
        if let gems = r.gems, gems > 0 { return "\(gems) Gems" }
        if let tok = r.tokens {
            let n = r.count ?? 1
            return "\(n) \(capitalized(tok.rawValue)) token\(n == 1 ? "" : "s")"
        }
        var parts: [String] = []
        if let mana = r.mana, mana > 0 { parts.append("\(mana) Mana") }
        if let st = r.stamina, st > 0 { parts.append("\(st) Stamina") }
        if parts.isEmpty { return "" }
        let total = (r.mana ?? 0) + (r.stamina ?? 0)
        return "\(parts.joined(separator: " + ")) potion\(total == 1 ? "" : "s")"
    }

    /// `dailyRewardIcon`: sprite and number for the strip.
    static func icon(_ r: DailyReward) -> (sprite: String, amount: Int?, label: String) {
        if let gems = r.gems, gems > 0 { return ("reward_gems", gems, "\(gems) gems") }
        if let tok = r.tokens { return (tokenSprite(tok), r.count ?? 1, "\(r.count ?? 1) \(tok.rawValue) tokens") }
        if let mana = r.mana, mana > 0 { return ("reward_manapotion", mana + (r.stamina ?? 0), "\(mana) mana + \(r.stamina ?? 0) stamina potions") }
        return ("reward_staminapotions", r.stamina ?? 0, "\(r.stamina ?? 0) stamina potions")
    }

    /// `dailyRewardIcons`: small icons with counts (the calendar and the claim popup).
    static func icons(_ r: DailyReward) -> [(sprite: String, count: Int, gem: Bool)] {
        if let gems = r.gems, gems > 0 { return [("hud_gemiconsingle", gems, true)] }
        if let tok = r.tokens { return [(tokenSprite(tok), r.count ?? 1, false)] }
        var out: [(sprite: String, count: Int, gem: Bool)] = []
        if let st = r.stamina, st > 0 { out.append((sprite: "potion_stamina2", count: st, gem: false)) }
        if let mana = r.mana, mana > 0 { out.append((sprite: "potion_mana2", count: mana, gem: false)) }
        return out
    }
}
