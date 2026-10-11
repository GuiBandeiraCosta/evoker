import SwiftUI
import EvokerCore

/// The player level-up dialog (`src/ui/components/popup-levelup.js`, the client's `comp_levelup`): the hud_levelup
/// ribbon flashes in, then the panel "Level up!" / "Reached level N" with the Rewards column and "Points: x/N" with
/// +/- per attribute and Proceed. Proceed spreads the points not placed by hand (`autoDistribute`), counts them up
/// one per 250 ms and resolves with the final allocation (the caller spends it through `PlayerOps.spendStatPoints`).

/// Delay between two automatically placed points (comp_levelup autoCount).
let levelUpAutoStepMs: Double = 250
/// How long the "Level Up" ribbon shows before the panel.
let levelUpRibbonMs: Double = 900

enum LevelUpMath {
    /// `autoDistribute`: each point goes to the attribute with the fewest points placed so far (ties: mana, then
    /// stamina, then health); without the mana feature it alternates stamina / health.
    static func autoDistribute(pointsLeft: Int, placed: StatAlloc, manaUnlocked: Bool = true) -> StatAlloc {
        var mana = placed.mana, stamina = placed.stamina, hp = placed.hp
        if pointsLeft > 0 {
            for _ in 0..<pointsLeft {
                if !manaUnlocked {
                    if stamina <= hp { stamina += 1 } else { hp += 1 }
                } else if mana <= stamina && mana <= hp {
                    mana += 1
                } else if stamina < mana && stamina <= hp {
                    stamina += 1
                } else {
                    hp += 1
                }
            }
        }
        return StatAlloc(stamina: stamina, mana: mana, hp: hp)
    }

    /// `autoSteps`: the order the automatic points are counted up (health, stamina, mana).
    static func autoSteps(placed: StatAlloc, final: StatAlloc) -> [LevelUpAttribute] {
        var out: [LevelUpAttribute] = []
        if final.hp > placed.hp { for _ in placed.hp..<final.hp { out.append(.hp) } }
        if final.stamina > placed.stamina { for _ in placed.stamina..<final.stamina { out.append(.stamina) } }
        if final.mana > placed.mana { for _ in placed.mana..<final.mana { out.append(.mana) } }
        return out
    }

    /// `coinSprite`: the coin pile for a gold amount.
    static func coinSprite(_ amount: Int) -> String {
        if amount < 500 { return "shop_coins01" }
        if amount < 1000 { return "shop_coins03" }
        return "shop_coins04"
    }

    /// `dialogBudget`: every unspent point on the last dialog, only that level's points on the earlier ones.
    static func dialogBudget(unspent: Int, levelPoints: Int, last: Bool) -> Int {
        let u = max(0, unspent)
        return last ? u : min(u, max(0, levelPoints))
    }

    /// `rewardColumn`: the gold sum and the one special reward (gems, a potion or a token).
    static func rewardColumn(_ r: LevelUpRewards) -> (gold: Int, special: (sprite: String, count: Int, label: String, kind: String)?) {
        let gold = max(0, r.gold)
        if r.gems > 0 {
            return (gold, ("reward_gems", r.gems, "\(fmtNumber(r.gems)) gems", "gems"))
        }
        if let first = r.potions.first {
            let n = r.potions.filter { $0 == first }.count
            let kind = first == .mana ? "mana" : "stamina"
            return (gold, (first == .mana ? "potion_mana1" : "potion_stamina1", n, "\(n) \(kind) potion\(n == 1 ? "" : "s")", "potion-\(kind)"))
        }
        if let first = r.tokens.first {
            let n = r.tokens.filter { $0 == first }.count
            return (gold, (tokenSprite(first), n, "\(n) \(tokenName(first))\(n == 1 ? "" : "s")", "token"))
        }
        return (gold, nil)
    }

    /// `toDetails` for a bare level: rewards, 12 points and the level's unlock popups.
    static func detail(forLevel level: Int, state: GameState?) -> LevelUpDetail {
        LevelUpDetail(level: level, rewards: PlayerOps.levelUpRewards(level: level), statPoints: PlayerOps.statPointsPerLevel,
                      unlocked: StateOps.featuresUnlockedAt(level: level, state: state))
    }
}

/// `tokenSpriteFor`: token_small / _medium / _big; the portal tokens draw the triangle.
func tokenSprite(_ kind: TokenKind) -> String {
    switch kind {
    case .neophyte: return "token_small"
    case .summoner: return "token_medium"
    case .archmage: return "token_big"
    case .portalLow: return "token_medium"
    case .portalHigh: return "token_big"
    }
}

func tokenName(_ kind: TokenKind) -> String {
    switch kind {
    case .neophyte: return "Neophyte token"
    case .summoner: return "Summoner token"
    case .archmage: return "Archmage token"
    case .portalLow: return "Portal token"
    case .portalHigh: return "Grand portal token"
    }
}

enum LevelUpAttribute: String, CaseIterable, Identifiable {
    case hp, stamina, mana
    var id: String { rawValue }
    var label: String {
        switch self {
        case .hp: return Strings.health
        case .stamina: return Strings.staminaLabel
        case .mana: return Strings.manaLabel
        }
    }
    var sprite: String {
        switch self {
        case .hp: return "hud_healthicon02"
        case .stamina: return "hud_stamicon01"
        case .mana: return "hud_manaicon01"
        }
    }
    var mult: Int {
        switch self {
        case .hp: return PlayerOps.hpPerPoint
        case .stamina: return PlayerOps.staminaPerPoint
        case .mana: return PlayerOps.manaPerPoint
        }
    }
}

extension StatAlloc {
    func value(_ a: LevelUpAttribute) -> Int {
        switch a {
        case .hp: return hp
        case .stamina: return stamina
        case .mana: return mana
        }
    }
    mutating func add(_ a: LevelUpAttribute, _ delta: Int) {
        switch a {
        case .hp: hp += delta
        case .stamina: stamina += delta
        case .mana: mana += delta
        }
    }
}

/// One open level-up dialog.
@MainActor
final class LevelUpSession: ObservableObject, Identifiable {
    let id = UUID()
    let detail: LevelUpDetail
    let budget: Int
    let base: (hp: Int, stamina: Int, mana: Int)
    let manaUnlocked: Bool
    let sfx: (String) -> Void
    @Published var placed = StatAlloc()
    @Published var pointsLeft: Int
    @Published var intro: Bool
    @Published var busy: Bool = false
    var continuation: CheckedContinuation<StatAlloc, Never>?

    init(detail: LevelUpDetail, budget: Int, player: PlayerState, manaUnlocked: Bool, instant: Bool, sfx: @escaping (String) -> Void) {
        self.detail = detail
        self.budget = budget
        self.base = (player.hpMax, player.staminaMax, player.manaMax)
        self.manaUnlocked = manaUnlocked
        self.sfx = sfx
        self.pointsLeft = budget
        self.intro = !instant
    }

    func baseValue(_ a: LevelUpAttribute) -> Int {
        switch a {
        case .hp: return base.hp
        case .stamina: return base.stamina
        case .mana: return base.mana
        }
    }

    func change(_ a: LevelUpAttribute, _ delta: Int) {
        if busy { return }
        if delta > 0 && pointsLeft <= 0 { return }
        if delta < 0 && placed.value(a) <= 0 { return }
        placed.add(a, delta)
        pointsLeft -= delta
        sfx("ui_button_switch")
    }

    func skipIntro() {
        if intro { intro = false }
    }

    /// Proceed: spread the rest, count it up, then resolve.
    func proceed() {
        if busy { return }
        busy = true
        intro = false
        let final = LevelUpMath.autoDistribute(pointsLeft: pointsLeft, placed: placed, manaUnlocked: manaUnlocked)
        let steps = LevelUpMath.autoSteps(placed: placed, final: final)
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            for step in steps {
                try? await Task.sleep(nanoseconds: UInt64(levelUpAutoStepMs * 1_000_000))
                self.placed.add(step, 1)
                self.pointsLeft -= 1
                self.sfx("ui_button_switch")
            }
            try? await Task.sleep(nanoseconds: UInt64(levelUpAutoStepMs * 1_000_000))
            self.finish(final)
        }
    }

    private func finish(_ final: StatAlloc) {
        let c = continuation
        continuation = nil
        c?.resume(returning: final)
    }
}

/// Owns the open level-up dialog; `AppModel.showLevelUps` runs the sequence.
@MainActor
final class LevelUpCenter: ObservableObject {
    @Published private(set) var session: LevelUpSession?

    /// Show one dialog and resolve with the final allocation when Proceed finished.
    func run(detail: LevelUpDetail, budget: Int, player: PlayerState, manaUnlocked: Bool = true, instant: Bool, sfx: @escaping (String) -> Void) async -> StatAlloc {
        let s = LevelUpSession(detail: detail, budget: budget, player: player, manaUnlocked: manaUnlocked, instant: instant, sfx: sfx)
        session = s
        sfx("quest_reward_levelup")
        if !instant {
            Task { @MainActor [weak s] in
                try? await Task.sleep(nanoseconds: UInt64(levelUpRibbonMs * 1_000_000))
                s?.skipIntro()
            }
        }
        let result: StatAlloc = await withCheckedContinuation { (c: CheckedContinuation<StatAlloc, Never>) in
            s.continuation = c
        }
        session = nil
        return result
    }
}

/// Draws the open level-up dialog of a `LevelUpCenter`.
struct LevelUpLayer: View {
    @ObservedObject var center: LevelUpCenter

    var body: some View {
        if let s = center.session {
            LevelUpDialog(session: s).id(s.id)
        }
    }
}

struct LevelUpDialog: View {
    @ObservedObject var session: LevelUpSession
    @State private var flash: Bool = true
    @State private var ribbonIn: Bool = false

    var body: some View {
        ZStack {
            Color.black.opacity(0.7)
                .contentShape(Rectangle())
                .onTapGesture { session.skipIntro() }
            if session.intro {
                ZStack {
                    Color.white.opacity(flash ? 0.95 : 0)
                    Sprite("hud_levelup")
                        .frame(width: 600, height: 600)
                        .scaleEffect(ribbonIn ? 1 : 0.4)
                        .opacity(ribbonIn ? 1 : 0)
                }
                .allowsHitTesting(false)
                .onAppear {
                    withAnimation(.easeOut(duration: 0.7)) { flash = false }
                    withAnimation(.spring(response: 0.55, dampingFraction: 0.6)) { ribbonIn = true }
                }
            } else {
                LevelUpPanel(session: session)
                    .transition(.opacity.combined(with: .scale(scale: 0.95)))
            }
        }
        .animation(.easeOut(duration: 0.26), value: session.intro)
    }
}

/// The dark large-frame panel (`renderPlayerLevelUp`).
struct LevelUpPanel: View {
    @ObservedObject var session: LevelUpSession

    private var attributes: [LevelUpAttribute] {
        LevelUpAttribute.allCases.filter { $0 != .mana || session.manaUnlocked }
    }

    var body: some View {
        let col = LevelUpMath.rewardColumn(session.detail.rewards)
        VStack(spacing: 0) {
            VStack(spacing: 10) {
                Text(Strings.levelUp).font(Theme.font(66)).foregroundColor(Theme.text).shadow(color: .black.opacity(0.9), radius: 2, x: 0, y: 3)
                Text(Strings.reachedLevel(session.detail.level)).font(Theme.font(34)).foregroundColor(Theme.text).shadow(color: .black.opacity(0.9), radius: 1.5, x: 0, y: 2)
            }
            .padding(.top, 22)
            .padding(.bottom, 16)
            StretchedSprite("seperator_small").frame(height: 12)
            HStack(alignment: .top, spacing: 0) {
                // Rewards
                VStack(spacing: 12) {
                    Text(Strings.rewards).font(Theme.font(36)).foregroundColor(Theme.text)
                    ZStack(alignment: .bottomTrailing) {
                        if let sp = col.special {
                            Sprite(sp.sprite)
                                .frame(width: sp.kind == "token" ? 130 : (sp.kind == "gems" ? 200 : 170), height: sp.kind == "token" ? 140 : 200)
                            if sp.count > 1 || sp.kind == "gems" {
                                Text(fmtNumber(sp.count))
                                    .font(Theme.num(34))
                                    .foregroundColor(Theme.text)
                                    .shadow(color: .black, radius: 3)
                                    .padding(.trailing, 26)
                                    .padding(.bottom, 10)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    HStack(spacing: 12) {
                        Text(fmtNumber(col.gold)).font(Theme.num(38)).foregroundColor(Theme.text)
                        Sprite(LevelUpMath.coinSprite(col.gold)).frame(width: 96, height: 96)
                    }
                }
                .frame(width: 236)
                .padding(.top, 26)
                .padding(.bottom, 22)
                Rectangle()
                    .fill(LinearGradient(colors: [Color(hex: 0x2b2c2e), Color(hex: 0x8b8d90), Color(hex: 0x545659), Color(hex: 0x1c1d1f)], startPoint: .leading, endPoint: .trailing))
                    .frame(width: 5)
                // Points
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(Strings.points).font(Theme.font(36)).foregroundColor(Theme.text)
                        Text("\(session.pointsLeft)").font(Theme.num(36)).foregroundColor(Theme.text)
                        Text("/\(session.budget)").font(Theme.num(36)).foregroundColor(Theme.text)
                    }
                    VStack(spacing: 14) {
                        ForEach(attributes) { a in
                            attributeRow(a)
                        }
                    }
                    .padding(.top, 24)
                    .padding(.bottom, 10)
                    Spacer(minLength: 10)
                    HStack {
                        Spacer()
                        Button(action: { session.proceed() }) {
                            Text(Strings.proceed)
                                .font(Theme.font(38))
                                .foregroundColor(Color(hex: 0xf0f0f0))
                                .frame(minWidth: 300, minHeight: 92)
                                .background(NineSlice(session.busy ? Theme.Frames.bigbutton03Inactive : Theme.Frames.bigbutton03))
                        }
                        .buttonStyle(.plain)
                        .disabled(session.busy)
                        Spacer()
                    }
                }
                .padding(.top, 26)
                .padding(.leading, 24)
                .padding(.trailing, 18)
                .padding(.bottom, 18)
                .frame(maxWidth: .infinity)
            }
            .frame(minHeight: 470)
        }
        .frame(width: 660)
        .background(Color(hex: 0x1e2023, alpha: 0.97))
        .overlay(NineSlice(Theme.Frames.hudNineframe))
        .shadow(color: .black.opacity(0.85), radius: 20, x: 0, y: 12)
    }

    private func attributeRow(_ a: LevelUpAttribute) -> some View {
        let placedHere = session.placed.value(a)
        let value = session.baseValue(a) + placedHere * a.mult
        let canMinus = placedHere > 0 && !session.busy
        let canPlus = session.pointsLeft > 0 && !session.busy
        return HStack(spacing: 10) {
            Sprite(a.sprite).frame(width: 58, height: 58)
            Text("\(value)")
                .font(Theme.num(32))
                .foregroundColor(Theme.text)
                .frame(maxWidth: .infinity, alignment: .trailing)
                .padding(.trailing, 18)
            smallButton(canMinus ? "minus_icon_active" : "minus_icon_inactive", iconHeight: 14, enabled: canMinus) { session.change(a, -1) }
            smallButton(canPlus ? "plus_icon_active" : "plus_icon_inactive", iconHeight: 40, enabled: canPlus) { session.change(a, 1) }
        }
        .frame(height: 82)
    }

    private func smallButton(_ icon: String, iconHeight: CGFloat, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            ZStack {
                NineSlice(Theme.Frames.smallbutton)
                Sprite(icon).frame(width: 40, height: iconHeight)
            }
            .frame(width: 78, height: 78)
            .saturation(enabled ? 1 : 0.3)
            .brightness(enabled ? 0 : -0.15)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }
}
