import SwiftUI
import EvokerCore

/// Booster screen (`src/ui/screens/booster-open.js`, openbooster_screen): the cavern with a top bar of its own
/// (back arrow, gem count, token count, green refresh button) and the pack's nine cards in a 3x3 grid. A sealed
/// booster plays the opening (the glowing pack on the altar grows and bursts, the cards fly into the grid); each
/// face-down card shows what the next pick costs (1 token or the gem price); a tap pays, flips the card, zooms
/// it to the centre with the "Card added to set" plate, and a tap settles it. The refresh button and the last pick
/// ask "Do you want to open a new booster?".
struct BoosterOpenScreen: View {
    let booster: TokenKind
    let portalId: String?
    @EnvironmentObject private var model: AppModel
    @Environment(\.stage) private var stage
    @State private var entered: Bool = false
    @State private var failed: Bool = false
    @State private var busy: Bool = false
    @State private var sealed: Bool = false
    @State private var dealing: Bool = false
    @State private var discarding: Bool = false
    @State private var intro: Int = 0   // 0 none, 1 beam, 2 grow, 3 burst
    @State private var reveal: RevealFx? = nil
    @State private var pendingCell: Int? = nil
    @State private var flashing: Int? = nil

    static let cellW: CGFloat = 196
    static let cellH: CGFloat = 278
    static let colX: [CGFloat] = [124, 360, 596]
    static let rowY: [CGFloat] = [352, 672, 992]
    static let revealCentre = CGPoint(x: 360, y: 650)
    static let altar = CGPoint(x: 360, y: 820)

    struct RevealFx {
        let face: CardFaceModel
        let fromCell: Int
        let setAdded: SetProgress?
        var settling: Bool = false
    }

    private var effectivePortal: String? { booster.isPortal ? portalId : nil }
    private var reduced: Bool { model.store.state?.settings.reducedMotion ?? false }

    private var title: String {
        if let pid = effectivePortal, let line = QuestOps.questLine(deps: model.deps, lineId: pid), let tokens = line.tokens {
            let name = booster == .portalLow ? tokens.low.name : tokens.high.name
            return name.replacingOccurrences(of: " token", with: "", options: [.caseInsensitive, .anchored, .backwards]) + " Pack"
        }
        return Constants.boosterPack(booster).name
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color(hex: 0x0b1418)
            Sprite("cardshop_background_01", contentMode: .fill).frame(width: Stage.width, height: stage.size.height).clipped()
            if failed {
                VStack(spacing: 20) {
                    Text(Strings.boosterFailed).font(Theme.font(26)).foregroundColor(Theme.text)
                    SteelButton(Strings.backToShop) { model.router.back(fallback: .shop()) }
                }
                .padding(30)
                .background(Panel { Color.clear })
                .frame(maxWidth: .infinity)
                .padding(.top, 260)
            } else if let state = model.store.state, let b = ShopOps.getBooster(state, id: booster, portalId: effectivePortal) {
                grid(state: state, booster: b)
                if intro > 0 { openingLayer }
                if let r = reveal { revealLayer(r) }
                topBar(state: state)
                Text(title)
                    .font(Theme.font(26))
                    .foregroundColor(Theme.tan)
                    .shadow(color: .black.opacity(0.95), radius: 4, x: 0, y: 2)
                    .frame(width: Stage.width)
                    .offset(y: 112 + stage.safeTop)
                    .allowsHitTesting(false)
            }
        }
        .frame(width: Stage.width, height: stage.size.height, alignment: .topLeading)
        .clipped()
        .onAppear { enter() }
    }

    // MARK: Entering (openBooster)

    private func enter() {
        if entered { return }
        entered = true
        if booster.isPortal && (portalId == nil || QuestOps.questLine(deps: model.deps, lineId: portalId!) == nil) {
            failed = true
            return
        }
        let pid = effectivePortal
        let r: OpenBoosterResult? = model.update(toastOnError: false) { s, d, t in
            let r = try ShopOps.openBooster(s, deps: d, now: t, id: booster, portalId: pid, open: false)
            return (state: r.state, info: r.info)
        }
        guard let res = r else {
            failed = true
            return
        }
        if res.fresh {
            if reduced {
                markOpened()
            } else {
                Task { @MainActor in await playOpening() }
            }
        } else if res.booster.drawn.count >= res.booster.cards.count && !res.booster.cards.isEmpty {
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 300_000_000)
                await askNewBooster()
            }
        }
    }

    private func markOpened() {
        let pid = effectivePortal
        _ = model.update(toastOnError: false) { s, d, t in
            let r = try ShopOps.openBooster(s, deps: d, now: t, id: booster, portalId: pid, open: true)
            return (state: r.state, info: r.info)
        }
    }

    private func pause(_ seconds: Double) async {
        if reduced { return }
        try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
    }

    /// The sealed booster: the glowing pack on the altar under a beam of light grows and bursts, the cards deal.
    private func playOpening() async {
        busy = true
        sealed = true
        intro = 1
        model.sfx("booster_open")
        await pause(0.7)
        withAnimation(.easeInOut(duration: 0.65)) { intro = 2 }
        await pause(0.65)
        withAnimation(.easeOut(duration: 0.22)) { intro = 3 }
        await pause(0.22)
        intro = 0
        sealed = false
        model.sfx(["shop_shuffle_cards1", "shop_shuffle_cards2", "shop_shuffle_cards3"].randomElement() ?? "shop_shuffle_cards1")
        markOpened()
        withAnimation(.easeOut(duration: 0.55)) { dealing = true }
        await pause(0.9)
        dealing = false
        busy = false
    }

    // MARK: Top bar

    private func topBar(state: GameState) -> some View {
        let p = ShopOps.pickPayment(state, id: booster, portalId: effectivePortal, event: model.event)
        return ZStack(alignment: .topLeading) {
            Color(hex: 0x1b1d1f)
            StretchedSprite("topbar_bg").frame(height: 98).frame(maxHeight: .infinity, alignment: .bottom)
            HStack(alignment: .top, spacing: 14) {
                Button(action: { model.sfx("ui_button_card_close"); model.router.back(fallback: .shop()) }) {
                    Sprite("back_icon_active").frame(width: 48, height: 65).frame(width: 64, height: 90).contentShape(Rectangle())
                }
                .buttonStyle(PressScaleStyle())
                HStack(spacing: 10) {
                    Sprite("hud_gemicon01").frame(width: 54, height: 40)
                    Text("\(p.gems)").font(Theme.num(34)).foregroundColor(Theme.text)
                }
                .frame(minWidth: 190, minHeight: 90)
                .padding(.leading, 70)
                HStack(spacing: 10) {
                    TokenImage(kind: booster, size: 44)
                    Text("\(p.tokens)").font(Theme.num(34)).foregroundColor(Theme.text)
                }
                .frame(minWidth: 140, minHeight: 90)
                Spacer()
                Button(action: { Task { @MainActor in await askNewBooster() } }) {
                    ZStack {
                        NineSlice(Theme.Frames.buttonGreen)
                        Sprite("refresh").frame(width: 40, height: 46)
                    }
                    .frame(width: 78, height: 78)
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressScaleStyle())
                .padding(.top, 8)
            }
            .shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 2)
            .padding(.top, 2 + stage.safeTop).padding(.horizontal, 12)
        }
        .frame(width: Stage.width, height: 98 + stage.safeTop, alignment: .topLeading)
        .shadow(color: .black.opacity(0.7), radius: 5, x: 0, y: 2)
        .opacity(intro > 0 ? 0 : 1)
        .animation(.easeInOut(duration: 0.4), value: intro)
        .zIndex(5)
    }

    // MARK: Grid

    private func grid(state: GameState, booster b: Booster) -> some View {
        let p = ShopOps.pickPayment(state, id: booster, portalId: effectivePortal, event: model.event)
        let drawn = Set(b.drawn)
        return ZStack(alignment: .topLeading) {
            ForEach(0..<min(9, b.cards.count), id: \.self) { i in
                let col = i % 3, row = i / 3
                let isDrawn = drawn.contains(i)
                let hidden = pendingCell == i
                Button(action: { tapCell(i, drawn: isDrawn, cards: b.cards) }) {
                    ZStack {
                        if isDrawn {
                            faceUp(b.cards[i])
                        } else {
                            StretchedSprite("flipcard")
                                .cornerRadius(8)
                                .shadow(color: .black.opacity(0.75), radius: 9, x: 0, y: 8)
                                .scaleEffect(x: flashing == i ? 0.1 : 1, y: 1)
                                .brightness(flashing == i ? 1 : 0)
                            VStack(spacing: 6) {
                                if p.type == .token {
                                    TokenImage(kind: booster, size: 66)
                                } else {
                                    Sprite("hud_gemiconsingle").frame(width: 70, height: 62)
                                }
                                Text("\(p.amount)").font(Theme.num(34)).foregroundColor(.white)
                            }
                            .shadow(color: .black.opacity(0.95), radius: 3, x: 0, y: 2)
                            .opacity(flashing == i ? 0 : 1)
                        }
                    }
                    .frame(width: BoosterOpenScreen.cellW, height: BoosterOpenScreen.cellH)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .opacity(hidden || sealed ? 0 : 1)
                .scaleEffect(dealing || discarding ? 0.18 : 1)
                .rotationEffect(.degrees(dealing ? -8 : (discarding ? 14 : 0)))
                .offset(x: dealing ? BoosterOpenScreen.altar.x - BoosterOpenScreen.colX[col] : 0, y: dealing ? BoosterOpenScreen.altar.y - BoosterOpenScreen.rowY[row] : 0)
                .animation(.easeOut(duration: 0.55).delay(Double(i) * 0.055), value: dealing)
                .animation(.easeIn(duration: 0.6).delay(Double(i) * 0.055), value: discarding)
                .position(x: BoosterOpenScreen.colX[col], y: BoosterOpenScreen.rowY[row] + stage.safeTop)
            }
        }
        .frame(width: Stage.width, height: stage.size.height, alignment: .topLeading)
    }

    /// Face-up thumbnail of a drawn card in its slot (art in the rarity-coloured frame, the name below).
    private func faceUp(_ cardId: String) -> some View {
        let def = model.db.get(cardId)
        return ZStack(alignment: .bottom) {
            Color(hex: 0x0b0c0d)
            if let d = def { CardArt(def: d, stage: 0) }
            Text(def?.name ?? cardId)
                .font(Theme.font(17))
                .foregroundColor(.white)
                .multilineTextAlignment(.center)
                .padding(.top, 18).padding(.horizontal, 6).padding(.bottom, 6)
                .frame(maxWidth: .infinity)
                .background(LinearGradient(colors: [.clear, .black.opacity(0.85)], startPoint: .top, endPoint: .bottom))
        }
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(def.map { Theme.rarityThumb($0.rarity) } ?? Theme.rarity(.common), lineWidth: 6))
        .shadow(color: .black.opacity(0.75), radius: 9, x: 0, y: 8)
    }

    private func tapCell(_ i: Int, drawn: Bool, cards: [String]) {
        if busy { return }
        if drawn {
            model.sfx("ui_button_card")
            model.router.go(.cardDetail(.catalog(cardId: cards[i], stage: 0, level: 1)))
            return
        }
        Task { @MainActor in await pick(i) }
    }

    // MARK: Drawing a card

    private func pick(_ index: Int) async {
        guard let state = model.store.state else { return }
        let pay = ShopOps.pickPayment(state, id: booster, portalId: effectivePortal, event: model.event)
        if !pay.canPay {
            await ShopDialogs.notEnoughGems(model: model)
            return
        }
        let pid = effectivePortal
        let ev = model.event
        let result: BoosterDraw? = model.update { s, d, t in
            let r = try ShopOps.drawBoosterCard(s, deps: d, now: t, id: booster, portalId: pid, position: index, event: ev)
            return (state: r.state, info: r.info)
        }
        guard let draw = result, let def = model.db.get(draw.cardId) else { return }
        busy = true
        model.sfx("shop_draw_card")
        withAnimation(.easeIn(duration: 0.16)) { flashing = index }
        await pause(0.16)
        flashing = nil
        pendingCell = index
        let face = CardFaceModel.fromDef(def, stage: 0, level: 1, deps: model.deps)
        withAnimation(.spring(response: 0.45, dampingFraction: 0.8)) {
            reveal = RevealFx(face: face, fromCell: index, setAdded: draw.setAdded)
        }
        if draw.converted {
            model.toast("Collection full: \(def.name) sold for \(fmtNumber(draw.gold)) gold", icon: "hud_coinsicon01", duration: 3.5)
        }
        await waitForSettle()
        model.sfx("shop_card_collect")
        withAnimation(.easeIn(duration: 0.38)) { reveal?.settling = true }
        await pause(0.38)
        reveal = nil
        pendingCell = nil
        busy = false
        if draw.remaining == 0 { await askNewBooster() }
    }

    @State private var settleTapped: Bool = false

    /// Settle on a tap (after 350 ms) or after a while.
    private func waitForSettle() async {
        settleTapped = false
        let limit = reduced ? 1.5 : 3.2
        var waited: Double = 0
        while waited < limit {
            try? await Task.sleep(nanoseconds: 50_000_000)
            waited += 0.05
            if settleTapped && waited >= (reduced ? 0 : 0.35) { return }
        }
    }

    // MARK: Layers

    private var openingLayer: some View {
        ZStack(alignment: .topLeading) {
            Color.black.opacity(0.001)
            LinearGradient(colors: [Color(hex: 0xc8f5ff, alpha: 0), Color(hex: 0xc8f5ff, alpha: 0.85), .white], startPoint: .top, endPoint: .bottom)
                .frame(width: 40, height: 860)
                .blur(radius: 6)
                .offset(x: 340, y: -40 + stage.safeTop)
                .opacity(intro >= 2 ? 0.4 : 1)
            ZStack {
                Circle()
                    .fill(RadialGradient(colors: [Color(hex: 0xdcfaff, alpha: 0.9), Color(hex: 0x78dcff, alpha: 0.45), Color(hex: 0x50b4ff, alpha: 0)], center: .center, startRadius: 0, endRadius: 120))
                    .frame(width: 240, height: 240)
                    .blendMode(.screen)
                Sprite("flipcard").frame(width: 52, height: 74).cornerRadius(3).shadow(color: Color(hex: 0xaaf0ff, alpha: 0.9), radius: 18)
            }
            .scaleEffect(intro >= 3 ? 7 : (intro >= 2 ? 5.4 : 1))
            .opacity(intro >= 3 ? 0 : 1)
            .position(x: BoosterOpenScreen.altar.x, y: BoosterOpenScreen.altar.y + stage.safeTop - (intro >= 2 ? 180 : 0))
            if intro >= 3 {
                RadialGradient(colors: [Color.white.opacity(0.95), Color(hex: 0xbef0ff, alpha: 0.5), .clear], center: .center, startRadius: 0, endRadius: 500)
                    .transition(.opacity)
            }
        }
        .frame(width: Stage.width, height: stage.size.height, alignment: .topLeading)
        .contentShape(Rectangle())
        .onTapGesture { }
        .zIndex(4)
    }

    private func revealLayer(_ r: RevealFx) -> some View {
        let col = r.fromCell % 3, row = r.fromCell / 3
        let from = CGPoint(x: BoosterOpenScreen.colX[col], y: BoosterOpenScreen.rowY[row] + stage.safeTop)
        let centre = CGPoint(x: BoosterOpenScreen.revealCentre.x, y: BoosterOpenScreen.revealCentre.y + stage.safeTop)
        let fromScale = BoosterOpenScreen.cellW / 600
        return ZStack(alignment: .topLeading) {
            Color.black.opacity(r.settling ? 0 : 0.55)
                .contentShape(Rectangle())
                .onTapGesture { settleTapped = true }
            ZStack {
                if !r.settling {
                    Sprite("newcardglow").frame(width: 1100, height: 1300).opacity(0.8)
                    Sprite(glowSprite(r.face.rarity)).frame(width: 660, height: 890).opacity(0.9)
                }
                CardDetailView(face: r.face, showStats: false)
            }
            .scaleEffect(r.settling ? fromScale : 0.84)
            .position(r.settling ? from : centre)
            .allowsHitTesting(false)
            if let sa = r.setAdded {
                VStack(spacing: 2) {
                    Text(Strings.cardAddedToSet).font(Theme.font(26)).foregroundColor(.white)
                    Text(sa.name).font(Theme.font(34)).foregroundColor(Color(hex: 0x8fd0ff))
                    ZStack(alignment: .leading) {
                        StretchedSprite("cardnotification_progressbar")
                        GeometryReader { geo in
                            LinearGradient(colors: [Color(hex: 0xffb35a), Color(hex: 0xe0661c)], startPoint: .top, endPoint: .bottom)
                                .frame(width: max(0, (geo.size.width - 12) * CGFloat(barRatio(Double(sa.owned), Double(sa.total)))), height: 8)
                                .offset(x: 6, y: 9)
                        }
                        Text("\(sa.owned)/\(sa.total)").font(Theme.num(18)).foregroundColor(.white).shadow(color: .black, radius: 1).offset(x: 22, y: 1)
                    }
                    .frame(height: 26)
                    .padding(.top, 8)
                }
                .padding(.top, 10).padding(.horizontal, 22).padding(.bottom, 14)
                .frame(width: Stage.width - 80)
                .background(Color(hex: 0x0e1012, alpha: 0.94))
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color(hex: 0x3a3d40), lineWidth: 3))
                .shadow(color: .black.opacity(0.8), radius: 16, x: 0, y: 6)
                .offset(x: 40, y: r.settling ? -180 : 104 + stage.safeTop)
                .opacity(r.settling ? 0 : 1)
                .allowsHitTesting(false)
            }
        }
        .frame(width: Stage.width, height: stage.size.height, alignment: .topLeading)
        .zIndex(6)
    }

    // MARK: New booster

    private func askNewBooster() async {
        if busy { return }
        busy = true
        var r = DialogRequest()
        r.body = { _ in
            AnyView(VStack(spacing: 16) {
                Sprite("fx_alldieskull01").frame(width: 150, height: 150).shadow(color: .black.opacity(0.8), radius: 6, x: 0, y: 4)
                Text(Strings.openNewBooster).font(Theme.font(28)).foregroundColor(Theme.text).multilineTextAlignment(.center)
            }.padding(.top, 10))
        }
        r.buttons = [DialogButton("Ok", value: "ok", variant: .green)]
        let ok = await model.dialogs.open(r) == "ok"
        if !ok { busy = false; return }
        model.sfx(["shop_shuffle_cards1", "shop_shuffle_cards2", "shop_shuffle_cards3"].randomElement() ?? "shop_shuffle_cards1")
        withAnimation { discarding = true }
        await pause(0.65)
        let pid = effectivePortal
        _ = model.update { s, d, t in
            let r = try ShopOps.discardBooster(s, deps: d, now: t, id: booster, portalId: pid)
            return (state: r.state, info: r.booster)
        }
        discarding = false
        busy = false
        if reduced { markOpened() } else { await playOpening() }
    }
}
