import SwiftUI
import EvokerCore

/// Quest screen (`src/ui/screens/quest.js` + `quest-model.js` + `quest-fx.js`): purple progress bar, the original
/// village landscape with the parallax layers, the minion cut-outs walking in from the right, the minideck at the
/// bottom. Tapping a minion spends stamina (Drink-potion dialog when short) and pays at once (QuestOps.tapMinion):
/// an orange X-slash with "PERFECT", the tap's gold as a small white number, the HUD gold counting up; a wave's
/// end brings the coin shower, a card drop or a reward burst; level-ups open the level-up dialog; when every
/// minion is down the boss intro follows.
struct QuestScreen: View {
    let line: String
    let n: Int
    @EnvironmentObject private var model: AppModel
    @State private var started: Bool = false
    @State private var busy: Bool = false
    @State private var shownWave: Int = -1
    @State private var minions: [MinionSprite] = []
    @State private var slashes: [SlashFx] = []
    @State private var tapNumbers: [TapNumberFx] = []
    @State private var burst: BurstFx? = nil
    @State private var drop: DropFx? = nil
    @State private var coins: Bool = false
    @State private var dropping: Bool = false
    @State private var shownGold: Int = 0
    @State private var heldGold: Int = 0
    @State private var goldTask: Task<Void, Never>? = nil
    @State private var landscapeSize: CGSize = CGSize(width: 720, height: 820)
    @State private var minideckFrame: CGRect = .zero

    /// Where the minions stand (stage px inside the arena; x = centre, y = feet, s = scale).
    static let slots: [(x: CGFloat, y: CGFloat, s: CGFloat)] = [(118, 612, 0.94), (262, 672, 1.02), (408, 628, 0.96), (552, 690, 1.06), (652, 606, 0.9)]
    /// Minion sprite size at scale 1 (the 245x383 cut-outs drawn at 0.56).
    static let minionW: CGFloat = 137
    static let minionH: CGFloat = 214
    /// Minion cut-outs per tribe in GameAssets/minions.
    static let minionCounts: [Tribe: Int] = [.dwarf: 3, .elf: 3, .orc: 4, .neutral: 7]
    /// Tap feedback timings (s): the minion is gone after `vanish`, the slash fades after `slash`, "PERFECT" holds
    /// `perfect`, the white tap number floats `number`.
    static let tapFx = (vanish: 0.13, slash: 0.45, perfect: 0.9, number: 0.9)
    /// Wave-end coin shower: ~1.3 s, the HUD gold counting up in 4 steps.
    static let goldShower = (duration: 1.3, steps: 4, stepMs: 260)
    static let tapGoldCount = (steps: 3, stepMs: 60)
    /// Card drop: glint, white flash → card, hold, fly to the minideck, then the next wave fades in (s).
    static let cardDrop = (glint: 0.6, flash: 0.25, reveal: 0.25, hold: 1.0, fly: 0.25, waveIn: 0.9)

    private var quest: QuestNode? { QuestOps.getQuest(deps: model.deps, lineId: line, n: n) }
    private var lineDef: QuestLine? { QuestOps.questLine(deps: model.deps, lineId: line) }

    var body: some View {
        Group {
            if let state = model.store.state, let q = quest {
                content(state: state, quest: q)
            } else {
                Color.black
            }
        }
        .chrome(active: .quest, back: .custom({ leave() }), help: "quest", goldOverride: shownGold)
        .onAppear { start() }
    }

    // MARK: Model helpers (quest-model.js)

    /// `questTribe`: the fixed boss's tribe, else a band-dependent pick that cycles with the quest number.
    private func questTribe(_ q: QuestNode) -> Tribe {
        if let boss = q.boss, let def = model.db.get(boss) { return def.tribe }
        let cycle: [Tribe] = [.orc, .dwarf, .elf, .neutral]
        return cycle[max(0, q.n - 1) % cycle.count]
    }

    /// `minionSprite`: minion number `seed` of a tribe.
    private func minionSprite(_ tribe: Tribe, seed: Int) -> String {
        let count = QuestScreen.minionCounts[tribe] ?? 7
        return "\(tribe.rawValue)-\((abs(seed) % count) + 1)"
    }

    /// `backdropFor`: the peaceful village for the first three sections of the main quest, burned otherwise.
    private func burned(_ q: QuestNode) -> Bool {
        line != "main" || (q.section ?? 1) >= 4
    }

    private func destroySound(_ tribe: Tribe) -> String {
        switch tribe {
        case .orc: return ["quest_enemy_destroy_orc_01", "quest_enemy_destroy_orc_02", "quest_enemy_destroy_orc_03", "quest_enemy_destroy_orc_04"].randomElement() ?? "quest_enemy_destroy_orc_01"
        case .dwarf: return ["quest_enemy_destroy_dwarf_01", "quest_enemy_destroy_dwarf_02", "quest_enemy_destroy_dwarf_03", "quest_enemy_destroy_dwarf_05"].randomElement() ?? "quest_enemy_destroy_dwarf_01"
        case .elf: return ["quest_enemy_destroy_elf_01", "quest_enemy_destroy_elf_02", "quest_enemy_destroy_elf_04", "quest_enemy_destroy_elf_05", "quest_enemy_destroy_elf_06"].randomElement() ?? "quest_enemy_destroy_elf_01"
        case .neutral: return ["quest_enemy_destroy_02", "quest_enemy_destroy_03", "quest_enemy_destroy_04", "quest_enemy_destroy_07"].randomElement() ?? "quest_enemy_destroy_02"
        }
    }

    // MARK: Layout

    private func content(state: GameState, quest q: QuestNode) -> some View {
        let tribe = questTribe(q)
        let active = state.quests.active
        let pct = QuestOps.questProgressPct(active)
        return VStack(spacing: 0) {
            QuestBarView(percent: pct)
                .padding(.top, 10).padding(.horizontal, 24).padding(.bottom, 8)
                .background(LinearGradient(colors: [Color(hex: 0x1f2224), Color(hex: 0x141617)], startPoint: .top, endPoint: .bottom))
                .overlay(Rectangle().frame(height: 4).foregroundColor(Theme.stoneEdge), alignment: .bottom)
            landscape(state: state, quest: q, tribe: tribe)
            tray(state: state, active: active)
                .frame(height: 150)
                .frame(maxWidth: .infinity)
                .background(StretchedSprite("ligaboard_top_bg"))
                .background(Color(hex: 0x1b1d1f))
                .shadow(color: .black.opacity(0.6), radius: 5, x: 0, y: 4)
        }
        .background(Color(hex: 0x0d0f10))
    }

    private func landscape(state: GameState, quest q: QuestNode, tribe: Tribe) -> some View {
        let dark = burned(q)
        return GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                Group {
                    Color(hex: 0x3b4a55)
                    Sprite(dark ? "village_burned_bg" : "village_normal_bg", contentMode: .fill)
                        .frame(width: geo.size.width, height: geo.size.height)
                        .clipped()
                    ParallaxLayer(name: "village_normal_eb2", width: 724, height: 766, x: -230, bottom: -8, drift: 14, dark: dark, container: geo.size)
                    ParallaxLayer(name: "village_normal_eb1", width: 710, height: 668, x: geo.size.width - 710 + 150, bottom: -4, drift: -14, dark: dark, container: geo.size)
                    if !dark { BirdsLayer() }
                    if line != "main" {
                        LinearGradient(colors: [Color(hex: 0x3c1450, alpha: 0.3), Color(hex: 0x140028, alpha: 0.15), Color(hex: 0x1e0032, alpha: 0.45)], startPoint: .top, endPoint: .bottom)
                    }
                }
                // minions
                ForEach(minions) { m in
                    MinionView(sprite: minionSprite(tribe, seed: n * 7 + m.wave * 3 + m.index), slot: QuestScreen.slots[m.slot], slain: m.slain, entering: m.entering)
                        .opacity(dropping ? 0 : 1)
                        .zIndex(Double(10 + Int(QuestScreen.slots[m.slot].y / 10)))
                        .onTapGesture { onTap(m) }
                }
                Text("\(lineDef?.name ?? "Quest") - \(q.sectionName.map { $0 + " " } ?? "")\(n)")
                    .font(Theme.font(22))
                    .foregroundColor(Theme.gold)
                    .padding(.vertical, 4).padding(.horizontal, 12)
                    .background(Color(hex: 0x0a0b0c, alpha: 0.8))
                    .overlay(NineSlice(Theme.Frames.smallWhite))
                    .offset(x: 14, y: 12)
                    .zIndex(30)
                // effects
                Group {
                    ForEach(slashes) { s in
                        SlashView(at: s.point, perfect: s.perfect).zIndex(45)
                    }
                    ForEach(tapNumbers) { t in
                        TapNumberView(text: t.text, burst: t.burst, lane: t.lane).zIndex(53)
                    }
                    if let b = burst {
                        BurstView(sprite: b.sprite, title: b.title).zIndex(50)
                    }
                    if coins {
                        CoinShowerView().zIndex(51)
                    }
                    if let d = drop {
                        DropView(fx: d, landscape: geo.size).zIndex(60)
                    }
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .clipped()
            .onAppear { landscapeSize = geo.size }
            .onChange(of: geo.size) { _, s in landscapeSize = s }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay(Rectangle().frame(height: 3).foregroundColor(Theme.stoneEdgeDark), alignment: .top)
        .overlay(Rectangle().frame(height: 3).foregroundColor(Theme.stoneEdgeDark), alignment: .bottom)
    }

    @ViewBuilder
    private func tray(state: GameState, active: ActiveQuest?) -> some View {
        if let a = active, a.bossReady {
            VStack(spacing: 6) {
                Text(Strings.allMinionsDefeated).font(Theme.font(26)).foregroundColor(Theme.gold).shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 2)
                SteelButton(Strings.bossFight, variant: .red, size: .lg) {
                    model.sfx("ui_button_start")
                    if !leaveClosedPortal() { model.router.replace(.bossIntro(line: line, n: n)) }
                }
                .frame(minWidth: 320)
            }
        } else {
            HStack(spacing: 14) {
                ForEach(0..<5, id: \.self) { i in
                    let locked = !StateOps.slotUnlocked(state, slot: i)
                    let inst = StateOps.deckCards(state)[i]
                    ZStack {
                        Color(hex: 0x0c0d0e)
                        StretchedSprite(locked ? "cardslotlocked" : "cardslot_simple").opacity(locked ? 0.7 : 1)
                        if let inst = inst, let def = model.db.get(inst.cardId) {
                            CardArt(def: def, stage: inst.stage)
                        }
                    }
                    .frame(width: 104, height: 104)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(inst != nil ? Color(hex: 0x6b5a3a) : Color(hex: 0x2e3236), lineWidth: 3))
                }
            }
            .background(FrameReader { f in minideckFrame = f })
        }
    }

    // MARK: Flow

    private func start() {
        if started { return }
        started = true
        guard let state = model.store.state else { return }
        guard quest != nil else {
            model.toast(Strings.noSuchQuest)
            model.router.back(fallback: .questMap())
            return
        }
        shownGold = state.player.gold
        if leaveClosedPortal() { return }
        let a = state.quests.active
        if !(a != nil && a!.line == line && a!.n == n) {
            let r: ActiveQuest? = model.update(toastOnError: false) { s, d, t in
                let r = try QuestOps.startQuest(s, deps: d, now: t, line: line, n: n)
                return (state: r.state, info: r.active)
            }
            if r == nil {
                model.toast(Strings.questLocked, icon: "lock_small")
                model.router.back(fallback: .questMap())
                return
            }
        }
        renderTray()
    }

    /// A portal quest whose portal has ended (or a portal below level 8) can't start or stay active.
    @discardableResult
    private func leaveClosedPortal() -> Bool {
        guard let state = model.store.state, let why = PortalGate.block(state, deps: model.deps, now: model.now, line: line) else { return false }
        if let a = state.quests.active, a.line == line {
            model.updateState { s, _, _ in QuestOps.leaveQuest(s) }
        }
        model.toast(why == .level ? Strings.portalsLocked : Strings.portalClosed, icon: "icon_map_active")
        model.router.goTop(.quest)
        return true
    }

    private func leave() {
        if let a = model.store.state?.quests.active, a.figuresDone == 0 && !a.bossReady {
            model.updateState { s, _, _ in QuestOps.leaveQuest(s) }
        }
        model.router.back(fallback: .questMap())
    }

    /// Sync the minions with the store (`renderTray`).
    private func renderTray() {
        guard let active = model.store.state?.quests.active else { return }
        if active.bossReady {
            minions = []
            return
        }
        let wave = active.waveIndex < active.waves.count ? active.waves[active.waveIndex] : []
        if active.waveIndex != shownWave {
            minions = []
            shownWave = active.waveIndex
            for (j, cardId) in wave.enumerated() where j >= active.waveDone {
                let m = MinionSprite(cardId: cardId ?? "", wave: active.waveIndex, index: j, slot: (j + active.waveIndex) % QuestScreen.slots.count)
                minions.append(m)
                if j == 0 { model.sfx(["quest_enemy_showup_01", "quest_enemy_showup_02", "quest_enemy_showup_03", "quest_enemy_showup_04"].randomElement() ?? "quest_enemy_showup_01") }
                let id = m.id
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: UInt64((QuestScreen.cardDrop.waveIn + 0.04) * 1_000_000_000))
                    if let i = minions.firstIndex(where: { $0.id == id }) { minions[i].entering = false }
                }
            }
        } else {
            let want = wave.count - active.waveDone
            while minions.count > want && !minions.isEmpty { minions.removeFirst() }
        }
    }

    private func onTap(_ m: MinionSprite) {
        if busy || m.slain { return }
        if leaveClosedPortal() { return }
        guard let q = quest else { return }
        busy = true
        let ev = model.event
        guard let info: TapResult = model.update({ s, d, t in
            let r = try QuestOps.tapMinion(s, deps: d, now: t, event: ev)
            return (state: r.state, info: r.info)
        }) else {
            busy = false
            return
        }
        if let np = info.needsPotion, np.needed {
            Task { @MainActor in
                let ok = await model.offerPotion(kind: .stamina, amount: q.staminaPerTap)
                busy = false
                if ok { onTap(m) }
            }
            return
        }
        model.sfx(destroySound(questTribe(q)))
        let slot = QuestScreen.slots[m.slot]
        let at = CGPoint(x: slot.x, y: slot.y - QuestScreen.minionH * slot.s * 0.55)
        if let i = minions.firstIndex(where: { $0.id == m.id }) {
            minions[i].slain = true
            let id = m.id
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: UInt64(QuestScreen.tapFx.vanish * 1_000_000_000))
                minions.removeAll { $0.id == id }
            }
        }
        tapFx(at: at, info: info)
        heldGold += max(0, info.burst)
        goldTap()
        let levelUps = !info.levelUpDetails.isEmpty
        if !levelUps && !info.waveCleared && info.soulCard == nil {
            busy = false
            return
        }
        Task { @MainActor in
            if levelUps {
                try? await Task.sleep(nanoseconds: 320_000_000)
                await model.showLevelUps(info.levelUpDetails)
            }
            if let soul = info.soulCard {
                await cardDrop(soul, at: at)
                renderTray()
            }
            if info.waveCleared {
                await waveEnd(info, at: at)
            } else {
                renderTray()
            }
            busy = false
        }
    }

    /// The end of a wave: the coin shower, the card drop (or a reward burst), then the next wave - or the boss.
    private func waveEnd(_ info: TapResult, at: CGPoint) async {
        let shower = Task { @MainActor in await coinShower() }
        if let reward = info.reward, reward.type != .none, reward.burst != true {
            if reward.type == .card {
                await cardDrop(reward, at: at)
            } else {
                burst = BurstFx(sprite: rewardSprite(reward), title: burstTitle(reward))
                model.toast(RewardOps.describeReward(reward, db: model.db), icon: burstIcon(reward))
                try? await Task.sleep(nanoseconds: 900_000_000)
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 700_000_000)
                    burst = nil
                }
            }
        }
        await shower.value
        renderTray()
        if info.bossReady {
            try? await Task.sleep(nanoseconds: 700_000_000)
            if !leaveClosedPortal() { model.router.replace(.bossIntro(line: line, n: n)) }
        }
    }

    // MARK: Effects (quest-fx.js)

    private func tapFx(at: CGPoint, info: TapResult) {
        let slash = SlashFx(point: at, perfect: info.perfect)
        slashes.append(slash)
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64((QuestScreen.tapFx.perfect + 0.06) * 1_000_000_000))
            slashes.removeAll { $0.id == slash.id }
        }
        var parts: [String] = []
        if info.tapGold > 0 { parts.append(fmtNumber(info.tapGold)) }
        if info.burst > 0 { parts.append(fmtNumber(info.burst)) }
        if !parts.isEmpty {
            let num = TapNumberFx(text: parts.joined(separator: " "), burst: info.burst > 0, lane: tapNumbers.count % 3)
            tapNumbers.append(num)
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: UInt64((QuestScreen.tapFx.number + 0.06) * 1_000_000_000))
                tapNumbers.removeAll { $0.id == num.id }
            }
        }
    }

    /// `goldSteps`: roughly even steps from `from` to `to`.
    private func goldSteps(_ from: Int, _ to: Int, _ n: Int) -> [Int] {
        if from == to { return [] }
        var out: [Int] = []
        for i in 1...max(1, n) {
            let v = i == n ? to : Int(JSMath.round(Double(from) + Double(to - from) * Double(i) / Double(n)))
            if out.last != v { out.append(v) }
        }
        return out
    }

    private var realGold: Int { model.store.state?.player.gold ?? 0 }

    /// After a tap: count the HUD up to the saved gold minus what the coin shower still holds.
    private func goldTap() {
        goldTask?.cancel()
        var steps = goldSteps(shownGold, realGold - heldGold, QuestScreen.tapGoldCount.steps)
        if steps.isEmpty { return }
        shownGold = steps.removeFirst()
        if steps.isEmpty { return }
        goldTask = Task { @MainActor in
            for v in steps {
                try? await Task.sleep(nanoseconds: UInt64(QuestScreen.tapGoldCount.stepMs) * 1_000_000)
                if Task.isCancelled { return }
                shownGold = v
            }
        }
    }

    /// Step the HUD gold up to the saved value (the coin shower).
    private func releaseGold() async {
        goldTask?.cancel()
        heldGold = 0
        for v in goldSteps(shownGold, realGold, QuestScreen.goldShower.steps) {
            shownGold = v
            try? await Task.sleep(nanoseconds: UInt64(QuestScreen.goldShower.stepMs) * 1_000_000)
        }
    }

    private func coinShower() async {
        if heldGold <= 0 { goldTap(); return }
        model.sfx("quest_reward_gold")
        coins = true
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(QuestScreen.goldShower.duration * 1_000_000_000))
            coins = false
        }
        try? await Task.sleep(nanoseconds: UInt64(QuestScreen.goldShower.duration * 0.25 * 1_000_000_000))
        await releaseGold()
    }

    /// The card drop on the scene: glint, white flash → the glowing card, hold, fly to the minideck.
    private func cardDrop(_ reward: Reward, at: CGPoint) async {
        guard let cardId = reward.cardId, let def = model.db.get(cardId) else { return }
        let face = CardFaceModel.fromDef(def, stage: reward.stage ?? 0, level: reward.level ?? 1, deps: model.deps)
        dropping = true
        drop = DropFx(face: face, glintAt: at, phase: .glint)
        try? await Task.sleep(nanoseconds: UInt64(QuestScreen.cardDrop.glint * 1_000_000_000))
        model.sfx("quest_reward_card")
        drop?.phase = .card
        if reward.converted == true {
            model.toast("\(def.name) - your collection is full, it was sold for \(fmtNumber(reward.gold ?? 0)) gold.", icon: "hud_coinsicon01")
        }
        try? await Task.sleep(nanoseconds: UInt64((QuestScreen.cardDrop.flash + QuestScreen.cardDrop.reveal + QuestScreen.cardDrop.hold) * 1_000_000_000))
        // fly into the minideck (its centre, relative to the landscape)
        let target = CGPoint(x: minideckFrame.midX, y: landscapeSize.height + 75)
        drop?.target = target
        withAnimation(.easeIn(duration: QuestScreen.cardDrop.fly)) { drop?.phase = .fly }
        try? await Task.sleep(nanoseconds: UInt64(QuestScreen.cardDrop.fly * 1_000_000_000))
        drop = nil
        dropping = false
    }

    private func rewardSprite(_ r: Reward) -> String {
        switch r.type {
        case .gold: return "reward_gold"
        case .gems: return "reward_gems"
        case .potion: return r.potion == .mana ? "reward_manapotion" : "reward_staminapotions"
        case .token:
            switch r.token ?? .neophyte {
            case .archmage, .portalHigh: return "reward_token_1"
            case .summoner: return "reward_token_2"
            default: return "reward_token_3"
            }
        default: return "reward_cardslots"
        }
    }

    private func burstTitle(_ r: Reward) -> String {
        switch r.type {
        case .gold: return "+\(fmtNumber(r.gold ?? 0)) gold"
        case .card: return Strings.aNewCard
        case .gems: return "+\(fmtNumber(r.gems ?? 0)) gems"
        case .potion: return Strings.aPotion
        case .token: return Strings.aBoosterToken
        default: return ""
        }
    }

    private func burstIcon(_ r: Reward) -> String {
        switch r.type {
        case .gold: return "hud_coinsicon01"
        case .card, .piece: return "icon_deckedit_active"
        case .gems: return "hud_gemiconsingle"
        case .potion: return r.potion == .mana ? "potion_mana2" : "potion_stamina2"
        case .token: return "token_small"
        default: return "hud_experienceicon01"
        }
    }
}

// MARK: - Pieces of the scene

struct MinionSprite: Identifiable {
    let id = UUID()
    let cardId: String
    let wave: Int
    let index: Int
    let slot: Int
    var slain: Bool = false
    var entering: Bool = true
}

struct SlashFx: Identifiable {
    let id = UUID()
    let point: CGPoint
    let perfect: Bool
}

struct TapNumberFx: Identifiable {
    let id = UUID()
    let text: String
    let burst: Bool
    let lane: Int
}

struct BurstFx {
    let sprite: String
    let title: String
}

struct DropFx {
    enum Phase { case glint, card, fly }
    let face: CardFaceModel
    let glintAt: CGPoint
    var phase: Phase
    var target: CGPoint = .zero
}

/// A minion cut-out at its slot: fades in from a dark silhouette, idles, goes black when slain.
struct MinionView: View {
    let sprite: String
    let slot: (x: CGFloat, y: CGFloat, s: CGFloat)
    let slain: Bool
    let entering: Bool
    @State private var idle: Bool = false

    var body: some View {
        let w = (QuestScreen.minionW * slot.s).rounded()
        let h = (QuestScreen.minionH * slot.s).rounded()
        ZStack(alignment: .bottom) {
            Ellipse()
                .fill(RadialGradient(colors: [Color.black.opacity(0.55), Color.clear], center: .center, startRadius: 0, endRadius: w * 0.4))
                .frame(width: w * 0.76, height: 22)
                .offset(y: 6)
                .opacity(slain ? 0 : 1)
            Sprite(sprite)
                .frame(width: w, height: h)
                .shadow(color: .black.opacity(0.55), radius: 6, x: 0, y: 6)
                .brightness(slain || entering ? -1 : 0)
                .opacity(slain ? 0.85 : 1)
                .offset(y: idle ? -3 : 0)
                .animation(.easeOut(duration: QuestScreen.cardDrop.waveIn), value: entering)
        }
        .frame(width: w, height: h, alignment: .bottom)
        .contentShape(Rectangle())
        .position(x: slot.x, y: slot.y - h / 2)
        .onAppear {
            withAnimation(.easeInOut(duration: 2.4).repeatForever(autoreverses: true)) { idle = true }
        }
    }
}

/// The two foreground pieces of the village, slowly drifting against the sky.
struct ParallaxLayer: View {
    let name: String
    let width: CGFloat
    let height: CGFloat
    let x: CGFloat
    let bottom: CGFloat
    let drift: CGFloat
    let dark: Bool
    let container: CGSize
    @State private var moved: Bool = false

    var body: some View {
        StretchedSprite(name)
            .frame(width: width, height: height)
            .mask(LinearGradient(stops: [.init(color: .black, location: 0), .init(color: .black, location: 0.7), .init(color: .clear, location: 0.86)], startPoint: .top, endPoint: .bottom))
            .brightness(dark ? -0.6 : 0)
            .saturation(dark ? 0.5 : 1)
            .offset(x: x + (moved ? drift : 0), y: container.height - height - bottom)
            .allowsHitTesting(false)
            .onAppear {
                withAnimation(.easeInOut(duration: 16).repeatForever(autoreverses: true)) { moved = true }
            }
    }
}

/// village_normal_birds crossing the sky.
struct BirdsLayer: View {
    @State private var fly: Bool = false

    var body: some View {
        Sprite("village_normal_birds")
            .frame(width: 150)
            .offset(x: fly ? 680 : -100, y: fly ? 60 : 150)
            .opacity(0.9)
            .allowsHitTesting(false)
            .onAppear {
                withAnimation(.linear(duration: 26).repeatForever(autoreverses: false)) { fly = true }
            }
    }
}

/// The tap's X-slash (two hud_explosion03 streaks over the hud_explosion01 sparks) with "PERFECT".
struct SlashView: View {
    let at: CGPoint
    let perfect: Bool
    @State private var shown: Bool = false
    @State private var gone: Bool = false

    var body: some View {
        ZStack {
            Sprite("hud_explosion01").frame(width: 260, height: 260).saturation(1.3)
            Sprite("hud_explosion03").frame(width: 300, height: 300).rotationEffect(.degrees(-38))
            Sprite("hud_explosion03").frame(width: 300, height: 300).rotationEffect(.degrees(52))
            if perfect {
                Text(Strings.perfect)
                    .font(Theme.font(46))
                    .foregroundColor(Theme.enhanceYellow)
                    .shadow(color: Color(hex: 0xff9614, alpha: 0.85), radius: 14)
                    .shadow(color: .black.opacity(0.9), radius: 1.5, x: 0, y: 3)
                    .offset(y: gone ? -136 : -120)
            }
        }
        .scaleEffect(shown ? (gone ? 1.15 : 1.05) : 0.4)
        .opacity(gone ? 0 : (shown ? 1 : 0))
        .position(at)
        .allowsHitTesting(false)
        .onAppear {
            withAnimation(.easeOut(duration: 0.07)) { shown = true }
            withAnimation(.easeOut(duration: 0.6).delay(0.3)) { gone = true }
        }
    }
}

/// The tap's gold as a small white number at the top right of the scene.
struct TapNumberView: View {
    let text: String
    let burst: Bool
    let lane: Int
    @State private var up: Bool = false
    @State private var gone: Bool = false

    var body: some View {
        Text(text)
            .font(Theme.font(burst ? 36 : 30))
            .foregroundColor(burst ? Color(hex: 0xfff4c0) : .white)
            .shadow(color: .black.opacity(0.9), radius: 1.5, x: 0, y: 2)
            .offset(y: gone ? -22 : (up ? 0 : 16))
            .opacity(gone ? 0 : 1)
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.trailing, 24 + CGFloat(lane) * 64)
            .padding(.top, 18)
            .allowsHitTesting(false)
            .onAppear {
                withAnimation(.easeOut(duration: 0.18)) { up = true }
                withAnimation(.easeIn(duration: 0.25).delay(QuestScreen.tapFx.number * 0.75)) { gone = true }
            }
    }
}

/// A reward burst in the landscape (reward_glow_yellow + reward sprite + caption).
struct BurstView: View {
    let sprite: String
    let title: String
    @State private var shown: Bool = false
    @State private var spin: Double = 0

    var body: some View {
        ZStack {
            Sprite("reward_glow_yellow").frame(width: 500, height: 500).rotationEffect(.degrees(spin))
            Sprite(sprite).frame(width: 300, height: 300).shadow(color: .black.opacity(0.6), radius: 10, x: 0, y: 8)
            Text(title)
                .font(Theme.font(42))
                .foregroundColor(Color(hex: 0xfff4c0))
                .shadow(color: Color(hex: 0xffaa14, alpha: 0.9), radius: 12)
                .shadow(color: .black.opacity(0.9), radius: 2, x: 0, y: 3)
                .offset(y: 200)
        }
        .scaleEffect(shown ? 1 : 0.4)
        .opacity(shown ? 1 : 0)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .offset(y: -40)
        .allowsHitTesting(false)
        .onAppear {
            withAnimation(.spring(response: 0.35, dampingFraction: 0.6)) { shown = true }
            withAnimation(.linear(duration: 9).repeatForever(autoreverses: false)) { spin = 360 }
        }
    }
}

/// The wave-end coin shower (a tumble of coins over the scene).
struct CoinShowerView: View {
    @State private var fall: Bool = false

    var body: some View {
        ZStack {
            ForEach(0..<14, id: \.self) { i in
                Sprite("hud_coinsicon01")
                    .frame(width: 44, height: 44)
                    .rotationEffect(.degrees(fall ? Double(i * 97) : 0))
                    .offset(x: CGFloat(-240 + (i * 37) % 480), y: fall ? 520 : -160 - CGFloat((i * 53) % 200))
                    .opacity(fall ? 0 : 1)
                    .animation(.easeIn(duration: 1.1).delay(Double(i) * 0.05), value: fall)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .allowsHitTesting(false)
        .onAppear { fall = true }
    }
}

/// The card drop on the scene: glint, flash → glowing card, flight to the minideck.
struct DropView: View {
    let fx: DropFx
    let landscape: CGSize
    @State private var glint: Bool = false
    @State private var rays: Bool = false

    var body: some View {
        let centre = CGPoint(x: landscape.width / 2, y: landscape.height * 0.48)
        ZStack {
            if fx.phase == .glint {
                Sprite("lens_flare")
                    .frame(width: 150, height: 150)
                    .scaleEffect(glint ? 1.4 : 0.3)
                    .rotationEffect(.degrees(glint ? 70 : 0))
                    .opacity(glint ? 0.3 : 1)
                    .position(fx.glintAt)
                    .onAppear { withAnimation(.easeInOut(duration: QuestScreen.cardDrop.glint)) { glint = true } }
            } else {
                ZStack {
                    Sprite("newcardglow")
                        .frame(width: 340, height: 440)
                        .opacity(fx.phase == .fly ? 0 : (rays ? 1 : 0.7))
                        .scaleEffect(rays ? 1.05 : 0.96)
                    ZStack {
                        Color.black
                        CardArt(def: fx.face.def, stage: fx.face.stage)
                    }
                    .frame(width: 230, height: 324)
                    .cornerRadius(6)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.rarity(fx.face.rarity), lineWidth: 7))
                    .shadow(color: Color(hex: 0xfff6d2, alpha: 0.85), radius: 24)
                    Sprite("glowingcard").frame(width: 258, height: 352).opacity(fx.phase == .card && !rays ? 1 : 0)
                }
                .scaleEffect(fx.phase == .fly ? 0.36 : 1)
                .opacity(fx.phase == .fly ? 0.6 : 1)
                .position(fx.phase == .fly ? fx.target : centre)
                .onAppear {
                    withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true).delay(QuestScreen.cardDrop.reveal)) { rays = true }
                }
            }
        }
        .allowsHitTesting(false)
    }
}
