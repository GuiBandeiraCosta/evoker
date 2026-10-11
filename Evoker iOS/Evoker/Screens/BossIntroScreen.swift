import SwiftUI
import EvokerCore

/// Boss fight intro (`src/ui/screens/boss-intro.js`, ctrl_bossquest spawnBoss): the screen dims, lightning flashes,
/// the fx_boss_light picture zooms in with "Boss Fight n" / "Showdown!" and the boss's name, the boss card scales
/// in over the rune circle; after the hold (or a tap) it fades and the pre-battle opens in its place.
struct BossIntroScreen: View {
    let line: String
    let n: Int
    @EnvironmentObject private var model: AppModel
    @Environment(\.stage) private var stage
    @State private var lineup: BossLineup? = nil
    @State private var prepared: Bool = false
    @State private var dim: Bool = false
    @State private var plateIn: Bool = false
    @State private var cardIn: Bool = false
    @State private var leaving: Bool = false
    @State private var left: Bool = false
    @State private var spin: Double = 0

    /// Timings (ms): plate zoom, card scale-in, hold, the picture fading, the card's flight to its slot.
    static let timings = (dim: 0.4, plate: 0.3, card: 0.8, hold: 2.6, leave: 0.3, fly: 0.35)
    /// The boss card of the intro in screen-body px (centre and size).
    static let cardBox = CGRect(x: 360 - 125, y: 395 - 176, width: 250, height: 352)

    var body: some View {
        ZStack {
            Sprite("village_normal_bg", contentMode: .fill).frame(width: Stage.width).clipped()
            if line != "main" {
                LinearGradient(colors: [Color(hex: 0x320a46, alpha: 0.35), Color(hex: 0x140028, alpha: 0.3)], startPoint: .top, endPoint: .bottom)
            }
            if let lu = lineup, let def = model.db.get(lu.boss.cardId) {
                stageView(lineup: lu, def: def)
            }
        }
        .clipped()
        .contentShape(Rectangle())
        .onTapGesture { advance() }
        .chrome(active: .quest, back: .custom({ model.router.replace(.quest(line: line, n: n)) }), help: "battle")
        .onAppear { prepare() }
    }

    private var title: String { FightRunner.bossTitle(deps: model.deps, line: line, n: n) }

    private func stageView(lineup: BossLineup, def: CardDef) -> some View {
        let showdown = title == Strings.showdown
        return ZStack(alignment: .topLeading) {
            Color.black.opacity(dim && !leaving ? 0.5 : 0)
            Sprite("fx_glow_map")
                .frame(width: 760, height: 760)
                .opacity(leaving ? 0 : 0.35)
                .blendMode(.screen)
                .rotationEffect(.degrees(spin))
                .position(x: 360, y: 395)
            ZStack(alignment: .top) {
                StretchedSprite("fx_boss_light")
                Text(title)
                    .font(Theme.font(showdown ? 58 : 58))
                    .foregroundColor(Theme.bossName)
                    .shadow(color: .black.opacity(0.9), radius: 1.5, x: 0, y: 2)
                    .lineLimit(1)
                    .frame(width: 504, height: 66)
                    .offset(y: 112)
                Text(cardNameWithPlus(def.name, stage: lineup.boss.stage))
                    .font(Theme.font(48))
                    .foregroundColor(Theme.bossName)
                    .shadow(color: .black.opacity(0.9), radius: 1.5, x: 0, y: 2)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .frame(width: 504, height: 64)
                    .offset(y: 615)
            }
            .frame(width: 784, height: 804)
            .offset(x: -32, y: 0)
            .scaleEffect(plateIn ? 1 : 1.5, anchor: UnitPoint(x: 0.5, y: 0.49))
            .opacity(plateIn && !leaving ? 1 : 0)
            ZStack {
                Color.black
                CardArt(def: def, stage: lineup.boss.stage)
            }
            .frame(width: BossIntroScreen.cardBox.width, height: BossIntroScreen.cardBox.height)
            .cornerRadius(6)
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color(hex: 0xa9adb1), lineWidth: 6))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(hex: 0x2b2e31), lineWidth: 3).padding(-4))
            .shadow(color: .black.opacity(0.8), radius: 13)
            .scaleEffect(cardIn ? 1 : 0.2)
            .opacity(cardIn ? 1 : 0)
            .position(x: BossIntroScreen.cardBox.midX, y: BossIntroScreen.cardBox.midY)
            ForEach(0..<3, id: \.self) { i in
                LightningBolt(delay: Double(i) * 0.26)
                    .frame(width: Stage.width + 180, height: 186)
                    .rotationEffect(.degrees([-18, 12, -6][i]))
                    .position(x: 360, y: CGFloat(430 + (i * 137) % 260))
                    .opacity(leaving ? 0 : 1)
            }
        }
        .frame(width: Stage.width, height: max(1026, stage.size.height - Stage.hudHeight - Stage.navHeight - stage.safeTop - stage.safeBottom), alignment: .topLeading)
        .animation(.linear(duration: BossIntroScreen.timings.dim), value: dim)
        .animation(.easeOut(duration: BossIntroScreen.timings.plate), value: plateIn)
        .animation(.spring(response: 0.6, dampingFraction: 0.7), value: cardIn)
        .animation(.linear(duration: BossIntroScreen.timings.leave), value: leaving)
        .onAppear {
            withAnimation(.linear(duration: 40).repeatForever(autoreverses: false)) { spin = 360 }
        }
    }

    private func prepare() {
        if prepared { return }
        prepared = true
        guard let state = model.store.state, let active = state.quests.active, active.line == line, active.n == n, active.bossReady,
              QuestOps.getQuest(deps: model.deps, lineId: line, n: n) != nil else {
            model.toast(Strings.beatMinionsFirst, icon: "icon_pvp_active")
            model.router.replace(.quest(line: line, n: n))
            return
        }
        let prep: (BossLineup, QuestNode)? = model.update { s, d, t in
            let r = try QuestOps.prepareBoss(s, deps: d, now: t)
            return (state: r.state, info: (r.lineup, r.quest))
        }
        guard let p = prep else {
            model.router.replace(.quest(line: line, n: n))
            return
        }
        lineup = p.0
        model.sfx("lightning_long")
        dim = true
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(BossIntroScreen.timings.dim * 1_000_000_000))
            model.sfx("metallic_transition")
            plateIn = true
            try? await Task.sleep(nanoseconds: 50_000_000)
            cardIn = true
            try? await Task.sleep(nanoseconds: UInt64((BossIntroScreen.timings.hold - BossIntroScreen.timings.dim - 0.05) * 1_000_000_000))
            advance()
        }
    }

    /// The picture fades, then the pre-battle opens in its place (the card flies into its slot there).
    private func advance() {
        if left || lineup == nil { return }
        left = true
        leaving = true
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(BossIntroScreen.timings.leave * 1_000_000_000))
            model.pendingBossIntro = (line, n)
            model.router.replace(.prebattle(.questBoss(line: line, n: n)), animated: false)
        }
    }
}

/// lightning_long: a lightining.png flash stepping through a few heights.
struct LightningBolt: View {
    let delay: Double
    @State private var step: Int = -1

    private let scales: [CGFloat] = [0.25, 0.5, 1, 0.5, 1, 0.5, 0.25, 0.01]

    var body: some View {
        StretchedSprite("lightining")
            .blendMode(.screen)
            .scaleEffect(x: 1, y: step >= 0 && step < scales.count ? scales[step] : 0.01)
            .opacity(step >= 0 && step < scales.count - 1 ? 1 : 0)
            .onAppear {
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: UInt64(max(0, delay) * 1_000_000_000))
                    for i in 0..<scales.count {
                        step = i
                        try? await Task.sleep(nanoseconds: 80_000_000)
                    }
                    step = scales.count
                }
            }
            .allowsHitTesting(false)
    }
}
