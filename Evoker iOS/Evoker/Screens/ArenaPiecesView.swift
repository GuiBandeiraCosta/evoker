import SwiftUI
import EvokerCore

/// Pieces tab of the Arena screen (`src/ui/screens/arena-pieces.js`): the 4 x 2 grid of hunted cards with the
/// original puzzle overlays and an attack button under each; empty slots offer a first piece for gems. The attack
/// button opens the holder's info popup with Fight and "Reroll opponent"; the card opens its pieces with the
/// buy-the-rest button.
struct ArenaPiecesView: View {
    @EnvironmentObject private var model: AppModel

    private static let small = CGSize(width: 156, height: 182)
    private static let large = CGSize(width: 315, height: 447)

    var body: some View {
        if let state = model.store.state {
            let event = model.event
            let firstPrice = event == .cardPieceDay ? Constants.firstPieceGemsEvent : Constants.firstPieceGems
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(174), spacing: 0), count: 4), spacing: 34) {
                ForEach(0..<PieceOps.maxHunts, id: \.self) { i in
                    if i < state.pieces.count, let def = model.db.get(state.pieces[i].cardId) {
                        let hunt = state.pieces[i]
                        VStack(spacing: 14) {
                            Button(action: { Task { @MainActor in await openPieces(i) } }) {
                                PuzzleView(def: def, owned: hunt.owned, total: hunt.total, width: ArenaPiecesView.small.width, height: ArenaPiecesView.small.height)
                            }
                            .buttonStyle(PressScaleStyle())
                            Button(action: { Task { @MainActor in await openHolder(i) } }) {
                                ZStack {
                                    NineSlice(Theme.Frames.quadbutton)
                                    Sprite("fight_icon_active").frame(width: 60, height: 60).shadow(color: .black.opacity(0.7), radius: 1, x: 0, y: 2)
                                }
                                .frame(width: 152, height: 66)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(PressScaleStyle())
                        }
                    } else {
                        VStack(spacing: 14) {
                            Button(action: { Task { @MainActor in await buyFirst(price: firstPrice) } }) {
                                ZStack {
                                    StretchedSprite("cardslot01")
                                    Sprite("addcard_icon").frame(width: 96, height: 96).shadow(color: .black.opacity(0.8), radius: 4, x: 0, y: 2)
                                }
                                .frame(width: ArenaPiecesView.small.width, height: ArenaPiecesView.small.height)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(PressScaleStyle())
                            Button(action: { Task { @MainActor in await buyFirst(price: firstPrice) } }) {
                                ZStack {
                                    NineSlice(Theme.Frames.quadbuttonShop)
                                    HStack(spacing: 6) {
                                        Sprite("getcardpiece_icon").frame(width: 40, height: 36)
                                        Text(fmtNumber(firstPrice)).font(Theme.num(22)).foregroundColor(.white).shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 1)
                                        Sprite("hud_gemicon01").frame(width: 26, height: 26)
                                    }
                                }
                                .frame(width: 152, height: 66)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(PressScaleStyle())
                        }
                    }
                }
            }
            .padding(.top, 34).padding(.bottom, 10)
            .frame(maxWidth: .infinity)
        }
    }

    /// Holder info popup with Fight and "Reroll opponent" (comp_enemyinfo_popup).
    private func openHolder(_ index: Int) async {
        guard let state0 = model.store.state, index < state0.pieces.count else { return }
        _ = model.update(toastOnError: false) { s, d, t in
            let r = PieceOps.huntHolder(s, deps: d, now: t, index: index)
            return (state: r.state, info: r.holder)
        }
        guard let state = model.store.state, index < state.pieces.count else { return }
        let hunt = state.pieces[index]
        guard let holderId = hunt.holderId, let sim = OpponentOps.getSim(state, simId: holderId) else {
            let def = model.db.get(hunt.cardId)
            let ok = await model.dialogs.confirm(title: Strings.pieces, message: "\(Strings.noHolder) Would you like to assemble it now?", okLabel: Strings.assemble)
            if ok, let d = def { await buyMissing(index, def: d) }
            return
        }
        model.sfx("ui_button_circular")
        let r = await PvpDialogs.showSimInfo(OpponentOps.simInfo(sim, deps: model.deps), model: model, canAttack: true, rerollGems: PieceOps.skipGems)
        if r == "attack" { attackHolder(index) }
        if r == "reroll" {
            if await skip(index) { await openHolder(index) }
        }
    }

    /// The hunted card with its pieces and the buy-the-rest button.
    private func openPieces(_ index: Int) async {
        guard let state = model.store.state, index < state.pieces.count, let def = model.db.get(state.pieces[index].cardId) else { return }
        let hunt = state.pieces[index]
        let prog = huntProgress(owned: hunt.owned, total: hunt.total)
        let price = PieceOps.huntBuyPrice(state, deps: model.deps, index: index, event: model.event)
        model.sfx("ui_button_card")
        var r = DialogRequest()
        r.title = def.name
        r.width = 460
        r.body = { _ in
            AnyView(VStack(spacing: 14) {
                PuzzleView(def: def, owned: hunt.owned, total: hunt.total, width: ArenaPiecesView.large.width, height: ArenaPiecesView.large.height)
                HStack(spacing: 10) {
                    Sprite("cardpiece_icon").frame(width: 44, height: 44)
                    Text(prog.text).font(Theme.num(28)).foregroundColor(Theme.tan)
                }
            }.padding(.top, 6))
        }
        var buttons: [DialogButton] = []
        if prog.missing > 0 {
            buttons.append(DialogButton("Complete", value: "buy", variant: .green, content: AnyView(HStack(spacing: 8) {
                Text("Complete: \(fmtNumber(price))")
                Sprite("hud_gemicon01").frame(width: 30, height: 30)
            })))
        }
        buttons.append(DialogButton(Strings.attack, value: "attack"))
        r.buttons = buttons
        let choice = await model.dialogs.open(r)
        if choice == "buy" { await buyMissing(index, def: def) }
        if choice == "attack" { await openHolder(index) }
    }

    private func attackHolder(_ index: Int) {
        guard let state = model.store.state, index < state.pieces.count, let h = state.pieces[index].holderId, OpponentOps.getSim(state, simId: h) != nil else {
            model.toast(Strings.noHolder)
            return
        }
        model.sfx("ui_button_circular")
        model.router.go(.prebattle(.pieces(huntIndex: index)))
    }

    /// "Reroll opponent" for gems; true when a new holder was found.
    private func skip(_ index: Int) async -> Bool {
        guard let state = model.store.state else { return false }
        if state.player.gems < PieceOps.skipGems {
            model.toast(Strings.needGemsNewEnemy, icon: "hud_gemiconsingle")
            return false
        }
        if !model.updateState({ s, d, t in try PieceOps.skipHolder(s, deps: d, now: t, index: index) }) { return false }
        model.sfx("fight_curse")
        return true
    }

    private func buyMissing(_ index: Int, def: CardDef) async {
        guard let state = model.store.state, index < state.pieces.count else { return }
        let hunt = state.pieces[index]
        let prog = huntProgress(owned: hunt.owned, total: hunt.total)
        let price = PieceOps.huntBuyPrice(state, deps: model.deps, index: index, event: model.event)
        if state.player.gems < price {
            model.toast("You need \(fmtNumber(price)) gems.", icon: "hud_gemiconsingle")
            return
        }
        let ok = await model.dialogs.confirm(title: Strings.buyPieces, message: "Buy the \(prog.missing) missing piece\(prog.missing == 1 ? "" : "s") of \(def.name) for \(fmtNumber(price)) gems?", okLabel: Strings.buy)
        if !ok { return }
        let ev = model.event
        let r: BuyPiecesResult? = model.update { s, d, t in
            let r = try PieceOps.buyMissingPieces(s, deps: d, now: t, index: index, event: ev)
            return (state: r.state, info: r.info)
        }
        if r == nil { return }
        model.sfx("shop_buy_gems")
        await model.celebratePiece(cardId: def.id)
    }

    private func buyFirst(price: Int) async {
        guard let state = model.store.state else { return }
        if state.pieces.count >= PieceOps.maxHunts { model.toast(Strings.allPieceSlotsUsed); return }
        if state.player.gems < price { model.toast(Strings.needGemsNewPiece, icon: "hud_gemiconsingle"); return }
        let ok = await model.dialogs.confirm(title: Strings.getMore, message: "Get an awesome new card piece for \(fmtNumber(price)) gems?", okLabel: Strings.buy)
        if !ok { return }
        let ev = model.event
        let r: BuyFirstPieceResult? = model.update { s, d, t in
            let r = try PieceOps.buyFirstPiece(s, deps: d, now: t, event: ev)
            return (state: r.state, info: r.info)
        }
        guard let info = r else { return }
        model.sfx("shop_buy_gems")
        let name = model.db.get(info.cardId)?.name
        model.toast(name.map { "Random card piece received: \($0)" } ?? "Random card piece received", icon: "icon_deckedit_active")
    }
}
