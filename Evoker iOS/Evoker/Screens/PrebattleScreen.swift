import SwiftUI
import EvokerCore

/// Pre-battle (deck placement) screen (`src/ui/screens/prebattle.js`), shared by quests, arena, pieces and league:
/// the opponent row (face-up cards or card backs in cardslot01 recesses), the flaming Attack! bar, the player row
/// of 5 deck slots with drag and drop from the collection drawer below, "Mana needed: x / y" for PvP. Attack!
/// checks the mana (Drink-potion dialog), runs the fight (`FightRunner`) and opens the battle screen.
struct PrebattleScreen: View {
    let request: FightRequest
    @EnvironmentObject private var model: AppModel
    @StateObject private var dnd = DragDropCoordinator()
    @State private var attacking: Bool = false
    @State private var introPending: Bool = false
    @State private var introSlot: Int = 0
    @State private var introFlown: Bool = false
    @State private var barHidden: Bool = false
    @State private var slotFrames: [Int: CGRect] = [:]

    /// The opponent as the pre-battle shows it (`opponent` param of architecture §8.4).
    struct OpponentPreview {
        var name: String
        var level: Int
        var hp: Int
        var faceDown: Bool
        var avatar: Int
        var cards: [CardFaceModel?]
    }

    private var mode: FightMode {
        switch request {
        case .questBoss: return .quest
        case .arena: return .arena
        case .pieces: return .pieces
        case .league: return .league
        case .replay: return .replay
        case .lab: return .lab
        }
    }

    private var isPvp: Bool { mode == .arena || mode == .pieces || mode == .league }

    private var navItem: NavItem {
        switch mode {
        case .arena, .pieces: return .arena
        case .league: return .league
        default: return .quest
        }
    }

    private var theme: String {
        switch request {
        case .questBoss(let line, let n):
            if line != "main" { return "swamp" }
            return n >= 31 ? "lava" : "valley"
        default:
            return "sunset"
        }
    }

    var body: some View {
        Group {
            if let state = model.store.state, let opp = opponent(state) {
                content(state: state, opponent: opp)
            } else {
                VStack {
                    Text(Strings.opponentGone).font(Theme.font(26)).foregroundColor(Theme.muted).padding(40)
                    SteelButton(Strings.back) { model.router.back(fallback: .questMap()) }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .chrome(active: navItem, back: .pop(fallback: .questMap()), help: "prebattle")
        .onAppear { ensureBoss(); setupDnd(); setupIntro() }
    }

    /// A boss fight reached without the intro: prepare the line-up here (the intro normally did).
    private func ensureBoss() {
        guard case .questBoss = request, let state = model.store.state, state.quests.active?.boss == nil else { return }
        _ = prepareBoss()
    }

    // MARK: Opponent

    private func opponent(_ state: GameState) -> OpponentPreview? {
        let deps = model.deps
        switch request {
        case .questBoss:
            guard let lineup = state.quests.active?.boss else { return nil }
            let cards: [CardFaceModel?] = lineup.cards.map { c in
                guard let c = c else { return nil }
                return CardFaceModel.fromRef(c.ref, deps: deps)
            }
            return OpponentPreview(name: lineup.player.name, level: lineup.player.level ?? 1, hp: lineup.player.hp, faceDown: false, avatar: 0, cards: cards)
        case .arena(let i):
            guard i < state.sim.arena.offers.count else { return nil }
            let offer = state.sim.arena.offers[i]
            guard let sim = OpponentOps.getSim(state, simId: offer.simId) else { return nil }
            return simPreview(sim, power: offer.power)
        case .pieces(let i):
            guard i < state.pieces.count, let holder = state.pieces[i].holderId, let sim = OpponentOps.getSim(state, simId: holder) else { return nil }
            return simPreview(sim, power: 1)
        case .league(let simId):
            guard let sim = OpponentOps.getSim(state, simId: simId) else { return nil }
            return simPreview(sim, power: state.sim.league?.power ?? 1)
        case .replay(let index):
            guard index < state.replays.count else { return nil }
            let rep = state.replays[index]
            let cards: [CardFaceModel?] = rep.defender.cards.map { c in
                guard let c = c, let def = deps.db.get(c.cardId) else { return nil }
                return CardFaceModel.fromDef(def, stage: c.stage, level: max(1, c.level), deps: deps)
            }
            return OpponentPreview(name: rep.defender.name, level: 0, hp: rep.defender.maxHp, faceDown: false, avatar: rep.defender.avatar, cards: cards)
        case .lab:
            return OpponentPreview(name: "Lab opponent", level: 0, hp: 0, faceDown: false, avatar: 0, cards: [nil, nil, nil, nil, nil])
        }
    }

    /// `pvp-view.js opponentPreview`: face-down cards scaled by the power multiplier.
    private func simPreview(_ sim: SimPlayer, power: Double) -> OpponentPreview {
        let hp = Int(JSMath.round(Double(sim.hpMax) * power))
        var cards: [CardFaceModel?] = OpponentOps.scaledSimDeck(sim, deps: model.deps, power: power).map { c in
            guard let c = c else { return nil }
            return CardFaceModel.fromRef(c, deps: model.deps)
        }
        while cards.count < 5 { cards.append(nil) }
        return OpponentPreview(name: sim.name, level: sim.level, hp: hp, faceDown: true, avatar: sim.avatar, cards: Array(cards.prefix(5)))
    }

    /// The boss line-up when the intro did not prepare it (a direct route).
    private func prepareBoss() -> BossLineup? {
        guard let state = model.store.state, let active = state.quests.active, active.bossReady else { return nil }
        let r: (BossLineup, QuestNode)? = model.update(toastOnError: false) { s, d, t in
            let r = try QuestOps.prepareBoss(s, deps: d, now: t)
            return (state: r.state, info: (r.lineup, r.quest))
        }
        return r?.0
    }

    // MARK: Layout

    private func content(state: GameState, opponent: OpponentPreview) -> some View {
        let deps = model.deps
        let deck = StateOps.deckCards(state)
        let mana = StateOps.deckMana(state, deps: deps)
        let have = state.player.mana
        let maxMana = max(have, state.player.manaMax)
        let showMana = isPvp
        let others = CollectionOps.sortCards(state.cards.filter { c in !state.deck.contains(c.uid) && deps.db.get(c.cardId) != nil }, db: deps.db, order: .default, stats: deps.stats)
        return ZStack(alignment: .topLeading) {
            PrebattleBackground(theme: theme)
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 0) {
                    if isPvp {
                        nameLine(opponent.name).frame(height: 60).padding(.top, 2)
                    } else {
                        Color.clear.frame(height: 92)
                    }
                    // opponent row
                    HStack(spacing: 12) {
                        ForEach(0..<5, id: \.self) { i in
                            ZStack(alignment: .topLeading) {
                                DeckSlotView(recess: true)
                                if let face = opponent.cards[i] {
                                    if opponent.faceDown {
                                        CardFaceView(face: face, size: .back(hidden: false)).offset(x: -2, y: -2)
                                    } else {
                                        CardFaceView(face: face, size: .battle(side: .top))
                                            .offset(x: -2, y: -2)
                                            .opacity(introPending && introSlot == i && !introFlown ? 0 : 1)
                                            .onTapGesture {
                                                model.sfx("ui_button_card")
                                                model.router.go(.cardDetail(.catalog(cardId: face.cardId, stage: face.stage, level: face.level)))
                                            }
                                    }
                                }
                            }
                            .background(FrameReader { f in slotFrames[i] = f })
                        }
                    }
                    .padding(.vertical, 10).padding(.horizontal, 8)
                    .frame(maxWidth: .infinity)
                    // Attack! bar on the seperator_big band
                    ZStack {
                        StretchedSprite("seperator_big").frame(height: 54).shadow(color: .black.opacity(0.6), radius: 6, x: 0, y: 3)
                        AttackBarView(disabled: attacking) { attack(showMana: showMana) }
                            .opacity(barHidden ? 0 : 1)
                            .scaleEffect(x: barHidden ? 0.02 : 1, y: 1)
                    }
                    .frame(height: 160)
                    .padding(.top, isPvp ? 6 : 26)
                    .padding(.bottom, isPvp ? 0 : 24)
                    if isPvp {
                        nameLine(state.player.name.isEmpty ? "You" : state.player.name).frame(height: 56).padding(.top, 4)
                    }
                    // player row (drop targets)
                    HStack(spacing: 12) {
                        ForEach(0..<5, id: \.self) { i in
                            let locked = !StateOps.slotUnlocked(state, slot: i)
                            ZStack(alignment: .topLeading) {
                                DeckSlotView(locked: locked, recess: true, highlight: dnd.highlight(.slot(i)))
                                if let inst = deck[i], let face = CardFaceModel.forUid(inst.uid, state: state, deps: deps) {
                                    CardFaceView(face: face, size: .battle(side: .bottom))
                                        .offset(x: -2, y: -2)
                                        .draggableCard(dnd, payload: DragPayload(uid: inst.uid, cardId: inst.cardId, pieceId: nil, fromSlot: i, fromZone: nil), face: face) {
                                            model.sfx("ui_button_card")
                                            model.router.go(.cardDetail(.owned(uid: inst.uid)))
                                        }
                                }
                            }
                            .dropTarget(.slot(i))
                        }
                    }
                    .padding(.vertical, 10).padding(.horizontal, 8)
                    .frame(maxWidth: .infinity)
                    if showMana {
                        ManaNeededBarView(needed: mana, have: have, max: maxMana)
                            .padding(.horizontal, 40)
                            .padding(.top, 2)
                    }
                    // the collection drawer
                    VStack(alignment: .leading, spacing: 0) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(Strings.yourCards).font(Theme.font(24)).foregroundColor(Theme.gold)
                            Spacer()
                            Text(Strings.dragHint).font(Theme.font(18)).foregroundColor(Theme.muted)
                        }
                        .padding(.top, 2).padding(.horizontal, 16).padding(.bottom, 6)
                        if others.isEmpty {
                            Text(Strings.allCardsInDeck).font(Theme.font(22)).foregroundColor(Theme.muted)
                                .frame(maxWidth: .infinity).padding(.vertical, 50)
                        } else {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 12) {
                                    ForEach(others) { inst in
                                        if let def = deps.db.get(inst.cardId) {
                                            let face = CardFaceModel.fromInstance(inst, def: def, deps: deps)
                                            CardFaceView(face: face, size: .compact)
                                                .draggableCard(dnd, payload: DragPayload(uid: inst.uid, cardId: inst.cardId, pieceId: nil, fromSlot: nil, fromZone: nil), face: face) {
                                                    model.sfx("ui_button_card")
                                                    model.router.go(.cardDetail(.owned(uid: inst.uid)))
                                                }
                                        }
                                    }
                                }
                                .padding(.top, 4).padding(.horizontal, 14).padding(.bottom, 8)
                            }
                            .frame(minHeight: 182)
                        }
                    }
                    .padding(.top, 6).padding(.bottom, 10)
                    .frame(minHeight: 236)
                    .background(Color(hex: 0x0e0f10, alpha: 0.78))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.stoneEdge, lineWidth: 3))
                    .padding(.top, 10).padding(.horizontal, 12).padding(.bottom, 12)
                }
            }
            .dragDropLayer(dnd)
            if introPending, let intro = introCard(state: state, opponent: opponent) {
                intro
            }
        }
    }

    private func nameLine(_ text: String) -> some View {
        Text(text)
            .font(Theme.light(38))
            .foregroundColor(Theme.text)
            .shadow(color: .black.opacity(0.9), radius: 5)
            .shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 2)
            .lineLimit(1)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 24)
    }

    // MARK: Drag and drop (placeInDeck / removeFromDeck)

    private func setupDnd() {
        dnd.canDrop = { _, target in
            guard let state = model.store.state, let slot = target.slot else { return false }
            return StateOps.slotUnlocked(state, slot: slot)
        }
        dnd.onDrop = { payload, target in
            guard let uid = payload.uid, let slot = target.slot else { return }
            if model.update({ s, d, _ in
                let r = try CollectionOps.placeInDeck(s, deps: d, uid: uid, slot: slot)
                return (state: r.state, info: r.mana)
            }) != nil {
                model.sfx("ui_decksetup_card_place")
            }
        }
        dnd.onDropOutside = { payload in
            guard let from = payload.fromSlot else { return }
            model.updateState { s, _, _ in CollectionOps.removeFromDeck(s, slot: from) }
            model.sfx("ui_decksetup_card_remove")
        }
        dnd.onDropInvalid = { _, target in
            if target.slot != nil { model.toast(Strings.slotLocked, icon: "lock_small") }
        }
        dnd.onDragStart = { _ in model.sfx("ui_decksetup_card_take") }
    }

    // MARK: Boss intro card flight

    private func setupIntro() {
        guard case .questBoss(let line, let n) = request, let pending = model.pendingBossIntro, pending.line == line, pending.n == n else { return }
        model.pendingBossIntro = nil   // one-shot
        guard let lineup = model.store.state?.quests.active?.boss else { return }
        introSlot = max(0, lineup.cards.firstIndex(where: { $0?.uid == lineup.boss.uid }) ?? 0)
        introPending = true
        barHidden = true
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 60_000_000)
            withAnimation(.easeIn(duration: BossIntroScreen.timings.fly)) { introFlown = true }
            try? await Task.sleep(nanoseconds: UInt64(BossIntroScreen.timings.fly * 1_000_000_000) + 60_000_000)
            introPending = false
            model.sfx("ui_button_switch")
            withAnimation(.spring(response: 0.4, dampingFraction: 0.7)) { barHidden = false }
        }
    }

    private func introCard(state: GameState, opponent: OpponentPreview) -> AnyView? {
        guard let face = opponent.cards[introSlot] else { return nil }
        let from = BossIntroScreen.cardBox
        let target = slotFrames[introSlot] ?? CGRect(x: 302 + CGFloat(introSlot - 2) * 128, y: 118 + 102, width: 116, height: 164)
        let rect = introFlown ? CGRect(x: target.minX - 2, y: target.minY - 2, width: 116, height: 164) : from
        return AnyView(
            ZStack {
                Color.black
                CardArt(def: face.def, stage: face.stage)
            }
            .frame(width: rect.width, height: rect.height)
            .cornerRadius(6)
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color(hex: 0xa9adb1), lineWidth: 6))
            .shadow(color: Color(hex: 0x78beff, alpha: 0.7), radius: 13)
            .position(x: rect.midX, y: rect.midY)
            .allowsHitTesting(false)
        )
    }

    // MARK: Attack!

    private func attack(showMana: Bool) {
        if attacking { return }
        guard let state = model.store.state else { return }
        if !state.deck.contains(where: { $0 != nil }) {
            model.toast(Strings.placeOneCard, icon: "icon_deckedit_active")
            return
        }
        if showMana {
            let mana = StateOps.deckMana(state, deps: model.deps)
            let need = PlayerOps.needsPotion(state, kind: .mana, amount: mana, event: model.event)
            if need.needed {
                Task { @MainActor in
                    let choice = await model.dialogs.drinkPotion(kind: .mana, count: need.potions, gemPrice: need.price, gems: state.player.gems)
                    let ev = model.event
                    if choice == "use" {
                        if model.updateState({ s, _, _ in try PlayerOps.drinkPotion(s, kind: .mana) }) { model.sfx("ui_use_potion") }
                    } else if choice == "buy" {
                        if model.updateState({ s, _, _ in try PlayerOps.buyAndDrinkPotion(s, kind: .mana, event: ev) }) { model.sfx("ui_use_potion") }
                    } else {
                        return
                    }
                    if (model.store.state?.player.mana ?? 0) < mana {
                        model.toast(Strings.notEnoughMana, icon: "hud_manaicon01")
                        return
                    }
                    launch()
                }
                return
            }
        }
        launch()
    }

    private func launch() {
        attacking = true
        model.sfx("ui_button_attack")
        do {
            if let p = try FightRunner.run(request, model: model) {
                model.presentBattle(p, replacing: true)
            } else {
                model.toast(Strings.fightCouldNotStart)
                attacking = false
            }
        } catch {
            model.toast(model.errorText(error))
            attacking = false
        }
    }
}

/// Backdrop: the arena painting for PvP, sky / horizon strip / ground for quests, dimmed so the panels read.
struct PrebattleBackground: View {
    let theme: String

    var body: some View {
        ZStack {
            switch theme {
            case "sunset":
                Color(hex: 0x3a1a0c)
                Sprite("arena", contentMode: .fill).frame(width: Stage.width).clipped()
                LinearGradient(colors: [Color(hex: 0x0a0806, alpha: 0.55), Color(hex: 0x0a0806, alpha: 0.35), Color(hex: 0x0a0806, alpha: 0.5)], startPoint: .top, endPoint: .bottom)
            case "swamp":
                LinearGradient(stops: [.init(color: Color(hex: 0x584a3a), location: 0), .init(color: Color(hex: 0x436130), location: 0.3), .init(color: Color(hex: 0x35501f), location: 0.38), .init(color: Color(hex: 0x2a3e14), location: 0.46), .init(color: Color(hex: 0x11200a), location: 1)], startPoint: .top, endPoint: .bottom)
                horizon("horizon-swamp")
                Color(hex: 0x0a0806, alpha: 0.42)
            case "lava":
                LinearGradient(stops: [.init(color: Color(hex: 0x3d2315), location: 0), .init(color: Color(hex: 0x5a2a12), location: 0.34), .init(color: Color(hex: 0xc1922e), location: 0.43), .init(color: Color(hex: 0x7a3a12), location: 0.56), .init(color: Color(hex: 0x2a1208), location: 1)], startPoint: .top, endPoint: .bottom)
                horizon("fight_cardbackground01")
                Color(hex: 0x0a0806, alpha: 0.42)
            default:
                LinearGradient(stops: [.init(color: Color(hex: 0x354353), location: 0), .init(color: Color(hex: 0x396648), location: 0.3), .init(color: Color(hex: 0x244a22), location: 0.38), .init(color: Color(hex: 0x193917), location: 0.46), .init(color: Color(hex: 0x0d2410), location: 1)], startPoint: .top, endPoint: .bottom)
                horizon("horizon-valley")
                Color(hex: 0x0a0806, alpha: 0.42)
            }
        }
    }

    private func horizon(_ name: String) -> some View {
        VStack {
            Sprite(name, contentMode: .fill)
                .frame(width: Stage.width, height: 280)
                .clipped()
                .mask(LinearGradient(colors: [.clear, .black, .black, .clear], startPoint: .top, endPoint: .bottom))
                .padding(.top, 300)
            Spacer()
        }
    }
}
