import SwiftUI
import EvokerCore

/// The post-battle flow (port of `src/ui/screens/battle-result.js`, the 1.7.4 client's DECISIONS D5):
///  1. the fx_wonlost banner (hud_victory / hud_defeat / hud_drawd zooming 3x → 1x, blur echo, fx_glow03/04)
///     over the frozen battlefield, 3.66 s or a tap;
///  2. the loot (quests: victory only, PvP: any gold) with the client's keyframe animation at speed 1.2
///     (goldreward / gemreward / manapotion / staminapotion / cardreward with the card in its template slot),
///     the quest_reward_* sounds, gold and gems flying to the purse as a number, a card shown full size until
///     tapped (a piece: with its puzzle overlay for 1.5 s), "Card added to set: X n/8" for a card new to its set;
///  3. the deck's card XP in a zigzag with the violet "Level n" bars, one card per second, a level-up opening
///     the full-art "Level up!" popup;
///  4. Continue (quests) / Proceed (PvP) on the stripe, then `onDone` (the player level-up dialogs are shown by
///     `AppModel.battleFinished`).
/// Everything is laid out in the web's 720-wide stage space, scaled to the view.
struct BattleResultView: View {
    let presentation: BattlePresentation
    let onDone: () -> Void
    @EnvironmentObject var model: AppModel
    @StateObject private var flow = BattleResultFlow()

    var body: some View {
        GeometryReader { geo in
            let scale = BattleLayout.scale(forViewWidth: max(1, geo.size.width))
            let layout = BattleLayout(size: CGSize(width: BattleLayout.stageWidth, height: geo.size.height / scale),
                                      safeTop: geo.safeAreaInsets.top / scale, safeBottom: geo.safeAreaInsets.bottom / scale, top: .defender)
            ZStack(alignment: .topLeading) {
                ResultCanvas(flow: flow, layout: layout, presentation: presentation)
                    .frame(width: BattleLayout.stageWidth, height: layout.size.height, alignment: .topLeading)
                    .scaleEffect(scale, anchor: .topLeading)
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
            .contentShape(Rectangle())
            .onTapGesture { flow.tap() }
        }
        .ignoresSafeArea()
        .onAppear { flow.start(presentation: presentation, model: model, onDone: onDone) }
        .onDisappear { flow.destroy() }
    }
}

// MARK: - Flow (state machine, main actor)

/// Waits for a tap or a timeout (the `onTap` promises of battle-result.js).
@MainActor
final class TapGate {
    private var continuation: CheckedContinuation<Bool, Never>?
    private var generation = 0
    private var acceptAfter = Date.distantPast

    /// true = tapped, false = timed out / cancelled. Taps before `minTapMs` are ignored.
    func wait(timeoutMs: Double?, minTapMs: Double = 0) async -> Bool {
        generation += 1
        let gen = generation
        acceptAfter = Date().addingTimeInterval(minTapMs / 1000)
        return await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
            continuation = c
            if let ms = timeoutMs {
                Task { [weak self] in
                    try? await Task.sleep(nanoseconds: UInt64(max(0, ms) * 1_000_000))
                    self?.fire(tapped: false, generation: gen, checkMin: false)
                }
            }
        }
    }

    func tap() { fire(tapped: true, generation: generation, checkMin: true) }
    func cancel() { fire(tapped: false, generation: generation, checkMin: false) }

    private func fire(tapped: Bool, generation gen: Int, checkMin: Bool) {
        guard gen == generation, let c = continuation else { return }
        if checkMin && Date() < acceptAfter { return }
        continuation = nil
        c.resume(returning: tapped)
    }
}

/// The reward card drawn in the animation's template slot and shown full size afterwards.
struct RewardCardInfo {
    let def: CardDef
    let stage: Int
    let level: Int
    let piece: Bool
}

struct LootStage {
    let item: LootItem
    let anim: ClientAnimation?
    let segments: [[String: [ClientAnimation.Segment]]]
    let start: Date
    var frozenAt: Double?
    let icon: String?
    let portalToken: TokenKind?
    let caption: String?
    let card: RewardCardInfo?
    var taken = false
    var fading = false
    var fly: FlyAmount?
}

struct FlyAmount {
    let text: String
    let gems: Bool
    let start: Date
}

struct FullCardStage {
    let card: RewardCardInfo
    let pieces: BattleResultModel.PieceProgress?
    var closing = false
}

struct SetPlateStage {
    let name: String
    let owned: Int
    let total: Int
    let start: Date
}

struct XpRow: Identifiable {
    let id: String
    let entry: BattleResultModel.XpEntry
    let def: CardDef?
    let stats: CardStats?
    let evolveQuality: Double
    var shown = false
    var instant = false
    var bar: BattleResultModel.XpBar
    var barMs: Double = 0
}

struct LevelUpStage {
    let def: CardDef
    let stage: Int
    let name: String
    let rows: [BattleResultModel.LevelUpRow]
    let start: Date
    var closing = false
}

@MainActor
final class BattleResultFlow: ObservableObject {
    enum Phase { case banner, loot, card, xp, cont, levelup, done }

    @Published var phase: Phase = .banner
    @Published var kind: BattleResultKind = .draw
    @Published var pvp = false
    @Published var bannerStart = Date()
    @Published var bannerVisible = false
    @Published var bannerFading = false
    @Published var screenShown = false
    @Published var loot: LootStage?
    @Published var fullCard: FullCardStage?
    @Published var setPlate: SetPlateStage?
    @Published var xpRows: [XpRow] = []
    @Published var levelUp: LevelUpStage?
    @Published var continueShown = false

    private var presentation: BattlePresentation?
    private var deps: Deps?
    private weak var store: GameStore?
    private weak var audio: AudioPlaying?
    private var assets: AssetCatalog?
    private var onDone: (() -> Void)?
    private let gate = TapGate()
    private var continueGate: CheckedContinuation<Void, Never>?
    private var tapHandler: (() -> Void)?
    private var started = false
    private var destroyed = false
    private var finished = false
    private var task: Task<Void, Never>?

    func start(presentation p: BattlePresentation, model: AppModel, onDone: @escaping () -> Void) {
        guard !started else { return }
        started = true
        presentation = p
        deps = model.store.deps
        store = model.store
        audio = model.audio
        assets = model.assets
        self.onDone = onDone
        kind = p.resultKind
        pvp = p.isPvp
        task = Task { [weak self] in await self?.flow() }
    }

    func destroy() {
        destroyed = true
        task?.cancel()
        gate.cancel()
        tapHandler = nil
        if let c = continueGate { continueGate = nil; c.resume() }
    }

    /// A tap anywhere on the overlay.
    func tap() {
        if let h = tapHandler { h(); return }
        gate.tap()
    }

    /// The Continue / Proceed button.
    func pressContinue() {
        guard phase == .cont, let c = continueGate else { return }
        continueGate = nil
        audio?.sfx(BattleSounds.startClick)
        c.resume()
    }

    private func sfx(_ name: String?) {
        if let n = name { audio?.sfx(n) }
    }

    private func sleep(_ ms: Double) async {
        try? await Task.sleep(nanoseconds: UInt64(max(1, ms) * 1_000_000))
    }

    /// Sleep that ends early once `cond()` turns true (polled).
    private func sleepUnless(_ ms: Double, _ cond: () -> Bool) async {
        let end = Date().addingTimeInterval(ms / 1000)
        while !destroyed && !cond() && Date() < end {
            let left = end.timeIntervalSinceNow * 1000
            await sleep(min(50, max(1, left)))
        }
    }

    // MARK: the flow

    private func flow() async {
        guard let p = presentation, let deps = deps else { finish(); return }
        await banner()
        if destroyed { return }
        // quests reward only a victory (the fight info carries no reward otherwise); PvP shows its gold either way
        let rewards = (kind == .victory || pvp) ? BattleResultModel.lootList(p) : []
        let state = store?.state
        var before = p.deckBefore
        if before.isEmpty, let s = state, p.mode != .replay, p.mode != .lab {
            before = BattleResultModel.reconstructedDeckBefore(state: s, deps: deps, cardXp: p.cardXp, levelUps: p.cardLevelUps)
        }
        let hasXp = !before.isEmpty
        if rewards.isEmpty && !hasXp { finish(); return }
        withAnimation(.linear(duration: 0.5)) { screenShown = true }
        for r in rewards {
            await lootStep(r)
            if destroyed { return }
        }
        if hasXp { await cardXp(before: before, state: state, deps: deps) }
        if destroyed { return }
        await showContinue()
        if destroyed { return }
        finish()
    }

    private func banner() async {
        phase = .banner
        bannerStart = Date()
        bannerVisible = true
        _ = await gate.wait(timeoutMs: BattleResultTiming.bannerMs)
        withAnimation(.linear(duration: 0.3)) { bannerFading = true }
        Task { [weak self] in
            await self?.sleep(400)
            self?.bannerVisible = false
        }
    }

    private func lootStep(_ item: LootItem) async {
        guard let assets = assets else { return }
        let reward = item.reward
        let animName = BattleResultModel.rewardAnimName(reward)
        let anim = animName.flatMap { ClientAnimation.load($0, assets: assets) }
        phase = .loot
        let snd = BattleResultModel.rewardSounds(reward)
        var cardInfo: RewardCardInfo? = nil
        if reward.type == .card || reward.type == .piece, let id = reward.cardId, let def = deps?.db.get(id) {
            cardInfo = RewardCardInfo(def: def, stage: reward.stage ?? 0, level: reward.level ?? 1, piece: reward.type == .piece)
        }
        sfx(snd.show)
        setPlate = makeSetPlate(reward)
        let portal = (reward.type == .token && (reward.token?.isPortal ?? false)) ? reward.token : nil
        var caption: String? = nil
        if reward.type == .token {
            let count = (reward.count ?? 1) > 1 ? "\(reward.count ?? 1) x " : ""
            caption = count + BattleResultModel.tokenName(reward, deps: deps)
        }
        loot = LootStage(item: item, anim: anim, segments: anim?.segments() ?? [], start: Date(), frozenAt: nil,
                         icon: BattleResultModel.rewardIcon(reward), portalToken: portal, caption: caption, card: cardInfo)
        let duration = (anim?.durationMs ?? 2600) / BattleResultTiming.rewardSpeed
        let tapped = await gate.wait(timeoutMs: duration, minTapMs: BattleResultTiming.rewardTapAfterMs)
        if destroyed { return }
        if tapped, let a = anim { loot?.frozenAt = a.durationMs }
        sfx(snd.taken)
        withAnimation(.easeOut(duration: 0.5)) { loot?.taken = true }
        if reward.type == .gold || reward.type == .gems || (reward.type == .card && reward.converted == true) {
            let amount = reward.type == .gems ? (reward.gems ?? 0) : (reward.gold ?? 0)
            if amount > 0 {
                loot?.fly = FlyAmount(text: "+\(BattleResultModel.fmt(amount))", gems: reward.type == .gems, start: Date())
                await sleep(800)
            }
        } else if let info = cardInfo {
            await fullCardStep(info, reward: reward)
        }
        withAnimation(.linear(duration: 0.3)) { loot?.fading = true }
        await sleep(300)
        loot = nil
    }

    /// The reward card full size (comp_cardfullscreen_v3) until tapped; a card piece with its puzzle overlay for
    /// PIECE_CARD_MS or until tapped.
    private func fullCardStep(_ info: RewardCardInfo, reward: Reward) async {
        phase = .card
        let pieces: BattleResultModel.PieceProgress? = (reward.type == .piece && reward.completed != true) ? BattleResultModel.pieceProgress(state: store?.state, reward: reward) : nil
        fullCard = FullCardStage(card: info, pieces: pieces)
        _ = await gate.wait(timeoutMs: pieces != nil ? BattleResultTiming.pieceCardMs : nil)
        if destroyed { return }
        withAnimation(.easeIn(duration: 0.25)) { fullCard?.closing = true }
        await sleep(250)
        fullCard = nil
    }

    /// "Card added to set: X n/8" (new_card_notify_comp) for a card new to its collection set.
    private func makeSetPlate(_ reward: Reward) -> SetPlateStage? {
        guard reward.type == .card, reward.converted != true, let id = reward.cardId, let state = store?.state, let deps = deps else { return nil }
        guard state.cards.filter({ $0.cardId == id }).count == 1 else { return nil }
        guard let sa = ShopOps.setProgressFor(state, deps: deps, cardId: id), sa.total > 0 else { return nil }
        let plate = SetPlateStage(name: sa.name, owned: sa.owned, total: sa.total, start: Date())
        Task { [weak self] in
            await self?.sleep(BattleResultTiming.setPlateIn + BattleResultTiming.setPlateHold + BattleResultTiming.setPlateOut + 100)
            self?.setPlate = nil
        }
        return plate
    }

    private func cardXp(before: [DeckCardSnapshot], state: GameState?, deps: Deps) async {
        guard let p = presentation else { return }
        let entries = BattleResultModel.xpEntries(before: before, state: state, deps: deps, levelUps: p.cardLevelUps)
        if entries.isEmpty { return }
        phase = .xp
        var rows: [XpRow] = []
        for e in entries.prefix(5) {
            let def = deps.db.get(e.cardId)
            let inst = state?.cards.first { $0.uid == e.uid }
            let q = inst?.evolveQuality ?? 1
            let stats = def.map { deps.stats.statsAt($0, stage: e.stage, level: e.from.level, evolveQuality: q) }
            rows.append(XpRow(id: e.uid, entry: e, def: def, stats: stats, evolveQuality: q, bar: e.from))
        }
        xpRows = rows
        var skip = false
        tapHandler = { skip = true }
        for i in rows.indices {
            if !skip {
                if i > 0 { await sleepUnless(BattleResultTiming.xpStaggerMs - BattleResultTiming.xpFadeMs) { skip } }
                sfx(BattleSounds.cardXpGain[i % 3])
                withAnimation(.linear(duration: BattleResultTiming.xpFadeMs / 1000)) { xpRows[i].shown = true }
                await sleepUnless(BattleResultTiming.xpFadeMs) { skip }
            } else {
                xpRows[i].shown = true
                xpRows[i].instant = true
            }
            if destroyed { return }
            xpRows[i].barMs = skip ? 0 : BattleResultTiming.xpBarMs
            xpRows[i].bar = rows[i].entry.to
            if rows[i].entry.levelled {
                tapHandler = nil
                await sleep(skip ? 50 : BattleResultTiming.xpBarMs + 50)
                await showCardLevelUp(rows[i], deps: deps)
                if destroyed { return }
                skip = false
                tapHandler = { skip = true }
            }
        }
        tapHandler = nil
    }

    /// Card level-up popup (comp_levelup_card): any tap fades it out.
    private func showCardLevelUp(_ row: XpRow, deps: Deps) async {
        guard let def = row.def else { return }
        let e = row.entry
        let rows = BattleResultModel.levelUpRows(deps: deps, cardId: e.cardId, stage: e.stage, evolveQuality: row.evolveQuality, from: e.from.level, to: e.to.level)
        levelUp = LevelUpStage(def: def, stage: e.stage, name: e.name, rows: rows, start: Date())
        sfx(BattleSounds.cardLevelUp)
        _ = await gate.wait(timeoutMs: nil)
        if destroyed { return }
        sfx(BattleSounds.cardClose)
        withAnimation(.linear(duration: 0.5)) { levelUp?.closing = true }
        await sleep(500)
        levelUp = nil
    }

    private func showContinue() async {
        phase = .cont
        withAnimation(.linear(duration: 0.5)) { continueShown = true }
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            continueGate = c
        }
    }

    private func finish() {
        guard !finished, !destroyed else { return }
        finished = true
        phase = .levelup
        onDone?()
    }
}

// MARK: - Views

/// The 720-wide stage canvas of the result overlay.
private struct ResultCanvas: View {
    @ObservedObject var flow: BattleResultFlow
    let layout: BattleLayout
    let presentation: BattlePresentation
    @EnvironmentObject var model: AppModel

    private var oy: CGFloat { layout.offsetY }

    var body: some View {
        ZStack(alignment: .topLeading) {
            if flow.phase != .banner || flow.screenShown {
                resultScreen
                    .opacity(flow.screenShown ? 1 : 0)
            }
            if flow.bannerVisible {
                WonLostBanner(kind: flow.kind, start: flow.bannerStart, centerY: oy + 600)
                    .opacity(flow.bannerFading ? 0 : 1)
            }
            if let lu = flow.levelUp {
                CardLevelUpView(stage: lu, offsetY: oy)
                    .opacity(lu.closing ? 0 : 1)
                    .zIndex(5)
            }
        }
    }

    private var resultScreen: some View {
        ZStack(alignment: .topLeading) {
            // the quest's landscape (PvP: the arena painting), 10 % overscan, under a 50 % black
            CatalogSprite(name: flow.pvp ? "arena" : "village_normal_bg", fallback: Color(uiColor: BattleColors.hex(0x1a2a1a)))
                .aspectRatio(contentMode: .fill)
                .frame(width: BattleLayout.stageWidth + 128, height: layout.size.height + 128)
                .clipped()
                .position(x: BattleLayout.stageWidth / 2, y: layout.size.height / 2)
            Color.black.opacity(0.5)
                .frame(width: BattleLayout.stageWidth, height: layout.size.height)
            // card XP entries
            ForEach(flow.xpRows) { row in
                XpEntryView(row: row, position: BattleResultModel.entryLayout(flow.xpRows.firstIndex(where: { $0.id == row.id }) ?? 0), offsetY: oy)
                    .opacity(row.shown ? 1 : 0)
            }
            // the stripe with Continue / Proceed
            stripe
            // loot
            if let l = flow.loot {
                LootLayer(stage: l, centerY: oy + 640, assets: model.assets)
                    .opacity(l.fading ? 0 : 1)
            }
            if let plate = flow.setPlate {
                SetPlateView(stage: plate, offsetY: oy)
                    .zIndex(3)
            }
            if let fc = flow.fullCard {
                FullCardView(stage: fc, layout: layout)
                    .zIndex(2)
            }
        }
    }

    private var stripe: some View {
        ZStack {
            CatalogSprite(name: "seperator_big", fallback: Color(uiColor: BattleColors.stone))
                .frame(width: BattleLayout.stageWidth + 180, height: 61)
            Button(action: { flow.pressContinue() }) {
                ZStack {
                    CatalogSprite(name: flow.pvp ? "hud_bigbutton03_fill" : "hud_bigbutton04_fill", fallback: Color(uiColor: BattleColors.hex(0x2d7a24)))
                    CatalogSprite(name: flow.pvp ? "hud_bigbutton03_frame" : "hud_bigbutton04_frame", fallback: Color.clear)
                    Text(flow.pvp ? "Proceed" : "Continue")
                        .font(.custom(model.assets.fontName(.bold), size: 32))
                        .foregroundColor(Color(uiColor: BattleColors.hex(0xf4f1ea)))
                        .shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 2)
                        .padding(.bottom, 4)
                }
                .frame(width: 304, height: 86)
            }
            .buttonStyle(.plain)
            .disabled(!flow.continueShown)
        }
        .shadow(color: .black.opacity(0.6), radius: 6, x: 0, y: 3)
        .position(x: BattleLayout.stageWidth / 2, y: oy + 1204 + 30)
        .opacity(flow.continueShown ? 1 : 0)
        .allowsHitTesting(flow.continueShown)
    }
}

/// fx_wonlost: the banner zooms 3x → 1x over 900 ms, a blurred copy flashes out (x4, 1.2 s), the banner fades
/// over 2.1 s; fx_glow03 / 04 expand from 660 ms for 3 s (from a dot on a victory, from 3x otherwise).
private struct WonLostBanner: View {
    let kind: BattleResultKind
    let start: Date
    let centerY: CGFloat
    @EnvironmentObject var model: AppModel

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60.0)) { context in
            let t = context.date.timeIntervalSince(start) * 1000
            let glowTotal = BattleResultTiming.bannerGlowStart + BattleResultTiming.bannerGlow
            let tg = max(0, min(1, t / glowTotal))
            let g0: CGFloat = kind == .victory ? 0.01 : 3
            let glowScale: CGFloat = tg < 0.18 ? g0 : g0 + (6 - g0) * CGFloat((tg - 0.18) / 0.82)
            let glowAlpha: Double = tg < 0.18 ? 1 : 1 - (tg - 0.18) / 0.82
            let centerTotal = BattleResultTiming.bannerZoom + BattleResultTiming.bannerFade
            let tc = max(0, min(1, t / centerTotal))
            let centerScale: CGFloat = tc < 0.3 ? 3 - 2 * CGFloat(tc / 0.3) : 1
            let centerAlpha: Double = tc < 0.3 ? tc / 0.3 : 1 - (tc - 0.3) / 0.7
            let tb = (t - BattleResultTiming.bannerZoom) / BattleResultTiming.bannerBlur
            let blurOn = tb >= 0 && tb <= 1
            let blurScale: CGFloat = 1 + 3 * CGFloat(max(0, min(1, tb)))
            let blurAlpha: Double = blurOn ? 0.7 * (1 - tb) : 0
            let imgWidth: CGFloat = kind == .victory ? 634 : 562
            ZStack {
                CatalogSprite(name: "fx_glow04", fallback: Color.clear)
                    .frame(width: 279, height: 279)
                    .scaleEffect(glowScale)
                    .opacity(glowAlpha)
                    .blendMode(.screen)
                CatalogSprite(name: "fx_glow03", fallback: Color.clear)
                    .frame(width: 279, height: 279)
                    .scaleEffect(glowScale)
                    .opacity(glowAlpha)
                    .blendMode(.screen)
                bannerImage(width: imgWidth)
                    .scaleEffect(centerScale)
                    .opacity(centerAlpha)
                bannerImage(width: imgWidth)
                    .blur(radius: 3)
                    .scaleEffect(blurScale)
                    .opacity(blurAlpha)
            }
            .position(x: BattleLayout.stageWidth / 2, y: centerY)
        }
        .allowsHitTesting(false)
    }

    private func bannerImage(width: CGFloat) -> some View {
        Group {
            if let img = model.assets.image(kind.bannerSprite) {
                Image(uiImage: img).resizable().aspectRatio(contentMode: .fit)
            } else {
                Text(kind.title)
                    .font(.custom(model.assets.fontName(.thin), size: 120))
                    .foregroundColor(kind == .victory ? Color(uiColor: BattleColors.hex(0xffcf35)) : Color.white)
                    .shadow(color: .black, radius: 4, x: 0, y: 4)
            }
        }
        .frame(width: width, height: 562)
    }
}

/// The loot step: the keyframe animation, the reward object, the token caption, the flying amount.
private struct LootLayer: View {
    let stage: LootStage
    let centerY: CGFloat
    let assets: AssetCatalog
    @EnvironmentObject var model: AppModel

    var body: some View {
        ZStack(alignment: .topLeading) {
            if let anim = stage.anim {
                ClientAnimationPlayer(anim: anim, segments: stage.segments, start: stage.start, speed: BattleResultTiming.rewardSpeed, frozenAt: stage.frozenAt, assets: assets, template: templateView)
                    .position(x: BattleResultTiming.cx, y: centerY)
            } else if let card = stage.card {
                RewardCardView(info: card, assets: assets)
                    .frame(width: 451 * 0.444, height: 640 * 0.444)
                    .position(x: BattleResultTiming.cx, y: centerY)
            }
            if let icon = stage.icon {
                CatalogSprite(name: icon, fallback: Color(uiColor: BattleColors.hex(0xffcf35)))
                    .frame(width: 288, height: 288)
                    .scaleEffect(stage.taken ? 0.001 : 1)
                    .position(x: BattleResultTiming.cx, y: centerY)
                    .transition(.scale)
            } else if let kind = stage.portalToken {
                PortalTokenTriangle(high: kind == .portalHigh)
                    .frame(width: 288, height: 288)
                    .scaleEffect(stage.taken ? 0.001 : 1)
                    .position(x: BattleResultTiming.cx, y: centerY)
            }
            if let caption = stage.caption {
                Text(caption)
                    .font(.custom(model.assets.fontName(.bold), size: 34))
                    .foregroundColor(Color(uiColor: BattleColors.hex(0xf4f1ea)))
                    .shadow(color: .black, radius: 2, x: 0, y: 2)
                    .frame(width: BattleLayout.stageWidth)
                    .position(x: BattleResultTiming.cx, y: centerY + 170 + 20)
            }
            if let fly = stage.fly {
                FlyAmountView(fly: fly, centerY: centerY)
            }
        }
        .allowsHitTesting(false)
    }

    private var templateView: AnyView? {
        guard let card = stage.card else { return nil }
        return AnyView(RewardCardView(info: card, assets: assets))
    }
}

/// The reward card inside the animation's template slot (`.reward-card`): art with the rarity frame, "NEW" (a
/// piece: the art darkened under card_piece_overlay_thumb).
private struct RewardCardView: View {
    let info: RewardCardInfo
    let assets: AssetCatalog

    var body: some View {
        ZStack {
            Image(uiImage: assets.cardArt(info.def, stage: info.stage))
                .resizable()
                .aspectRatio(contentMode: .fill)
                .brightness(info.piece ? -0.25 : 0)
                .saturation(info.piece ? 0.8 : 1)
            if info.piece {
                if let overlay = assets.image("card_piece_overlay_thumb") {
                    Image(uiImage: overlay).resizable()
                }
            } else {
                VStack {
                    Spacer()
                    Text("NEW")
                        .font(.custom(assets.fontName(.bold), size: 90))
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .background(Color(uiColor: BattleColors.hex(0xc81e14)).opacity(0.9))
                        .padding(.bottom, 64)
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 22))
        .overlay(RoundedRectangle(cornerRadius: 22).stroke(Color(uiColor: BattleColors.rarity(info.def.rarity)), lineWidth: 10))
        .shadow(color: Color(uiColor: BattleColors.hex(0xfff0c8)).opacity(0.8), radius: 20)
    }
}

/// A portal token (no client sprite): the shop's triangle, sand (low) or violet (high), glowing.
private struct PortalTokenTriangle: View {
    let high: Bool

    var body: some View {
        ZStack {
            CatalogSprite(name: "parks", fallback: Color.clear)
                .shadow(color: high ? Color(uiColor: BattleColors.hex(0xd696ff)) : Color(uiColor: BattleColors.hex(0xffecaa)), radius: 18)
            Triangle()
                .fill(LinearGradient(colors: high ? [Color(uiColor: BattleColors.hex(0xf1d5ff)), Color(uiColor: BattleColors.hex(0xa04fd6)), Color(uiColor: BattleColors.hex(0x4b1670))]
                                                 : [Color(uiColor: BattleColors.hex(0xfff4dc)), Color(uiColor: BattleColors.hex(0xd8b98a)), Color(uiColor: BattleColors.hex(0x8a6a3e))],
                                     startPoint: .topLeading, endPoint: .bottomTrailing))
                .frame(width: 150, height: 150)
            Triangle()
                .fill(high ? Color.white : Color(uiColor: BattleColors.hex(0x3b2a16)))
                .frame(width: 48, height: 50)
                .offset(y: 20)
        }
    }

    private struct Triangle: Shape {
        func path(in rect: CGRect) -> Path {
            var p = Path()
            p.move(to: CGPoint(x: rect.midX, y: rect.minY + rect.height * 0.04))
            p.addLine(to: CGPoint(x: rect.maxX - rect.width * 0.03, y: rect.maxY - rect.height * 0.08))
            p.addLine(to: CGPoint(x: rect.minX + rect.width * 0.03, y: rect.maxY - rect.height * 0.08))
            p.closeSubpath()
            return p
        }
    }
}

/// The amount flying to the purse (`rewardFly`): pops at the centre, flies up-right (170, -560) shrinking.
private struct FlyAmountView: View {
    let fly: FlyAmount
    let centerY: CGFloat
    @EnvironmentObject var model: AppModel

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60.0)) { context in
            let t = max(0, min(1, context.date.timeIntervalSince(fly.start) * 1000 / 800))
            let k = t * t   // ease-in
            let scale: CGFloat = t < 0.2 ? CGFloat(t / 0.2) : (t < 0.81 ? 1 - 0.4 * CGFloat((t - 0.2) / 0.61) : 0.6 - 0.1 * CGFloat((t - 0.81) / 0.19))
            let alpha: Double = t < 0.2 ? 0.3 + 0.7 * (t / 0.2) : (t < 0.81 ? 1 : 1 - (t - 0.81) / 0.19)
            let dx: CGFloat = t < 0.2 ? 0 : 170 * CGFloat(min(1, (k - 0.04) / 0.62))
            let dy: CGFloat = t < 0.2 ? 0 : -560 * CGFloat(min(1, (k - 0.04) / 0.62)) - (t > 0.81 ? 20 : 0)
            Text(fly.text)
                .font(.custom(model.assets.fontName(.bold), size: 72))
                .foregroundColor(fly.gems ? Color(uiColor: BattleColors.hex(0x8fe3ff)) : Color(uiColor: BattleColors.hex(0xffd556)))
                .shadow(color: .black, radius: 2, x: 0, y: 2)
                .scaleEffect(max(0.001, scale))
                .opacity(alpha)
                .position(x: BattleResultTiming.cx + dx, y: centerY + dy)
        }
    }
}

/// "Card added to set: X n/8" (new_card_notify_comp): slides in from the left, waits 3 s, slides out; the bar
/// fills from the count before this card to the new count once the plate is in.
private struct SetPlateView: View {
    let stage: SetPlateStage
    let offsetY: CGFloat
    @EnvironmentObject var model: AppModel

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60.0)) { context in
            let t = context.date.timeIntervalSince(stage.start) * 1000
            let total = BattleResultTiming.setPlateIn + BattleResultTiming.setPlateHold + BattleResultTiming.setPlateOut
            let x = slideX(t)
            let fillFrom = Double(max(0, stage.owned - 1)) / Double(max(1, stage.total))
            let fillTo = Double(stage.owned) / Double(max(1, stage.total))
            let fk = max(0, min(1, (t - BattleResultTiming.setPlateIn) / 1200))
            let fill = fillFrom + (fillTo - fillFrom) * easeInOutExpo(fk)
            let count = t >= BattleResultTiming.setPlateIn ? "\(stage.owned)/\(stage.total)" : "\(max(0, stage.owned - 1))/\(stage.total)"
            VStack(alignment: .leading, spacing: 4) {
                Text("Card added to set:")
                    .font(.custom(model.assets.fontName(.bold), size: 24))
                    .foregroundColor(Color(uiColor: BattleColors.headline))
                Text(stage.name)
                    .font(.custom(model.assets.fontName(.bold), size: 30))
                    .foregroundColor(Color(uiColor: BattleColors.hex(0x8cf8d2)))
                ZStack(alignment: .leading) {
                    Rectangle().fill(Color.black.opacity(0.7))
                    Rectangle().fill(Color(uiColor: BattleColors.hex(0xff8232))).frame(width: max(0, 570 * CGFloat(fill)))
                    Text(count)
                        .font(.custom(model.assets.fontName(.bold), size: 20))
                        .foregroundColor(.white)
                        .shadow(color: .black, radius: 1, x: 0, y: 1)
                        .frame(maxWidth: .infinity)
                }
                .frame(height: 26)
                .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color(uiColor: BattleColors.hex(0x5a5a5a)), lineWidth: 2))
            }
            .padding(.horizontal, 28)
            .padding(.vertical, 10)
            .frame(width: 630, height: 135, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color(uiColor: BattleColors.hex(0x191919)).opacity(0.86)))
            .shadow(color: .black.opacity(0.7), radius: 12, x: 0, y: 4)
            .position(x: 45 + 315 + x, y: offsetY + 24 + 67.5)
            .opacity(t > total ? 0 : 1)
        }
        .allowsHitTesting(false)
    }

    /// Horizontal offset of the plate at `t` ms: slides in from the left, holds, slides out to the right.
    private func slideX(_ t: Double) -> CGFloat {
        if t < BattleResultTiming.setPlateIn {
            let k = t / BattleResultTiming.setPlateIn
            return -820 * CGFloat(1 - easeInOutExpo(k))
        }
        if t < BattleResultTiming.setPlateIn + BattleResultTiming.setPlateHold {
            return 0
        }
        let k = min(1, (t - BattleResultTiming.setPlateIn - BattleResultTiming.setPlateHold) / BattleResultTiming.setPlateOut)
        return 820 * CGFloat(easeInOutExpo(k))
    }

    private func easeInOutExpo(_ k: Double) -> Double {
        if k <= 0 { return 0 }
        if k >= 1 { return 1 }
        return k < 0.5 ? pow(2, 20 * k - 10) / 2 : (2 - pow(2, -20 * k + 10)) / 2
    }
}

/// The reward card full size (comp_cardfullscreen_v3) until tapped; a card piece with the puzzle overlay.
private struct FullCardView: View {
    let stage: FullCardStage
    let layout: BattleLayout
    @EnvironmentObject var model: AppModel
    @State private var shown = false

    var body: some View {
        ZStack {
            Color.black.opacity(stage.pieces != nil ? 0.35 : 0.55)
            VStack(spacing: 18) {
                DetailCardView(def: stage.card.def, stage: stage.card.stage, pieces: stage.pieces)
                    .frame(width: 600, height: 829)
                if stage.pieces == nil {
                    Text("Tap to continue")
                        .font(.custom(model.assets.fontName(.standard), size: 28))
                        .foregroundColor(.white.opacity(0.85))
                        .shadow(color: .black, radius: 2, x: 0, y: 2)
                }
            }
            .scaleEffect(stage.closing ? 0.001 : (shown ? 1 : 0.4))
            .opacity(stage.closing ? 0 : (shown ? 1 : 0))
        }
        .frame(width: BattleLayout.stageWidth, height: layout.size.height)
        .onAppear { withAnimation(.easeOut(duration: 0.3)) { shown = true } }
    }
}

/// The detail-size card (600 × 829): the rarity plates (carddetail_top / bottom / rail) around the art, the name,
/// the tribe emblem, the rarity label and the puzzle pieces of a hunt (card.js size 'detail', showStats false).
private struct DetailCardView: View {
    let def: CardDef
    let stage: Int
    let pieces: BattleResultModel.PieceProgress?
    @EnvironmentObject var model: AppModel

    var body: some View {
        let rarity = def.rarity.rawValue
        let textColor = Color(uiColor: BattleColors.rarity(def.rarity))
        return ZStack(alignment: .topLeading) {
            // art between the rails
            ZStack {
                Color(uiColor: BattleColors.tribe(def.tribe)).opacity(0.35)
                Image(uiImage: model.assets.cardArt(def, stage: stage))
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                if let p = pieces {
                    PiecesOverlay(owned: p.owned, total: p.total, compact: false)
                }
            }
            .frame(width: 529, height: 580)
            .clipped()
            .position(x: 35 + 529 / 2, y: 97 + 290)
            // plates
            CatalogSprite(name: "carddetail_rail_\(rarity)", fallback: Color.clear)
                .frame(width: 600, height: 829)
            // the plates keep their natural aspect at 600 wide (`top center / 100% auto`)
            CatalogSprite(name: "carddetail_top_\(rarity)", fallback: Color(uiColor: BattleColors.stoneDark).opacity(0.9))
                .aspectRatio(contentMode: .fit)
                .frame(width: 600)
            VStack { Spacer()
                CatalogSprite(name: "carddetail_bottom_\(rarity)", fallback: Color(uiColor: BattleColors.stoneDark).opacity(0.9))
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 600)
            }
            .frame(width: 600, height: 829)
            // name and emblem on the top plate
            HStack(spacing: 4) {
                Text(def.name)
                    .font(.custom(model.assets.fontName(.bold), size: 34))
                    .foregroundColor(textColor)
                    .lineLimit(1)
                if stage > 0 {
                    Text(String(repeating: "+", count: min(4, stage)))
                        .font(.custom(model.assets.fontName(.bold), size: 34))
                        .foregroundColor(Color(uiColor: BattleColors.star))
                }
            }
            .shadow(color: .black.opacity(0.8), radius: 1, x: 0, y: 2)
            .frame(width: 448, height: 56, alignment: .leading)
            .position(x: 22 + 224, y: 9 + 28)
            CatalogSprite(name: BattleSprites.tribeEmblem(def.tribe), fallback: Color(uiColor: BattleColors.tribe(def.tribe)))
                .frame(width: 64, height: 64)
                .shadow(color: .black.opacity(0.9), radius: 4)
                .position(x: 489 + 51.5, y: 9 + 57.5)
            // rarity label and pips on the bottom plate
            HStack {
                Text(def.rarity.rawValue.prefix(1).uppercased() + def.rarity.rawValue.dropFirst())
                    .font(.custom(model.assets.fontName(.bold), size: 32))
                    .foregroundColor(textColor)
                    .shadow(color: .black.opacity(0.8), radius: 1, x: 0, y: 2)
                Spacer()
                HStack(spacing: 10) {
                    ForEach(0..<5, id: \.self) { i in
                        CatalogSprite(name: i <= stage ? "hud_evolution" : "hud_evolution_grey", fallback: i <= stage ? Color(uiColor: BattleColors.star) : Color.gray)
                            .frame(width: 22, height: 30)
                    }
                }
            }
            .frame(width: 600 - 24 - 26, height: 48)
            .position(x: 300, y: 829 - 8 - 118 + 6 + 24)
        }
        .frame(width: 600, height: 829)
        .shadow(color: .black.opacity(0.8), radius: 30, x: 0, y: 10)
    }
}

// The puzzle-piece overlay (card.js renderPieces) is the shared `PiecesOverlay` of Components/CardFaceView.swift.

/// One card XP entry of the result screen: the battle card at 0.8 and the violet XP bar beside it.
private struct XpEntryView: View {
    let row: XpRow
    let position: BattleResultModel.EntryLayout
    let offsetY: CGFloat
    @EnvironmentObject var model: AppModel

    var body: some View {
        let x = position.x
        let y = position.y + offsetY
        ZStack(alignment: .topLeading) {
            // `.result-entry-card { left: -47px; top: -66px }` holds the card scaled 0.8 from its top-left corner;
            // the layout frame stays 116 × 164, so its centre sits 58 / 82 from that corner
            ResultCardFace(def: row.def, stage: row.entry.stage, level: row.entry.from.level, stats: row.stats, name: row.entry.name)
                .frame(width: 116, height: 164)
                .scaleEffect(0.8, anchor: .topLeading)
                .position(x: x - 47 + 58, y: y - 66 + 82)
            XpBarView(bar: row.bar, tweenMs: row.barMs)
                .frame(width: 252, height: 34)
                .position(x: position.right ? x - 62 - 126 : x + 62 + 126, y: y - 17 + 17)
        }
        .animation(row.instant ? nil : .linear(duration: BattleResultTiming.xpFadeMs / 1000), value: row.shown)
    }
}

/// The XP bar of a result entry: violet hud_progressbarviolet03 on the 3-slice track, the xp star at its left end.
private struct XpBarView: View {
    let bar: BattleResultModel.XpBar
    let tweenMs: Double
    @EnvironmentObject var model: AppModel

    var body: some View {
        ZStack(alignment: .leading) {
            HStack(spacing: 0) {
                CatalogSprite(name: "hud_progressbar_3sliceleft", fallback: Color(uiColor: BattleColors.stoneDark)).frame(width: 18)
                CatalogSprite(name: "hud_progressbar_3slice02", fallback: Color(uiColor: BattleColors.stoneDark))
                CatalogSprite(name: "hud_progressbar_3sliceright", fallback: Color(uiColor: BattleColors.stoneDark)).frame(width: 20)
            }
            .frame(width: 252, height: 34)
            .shadow(color: .black.opacity(0.7), radius: 3, x: 0, y: 2)
            CatalogSprite(name: "hud_progressbarviolet03", fallback: Color(uiColor: BattleColors.xpViolet))
                .frame(width: 214, height: 7)
                .scaleEffect(x: max(0.0001, CGFloat(bar.ratio)), y: 1, anchor: .leading)
                .shadow(color: Color(uiColor: BattleColors.hex(0xbe50ff)).opacity(0.8), radius: 6)
                .offset(x: 18, y: 34 / 2 - 6 - 3.5)
                .animation(.linear(duration: tweenMs / 1000), value: bar.ratio)
            Text(BattleResultModel.levelText(bar))
                .font(.custom(model.assets.fontName(.bold), size: 22))
                .foregroundColor(Color(uiColor: BattleColors.headline))
                .shadow(color: .black, radius: 1, x: 0, y: 1)
                .frame(width: 252, height: 34)
            CatalogSprite(name: "hud_experienceicon01", fallback: Color(uiColor: BattleColors.star))
                .frame(width: 46, height: 46)
                .shadow(color: .black.opacity(0.9), radius: 2, x: 0, y: 2)
                .offset(x: -22)
        }
        .frame(width: 252, height: 34)
    }
}

/// A battle-size card face in SwiftUI (card.js size 'battle', bottom row) for the result entries.
private struct ResultCardFace: View {
    let def: CardDef?
    let stage: Int
    let level: Int
    let stats: CardStats?
    let name: String
    @EnvironmentObject var model: AppModel

    var body: some View {
        let rarity = def?.rarity ?? .common
        let tribe = def?.tribe ?? .neutral
        return ZStack(alignment: .bottom) {
            Color(uiColor: BattleColors.tribe(tribe)).opacity(0.35)
            if let d = def {
                Image(uiImage: model.assets.cardArt(d, stage: stage))
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .frame(width: 116, height: 164)
                    .clipped()
            }
            ZStack(alignment: .top) {
                CatalogSprite(name: "cardstatsoverlay_small", fallback: Color.black.opacity(0.62))
                VStack(spacing: 2) {
                    HStack {
                        statCell("hud_fighticon02", stats.map { String($0.attack) }, Color(uiColor: BattleColors.attack))
                        Spacer()
                        statCell("hud_experienceicon01", String(level), Color(uiColor: BattleColors.star))
                    }
                    HStack {
                        statCell("hud_healthicon01", stats.map { String($0.hp) }, Color(uiColor: BattleColors.hp))
                        Spacer()
                        statCell("hud_specialskill01", stats?.ability.map { plainNumber($0) }, Color(uiColor: BattleColors.ability))
                    }
                }
                .padding(.horizontal, 8)
                .padding(.top, 7)
            }
            .frame(width: 116, height: 44)
            CatalogSprite(name: BattleSprites.cardFrame(rarity), fallback: Color.clear)
                .frame(width: 116, height: 164)
        }
        .frame(width: 116, height: 164)
        .clipShape(RoundedRectangle(cornerRadius: 3))
        .shadow(color: .black.opacity(0.7), radius: 10, x: 0, y: 4)
    }

    private func statCell(_ icon: String, _ text: String?, _ color: Color) -> some View {
        HStack(spacing: 3) {
            CatalogSprite(name: icon, fallback: color).frame(width: 15, height: 15)
            Text(text ?? "")
                .font(.custom(model.assets.fontName(.bold), size: (text?.count ?? 0) >= 5 ? 11 : 13))
                .foregroundColor(color)
                .shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 1)
        }
        .frame(height: 16)
        .opacity(text == nil ? 0 : 1)
    }
}

/// Card level-up popup (comp_levelup_card + ctrl_cardlevelup): the card art at 85 % of the screen behind a black
/// 75 % dim, "Level up!" fades then zooms in, then the rows Level / Attack / HP / Skill ("from → to", 500 ms
/// each) and the pulsing "Tap to continue" hint.
private struct CardLevelUpView: View {
    let stage: LevelUpStage
    let offsetY: CGFloat
    @EnvironmentObject var model: AppModel

    private static let rowTops: [CGFloat] = [437, 595, 752, 910]

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60.0)) { context in
            let t = context.date.timeIntervalSince(stage.start) * 1000
            let step = BattleResultTiming.levelUpStepMs
            let dimAlpha = min(1, t / 500)
            let titleK = max(0, min(1, t / (2 * step)))
            let titleScale: CGFloat = titleK < 0.5 ? 0.01 : CGFloat(0.01 + 0.99 * (titleK - 0.5) / 0.5)
            let titleAlpha: Double = titleK < 0.5 ? titleK / 0.5 : 1
            let tapDelay = Double(2 + stage.rows.count) * step
            let tapAlpha: Double = t < tapDelay ? 0 : 0.9 * (0.5 + 0.5 * cos(((t - tapDelay - 200) / 2000) * 2 * Double.pi))
            let fingerScale: CGFloat = CGFloat(0.86 + 0.14 * cos(((t - tapDelay) / 2000) * 2 * Double.pi))
            ZStack(alignment: .topLeading) {
                Color.black.opacity(0.745 * dimAlpha)
                // the card art
                ZStack {
                    Color.black
                    Image(uiImage: model.assets.cardArt(stage.def, stage: stage.stage))
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                }
                .frame(width: 612, height: 868)
                .clipShape(RoundedRectangle(cornerRadius: 24))
                .overlay(RoundedRectangle(cornerRadius: 24).stroke(Color(uiColor: BattleColors.rarity(stage.def.rarity)), lineWidth: 8))
                .shadow(color: .black.opacity(0.8), radius: 30, x: 0, y: 10)
                .position(x: 54 + 306, y: offsetY + 206 + 434)
                .opacity(dimAlpha)
                Text("Level up!")
                    .font(.custom(model.assets.fontName(.bold), size: 76))
                    .foregroundColor(Color(uiColor: BattleColors.headline))
                    .shadow(color: .black, radius: 2, x: 0, y: 3)
                    .scaleEffect(titleScale)
                    .opacity(titleAlpha)
                    .frame(width: BattleLayout.stageWidth)
                    .position(x: BattleLayout.stageWidth / 2, y: offsetY + 236 + 45)
                ForEach(Array(stage.rows.enumerated()), id: \.offset) { pair in
                    let i = pair.offset
                    let r = pair.element
                    let rowStart = Double(2 + i) * step
                    let k = max(0, min(1, (t - rowStart) / step))
                    levelUpRow(r)
                        .scaleEffect(CGFloat(0.01 + 0.99 * k))
                        .opacity(k)
                        .position(x: BattleLayout.stageWidth / 2, y: offsetY + (i < CardLevelUpView.rowTops.count ? CardLevelUpView.rowTops[i] : 910))
                }
                Text("Tap to continue")
                    .font(.custom(model.assets.fontName(.standard), size: 32))
                    .foregroundColor(Color(uiColor: BattleColors.headline))
                    .shadow(color: .black, radius: 1, x: 0, y: 2)
                    .frame(width: 400, alignment: .trailing)
                    .position(x: 551 - 200, y: offsetY + 990 + 16)
                    .opacity(tapAlpha)
                CatalogSprite(name: "hud_tapfeedback01", fallback: Color.clear)
                    .frame(width: 64, height: 64)
                    .position(x: 548 + 32, y: offsetY + 975 + 32)
                    .opacity(t < tapDelay ? 0 : 0.9)
                CatalogSprite(name: "hud_tapindicator01", fallback: Color.white.opacity(0.6))
                    .frame(width: 64, height: 64)
                    .scaleEffect(fingerScale)
                    .position(x: 566 + 32, y: offsetY + 995 + 32)
                    .opacity(t < tapDelay ? 0 : 0.9)
            }
        }
        .allowsHitTesting(false)
    }

    private func rowColor(_ kind: BattleResultModel.LevelUpRowKind) -> Color {
        switch kind {
        case .level: return Color(uiColor: BattleColors.hex(0xfed00f))
        case .attack: return Color(uiColor: BattleColors.hex(0xff0000))
        case .hp: return Color(uiColor: BattleColors.hex(0x378f0b))
        case .skill: return Color(uiColor: BattleColors.hex(0xff8014))
        }
    }

    private func levelUpRow(_ r: BattleResultModel.LevelUpRow) -> some View {
        ZStack {
            Rectangle().fill(Color.black.opacity(0.39))
            HStack(spacing: 8) {
                CatalogSprite(name: r.kind.icon, fallback: rowColor(r.kind)).frame(width: 54, height: 54)
                Text(BattleResultModel.fmt(r.from))
                    .font(.custom(model.assets.fontName(.bold), size: 45))
                    .foregroundColor(Color(uiColor: BattleColors.headline))
                    .shadow(color: .black, radius: 1, x: 0, y: 2)
            }
            .frame(width: 236, alignment: .trailing)
            // `.clu-from { right: calc(50% + 112px) }` → right edge 112 px left of the row's centre (284)
            .position(x: 284 - 112 - 118, y: 56)
            // `.clu-arrow { left: calc(50% - 67px - 30px); width: 60px }`
            CatalogSprite(name: "levelup_arrow_icon", fallback: Color.white)
                .frame(width: 60, height: 60)
                .position(x: 284 - 97 + 30, y: 56)
            HStack(spacing: 8) {
                CatalogSprite(name: r.kind.icon, fallback: rowColor(r.kind)).frame(width: 80, height: 80)
                Text(BattleResultModel.fmt(r.to))
                    .font(.custom(model.assets.fontName(.bold), size: 67))
                    .foregroundColor(rowColor(r.kind))
                    .shadow(color: .black, radius: 1, x: 0, y: 2)
            }
            .frame(width: 248, alignment: .leading)
            // `.clu-to { left: calc(50% + 20px) }`
            .position(x: 284 + 20 + 124, y: 56)
        }
        .frame(width: 720 - 152, height: 112)
    }
}
