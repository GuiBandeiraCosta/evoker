import SwiftUI
import EvokerCore

/// Cards screen = the client's deck screen with its three modes (`src/ui/screens/cards.js`, `cards-ops.js`,
/// `cards-dnd.js`): deck edit ("Your Deck": the 5 slots, "Your cards n/100", the "Mana needed" bar), training
/// ("Card Training": Training slot + Sacrifice stack, price, OK) and fusion ("Fuse cards": Slot 1 + Slot 2, price,
/// OK). Below: the mode stripe with the three icon buttons and the card slider. Cards move by drag and drop only;
/// a tap opens the card detail.
struct CardsScreen: View {
    let tab: CardsTab
    @EnvironmentObject private var model: AppModel
    @StateObject private var dnd = DragDropCoordinator()
    @State private var mode: CardsMode = .deck
    @State private var modeSet: Bool = false
    @State private var offsets: [CardsMode: Double] = [:]
    @State private var trainUid: String? = nil
    @State private var sacrifices: [String] = []
    @State private var fuse: [String?] = [nil, nil]
    @State private var fx: OpFx? = nil

    private var sliderOffset: Binding<Double> {
        Binding(get: { offsets[mode] ?? SliderGeometry.start }, set: { offsets[mode] = $0 })
    }

    var body: some View {
        Group {
            if let state = model.store.state {
                content(state)
            } else {
                Color.black
            }
        }
        .chrome(active: .cards, back: .none, help: mode.help)
        .onAppear {
            if !modeSet {
                modeSet = true
                mode = CardsMode(tab: tab)
                if let state = model.store.state, let f = mode.feature, !StateOps.isUnlocked(state, f) { mode = .deck }
            }
            setupDnd()
        }
    }

    // MARK: Layout (ctrl_deckedit / ctrl_enhance / ctrl_evolve on the 720 × 1026 body)

    private func content(_ state: GameState) -> some View {
        let deps = model.deps
        let pruned = CardsHelpers.pruneTrainingSelection(state, trainUid: trainUid, sacrifices: sacrifices)
        let fuseSlots = CardsHelpers.pruneFusionSlots(state, slots: fuse)
        let entries = CardsHelpers.sliderEntries(state, deps: deps, mode: mode, trainUid: pruned.trainUid, sacrifices: pruned.sacrifices, fuse: fuseSlots)
        return ZStack(alignment: .topLeading) {
            Sprite("fullscreen_background", contentMode: .fill)
                .frame(width: 900, height: 1440)
                .offset(x: -90, y: -198)
                .clipped()
            CardsSliderView(entries: entries, inDeck: Set(state.deck.compactMap { $0 }), offset: sliderOffset, dnd: dnd, onTap: { e in
                model.sfx("ui_button_card")
                switch e {
                case .card(let uid, _): model.router.go(.cardDetail(.owned(uid: uid)))
                case .piece(let cardId, _, _, _): model.router.go(.cardDetail(.catalog(cardId: cardId, stage: 0, level: 1)))
                }
            })
            .offset(x: CardsSliderView.box.minX, y: CardsSliderView.box.minY)
            Text(mode.title)
                .font(Theme.font(40))
                .foregroundColor(Color(hex: 0xf2efe7))
                .shadow(color: .black.opacity(0.9), radius: 1.5, x: 0, y: 2)
                .frame(width: Stage.width, height: 60)
                .offset(y: 114 - 30)
                .allowsHitTesting(false)
            switch mode {
            case .deck: deckBox(state)
            case .training: trainingBox(state, trainUid: pruned.trainUid, sacrifices: pruned.sacrifices)
            case .fusion: fusionBox(state, slots: fuseSlots)
            }
            modeStripe(state)
            if let fx = fx {
                OpFxView(fx: fx) { self.fx = nil }
                    .zIndex(100)
            }
        }
        .frame(width: Stage.width, alignment: .topLeading)
        .clipped()
        .dragDropLayer(dnd)
        .onAppear {
            trainUid = pruned.trainUid
            sacrifices = pruned.sacrifices
            fuse = fuseSlots
        }
    }

    // MARK: Deck box (comp_deck_layout)

    private func deckBox(_ state: GameState) -> some View {
        let sum = CardsHelpers.deckSummary(state, deps: model.deps)
        let pct = { (v: Int) -> CGFloat in CGFloat(barRatio(Double(v), Double(sum.manaMax))) }
        return ZStack(alignment: .topLeading) {
            Color(hex: 0x1a1918, alpha: 0.9).cornerRadius(4)
            NineSlice(Theme.Frames.smallWhite)
            HStack(spacing: 22) {
                ForEach(0..<5, id: \.self) { i in
                    ZStack(alignment: .top) {
                        DeckSlotView(locked: !sum.unlocked[i], small: true, highlight: dnd.highlight(.slot(i)), width: 124, height: 146)
                        if let inst = sum.slots[i], sum.unlocked[i], let face = CardFaceModel.forUid(inst.uid, state: state, deps: model.deps) {
                            CardFaceView(face: face, size: .compact, inDeck: true)
                                .scaleEffect(1.0333, anchor: .top)
                                .frame(width: 124, height: 146, alignment: .top)
                                .clipped()
                                .draggableCard(dnd, payload: DragPayload(uid: inst.uid, cardId: inst.cardId, pieceId: nil, fromSlot: i, fromZone: nil), face: face) {
                                    model.sfx("ui_button_card")
                                    model.router.go(.cardDetail(.owned(uid: inst.uid)))
                                }
                        }
                    }
                    .dropTarget(.slot(i))
                }
            }
            .frame(width: 716)
            .offset(y: 14)
            // "Your cards n/100"
            VStack(spacing: 0) {
                Text(Strings.yourCards).font(Theme.font(20)).foregroundColor(Color(hex: 0xe5e5e5))
                Text("\(sum.poolCount)/\(sum.poolLimit)").font(Theme.num(20)).foregroundColor(sum.poolFull ? Color(hex: 0xff0000) : Color(hex: 0xe5e5e5))
            }
            .shadow(color: .black, radius: 1, x: 0, y: 1)
            .frame(width: 222, height: 50)
            .background(Color(hex: 0x121212))
            .overlay(NineSlice(Theme.Frames.smallWhite))
            .offset(x: 4, y: 168)
            Sprite("hud_manaicon01").frame(width: 44, height: 44).shadow(color: .black.opacity(0.8), radius: 1, x: 0, y: 2)
                .offset(x: 246, y: 171).zIndex(2)
            ZStack(alignment: .bottomLeading) {
                RoundedRectangle(cornerRadius: 3).fill(Color(hex: 0x060708, alpha: 0.92)).overlay(RoundedRectangle(cornerRadius: 3).stroke(Color(hex: 0x050505), lineWidth: 2))
                StretchedSprite("hud_progressbarblue03").background(Theme.mana).frame(width: 428 * pct(sum.manaNow), height: 5).shadow(color: Theme.mana.opacity(0.7), radius: 3)
                Text(Strings.manaNeededText(sum.mana, sum.manaMax))
                    .font(Theme.font(20))
                    .foregroundColor(sum.manaShort ? Color(hex: 0xff0000) : Color(hex: 0xe5e5e5))
                    .shadow(color: .black, radius: 1, x: 0, y: 1)
                    .frame(width: 428, height: 30)
                Sprite("hud_progressbar_pinocle01").frame(width: 14, height: 38).offset(x: 428 * pct(sum.mana) - 7, y: 14 + 8)
            }
            .frame(width: 428, height: 30)
            .offset(x: 280, y: 178)
        }
        .frame(width: 716, height: 226, alignment: .topLeading)
        .shadow(color: .black.opacity(0.6), radius: 6, x: 0, y: 3)
        .offset(x: 2, y: 152)
    }

    // MARK: Training box (ctrl_enhance)

    private func trainingBox(_ state: GameState, trainUid: String?, sacrifices: [String]) -> some View {
        let sum = CardsHelpers.trainingSummary(state, deps: model.deps, trainUid: trainUid, sacrifices: sacrifices)
        let ready = trainUid != nil && !sacrifices.isEmpty
        return opBox {
            // training slot
            zone(id: "train", skull: false) {
                if let uid = trainUid, let face = CardFaceModel.forUid(uid, state: state, deps: model.deps) {
                    CardFaceView(face: face, size: .compact)
                        .scaleEffect(0.8667, anchor: .topLeading)
                        .offset(y: 1)
                        .draggableCard(dnd, payload: DragPayload(uid: uid, cardId: face.cardId, pieceId: nil, fromSlot: nil, fromZone: "train"), face: face) {
                            model.sfx("ui_button_card")
                            model.router.go(.cardDetail(.owned(uid: uid)))
                        }
                }
            }
            .offset(x: 73, y: 38)
            zoneLabel(Strings.trainingSlot).offset(x: 7, y: 205)
            // sacrifice stack
            zone(id: "stack", skull: true) {
                ForEach(Array(sacrifices.enumerated()), id: \.element) { item in
                    if let face = CardFaceModel.forUid(item.element, state: state, deps: model.deps) {
                        let top = item.offset == sacrifices.count - 1
                        let card = CardFaceView(face: face, size: .compact, inDeck: state.deck.contains(item.element))
                            .scaleEffect(0.8667, anchor: .topLeading)
                            .offset(x: CGFloat(item.offset) * 2, y: 1 - CGFloat(item.offset) * 3)
                        if top {
                            card.draggableCard(dnd, payload: DragPayload(uid: item.element, cardId: face.cardId, pieceId: nil, fromSlot: nil, fromZone: "stack"), face: face) {
                                model.sfx("ui_button_card")
                                model.router.go(.cardDetail(.owned(uid: item.element)))
                            }
                        } else {
                            card.allowsHitTesting(false)
                        }
                    }
                }
            }
            .offset(x: 523, y: 38)
            zoneLabel(Strings.sacrificeStack).offset(x: 457, y: 205)
            costLine(sum.gold, short: !sum.canAffordAll).offset(x: 250, y: 50)
            okButton(ready: ready) { Task { @MainActor in await doTrain() } }.offset(x: 235, y: 122)
        }
    }

    // MARK: Fusion box (ctrl_evolve)

    private func fusionBox(_ state: GameState, slots: [String?]) -> some View {
        let check = CardsHelpers.fusionCheck(state, deps: model.deps, slots: slots)
        return opBox {
            ForEach(0..<2, id: \.self) { i in
                zone(id: "fuse\(i + 1)", skull: false) {
                    if let uid = slots[i], let face = CardFaceModel.forUid(uid, state: state, deps: model.deps) {
                        CardFaceView(face: face, size: .compact, inDeck: state.deck.contains(uid))
                            .scaleEffect(0.8667, anchor: .topLeading)
                            .offset(y: 1)
                            .draggableCard(dnd, payload: DragPayload(uid: uid, cardId: face.cardId, pieceId: nil, fromSlot: nil, fromZone: "fuse\(i + 1)"), face: face) {
                                model.sfx("ui_button_card")
                                model.router.go(.cardDetail(.owned(uid: uid)))
                            }
                    }
                }
                .offset(x: i == 0 ? 73 : 523, y: 38)
                zoneLabel(i == 0 ? Strings.slot1 : Strings.slot2).offset(x: i == 0 ? 7 : 457, y: 205)
            }
            costLine(check.cost, short: check.ready && !check.ok).offset(x: 250, y: 50)
            okButton(ready: check.ready) { Task { @MainActor in await doFuse() } }.offset(x: 235, y: 122)
        }
    }

    private func opBox<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        ZStack(alignment: .topLeading) {
            Color(hex: 0x1a1918, alpha: 0.92).cornerRadius(4)
            NineSlice(Theme.Frames.hudNineframe)
            content()
        }
        .frame(width: 700, height: 270, alignment: .topLeading)
        .shadow(color: .black.opacity(0.6), radius: 6, x: 0, y: 3)
        .offset(x: 10, y: 154)
    }

    private func zone<Content: View>(id: String, skull: Bool, @ViewBuilder _ content: () -> Content) -> some View {
        ZStack(alignment: .topLeading) {
            StretchedSprite(skull ? "cardslotskull" : "cardslot")
            content()
        }
        .frame(width: 104, height: 148, alignment: .topLeading)
        .overlay(zoneHighlight(.zone(id)))
        .dropTarget(.zone(id))
    }

    @ViewBuilder
    private func zoneHighlight(_ id: DropTargetID) -> some View {
        switch dnd.highlight(id) {
        case .none: EmptyView()
        case .valid: RoundedRectangle(cornerRadius: 3).stroke(Theme.mana, lineWidth: 3).shadow(color: Theme.mana, radius: 10)
        case .invalid: RoundedRectangle(cornerRadius: 3).stroke(Theme.attack, lineWidth: 3).shadow(color: Theme.attack, radius: 10)
        }
    }

    private func zoneLabel(_ text: String) -> some View {
        Text(text)
            .font(Theme.font(32))
            .foregroundColor(Color(hex: 0xf2efe7))
            .shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 2)
            .lineLimit(1)
            .frame(width: 236)
            .allowsHitTesting(false)
    }

    private func costLine(_ gold: Int, short: Bool) -> some View {
        HStack(spacing: 12) {
            Text("\(gold)").font(Theme.num(40)).foregroundColor(short ? Color(hex: 0xff3b2f) : Color(hex: 0xf2efe7)).shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 2)
            Sprite("hud_coinsicon01").frame(width: 62, height: 62).shadow(color: .black.opacity(0.8), radius: 1, x: 0, y: 2)
        }
        .frame(width: 200, height: 58)
    }

    private func okButton(ready: Bool, action: @escaping () -> Void) -> some View {
        SteelButton(Strings.ok, size: .lg, action: action)
            .frame(width: 230, height: 72)
            .brightness(ready ? 0.15 : 0)
            .shadow(color: ready ? Color(hex: 0x96d7ff, alpha: 0.55) : .clear, radius: 14)
    }

    // MARK: Mode stripe (seperator_big with the three quad buttons)

    private func modeStripe(_ state: GameState) -> some View {
        ZStack(alignment: .topLeading) {
            StretchedSprite("seperator_big").frame(width: 900, height: 61)
            ForEach(CardsMode.order, id: \.rawValue) { m in
                let x: CGFloat = m == .training ? 146 : (m == .deck ? 371 : 596)
                let locked = m.feature.map { !StateOps.isUnlocked(state, $0) } ?? false
                let icon = m == .training ? "enhance" : (m == .deck ? "deckedit" : "fusion")
                let badge = m == .fusion && CardsHelpers.fuseCount(state, deps: model.deps) > 0
                Button(action: {
                    if locked || mode == m { return }
                    model.sfx("ui_button_circular")
                    mode = m
                    offsets[m] = SliderGeometry.start
                }) {
                    ZStack(alignment: .topLeading) {
                        if locked {
                            Sprite("deckeditbutton_locked").frame(width: 172, height: 95).offset(x: -7, y: -4)
                        } else {
                            StretchedSprite("hud_quadbutton_02_fill")
                            StretchedSprite("hud_quadbutton_02_frame")
                            if mode == m {
                                StretchedSprite("\(icon)_on")
                            } else {
                                Sprite("\(icon)_off").frame(width: 172, height: 95).offset(x: -7, y: -4)
                            }
                            if badge {
                                Sprite("badge").frame(width: 81, height: 81).offset(x: 95, y: -29)
                            }
                        }
                    }
                    .frame(width: 158, height: 86, alignment: .topLeading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressScaleStyle())
                .offset(x: x, y: -12)
            }
        }
        .frame(width: 900, height: 61, alignment: .topLeading)
        .shadow(color: .black.opacity(0.6), radius: 3, x: 0, y: 3)
        .offset(x: -90, y: 491)
        .zIndex(4)
    }

    // MARK: Drag and drop rules (cards-dnd.js)

    private func setupDnd() {
        dnd.canDrop = { payload, target in
            guard let state = model.store.state else { return false }
            if payload.pieceId != nil || payload.uid == nil { return false }
            let uid = payload.uid!
            switch mode {
            case .deck:
                guard let slot = target.slot, StateOps.slotUnlocked(state, slot: slot) else { return false }
                return CardsHelpers.manaAfterPlace(state, deps: model.deps, uid: uid, slot: slot) <= state.player.manaMax
            case .training:
                if target.zone == "train" { return true }
                if target.zone == "stack" { return payload.fromZone == "stack" || CardsHelpers.sacrificeEligible(state, uid: uid, trainUid: nil, sacrifices: sacrifices).ok }
                return false
            case .fusion:
                guard let zone = target.zone, zone == "fuse1" || zone == "fuse2" else { return false }
                let other = fuse[zone == "fuse1" ? 1 : 0]
                return CardsHelpers.fitsFusionSlot(state, uid: uid, otherUid: other == uid ? nil : other)
            }
        }
        dnd.onDrop = { payload, target in
            guard let uid = payload.uid else { return }
            switch mode {
            case .deck:
                guard let to = target.slot, payload.fromSlot != to else { return }
                if model.update(toastOnError: false, { s, d, _ in
                    let r = try CollectionOps.placeInDeck(s, deps: d, uid: uid, slot: to)
                    return (state: r.state, info: r.mana)
                }) == nil {
                    model.toast("Cannot place that card", icon: "hud_manaicon01")
                    return
                }
                if let state = model.store.state {
                    let open = (0..<5).filter { StateOps.slotUnlocked(state, slot: $0) }
                    model.sfx(open.allSatisfy { state.deck[$0] != nil } ? "ui_decksetup_card_place_deckfinished" : "ui_decksetup_card_place")
                }
            case .training:
                if target.zone == "train" {
                    if payload.fromZone == "train" { return }
                    sacrifices.removeAll { $0 == uid }
                    trainUid = uid
                    offsets[.training] = nil
                } else if target.zone == "stack" && payload.fromZone != "stack" {
                    if trainUid == uid { trainUid = nil }
                    sacrifices = CardsHelpers.pushSacrifice(sacrifices, uid: uid)
                }
                model.sfx("ui_decksetup_card_place")
            case .fusion:
                let i = target.zone == "fuse2" ? 1 : 0
                var next = fuse
                if next[1 - i] == uid { next[1 - i] = nil }
                next[i] = uid
                fuse = next
                model.sfx("ui_decksetup_card_place")
                offsets[.fusion] = SliderGeometry.start
            }
        }
        dnd.onDropInvalid = { payload, target in
            if payload.pieceId != nil {
                Task { @MainActor in _ = await warningPopup(Strings.incompleteCards, sprite: "cardslot") }
                return
            }
            guard let state = model.store.state else { return }
            if mode == .deck, let slot = target.slot, StateOps.slotUnlocked(state, slot: slot) {
                model.toast(Strings.manaTooLow, icon: "hud_manaicon01")
            } else if mode == .training && target.zone == "stack" {
                Task { @MainActor in _ = await warningPopup(Strings.stackFull, sprite: "cardslotskull") }
            }
        }
        dnd.onDropOutside = { payload in
            switch mode {
            case .deck:
                guard let from = payload.fromSlot else { return }
                model.updateState { s, _, _ in CollectionOps.removeFromDeck(s, slot: from) }
            case .training:
                if payload.fromZone == "train" { trainUid = nil }
                else if payload.fromZone == "stack" { sacrifices.removeAll { $0 == payload.uid } }
                else { return }
            case .fusion:
                guard let z = payload.fromZone, z == "fuse1" || z == "fuse2" else { return }
                var next = fuse
                next[z == "fuse2" ? 1 : 0] = nil
                fuse = next
                offsets[.fusion] = SliderGeometry.start
            }
            model.sfx("ui_decksetup_card_remove")
        }
        dnd.onDragStart = { _ in model.sfx("ui_decksetup_card_take") }
    }

    // MARK: Training / fusion (cards-ops.js)

    /// The client's warning popup: an image, the text and OK (or a named action button plus Cancel).
    private func warningPopup(_ text: String, sprite: String, action: String? = nil) async -> Bool {
        var r = DialogRequest()
        r.body = { _ in AnyView(WarningBody(sprite: sprite, text: text, coin: sprite == "hud_coinsicon01")) }
        if let a = action {
            r.buttons = [DialogButton(Strings.cancel, value: "cancel", variant: .grey), DialogButton(a, value: "ok", variant: .red)]
        } else {
            r.buttons = [DialogButton(Strings.ok, value: "ok")]
        }
        return await model.dialogs.open(r) == "ok"
    }

    private func notEnoughGold(missing: Int) async {
        var r = DialogRequest()
        r.title = Strings.notEnoughGold
        r.body = { _ in AnyView(WarningBody(sprite: "hud_coinsicon01", text: "\(Strings.needMoreGold)\n\(Strings.shortOfGold(missing))", coin: true)) }
        r.buttons = [DialogButton(Strings.ok, value: "ok")]
        _ = await model.dialogs.open(r)
    }

    private func doTrain() async {
        guard let state = model.store.state else { return }
        if let missing = CardsHelpers.trainingMissingText(trainUid: trainUid, sacrifices: sacrifices) {
            _ = await warningPopup(missing, sprite: trainUid != nil ? "cardslotskull" : "cardslot")
            return
        }
        guard let uid = trainUid else { return }
        let sum = CardsHelpers.trainingSummary(state, deps: model.deps, trainUid: uid, sacrifices: sacrifices)
        if !sum.canAffordAll { await notEnoughGold(missing: sum.gold - state.player.gold); return }
        if !sum.preview.ok { _ = await warningPopup(sum.preview.reason ?? "Training failed", sprite: "cardslot"); return }
        let warnings = CardsHelpers.sacrificeWarnings(state, deps: model.deps, uids: sacrifices)
        if !warnings.isEmpty {
            let go = await warningPopup(CardsHelpers.sacrificeWarningText(warnings, count: sacrifices.count), sprite: "fx_alldieskull01", action: Strings.sacrifice)
            if !go { return }
        }
        let sacs = sacrifices
        guard let before = CardFaceModel.forUid(uid, state: state, deps: model.deps) else { return }
        let sacFaces = sacs.compactMap { CardFaceModel.forUid($0, state: state, deps: model.deps) }
        let info: TrainingResult? = model.update(toastOnError: false) { s, d, _ in
            let r = try TrainingOps.train(s, deps: d, trainUid: uid, sacrificeUids: sacs, allowDeck: true)
            return (state: r.state, info: r.info)
        }
        guard let result = info else {
            _ = await warningPopup("Training failed", sprite: "cardslot")
            return
        }
        sacrifices = []
        model.sfx("ui_decksetup_card_enhance_pt0")
        let after = model.store.state.flatMap { CardFaceModel.forUid(uid, state: $0, deps: model.deps) } ?? before
        fx = OpFx(kind: .enhance, big: before, small: Array(sacFaces.prefix(9)), result: after, label: result.levelUps.isEmpty ? nil : Strings.levelUpLabel, sound: "card_enhancenew_pt2d")
    }

    private func doFuse() async {
        guard let state = model.store.state else { return }
        let check = CardsHelpers.fusionCheck(state, deps: model.deps, slots: fuse)
        if !check.ready { _ = await warningPopup(Strings.fuseMismatch, sprite: "cardslot"); return }
        if state.player.gold < check.cost { await notEnoughGold(missing: check.cost - state.player.gold); return }
        if !check.ok { _ = await warningPopup(check.reason ?? "Fusion failed", sprite: "cardslot"); return }
        guard let a = fuse[0], let b = fuse[1], let faceA = CardFaceModel.forUid(a, state: state, deps: model.deps),
              let faceB = CardFaceModel.forUid(b, state: state, deps: model.deps) else { return }
        let info: FusionResult? = model.update(toastOnError: false) { s, d, _ in
            let r = try FusionOps.fuse(s, deps: d, uidA: a, uidB: b, allowDeck: true)
            return (state: r.state, info: r.info)
        }
        guard let result = info else {
            _ = await warningPopup("Fusion failed", sprite: "cardslot")
            return
        }
        fuse = [nil, nil]
        model.sfx("ui_decksetup_card_enhance_pt0")
        let fused = model.store.state.flatMap { CardFaceModel.forUid(result.uid, state: $0, deps: model.deps) } ?? faceA
        fx = OpFx(kind: .evolve, big: faceA, small: [faceB], result: fused, label: Strings.fused, sound: "card_evolvenew_pt2")
    }
}

/// Body of the client's warning popup (warning_popup): an image and the text.
struct WarningBody: View {
    let sprite: String
    let text: String
    var coin: Bool = false

    var body: some View {
        HStack(spacing: 22) {
            Sprite(sprite).frame(width: coin ? 80 : 92, height: coin ? 80 : 110).shadow(color: .black.opacity(0.8), radius: 3, x: 0, y: 2)
            Text(text)
                .font(Theme.font(26))
                .foregroundColor(Theme.text)
                .multilineTextAlignment(.leading)
                .lineSpacing(6)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 6).padding(.horizontal, 4)
    }
}

/// The training / fusion animation (enhanceanim2 / evolveanim on fuse_background): the sacrificed cards (or the
/// partner) fly into the big card, then the result shows with the ornament plate ("LEVEL UP" / "FUSED"); a tap closes.
struct OpFx {
    enum Kind { case enhance, evolve }
    let kind: Kind
    let big: CardFaceModel
    let small: [CardFaceModel]
    let result: CardFaceModel
    let label: String?
    let sound: String
}

struct OpFxView: View {
    let fx: OpFx
    let onClose: () -> Void
    @EnvironmentObject private var model: AppModel
    @State private var phase: Int = 0
    @State private var shown: Bool = false

    var body: some View {
        ZStack {
            Color.black
            Sprite("fuse_background", contentMode: .fill).frame(width: Stage.width).clipped()
            ZStack {
                ForEach(Array(fx.small.enumerated()), id: \.offset) { item in
                    let angle = Double(item.offset) / Double(max(1, fx.small.count)) * 2 * Double.pi
                    CardFaceView(face: item.element, size: .compact)
                        .scaleEffect(phase >= 1 ? 0.2 : 1.4)
                        .opacity(phase >= 1 ? 0 : 1)
                        .offset(x: phase >= 1 ? 0 : CGFloat(cos(angle)) * 250, y: phase >= 1 ? 0 : CGFloat(sin(angle)) * 250)
                }
                ZStack {
                    if phase >= 2 {
                        Sprite("newcardglow").frame(width: 520, height: 680).opacity(0.85)
                    }
                    CardFaceView(face: phase >= 2 ? fx.result : fx.big, size: .compact)
                        .scaleEffect(phase >= 2 ? 3.2 : 2.6)
                    if phase >= 2, let label = fx.label {
                        ZStack {
                            NineSlice(Theme.Frames.ornamentTop)
                            Text(label)
                                .font(Theme.font(64))
                                .foregroundColor(Color(hex: 0xfff6dc))
                                .shadow(color: Color(hex: 0xffc850, alpha: 0.7), radius: 16)
                                .shadow(color: .black, radius: 4, x: 0, y: 3)
                                .padding(.top, 14)
                        }
                        .frame(width: 520, height: 150)
                        .offset(y: 0)
                    }
                }
            }
            .offset(y: 600 - 640)
            .opacity(shown ? 1 : 0)
            .animation(.easeInOut(duration: 0.6), value: phase)
        }
        .frame(width: Stage.width, height: Stage.height)
        .contentShape(Rectangle())
        .onTapGesture {
            if phase < 2 {
                model.sfx("card_enhancenew_skip2")
                phase = 2
            } else {
                onClose()
            }
        }
        .onAppear {
            withAnimation(.easeOut(duration: 0.25)) { shown = true }
            model.sfx(fx.sound)
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 700_000_000)
                if phase < 1 { phase = 1 }
                try? await Task.sleep(nanoseconds: 900_000_000)
                if phase < 2 { phase = 2 }
                try? await Task.sleep(nanoseconds: 10_000_000_000)
                onClose()
            }
        }
    }
}
