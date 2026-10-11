import SwiftUI
import EvokerCore

/// Card detail screen (`src/ui/screens/card-detail.js`): name plate with "+" marks, tribe emblem, big art with
/// direction arrows, rarity label + 5 pips, level bar, stats panel, magnifier (zoom) and "$" (sell, owned cards
/// only, never for cards in the deck). No bottom nav, like the original's full-screen card view.
struct CardDetailScreen: View {
    let target: CardDetailTarget
    @EnvironmentObject private var model: AppModel
    @State private var zoom: Bool = false

    var body: some View {
        Group {
            if let state = model.store.state {
                content(state)
            } else {
                Color.black
            }
        }
        .chrome(active: .cards, back: .pop(fallback: .cards()), help: "card-detail", hideNav: true)
    }

    /// The stage of a catalog target (0 for an owned card: its instance carries the stage).
    private var catalogStage: Int {
        if case .catalog(_, let s, _) = target { return s }
        return 0
    }

    private func resolve(_ state: GameState) -> (inst: CardInstance?, def: CardDef?) {
        switch target {
        case .owned(let uid):
            let inst = StateOps.getCard(state, uid: uid)
            return (inst, inst.flatMap { model.db.get($0.cardId) })
        case .catalog(let cardId, _, _):
            return (nil, model.db.get(cardId))
        }
    }

    private func content(_ state: GameState) -> some View {
        let r = resolve(state)
        return ZStack {
            // painted backdrop tinted by the card's tribe
            ZStack {
                Color(hex: 0x1b1d1f)
                Sprite("quest-valley", contentMode: .fill).frame(width: Stage.width).clipped().saturation(0.85)
                if let def = r.def {
                    LinearGradient(colors: [Theme.tribe(def.tribe).opacity(0.5), Theme.tribe(def.tribe).opacity(0.3), Color(hex: 0x141618, alpha: 0.9)], startPoint: .top, endPoint: .bottom)
                }
            }
            if let def = r.def {
                let face = r.inst.map { CardFaceModel.fromInstance($0, def: def, deps: model.deps) }
                    ?? { () -> CardFaceModel in
                        if case .catalog(_, let stage, let level) = target { return CardFaceModel.fromDef(def, stage: stage, level: level, deps: model.deps) }
                        return CardFaceModel.fromDef(def, stage: 0, level: 1, deps: model.deps)
                    }()
                let inDeck = r.inst.map { CollectionOps.isInDeck(state, uid: $0.uid) } ?? false
                let price = r.inst.map { CollectionOps.sellValueOf(state, deps: model.deps, uid: $0.uid) } ?? 0
                let pieces = r.inst == nil ? CardsHelpers.pieceHuntFor(state, cardId: def.id) : nil
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(spacing: 4) {
                        CardDetailView(face: face, showStats: true, pieces: pieces, inDeck: inDeck, actions: actions(face: face, inst: r.inst, def: def, price: price, inDeck: inDeck))
                            .padding(.top, 4)
                        HStack(spacing: 12) {
                            if let inst = r.inst {
                                chip(sprite: inDeck ? "cardindeck" : "hud_coinsicon01", text: inDeck ? Strings.inYourDeck : Strings.sellsFor(price), color: inDeck ? Theme.mana : Theme.muted)
                                    .id(inst.uid)
                            } else {
                                chip(sprite: "icon_deckedit_active", text: Strings.catalogCard, color: Theme.muted)
                            }
                            if let v = face.abilityValue {
                                chip(sprite: "hud_specialskill01", text: Abilities.formatValue(v), color: Theme.ability)
                            }
                            chip(sprite: nil, text: setLabel(def), color: Theme.muted)
                        }
                        .frame(width: 600)
                        .padding(.bottom, 6)
                    }
                    .frame(maxWidth: .infinity)
                }
            } else {
                VStack(spacing: 20) {
                    Text(r.inst == nil && target.isOwned ? Strings.cardGone : Strings.unknownCard).font(Theme.font(26)).foregroundColor(Theme.text)
                    SteelButton(Strings.back) { model.router.back(fallback: .cards()) }
                }
                .padding(30)
                .background(Panel { Color.clear })
                .padding(40)
            }
            if zoom, let def = r.def {
                zoomOverlay(def: def, stage: r.inst?.stage ?? catalogStage)
            }
        }
    }

    private func actions(face: CardFaceModel, inst: CardInstance?, def: CardDef, price: Int, inDeck: Bool) -> [(sprite: String, label: String, action: () -> Void)] {
        var out: [(sprite: String, label: String, action: () -> Void)] = [("button_zoom", Strings.zoom, { model.sfx("ui_button_card_showup"); withAnimation(.easeOut(duration: Theme.medium)) { zoom = true } })]
        if let inst = inst {
            out.append(("button_sell", inDeck ? Strings.cardsInDeckNoSell : "Sell for \(fmtNumber(price)) gold", { sell(inst: inst, def: def, price: price, inDeck: inDeck) }))
        }
        return out
    }

    private func chip(sprite: String?, text: String, color: Color) -> some View {
        HStack(spacing: 8) {
            if let s = sprite { Sprite(s).frame(width: 26, height: 26) }
            Text(text).font(Theme.font(18)).foregroundColor(color).lineLimit(1)
        }
        .padding(.vertical, 2).padding(.horizontal, 12)
        .background(Color(hex: 0x0a0b0c, alpha: 0.78))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(color == Theme.mana ? Theme.mana : Theme.stoneEdge, lineWidth: 2))
    }

    /// Human name of the card's set (a quest line's name, else the id capitalised).
    private func setLabel(_ def: CardDef) -> String {
        if let q = model.deps.quests {
            if q.main.id == def.set { return q.main.name }
            if let p = q.portals.first(where: { $0.id == def.set }) { return p.name }
        }
        if def.set.isEmpty { return "Main" }
        return def.set.split(separator: "-").map { capitalized(String($0)) }.joined(separator: " ")
    }

    /// Full-stage art zoom overlay; a tap closes it.
    private func zoomOverlay(def: CardDef, stage: Int) -> some View {
        ZStack {
            Color.black.opacity(0.92)
            VStack(spacing: 14) {
                CardArt(def: def, stage: stage)
                    .frame(width: 700, height: 980)
                    .cornerRadius(6)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color(hex: 0x4a4f54), lineWidth: 4))
                    .shadow(color: .black.opacity(0.95), radius: 30, x: 0, y: 10)
                Plate { Text(cardNameWithPlus(def.name, stage: stage)).font(Theme.font(34)).foregroundColor(Theme.text) }
                Text(Strings.tapToClose).font(Theme.font(22)).foregroundColor(Color.white.opacity(0.7))
            }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            model.sfx("ui_button_card_close")
            withAnimation(.easeOut(duration: Theme.medium)) { zoom = false }
        }
        .transition(.opacity)
        .zIndex(110)
    }

    /// Sell flow: confirm dialog, store update, toast, back.
    private func sell(inst: CardInstance, def: CardDef, price: Int, inDeck: Bool) {
        if inDeck {
            model.toast(Strings.cardsInDeckNoSell, icon: "lock_small")
            return
        }
        Task { @MainActor in
            let ok = await model.dialogs.confirm(title: Strings.sellCard, message: "Sell \(cardNameWithPlus(def.name, stage: inst.stage)) (Level \(inst.level)) for \(fmtNumber(price)) gold?", okLabel: Strings.sell, danger: true)
            if !ok { return }
            let gold: Int? = model.update { s, d, _ in
                let r = try CollectionOps.sellCard(s, deps: d, uid: inst.uid)
                return (state: r.state, info: r.gold)
            }
            guard let g = gold else { return }
            model.sfx("shop_buy_gold")
            model.toast(Strings.soldFor(g), icon: "hud_coinsicon01")
            model.router.back(fallback: .cards())
        }
    }
}

extension CardDetailTarget {
    var isOwned: Bool {
        if case .owned = self { return true }
        return false
    }
}
