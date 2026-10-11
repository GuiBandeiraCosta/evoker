import SwiftUI
import EvokerCore

/// Shop screen (`src/ui/screens/shop.js`): the "Need more Tokens? Visit the Shop!" banner that opens the gem packs,
/// then the framed pack banners (Neophyte, the running portal's two packs with "Offer ends in", the next portal's
/// two packs "Coming soon", Summoner's, Archmage's): the pack's painting in the ornate frame, the title plate,
/// "May contain:" with the rarity squares, "Look inside" and the token count. Below: the Great Potion Deal on its
/// event day and the set collections link.
struct ShopScreen: View {
    let openGems: Bool
    @EnvironmentObject private var model: AppModel
    @State private var gemsOpened: Bool = false

    var body: some View {
        Group {
            if let state = model.store.state {
                content(state)
            } else {
                Color.black
            }
        }
        .chrome(active: .shop, back: .none, help: "shop")
        .onAppear {
            if openGems && !gemsOpened {
                gemsOpened = true
                Task { @MainActor in await ShopDialogs.openGemShop(model: model) }
            }
        }
    }

    /// `offersForEvent`: the offers priced for the screen's event (the daily event on the save's clock).
    private func offers(_ state: GameState) -> ShopOffers {
        var o = ShopOps.shopOffers(state, deps: model.deps, now: model.now, portal: .rotation)
        let ev = model.event
        o.boosters = o.boosters.map { b in
            var n = b
            n.price = ShopOps.boosterPrice(b.id, event: ev)
            n.discounted = ev == .getTheBestCards
            return n
        }
        o.potionDeal = ShopOps.potionDealAvailable(state, now: model.now, event: ev) ? PotionDeal(gems: ShopOps.potionDealGems, potions: ShopOps.potionDealCount) : nil
        return o
    }

    private func content(_ state: GameState) -> some View {
        let o = offers(state)
        return ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: 0) {
                Button(action: { model.sfx("shop_open"); Task { @MainActor in await ShopDialogs.openGemShop(model: model) } }) {
                    ZStack(alignment: .leading) {
                        Color(hex: 0x3b2a12)
                        Sprite("eventbanner_cardboost02", contentMode: .fill).frame(width: (Stage.width - 28) * 0.7).frame(maxWidth: .infinity, alignment: .leading).clipped().opacity(0.9)
                        LinearGradient(colors: [Color.clear, Color(hex: 0x20160a, alpha: 0.6), Color(hex: 0x20160a, alpha: 0.85)], startPoint: .leading, endPoint: .trailing)
                        Sprite("shop_gems01").frame(width: 120, height: 64).padding(.leading, 14).shadow(color: .black.opacity(0.8), radius: 4, x: 0, y: 3)
                        Text(Strings.needMoreTokens)
                            .font(Theme.font(26))
                            .foregroundColor(.white)
                            .multilineTextAlignment(.trailing)
                            .shadow(color: .black.opacity(0.95), radius: 3, x: 0, y: 2)
                            .frame(maxWidth: .infinity, alignment: .trailing)
                            .padding(.trailing, 28)
                    }
                    .frame(width: Stage.width - 28, height: 86)
                    .clipped()
                    .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color(hex: 0xb58a2c), lineWidth: 4))
                    .shadow(color: .black.opacity(0.7), radius: 10, x: 0, y: 4)
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressScaleStyle())
                .padding(.bottom, 14)
                if let deal = o.potionDeal {
                    potionDealPanel(deal, gems: state.player.gems)
                }
                ForEach(Array(o.boosters.enumerated()), id: \.offset) { item in
                    PackBanner(offer: item.element) { open(item.element) }
                        .padding(.bottom, 12)
                }
                Button(action: { model.sfx("ui_button_circular"); model.router.go(.collections()) }) {
                    Panel {
                        HStack(spacing: 14) {
                            Sprite("icon_liga_active").frame(width: 48, height: 48)
                            Text(Strings.setCollections).font(Theme.font(26)).foregroundColor(Theme.text)
                            Spacer()
                            Text(Strings.completeSetForGems).font(Theme.light(18)).foregroundColor(Theme.muted)
                            Sprite("back_icon_active").frame(width: 48, height: 48).scaleEffect(x: -1, y: 1)
                        }
                        .padding(.vertical, 10).padding(.horizontal, 18)
                        .frame(minHeight: 84)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressScaleStyle())
                .padding(.top, 4)
            }
            .padding(.top, 8).padding(.horizontal, 14).padding(.bottom, 24)
        }
        .background(
            ZStack {
                Theme.bg
                Sprite("fullscreen_background", contentMode: .fill).frame(width: Stage.width).clipped()
                LinearGradient(colors: [Color(hex: 0x0e1012, alpha: 0.2), Color(hex: 0x0e1012, alpha: 0.55)], startPoint: .top, endPoint: .bottom)
            }
        )
    }

    private func open(_ offer: BoosterOffer) {
        if offer.pre { return }
        model.sfx("shop_open")
        model.router.go(.boosterOpen(booster: offer.id, portalId: offer.portalId))
    }

    /// Great Potion Deal panel (event day only).
    private func potionDealPanel(_ deal: PotionDeal, gems: Int) -> some View {
        let canPay = gems >= deal.gems
        return Panel {
            HStack(spacing: 10) {
                HStack(spacing: -16) {
                    Sprite("potion_stamina2").frame(width: 56, height: 64)
                    Sprite("potion_stamina2").frame(width: 56, height: 64)
                    Sprite("potion_mana2").frame(width: 56, height: 64)
                }
                .frame(width: 124)
                VStack(alignment: .leading, spacing: 6) {
                    Text(Strings.greatPotionDeal).font(Theme.font(28)).foregroundColor(Theme.text)
                    Text("\(deal.potions) potions (2 stamina + 1 mana) for \(fmtNumber(deal.gems)) gems, today only.").font(Theme.light(16)).foregroundColor(Theme.muted)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                VStack(spacing: 4) {
                    GemPrice(amount: deal.gems, fontSize: 26, iconSize: 30, color: Theme.gem)
                    SteelButton(Strings.buy, variant: canPay ? .green : .grey, size: .sm, disabled: !canPay) { Task { @MainActor in await buyDeal(deal) } }
                        .frame(minWidth: 150)
                }
                .frame(width: 168)
            }
            .padding(.vertical, 10).padding(.horizontal, 12)
            .frame(minHeight: 150)
        }
        .overlay(NineSlice(Theme.Frames.glowGold).padding(-8).allowsHitTesting(false))
        .padding(.bottom, 18)
    }

    private func buyDeal(_ deal: PotionDeal) async {
        var r = DialogRequest()
        r.title = Strings.greatPotionDeal
        r.body = { _ in
            AnyView(HStack(spacing: 4) {
                Text("Buy 2 stamina potions and 1 mana potion for").font(Theme.font(26)).foregroundColor(Theme.text)
                GemPrice(amount: deal.gems, fontSize: 26, iconSize: 32)
                Text("?").font(Theme.font(26)).foregroundColor(Theme.text)
            }.padding(10))
        }
        r.buttons = [DialogButton(Strings.cancel, value: "cancel", variant: .grey), DialogButton(Strings.buy, value: "ok")]
        guard await model.dialogs.open(r) == "ok" else { return }
        let ev = model.event
        let cost: Int? = model.update { s, _, t in
            let r = try ShopOps.buyPotionDeal(s, now: t, event: ev)
            return (state: r.state, info: r.cost)
        }
        if cost != nil {
            model.sfx("shop_buy_potions")
            model.toast(Strings.threePotionsAdded, icon: "potion_stamina2")
        }
    }
}

/// One framed booster banner (boosterlist_entry with the booster_template layout).
struct PackBanner: View {
    let offer: BoosterOffer
    let onOpen: () -> Void
    @EnvironmentObject private var model: AppModel

    private var theme: (frame: String, title: Color) {
        switch offer.id {
        case .neophyte, .portalLow: return ("steel", Color(hex: 0xe8eef6))
        case .portalHigh: return ("gold", Color(hex: 0xec8cf2))
        case .summoner: return ("violet", Color(hex: 0xec8cf2))
        case .archmage: return ("gold", Color(hex: 0xf3c47a))
        }
    }

    /// `showcaseCards`: the card paintings of the banner (the portal's own cards, else the rarest main-set cards).
    private var showcase: [CardDef] {
        guard let pool = try? ShopOps.boosterPool(deps: model.deps, id: offer.id, portalId: offer.portalId) else { return [] }
        let rarest = pool.reversed()
        var portal: [CardDef] = []
        for e in rarest { for d in e.portal where !portal.contains(d) && !d.art.isEmpty { portal.append(d) } }
        if offer.id == .portalLow { portal.reverse() }
        var main: [CardDef] = []
        for e in rarest { for d in e.main where !main.contains(d) && !d.art.isEmpty { main.append(d) } }
        let starts: [TokenKind: Int] = [.neophyte: 0, .summoner: 1, .archmage: 6]
        let start = starts[offer.id] ?? 0
        var out = Array(portal.prefix(4))
        var i = 0
        while out.count < 4 && i < main.count {
            let d = main[(start + i) % main.count]
            if !out.contains(d) { out.append(d) }
            i += 1
        }
        return Array(out.prefix(4))
    }

    var body: some View {
        let width: CGFloat = Stage.width - 28
        let height: CGFloat = offer.portalId != nil ? width * 372 / 649 : width * 270 / 649
        Button(action: { if !offer.pre { onOpen() } }) {
            bannerContent(width: width, height: height)
        }
        .buttonStyle(PressScaleStyle())
        .disabled(offer.pre)
    }

    // The banner is split into small builders: as one expression it took the Swift type checker too long.

    private func bannerContent(width: CGFloat, height: CGFloat) -> some View {
        ZStack(alignment: .top) {
            painting(width: width, height: height)
            frameOverlay
            titlePlate(width: width)
            countdownBadge
            discountBadge
            foot(width: width)
        }
        .frame(width: width, height: height)
        .shadow(color: .black.opacity(0.75), radius: 10, x: 0, y: 6)
        .contentShape(Rectangle())
    }

    /// The painting: card arts side by side, blended.
    private func painting(width: CGFloat, height: CGFloat) -> some View {
        let inner: CGFloat = width - 60
        let shade = LinearGradient(stops: [Gradient.Stop(color: Color.black.opacity(0.3), location: 0),
                                           Gradient.Stop(color: Color.clear, location: 0.3),
                                           Gradient.Stop(color: Color.clear, location: 0.52),
                                           Gradient.Stop(color: Color.black.opacity(0.78), location: 1)],
                                   startPoint: .top, endPoint: .bottom)
        let items: [(offset: Int, element: CardDef)] = Array(showcase.enumerated())
        return ZStack(alignment: .leading) {
            Color(hex: 0x0c0f13)
            HStack(spacing: 0) {
                ForEach(items, id: \.offset) { item in
                    showcaseArt(item.element, index: item.offset, inner: inner)
                }
            }
            shade
        }
        .frame(width: inner, height: height - 60)
        .clipped()
        .padding(30)
    }

    private func showcaseArt(_ def: CardDef, index: Int, inner: CGFloat) -> some View {
        let first: Color = index == 0 ? Color.black : Color.clear
        let last: Color = index == 3 ? Color.black : Color.clear
        let mask = LinearGradient(stops: [Gradient.Stop(color: first, location: 0),
                                          Gradient.Stop(color: Color.black, location: 0.2),
                                          Gradient.Stop(color: Color.black, location: 0.8),
                                          Gradient.Stop(color: last, location: 1)],
                                  startPoint: .leading, endPoint: .trailing)
        let step: CGFloat = inner * 0.22 - inner * 0.34
        let dx: CGFloat = CGFloat(index) * step
        return CardArt(def: def, stage: lastStage(def))
            .frame(width: inner * 0.34)
            .mask(mask)
            .offset(x: dx)
    }

    private var frameTint: Color {
        let t = theme
        if t.frame == "gold" { return Color(hex: 0xffd27a) }
        if t.frame == "violet" { return Color(hex: 0xcf9cff) }
        return Color.white
    }

    private var frameOverlay: some View {
        NineSlice(Theme.Frames.packFrame)
            .colorMultiply(frameTint)
            .allowsHitTesting(false)
    }

    private func titlePlate(width: CGFloat) -> some View {
        Text(offer.name)
            .font(Theme.font(36))
            .foregroundColor(theme.title)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .shadow(color: Color(hex: 0x280d0b), radius: 0, x: 2, y: 2)
            .frame(width: width * 0.76, height: 58)
            .background(StretchedSprite("header_framer_big"))
            .padding(.top, 30)
    }

    @ViewBuilder private var countdownBadge: some View {
        if !offer.pre && offer.endsInMs > 0 {
            HStack(spacing: 8) {
                Text(Strings.offerEndsIn).font(Theme.font(18)).foregroundColor(Theme.muted)
                CountdownText(endsAt: model.now + offer.endsInMs, style: .dhms, font: Theme.num(22), color: .white)
            }
            .padding(.vertical, 4).padding(.horizontal, 14)
            .background(Color(hex: 0x080a0c, alpha: 0.78))
            .cornerRadius(4)
            .frame(maxHeight: .infinity, alignment: .bottom)
            .padding(.bottom, 106)
        }
    }

    @ViewBuilder private var discountBadge: some View {
        if offer.discounted && !offer.pre {
            Text("−50 %")
                .font(Theme.font(22))
                .foregroundColor(Theme.sellGreen)
                .padding(.vertical, 4).padding(.horizontal, 16)
                .background(NineSlice(Theme.Frames.discountBg))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, 44).padding(.top, 96)
        }
    }

    /// Foot: "May contain:", Look inside / Coming soon, tokens.
    private func foot(width: CGFloat) -> some View {
        HStack(alignment: .bottom, spacing: 8) {
            mayContain
            footAction
            tokenCount
        }
        .frame(width: width - 80, height: 64)
        .frame(maxHeight: .infinity, alignment: .bottom)
        .padding(.bottom, 36)
    }

    private var mayContain: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(Strings.mayContain).font(Theme.font(15)).foregroundColor(Color(hex: 0xcfd3d6))
            HStack(spacing: 5) {
                ForEach(offer.mayContain, id: \.self) { r in
                    raritySquare(r)
                }
            }
        }
        .padding(.bottom, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func raritySquare(_ r: Rarity) -> some View {
        let c: Color = squareColor(r)
        return RoundedRectangle(cornerRadius: 4)
            .fill(Color.black.opacity(0.55))
            .overlay(RoundedRectangle(cornerRadius: 4).stroke(c, lineWidth: 3))
            .frame(width: 22, height: 22)
            .shadow(color: c, radius: 5)
    }

    @ViewBuilder private var footAction: some View {
        if !offer.pre {
            Text(Strings.lookInside)
                .font(Theme.font(24))
                .foregroundColor(.white)
                .shadow(color: .black, radius: 1, x: 0, y: 2)
                .padding(.horizontal, 22)
                .frame(minWidth: 210, minHeight: 54, maxHeight: 54)
                .background(StretchedSprite("promo_button_fill"))
                .background(StretchedSprite("promo_button_frame"))
        } else {
            VStack(spacing: 2) {
                Text(offer.startsInMs > 0 ? Strings.comingSoon : Strings.comingSoonPlain).font(Theme.font(22)).foregroundColor(.white)
                if offer.startsInMs > 0 {
                    CountdownText(endsAt: model.now + offer.startsInMs, style: .dhms, font: Theme.num(26), color: .white)
                }
            }
            .shadow(color: .black.opacity(0.9), radius: 3, x: 0, y: 2)
        }
    }

    private var tokenCount: some View {
        HStack(spacing: 8) {
            if offer.pre || offer.tokens > 0 {
                TokenImage(kind: offer.id, size: 52).shadow(color: Color(hex: 0xffaa3c, alpha: 0.55), radius: 6)
            }
            if offer.tokens > 0 {
                Text(fmtNumber(offer.tokens)).font(Theme.num(30)).foregroundColor(.white).shadow(color: .black.opacity(0.95), radius: 3, x: 0, y: 2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    private func lastStage(_ def: CardDef) -> Int {
        def.art.keys.compactMap { Int($0) }.max() ?? 0
    }

    private func squareColor(_ r: Rarity) -> Color {
        switch r {
        case .common: return Color(hex: 0xc8c7c7)
        case .standard: return Color(hex: 0xf3f3f3)
        case .uncommon: return Color(hex: 0x6fd23a)
        case .rare: return Color(hex: 0x3f8cff)
        case .heroic: return Color(hex: 0xc05be0)
        case .legendary: return Color(hex: 0xffc53a)
        case .ultimate: return Color(hex: 0xff3b3b)
        }
    }
}

enum ShopDialogs {
    /// The gem packs overlay (premiumshop): five packs with their original names and USD tiers; a tap explains that
    /// there is no real-money purchase.
    @MainActor
    static func openGemShop(model: AppModel) async {
        let packs = Constants.gemPacks
        var r = DialogRequest()
        r.title = Strings.gemsTitle
        r.width = 660
        r.body = { _ in
            AnyView(ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 10) {
                    ForEach(packs, id: \.id) { p in
                        HStack(spacing: 14) {
                            Sprite(p.sprite).frame(width: 124, height: 96).shadow(color: .black.opacity(0.8), radius: 4, x: 0, y: 3)
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 4) {
                                    Text(fmtNumber(p.gems)).font(Theme.num(30)).foregroundColor(Theme.gem)
                                    Text("Gems").font(Theme.font(30)).foregroundColor(Theme.gem)
                                }
                                .shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 2)
                                Text(p.name).font(Theme.font(20)).foregroundColor(Theme.text)
                                if p.card != nil || p.potions > 0 {
                                    HStack(spacing: 4) {
                                        Text("Bonus").font(Theme.font(17)).foregroundColor(Theme.sellGreen)
                                        Text("+ " + ([p.card.map { "\(rarityLabel($0)) card" }, p.potions > 0 ? "\(p.potions) potions" : nil].compactMap { $0 }.joined(separator: " + "))).font(Theme.font(17)).foregroundColor(Theme.muted)
                                    }
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            SteelButton(p.price, variant: .green, size: .sm) {
                                Task { @MainActor in await model.dialogs.alert(title: Strings.gemsTitle, message: Strings.noPurchases) }
                            }
                            .frame(minWidth: 130)
                        }
                        .padding(.vertical, 8).padding(.horizontal, 14)
                        .frame(minHeight: 112)
                        .background(Color(hex: 0x08090a, alpha: 0.85))
                        .overlay(NineSlice(Theme.Frames.ironframe))
                    }
                }
            }.frame(maxHeight: 820))
        }
        _ = await model.dialogs.open(r)
    }

    /// "You need more Gems to get a booster card!" with "Get more", which opens the gem packs.
    @MainActor
    static func notEnoughGems(model: AppModel) async {
        var r = DialogRequest()
        r.body = { _ in
            AnyView(VStack(spacing: 16) {
                Sprite("shop_gems01").frame(width: 220, height: 130).shadow(color: .black.opacity(0.8), radius: 6, x: 0, y: 4)
                Text(Strings.needGemsBooster).font(Theme.font(28)).foregroundColor(Theme.text).multilineTextAlignment(.center)
            }.padding(.top, 10))
        }
        r.buttons = [DialogButton(Strings.getMore, value: "more", variant: .green, content: AnyView(HStack(spacing: 8) {
            Text(Strings.getMore)
            Sprite("hud_gemiconsingle").frame(width: 26, height: 26)
        }))]
        if await model.dialogs.open(r) == "more" { await openGemShop(model: model) }
    }
}
