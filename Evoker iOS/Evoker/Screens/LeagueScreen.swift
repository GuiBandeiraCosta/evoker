import SwiftUI
import EvokerCore

/// League screen (`src/ui/screens/league.js`): the comp_league_top_bar band with the tier name in its colour, the
/// d:hh:mm:ss countdown ("FINISHED" at 0) and the info button; one ligaboard_player_bg row per player (the gold
/// variant for the own row) with rank, picture, name, points, prize icons and the fight button; the list opens
/// centred on the own row; the info view (RULES / PRIZES); the enter and finish popups.
struct LeagueScreen: View {
    @EnvironmentObject private var model: AppModel
    @State private var showInfo: Bool = false
    @State private var popupsShown: Bool = false
    @State private var opened: Bool = false

    var body: some View {
        Group {
            if let state = model.store.state {
                if showInfo {
                    infoView
                } else {
                    content(state)
                }
            } else {
                Color.black
            }
        }
        .chrome(active: .league, back: showInfo ? .custom({ model.sfx("ui_button_circular"); showInfo = false }) : .none, help: "league")
        .onAppear {
            openLeague()
            showPopups()
        }
    }

    /// Open today's league when none runs (`openLeague`).
    private func openLeague() {
        guard let state = model.store.state else { return }
        let lg = state.sim.league
        if lg == nil || lg!.day != JSDate.utcDay(model.now) || lg!.v != LeagueOps.leagueVersion {
            let ev = model.event
            _ = model.update(toastOnError: false) { s, d, t in
                let r = LeagueOps.openLeague(s, deps: d, now: t, event: ev)
                return (state: r.state, info: r.info)
            }
        }
    }

    private func showPopups() {
        guard !popupsShown, let state = model.store.state else { return }
        popupsShown = true
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 60_000_000)
            if let pending = state.sim.leaguePending {
                await showFinish(pending)
            } else if !LeagueOps.hasJoined(state) && StateOps.isUnlocked(state, .league) {
                await showEnter()
            }
        }
    }

    private func content(_ state: GameState) -> some View {
        let league = state.sim.league
        let tier = LeagueOps.tierDef(league?.tier ?? LeagueOps.leagueTierOf(state))
        let rows = LeagueOps.standings(state, deps: model.deps, now: model.now)
        return VStack(spacing: 0) {
            // top bar
            ZStack(alignment: .top) {
                Sprite("ligaboard_top_bg", contentMode: .fill).frame(width: 900, height: 117).frame(width: Stage.width).clipped()
                Text(tier.name)
                    .font(Theme.font(56))
                    .foregroundColor(Theme.tier(tier.id))
                    .shadow(color: .black, radius: 0, x: 3, y: 3)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .frame(width: Stage.width - 180, height: 64)
                    .offset(y: 8)
                if let lg = league {
                    CountdownText(endsAt: lg.endsAt, style: .dhms, font: Theme.num(22), color: .white, plate: true) {
                        Task { @MainActor in
                            try? await Task.sleep(nanoseconds: 1_200_000_000)
                            openLeague()
                            model.router.rerender()
                        }
                    }
                    .frame(width: 172, height: 36)
                    .offset(y: 76)
                } else {
                    Text(Strings.finished).font(Theme.num(22)).foregroundColor(.white).frame(width: 172, height: 36).background(NineSlice(Theme.Frames.ligaTimer)).offset(y: 76)
                }
                IconButton(sprite: "info_icon", size: .sm, iconScale: 0.56) { model.sfx("ui_button_circular"); showInfo = true }
                    .frame(width: 64, height: 64)
                    .offset(x: Stage.width / 2 - 22 - 32, y: 22)
            }
            .frame(width: Stage.width, height: 128)
            ScrollViewReader { proxy in
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(spacing: 4) {
                        EventBannerView().padding(.horizontal, 12)
                        if rows.isEmpty {
                            Text(Strings.loading).font(Theme.font(26)).foregroundColor(Theme.muted).padding(40)
                        }
                        ForEach(rows, id: \.id) { r in
                            LeagueRowView(row: r, onInfo: { Task { @MainActor in await openSimInfo(r.id) } }, onAttack: { attack(r.id) })
                                .id(r.isPlayer ? "me" : r.id)
                        }
                    }
                    .padding(.vertical, 6)
                }
                .onAppear {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                        proxy.scrollTo("me", anchor: .center)
                    }
                }
            }
        }
        .background(FullscreenBackground(tint: Color(hex: 0x120c08)))
    }

    private func attack(_ simId: String) {
        guard let state = model.store.state else { return }
        let check = LeagueOps.canFightLeague(state, simId: simId, now: model.now)
        if !check.ok {
            model.toast(check.reason ?? "You cannot fight this player now.", icon: "lock_small")
            if check.code == .ended { openLeague(); model.router.rerender() }
            return
        }
        guard OpponentOps.getSim(state, simId: simId) != nil else { return }
        model.sfx("ui_button_circular")
        model.router.go(.prebattle(.league(simId: simId)))
    }

    private func openSimInfo(_ simId: String) async {
        guard let state = model.store.state, let sim = OpponentOps.getSim(state, simId: simId) else { return }
        let can = LeagueOps.canFightLeague(state, simId: simId, now: model.now)
        if await PvpDialogs.showSimInfo(OpponentOps.simInfo(sim, deps: model.deps), model: model, canAttack: can.ok) == "attack" { attack(simId) }
    }

    // MARK: Popups (comp_league_enter_popup / comp_league_finish_popup)

    private func showEnter() async {
        guard let state = model.store.state else { return }
        let tier = LeagueOps.tierDef(LeagueOps.leagueTierOf(state))
        var r = DialogRequest()
        r.title = tier.name.uppercased()
        r.ornamentTitle = true
        r.closable = false
        r.width = 640
        r.body = { _ in
            AnyView(VStack(spacing: 10) {
                Text(Strings.leaguesUnlocked).font(Theme.font(32)).foregroundColor(Theme.text)
                Text(Strings.leagueDesc1).font(Theme.font(26)).foregroundColor(Theme.text).multilineTextAlignment(.center)
                Text(Strings.leagueDesc2).font(Theme.font(26)).foregroundColor(Theme.text).multilineTextAlignment(.center)
                Text(Strings.enterNextLeague).font(Theme.font(26)).foregroundColor(Theme.text).padding(.top, 26)
                Text(tier.name).font(Theme.font(42)).foregroundColor(Theme.tier(tier.id)).shadow(color: .black, radius: 0, x: 2, y: 2)
            }.padding(.top, 8).padding(.bottom, 14))
        }
        r.buttons = [DialogButton(Strings.joinLeague, value: "ok")]
        _ = await model.dialogs.open(r)
        model.updateState(toastOnError: false) { s, _, _ in LeagueOps.joinLeague(s) }
    }

    private func showFinish(_ result: LeaguePrizes) async {
        let prev = LeagueOps.tierDef(result.tier)
        let next = LeagueOps.tierDef(result.nextTier)
        var rewards: [PrizeItem] = []
        if let card = result.card { rewards.append(PrizeItem(kind: .card, amount: 1, rarity: card)) }
        if result.mana > 0 { rewards.append(PrizeItem(kind: .mana, amount: result.mana)) }
        if result.stamina > 0 { rewards.append(PrizeItem(kind: .stamina, amount: result.stamina)) }
        if result.gems > 0 { rewards.append(PrizeItem(kind: .gems, amount: result.gems)) }
        var r = DialogRequest()
        r.title = prev.name.uppercased()
        r.ornamentTitle = true
        r.closable = false
        r.width = 640
        r.body = { _ in
            AnyView(VStack(spacing: 10) {
                Text(Strings.congratulations).font(Theme.font(32)).foregroundColor(Theme.text)
                Text("\(prev.name) completed").font(Theme.font(32)).foregroundColor(Theme.text)
                Text("Your rank: \(result.rank)").font(Theme.font(46)).foregroundColor(Theme.text).padding(.vertical, 4)
                if !rewards.isEmpty {
                    HStack(spacing: 22) {
                        ForEach(Array(rewards.enumerated()), id: \.offset) { item in
                            PrizeIcon(item: item.element, big: true)
                        }
                    }
                    .padding(.bottom, 10)
                }
                Text(rewards.isEmpty ? Strings.enterNextLeague : Strings.takeRewardNextLeague).font(Theme.font(26)).foregroundColor(Theme.text).padding(.top, 16)
                Text(next.name).font(Theme.font(42)).foregroundColor(Theme.tier(next.id)).shadow(color: .black, radius: 0, x: 2, y: 2)
            }.padding(.top, 8).padding(.bottom, 14))
        }
        r.buttons = [DialogButton(Strings.joinLeague, value: "ok", variant: .green)]
        _ = await model.dialogs.open(r)
        let collected: LeaguePrizes? = model.update(toastOnError: false) { s, d, _ in
            let r = LeagueOps.collectLeagueResult(LeagueOps.joinLeague(s), deps: d)
            return (state: r.state, info: r.result)
        } ?? nil
        if !rewards.isEmpty { model.sfx("quest_reward_collect") }
        if let cardId = collected?.cardId, let def = model.db.get(cardId) {
            model.toast("New card: \(def.name)", icon: "icon_deckedit_active")
        }
        model.router.rerender()
    }

    // MARK: Info view (ctrl_league_info)

    private var infoView: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: 10) {
                headline(Strings.rules)
                Text(LeagueOps.rulesText)
                    .font(Theme.font(25))
                    .foregroundColor(.white)
                    .lineSpacing(8)
                    .padding(.vertical, 14).padding(.horizontal, 22)
                    .frame(width: 680, alignment: .leading)
                    .background(Color(hex: 0x100f0d, alpha: 0.92))
                    .overlay(NineSlice(Theme.Frames.smallYellow))
                headline(Strings.prizes)
                ForEach(LeagueOps.prizeTables(), id: \.tier.id) { table in
                    VStack(spacing: 6) {
                        HeaderPlate(text: table.tier.name, big: true, color: Theme.tier(table.tier.id), fontSize: 38)
                            .frame(width: 680)
                        VStack(spacing: 0) {
                            ForEach(Array(table.rows.enumerated()), id: \.offset) { item in
                                HStack(alignment: .firstTextBaseline, spacing: 0) {
                                    Text(item.element.rank).font(Theme.num(23)).foregroundColor(.white).frame(width: 96, alignment: .leading)
                                    Text(item.element.text).font(Theme.font(23)).foregroundColor(.white).frame(maxWidth: .infinity, alignment: .leading)
                                }
                                .frame(minHeight: 37)
                            }
                        }
                        .padding(.vertical, 14).padding(.horizontal, 22)
                        .frame(width: 680)
                        .background(Color(hex: 0x100f0d, alpha: 0.92))
                        .overlay(NineSlice(Theme.Frames.smallYellow))
                    }
                }
            }
            .padding(.top, 4).padding(.bottom, 24)
            .frame(maxWidth: .infinity)
        }
        .background(FullscreenBackground(tint: Color(hex: 0x120c08)))
    }

    private func headline(_ text: String) -> some View {
        ZStack {
            Sprite("ligaboard_top_bg", contentMode: .fill).frame(width: 900, height: 117).frame(width: Stage.width).clipped()
            Text(text).font(Theme.font(54)).foregroundColor(Color(hex: 0xffcf35)).shadow(color: .black, radius: 0, x: 3, y: 3)
        }
        .frame(width: Stage.width, height: 117)
    }
}

/// One standings row (comp_league_list_entry on ligaboard_player_bg).
struct LeagueRowView: View {
    let row: LeagueRow
    let onInfo: () -> Void
    let onAttack: () -> Void
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ZStack(alignment: .topLeading) {
            StretchedSprite(row.isPlayer ? "ligaboard_player_bg_gold" : "ligaboard_player_bg")
            Text(row.rankText)
                .font(Theme.num(52))
                .foregroundColor(row.markRank ? Color(hex: 0xfed00f) : .white)
                .shadow(color: .black, radius: 0, x: 2, y: 2)
                .frame(width: 80, height: 124)
                .offset(x: 18)
            Button(action: { if !row.isPlayer { model.sfx("ui_button_circular"); onInfo() } }) {
                ZStack {
                    Color(hex: 0x0a0b0c)
                    if row.isPlayer || row.picture {
                        PortraitView(avatar: row.avatar, size: 98).overlay(Color.clear)
                    } else {
                        Sprite("default_player", contentMode: .fill)
                    }
                }
                .frame(width: 98, height: 98)
                .clipped()
                .overlay(NineSlice(Theme.Frames.smallWhite))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(row.isPlayer)
            .at(96, 13, 98, 98)
            Text(row.name)
                .font(Theme.font(30))
                .foregroundColor(row.isPlayer ? Color(hex: 0xfed00f) : Theme.gold)
                .shadow(color: .black, radius: 0, x: 1, y: 1)
                .lineLimit(1)
                .frame(width: 405, height: 50, alignment: .leading)
                .offset(x: 216, y: 6)
            HStack(spacing: 12) {
                Sprite("pvp_points").frame(width: 50, height: 50)
                Text("\(row.points)").font(Theme.num(32)).foregroundColor(.white).shadow(color: .black, radius: 0, x: 1, y: 1)
            }
            .frame(height: 54)
            .offset(x: 222, y: 56)
            HStack(spacing: row.rewards.count == 1 ? 12 : 0) {
                ForEach(Array(row.rewards.prefix(2).enumerated()), id: \.offset) { item in
                    PrizeIcon(item: item.element, big: false)
                    if row.rewards.count > 1 && item.offset == 0 { Spacer(minLength: 0) }
                }
            }
            .padding(.horizontal, 6)
            .frame(width: 201, height: 54)
            .offset(x: 389, y: 45)
            Button(action: { if !row.isPlayer { onAttack() } }) {
                ZStack {
                    NineSlice(Theme.Frames.buttonDefault)
                    Sprite(row.fightable ? "fight_icon_active" : "fight_icon_inactive").frame(width: 65, height: 65)
                }
                .frame(width: 88, height: 88)
                .saturation(row.fightable ? 1 : 0.25)
                .brightness(row.fightable ? 0 : -0.2)
                .contentShape(Rectangle())
            }
            .buttonStyle(PressScaleStyle())
            .disabled(row.isPlayer)
            .at(604, 18, 88, 88)
        }
        .frame(width: 716, height: 124, alignment: .topLeading)
    }
}

/// A prize icon with its amount ("x5"): card fan, blue mana potion, orange stamina potion, gem pile.
struct PrizeIcon: View {
    let item: PrizeItem
    let big: Bool

    private var sprite: String {
        switch item.kind {
        case .card: return "reward_cardslots"
        case .mana: return "potion_mana1"
        case .stamina: return "potion_stamina1"
        case .gems: return "reward_gems"
        }
    }

    var body: some View {
        let size: CGFloat = big ? (item.kind == .card || item.kind == .gems ? 92 : 76) : (item.kind == .card ? 54 : (item.kind == .gems ? 56 : 46))
        HStack(spacing: 2) {
            Sprite(sprite).frame(width: size, height: size)
            Text("x\(fmtNumber(item.amount))").font(Theme.num(big ? 32 : 24)).foregroundColor(big ? Color(hex: 0xffcf35) : .white).shadow(color: .black, radius: 0, x: 1, y: 1)
        }
    }
}
