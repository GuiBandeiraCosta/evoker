import SwiftUI
import EvokerCore

/// Arena screen (`src/ui/screens/arena.js`, the client's PvP landing): the tabs Arena | Pieces | Replays on the
/// tab_background band; Arena = today's event banner and three opponents (strongest card in a frame glowing in
/// the difficulty colour, name, level, HP, info and attack); Pieces = the hunted cards (ArenaPiecesView);
/// Replays = the last fights with Won / Lost / Draw, date and time, info and the watch button. The first visit
/// asks for the player's name.
struct ArenaScreen: View {
    let tab: ArenaTab
    @EnvironmentObject private var model: AppModel
    @EnvironmentObject private var clock: ClockTicker
    @State private var current: ArenaTab = .arena
    @State private var tabSet: Bool = false
    @State private var asked: Bool = false

    var body: some View {
        Group {
            if let state = model.store.state {
                content(state)
            } else {
                Color.black
            }
        }
        .chrome(active: .arena, back: .none, help: "arena")
        .onAppear {
            if !tabSet { tabSet = true; current = tab }
            ensureOffers()
            if !asked {
                asked = true
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 350_000_000)
                    await model.maybeAskName()
                }
            }
        }
        .onChange(of: clock.tick) { _, _ in
            // the opponents change every 30 minutes: a list left open past that refreshes itself
            if current == .arena && !model.dialogs.isOpen { ensureOffers() }
        }
    }

    private func ensureOffers() {
        guard let state = model.store.state else { return }
        if state.sim.arena.offers.isEmpty || state.sim.arena.rerollAt <= model.now {
            _ = model.update(toastOnError: false) { s, d, t in
                let r = ArenaOps.ensureOffers(s, deps: d, now: t)
                return (state: r.state, info: r.info)
            }
        }
    }

    private func content(_ state: GameState) -> some View {
        VStack(spacing: 0) {
            ArenaTabs(active: current) { id in
                model.sfx("ui_button_switch")
                current = id
            }
            ScrollView(.vertical, showsIndicators: false) {
                switch current {
                case .arena: arenaTab(state)
                case .pieces: ArenaPiecesView()
                case .replays: replaysTab(state)
                }
            }
            .padding(.bottom, 20)
        }
        .background(FullscreenBackground())
    }

    // MARK: Arena tab

    private func arenaTab(_ state: GameState) -> some View {
        let offers = state.sim.arena.offers
        return VStack(spacing: 0) {
            EventBannerView()
            if offers.isEmpty {
                Text(Strings.emptyArena).font(Theme.font(28)).foregroundColor(Color(hex: 0xf1e6d0)).multilineTextAlignment(.center).padding(60)
            } else {
                ForEach(Array(offers.enumerated()), id: \.offset) { item in
                    offerRow(item.element, index: item.offset, state: state)
                }
            }
        }
    }

    private func offerRow(_ offer: ArenaOffer, index: Int, state: GameState) -> some View {
        let sim = OpponentOps.getSim(state, simId: offer.simId)
        let best = sim.flatMap { strongestCard($0.deck, db: model.db) }
        let color = Theme.difficulty(offer.color)
        let hp = Int(JSMath.round(Double(sim?.hpMax ?? 0) * offer.power))
        return ZStack(alignment: .topLeading) {
            PvpRowBackground()
            StretchedSprite("pvp_bg_" + (offer.color == "yellow" ? "orange" : offer.color))
                .opacity(0.82)
                .at(6, 2, 630, 192)
            CardThumb(def: best.flatMap { model.db.get($0.cardId) }, stage: best?.stage ?? 0)
                .at(30, 25, 128, 146)
            Text(offer.name).font(Theme.font(30)).foregroundColor(color).lineLimit(1).shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 2)
                .frame(width: 480, alignment: .leading)
                .offset(x: 208, y: 18)
            HStack(spacing: 44) {
                Sprite("hud_experienceicon01").frame(width: 52, height: 52)
                Text("\(offer.level)").font(Theme.num(26)).foregroundColor(Color(hex: 0xf2f2f2))
            }
            .offset(x: 206, y: 66)
            HStack(spacing: 47) {
                Sprite("hud_healthicon02").frame(width: 46, height: 46).padding(.leading, 3)
                Text(fmtNumber(hp)).font(Theme.num(26)).foregroundColor(Color(hex: 0xf2f2f2))
            }
            .offset(x: 206, y: 120)
            InfoButton { Task { @MainActor in await openOfferInfo(index) } }.at(462, 104, 74, 68)
            PvpAttackButton { attackOffer(index) }.at(596, 86, 100, 86)
        }
        .frame(width: Stage.width - 12, height: 196, alignment: .topLeading)
        .padding(.horizontal, 6)
    }

    private func openOfferInfo(_ i: Int) async {
        guard let state = model.store.state, let raw = ArenaOps.offerInfo(state, deps: model.deps, offerIndex: i) else { return }
        var info = raw
        info.hp = Int(JSMath.round(Double(raw.hp) * (raw.power ?? 1)))
        model.sfx("ui_button_circular")
        if await PvpDialogs.showSimInfo(info, model: model) == "attack" { attackOffer(i) }
    }

    private func attackOffer(_ i: Int) {
        guard let state = model.store.state, i < state.sim.arena.offers.count,
              OpponentOps.getSim(state, simId: state.sim.arena.offers[i].simId) != nil else {
            model.toast(Strings.opponentGone)
            ensureOffers()
            return
        }
        model.sfx("ui_button_circular")
        model.router.go(.prebattle(.arena(offerIndex: i)))
    }

    // MARK: Replays tab

    private func replaysTab(_ state: GameState) -> some View {
        let replays = state.replays
        return VStack(spacing: 0) {
            if replays.isEmpty {
                Text(Strings.emptyHistory).font(Theme.font(28)).foregroundColor(Color(hex: 0xf1e6d0)).multilineTextAlignment(.center).padding(60)
            } else {
                ForEach(Array(replays.enumerated()), id: \.offset) { item in
                    replayRow(item.element, index: item.offset)
                }
            }
        }
        .padding(.top, 8)
    }

    private func replayRow(_ rep: Replay, index: Int) -> some View {
        let res = HistoryLines.result(rep)
        let when = HistoryLines.date(rep.at)
        let best = strongestReplayCard(rep.defender.cards, db: model.db)
        return ZStack(alignment: .topLeading) {
            PvpRowBackground()
            ZStack(alignment: .topTrailing) {
                CardThumb(def: best.flatMap { model.db.get($0.cardId) }, stage: best?.stage ?? 0).frame(width: 128, height: 172)
                Sprite("attacked_icon").frame(width: 56, height: 49).offset(x: 30, y: -6)
            }
            .at(22, 18, 128, 172)
            Text(rep.defender.name).font(Theme.font(30)).foregroundColor(Color(hex: 0xf59a23)).lineLimit(1).shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 2)
                .frame(width: 480, alignment: .leading).offset(x: 208, y: 16)
            Text(res.label).font(Theme.font(40)).foregroundColor(res.color).shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 2).offset(x: 208, y: 60)
            Text(when.date).font(Theme.num(30)).foregroundColor(Color(hex: 0xf2f2f2)).offset(x: 208, y: 114)
            Text(when.time).font(Theme.num(30)).foregroundColor(Color(hex: 0xf2f2f2)).offset(x: 208, y: 152)
            InfoButton { Task { @MainActor in await replayInfo(index) } }.at(462, 122, 74, 68)
            Button(action: { watch(index) }) {
                ZStack {
                    NineSlice(Theme.Frames.buttonDefault)
                    Sprite("hud_eyebutton01").frame(width: 76, height: 48)
                }
                .frame(width: 100, height: 86)
                .contentShape(Rectangle())
            }
            .buttonStyle(PressScaleStyle())
            .at(596, 106, 100, 86)
        }
        .frame(width: Stage.width - 12, height: 210, alignment: .topLeading)
        .padding(.horizontal, 6)
    }

    /// The opponent's line-up of a recorded fight.
    private func replayInfo(_ i: Int) async {
        guard let state = model.store.state, i < state.replays.count else { return }
        let rep = state.replays[i]
        model.sfx("ui_button_circular")
        let faces: [CardFaceModel?] = rep.defender.cards.map { c in
            guard let c = c, let def = model.db.get(c.cardId) else { return nil }
            return CardFaceModel.fromDef(def, stage: c.stage, level: max(1, c.level), deps: model.deps)
        }
        var r = DialogRequest()
        r.title = rep.defender.name
        r.width = 660
        r.body = { _ in
            AnyView(VStack(spacing: 12) {
                HStack(spacing: 10) {
                    Sprite("hud_healthicon02").frame(width: 40, height: 40)
                    Text(fmtNumber(rep.defender.maxHp)).font(Theme.num(28)).foregroundColor(Theme.hp)
                }
                HStack(spacing: 6) {
                    ForEach(0..<5, id: \.self) { k in
                        if let f = faces[k] {
                            CardFaceView(face: f, size: .compact)
                        } else {
                            DeckSlotView(width: 120, height: 168)
                        }
                    }
                }
            })
        }
        r.buttons = [DialogButton(Strings.watch, value: "watch")]
        if await model.dialogs.open(r) == "watch" { watch(i) }
    }

    private func watch(_ i: Int) {
        guard let p = FightRunner.replay(index: i, model: model) else {
            model.toast(Strings.replayBroken)
            return
        }
        model.sfx("ui_button_circular")
        model.presentBattle(p, replacing: false)
    }
}

/// The hud_headeractive01 / hud_headeridle01 tabs on the tab_background band.
struct ArenaTabs: View {
    let active: ArenaTab
    let onSelect: (ArenaTab) -> Void

    private let tabs: [(ArenaTab, String, CGFloat)] = [(.arena, Strings.arena, 24), (.pieces, Strings.pieces, 258), (.replays, Strings.replays, 492)]

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            StretchedSprite("tab_background")
            ForEach(tabs, id: \.0) { tab in
                let isActive = tab.0 == active
                Button(action: { if !isActive { onSelect(tab.0) } }) {
                    Text(tab.1)
                        .font(Theme.font(25))
                        .foregroundColor(isActive ? .white : Color(hex: 0xe9edf0))
                        .shadow(color: .black.opacity(0.85), radius: 1, x: 0, y: 2)
                        .padding(.bottom, 4)
                        .padding(.top, isActive ? 4 : 0)
                        .frame(width: 204, height: isActive ? 77 : 54)
                        .background(StretchedSprite(isActive ? "hud_headeractive01" : "hud_headeridle01"))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .offset(x: tab.2, y: -4)
            }
        }
        .frame(width: Stage.width, height: 92, alignment: .bottomLeading)
        .overlay(alignment: .bottom) {
            TiledSprite("hud_nineframe02").frame(height: 16).offset(y: 10).allowsHitTesting(false)
        }
        .zIndex(2)
    }
}

/// comp_enemy_entry: popup fill between the hud_nineframe02 / 07 rules.
struct PvpRowBackground: View {
    var body: some View {
        ZStack(alignment: .top) {
            Color(hex: 0x1a1918, alpha: 0.9)
            TiledSprite("hud_nineframe02").frame(height: 48).frame(maxHeight: .infinity, alignment: .top).clipped()
            TiledSprite("hud_nineframe07").frame(height: 48).frame(maxHeight: .infinity, alignment: .bottom).clipped()
        }
        .allowsHitTesting(false)
    }
}
