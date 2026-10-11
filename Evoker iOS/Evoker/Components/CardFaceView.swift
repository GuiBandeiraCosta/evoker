import SwiftUI
import UIKit
import EvokerCore

/// The card component on the original textures (`src/ui/components/card.js`): compact (120x168, collection),
/// battle (116x164, line-ups), detail (600x829, the carddetail plates) and back (face-down thumb). Stats icons =
/// hud_fighticon02 (sword), hud_healthicon01 (heart), hud_experienceicon01 (star), hud_specialskill01 (anvil),
/// hud_manaicon01 (drop); arrows = card_arrowred01 / card_arrow01 / card_arrowblue01; pips = hud_evolution.

enum CardSide {
    case top, bottom
}

enum CardFaceSize: Equatable {
    case compact
    case battle(side: CardSide)
    case detail
    case back(hidden: Bool)
}

struct CardFaceView: View {
    let face: CardFaceModel
    var size: CardFaceSize = .compact
    var locked: Bool = false
    var selected: Bool = false
    var inDeck: Bool = false
    var dead: Bool = false
    var pieces: (owned: Int, total: Int)? = nil

    var body: some View {
        switch size {
        case .compact:
            compact
        case .battle(let side):
            battle(side: side)
        case .detail:
            detail
        case .back(let hidden):
            back(hidden: hidden)
        }
    }

    // MARK: Compact (120 x 168)

    private var compact: some View {
        ZStack(alignment: .topLeading) {
            artLayer(side: .bottom, arrowSize: CGSize(width: 20, height: 24), showArrows: true)
            if pieces == nil {
                statsBand
                    .at(0, 168 - 60, 120, 60)
                LevelBarView(level: max(1, face.level), levelCap: face.levelCap, xp: face.xp, xpToNext: face.xpToNext)
                    .frame(height: 16)
                    .at(4, 168 - 4 - 16, 112, 16)
            }
            StretchedSprite("cardframe_\(face.rarity.rawValue)")
                .allowsHitTesting(false)
            if face.stage > 0 {
                HStack(spacing: 1) {
                    Sprite("hud_evolution").frame(width: 16, height: 16)
                    Text("\(face.stage + 1)").font(Theme.font(12)).foregroundColor(Theme.xpBar).shadow(color: .black, radius: 0, x: 0, y: 1)
                }
                .padding(.leading, 2).padding(.trailing, 4).padding(.vertical, 1)
                .background(Color(hex: 0x0a0b0c, alpha: 0.72))
                .cornerRadius(3)
                .offset(x: 120 - 5 - 40, y: 5)
                .frame(width: 40, alignment: .trailing)
            }
            if inDeck {
                Sprite("cardindeck")
                    .frame(width: 31, height: 23)
                    .shadow(color: .black.opacity(0.9), radius: 2, x: 0, y: 1)
                    .at(120 - 8 - 31, 84 + 8, 31, 23)
            }
            if let p = pieces {
                PiecesOverlay(owned: p.owned, total: p.total, compact: true)
            }
        }
        .frame(width: 120, height: 168)
        .background(Color(hex: 0x0a0b0c))
        .clipShape(RoundedRectangle(cornerRadius: 3))
        .overlay(selected ? RoundedRectangle(cornerRadius: 3).stroke(Theme.mana, lineWidth: 3).shadow(color: Theme.mana, radius: 8) : nil)
        .shadow(color: .black.opacity(0.7), radius: 5, x: 0, y: 4)
    }

    /// Translucent stats band (cardstatsoverlay) over the bottom of the art: ATK | mana over HP | ability.
    private var statsBand: some View {
        VStack(spacing: 1) {
            HStack {
                statCell(.attack, face.attack)
                Spacer(minLength: 4)
                statCell(.mana, face.mana)
            }
            .frame(height: 16)
            HStack {
                statCell(.hp, face.maxHp)
                Spacer(minLength: 4)
                abilityCell(face.abilityValue)
            }
            .frame(height: 16)
        }
        .padding(.top, 9)
        .padding(.leading, 8)
        .padding(.trailing, 9)
        .frame(width: 120, height: 60, alignment: .top)
        .background(StretchedSprite("cardstatsoverlay"))
    }

    // MARK: Battle (116 x 164)

    private func battle(side: CardSide) -> some View {
        ZStack(alignment: .topLeading) {
            artLayer(side: side, arrowSize: CGSize(width: 20, height: 24), showArrows: true)
            strip(side: side)
                .at(0, side == .bottom ? 164 - 44 : 0, 116, 44)
            StretchedSprite("cardframe_\(face.rarity.rawValue)")
                .allowsHitTesting(false)
            if dead {
                StretchedSprite("burnedcard").opacity(0.9)
            }
        }
        .frame(width: 116, height: 164)
        .background(Color(hex: 0x0a0b0c))
        .clipShape(RoundedRectangle(cornerRadius: 3))
        .saturation(dead ? 0 : 1)
        .brightness(dead ? -0.3 : 0)
        .shadow(color: .black.opacity(0.7), radius: 5, x: 0, y: 4)
    }

    /// Stats band of the battle cards (sword/star over heart/anvil) on the edge away from the enemy.
    private func strip(side: CardSide) -> some View {
        VStack(spacing: 2) {
            HStack {
                statCell(.attack, face.attack)
                Spacer(minLength: 3)
                statCell(.star, face.level)
            }
            .frame(height: 16)
            HStack {
                statCell(.hp, face.hp)
                Spacer(minLength: 3)
                abilityCell(face.abilityValue)
            }
            .frame(height: 16)
        }
        .padding(.top, side == .bottom ? 7 : 4)
        .padding(.bottom, side == .bottom ? 0 : 6)
        .padding(.horizontal, 8)
        .frame(width: 116, height: 44, alignment: side == .bottom ? .top : .bottom)
        .background(StretchedSprite(side == .bottom ? "cardstatsoverlay_small" : "cardstatsoverlay_small_top"))
    }

    // MARK: Back (face-down)

    private func back(hidden: Bool) -> some View {
        let name: String
        if hidden {
            name = "cardslot_question01_thumb"
        } else {
            switch face.tribe {
            case .dwarf: name = "cardslotdwarf_thumb"
            case .elf: name = "cardslotelf_thumb"
            case .orc: name = "cardslotork_thumb"
            case .neutral: name = "cardslotneutral_thumb"
            }
        }
        return StretchedSprite(name)
            .frame(width: 116, height: 164)
            .background(Color(hex: 0x050506))
            .clipShape(RoundedRectangle(cornerRadius: 3))
            .shadow(color: .black.opacity(0.7), radius: 5, x: 0, y: 4)
    }

    // MARK: Detail (600 x 829)

    private var detail: some View {
        ZStack(alignment: .topLeading) {
            // the art between the rails
            ZStack(alignment: .topLeading) {
                RadialGradient(colors: [Theme.tribe(face.tribe).opacity(0.45), Color(hex: 0x0b0c0d)], center: UnitPoint(x: 0.5, y: 0.35), startRadius: 0, endRadius: 420)
                CardArt(def: face.def, stage: face.stage)
                    .saturation(locked ? 0 : 1)
                    .brightness(locked ? -0.15 : 0)
                if locked {
                    Sprite("lock_big").frame(width: 200, height: 210).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                        .shadow(color: .black.opacity(0.9), radius: 4, x: 0, y: 3)
                }
                ArrowsLayer(dirs: face.dirs, healDirs: face.healDirs, buffDirs: face.buffDirs, side: .bottom, arrowSize: CGSize(width: 40, height: 48), inset: 12)
                if let p = pieces {
                    PiecesOverlay(owned: p.owned, total: p.total, compact: false)
                }
            }
            .frame(width: 529, height: 580)
            .clipped()
            .at(35, 97, 529, 580)
            TiledSprite("carddetail_rail_\(face.rarity.rawValue)")
                .allowsHitTesting(false)
            VStack(spacing: 0) {
                Sprite("carddetail_top_\(face.rarity.rawValue)", contentMode: .fit).frame(width: 600)
                Spacer(minLength: 0)
                Sprite("carddetail_bottom_\(face.rarity.rawValue)", contentMode: .fit).frame(width: 600)
            }
            .frame(width: 600, height: 829)
            .allowsHitTesting(false)
            // head: name box and the octagon emblem box
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(face.name)
                    .font(Theme.font(34))
                    .foregroundColor(detailRarityText)
                    .lineLimit(1)
                    .truncationMode(.tail)
                if face.stage > 0 {
                    Text(String(repeating: "+", count: face.stage)).font(Theme.font(34)).foregroundColor(Theme.xpBar)
                }
            }
            .shadow(color: .black.opacity(0.8), radius: 1, x: 0, y: 2)
            .frame(width: 448, height: 56, alignment: .leading)
            .at(22, 9, 448, 56)
            Sprite(tribeSprite(face.tribe))
                .frame(width: 64, height: 64)
                .shadow(color: .black.opacity(0.9), radius: 4)
                .frame(width: 103, height: 115)
                .at(489, 9, 103, 115)
            // foot: rarity label, pips, level bar
            VStack(spacing: 0) {
                HStack {
                    Text(rarityLabel(face.rarity))
                        .font(Theme.font(32))
                        .foregroundColor(detailRarityText)
                        .shadow(color: .black.opacity(0.8), radius: 1, x: 0, y: 2)
                    Spacer()
                    PipsView(stage: face.stage)
                        .padding(.trailing, 6)
                }
                .frame(height: 48)
                LevelBarView(level: max(1, face.level), levelCap: face.levelCap, xp: face.xp, xpToNext: face.xpToNext, big: true)
                    .padding(.top, 8)
            }
            .padding(.top, 6)
            .padding(.leading, 12)
            .padding(.trailing, 14)
            .frame(width: 576, height: 118, alignment: .top)
            .at(12, 829 - 8 - 118, 576, 118)
        }
        .frame(width: 600, height: 829)
        .shadow(color: .black.opacity(0.8), radius: 15, x: 0, y: 10)
    }

    private var detailRarityText: Color {
        face.rarity == .ultimate ? Color(hex: 0xff4b4b) : Theme.rarity(face.rarity)
    }

    // MARK: Pieces

    private func artLayer(side: CardSide, arrowSize: CGSize, showArrows: Bool) -> some View {
        ZStack(alignment: .topLeading) {
            RadialGradient(colors: [Theme.tribe(face.tribe).opacity(0.4), Color(hex: 0x0b0c0d)], center: UnitPoint(x: 0.5, y: 0.35), startRadius: 0, endRadius: 150)
            CardArt(def: face.def, stage: face.stage)
                .saturation(locked ? 0 : 1)
                .brightness(locked ? -0.15 : 0)
            if locked {
                Sprite("lock_big")
                    .frame(width: 44, height: 56)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                    .offset(y: -8)
                    .shadow(color: .black.opacity(0.9), radius: 4, x: 0, y: 3)
            }
            if showArrows {
                ArrowsLayer(dirs: face.dirs, healDirs: face.healDirs, buffDirs: face.buffDirs, side: side, arrowSize: arrowSize, inset: 3)
            }
        }
    }

    private enum StatKind { case attack, hp, star, ability, mana }

    private func statSprite(_ k: StatKind) -> String {
        switch k {
        case .attack: return "hud_fighticon02"
        case .hp: return "hud_healthicon01"
        case .star: return "hud_experienceicon01"
        case .ability: return "hud_specialskill01"
        case .mana: return "hud_manaicon01"
        }
    }

    private func statColor(_ k: StatKind) -> Color {
        switch k {
        case .attack: return Theme.attack
        case .hp: return Theme.hp
        case .star: return Theme.star
        case .ability: return Theme.ability
        case .mana: return Theme.mana
        }
    }

    private func statCell(_ k: StatKind, _ value: Int) -> some View {
        let text = plainNumber(value)
        return HStack(spacing: 3) {
            Sprite(statSprite(k)).frame(width: 15, height: 15).shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 1)
            Text(text).font(Theme.num(text.count >= 5 ? 11 : 13)).foregroundColor(statColor(k)).shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 1)
        }
    }

    private func abilityCell(_ value: Double?) -> some View {
        let text = value.map { Abilities.formatValue($0).replacingOccurrences(of: ",", with: "") } ?? ""
        return HStack(spacing: 3) {
            Sprite(statSprite(.ability)).frame(width: 15, height: 15).shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 1)
            Text(text).font(Theme.num(text.count >= 5 ? 11 : 13)).foregroundColor(statColor(.ability)).shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 1)
        }
        .opacity(value == nil ? 0 : 1)
    }
}

/// Original tribe emblems (`TRIBE_SPRITES`).
func tribeSprite(_ t: Tribe) -> String {
    switch t {
    case .dwarf: return "hud_dwarficon01"
    case .elf: return "hud_elficon01"
    case .orc: return "hud_orcicon01"
    case .neutral: return "hud_neutralicon01"
    }
}

/// `glowSpriteFor`: the reveal glow of a rarity.
func glowSprite(_ r: Rarity) -> String {
    if r == .ultimate { return "glowingcardred" }
    if r == .rare || r == .heroic { return "glowingcardblue" }
    return "glowingcard"
}

/// A sprite tiled over its frame (the carddetail rails).
struct TiledSprite: View {
    @EnvironmentObject private var model: AppModel
    let name: String

    init(_ name: String) { self.name = name }

    var body: some View {
        if let img = model.assets.image(name) {
            Image(uiImage: img).resizable(resizingMode: .tile)
        } else {
            Color.clear
        }
    }
}

/// Direction arrows: red attack arrows on the enemy edge, green heal / blue buff arrows on the own neighbours
/// (`arrowsLayer`, including its remapping of the diagonal heal / buff directions onto the own neighbours).
struct ArrowsLayer: View {
    let dirs: [CatalogDirection]
    let healDirs: [CatalogDirection]
    let buffDirs: [CatalogDirection]
    let side: CardSide
    let arrowSize: CGSize
    let inset: CGFloat

    private enum Kind { case attack, heal, buff }

    private var arrows: [(dir: CatalogDirection, kind: Kind)] {
        var out: [(dir: CatalogDirection, kind: Kind)] = []
        var seen = Set<String>()
        for d in dirs {
            out.append((dir: d, kind: .attack))
            seen.insert(d.rawValue)
        }
        func add(_ list: [CatalogDirection], _ kind: Kind) {
            for d in list {
                let mapped: CatalogDirection
                switch d {
                case .left: mapped = .ownLeft
                case .right: mapped = .ownRight
                default: mapped = d
                }
                let key = "\(kind):\(mapped.rawValue)"
                if [.ownLeft, .ownRight, .direct].contains(mapped) && !seen.contains(key) && !(mapped == .direct && seen.contains("direct")) {
                    seen.insert(key)
                    out.append((dir: mapped, kind: kind))
                }
            }
        }
        add(healDirs, .heal)
        add(buffDirs, .buff)
        return out
    }

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            ForEach(Array(arrows.enumerated()), id: \.offset) { item in
                let a = item.element
                arrow(a.kind)
                    .rotationEffect(.degrees(rotation(a.dir)))
                    .position(position(a.dir, w: w, h: h))
            }
        }
        .allowsHitTesting(false)
    }

    private func arrow(_ kind: Kind) -> some View {
        let name: String
        switch kind {
        case .attack: name = "card_arrowred01"
        case .heal: name = "card_arrow01"
        case .buff: name = "card_arrowblue01"
        }
        return Sprite(name).frame(width: arrowSize.width, height: arrowSize.height).shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 1)
    }

    private func rotation(_ d: CatalogDirection) -> Double {
        switch (d, side) {
        case (.direct, .bottom): return 0
        case (.left, .bottom): return -45
        case (.right, .bottom): return 45
        case (.direct, .top): return 180
        case (.left, .top): return -135
        case (.right, .top): return 135
        case (.ownLeft, _): return -90
        case (.ownRight, _): return 90
        }
    }

    private func position(_ d: CatalogDirection, w: CGFloat, h: CGFloat) -> CGPoint {
        let aw = arrowSize.width, ah = arrowSize.height
        let edge = inset + 2
        switch (d, side) {
        case (.direct, .bottom): return CGPoint(x: w / 2, y: edge + ah / 2)
        case (.left, .bottom): return CGPoint(x: edge + aw / 2, y: edge + ah / 2)
        case (.right, .bottom): return CGPoint(x: w - edge - aw / 2, y: edge + ah / 2)
        case (.direct, .top): return CGPoint(x: w / 2, y: h - edge - ah / 2)
        case (.left, .top): return CGPoint(x: edge + aw / 2, y: h - edge - ah / 2)
        case (.right, .top): return CGPoint(x: w - edge - aw / 2, y: h - edge - ah / 2)
        case (.ownLeft, _): return CGPoint(x: inset + ah / 2, y: h / 2)
        case (.ownRight, _): return CGPoint(x: w - inset - ah / 2, y: h / 2)
        }
    }
}

/// Five fusion pips (`renderPips`): hud_evolution crystals, lit = stage + 1.
struct PipsView: View {
    let stage: Int
    var small: Bool = false

    var body: some View {
        let lit = max(0, min(5, stage + 1))
        HStack(spacing: small ? 4 : 10) {
            ForEach(0..<5, id: \.self) { i in
                Sprite(i < lit ? "hud_evolution" : "hud_evolution_grey")
                    .frame(width: small ? 11 : 22, height: small ? 15 : 30)
                    .shadow(color: i < lit ? Color(hex: 0xffd250, alpha: 0.8) : .black.opacity(0.8), radius: i < lit ? 4 : 1)
            }
        }
    }
}

/// Puzzle pieces over the art (`renderPieces`): owned pieces get the white outline, missing ones the dark
/// silhouette; positions are fractions of the 451 x 640 card canvas the sprites were cut from.
struct PiecesOverlay: View {
    let owned: Int
    let total: Int
    var compact: Bool = true

    /// `PIECE_LAYOUTS`: [x, y, w, h] of piece<n>_<i+1> on the 451x640 canvas.
    static let layouts: [Int: [(CGFloat, CGFloat, CGFloat, CGFloat)]] = [
        2: [(0, 0, 451, 323), (0, 217, 451, 423)],
        4: [(0, 0, 300, 323), (223, 0, 228, 394), (0, 246, 229, 394), (152, 314, 299, 326)],
        6: [(0, 0, 280, 216), (223, 0, 228, 216), (0, 159, 229, 282), (172, 159, 279, 282), (0, 385, 280, 255), (223, 385, 228, 255)],
        10: [(0, 0, 150, 216), (93, 0, 221, 216), (258, 0, 193, 216), (0, 159, 124, 302), (68, 159, 212, 302), (222, 159, 168, 302), (333, 159, 118, 302), (0, 405, 150, 235), (93, 405, 221, 235), (258, 405, 193, 235)],
    ]

    /// `pieceSet`: which sprite set draws a hunt of `total` pieces.
    static func pieceSet(_ total: Int) -> Int {
        total <= 2 ? 2 : total <= 4 ? 4 : total <= 6 ? 6 : 10
    }

    /// `litPieces`: how many sprites of the set are lit for owned / total.
    static func litPieces(owned: Int, total: Int) -> Int {
        let set = pieceSet(total)
        let t = max(1, total)
        let o = max(0, min(t, owned))
        if t == set { return o }
        return max(0, min(set, Int(JSMath.round(Double(o * set) / Double(t)))))
    }

    var body: some View {
        let set = PiecesOverlay.pieceSet(total)
        let lit = PiecesOverlay.litPieces(owned: owned, total: total)
        let layout = PiecesOverlay.layouts[set] ?? []
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            ZStack(alignment: .topLeading) {
                ForEach(Array(layout.enumerated()), id: \.offset) { item in
                    let r = item.element
                    let own = item.offset < lit
                    StretchedSprite("piece\(set)_\(item.offset + 1)\(own ? "" : "b")")
                        .opacity(own ? 0.75 : 0.92)
                        .frame(width: w * r.2 / 451, height: h * r.3 / 640)
                        .offset(x: w * r.0 / 451, y: h * r.1 / 640)
                }
                HStack(spacing: 3) {
                    Sprite("cardpiece_icon").frame(width: compact ? 16 : 32, height: compact ? 16 : 32)
                    Text("\(owned)/\(total)").font(Theme.num(compact ? 12 : 22)).foregroundColor(Theme.tan).shadow(color: .black, radius: 0, x: 0, y: 1)
                }
                .padding(.leading, compact ? 2 : 6).padding(.trailing, compact ? 5 : 10).padding(.vertical, compact ? 1 : 4)
                .background(Color(hex: 0x0a0b0c, alpha: 0.75))
                .cornerRadius(3)
                .frame(width: w, height: h, alignment: .bottomLeading)
                .offset(x: compact ? 5 : 12, y: compact ? -25 : -12)
            }
        }
        .allowsHitTesting(false)
    }
}

/// Empty deck slot (`renderEmptySlot`): cardslot_simple, cardslotlocked when locked; `recess` draws the
/// pre-battle's cardslot01, `small` the deck screen's cardslot.
struct DeckSlotView: View {
    var locked: Bool = false
    var recess: Bool = false
    var small: Bool = false
    var highlight: DropHighlight = .none
    var width: CGFloat = 116
    var height: CGFloat = 164

    var body: some View {
        let name = locked ? "cardslotlocked" : (small ? "cardslot" : (recess ? "cardslot01" : "cardslot_simple"))
        StretchedSprite(name)
            .frame(width: width, height: height)
            .background(Color(hex: 0x050506))
            .overlay(highlightOverlay)
    }

    @ViewBuilder
    private var highlightOverlay: some View {
        switch highlight {
        case .none:
            EmptyView()
        case .valid:
            RoundedRectangle(cornerRadius: 6).stroke(Theme.mana, lineWidth: 3).shadow(color: Theme.mana, radius: 10)
        case .invalid:
            RoundedRectangle(cornerRadius: 6).stroke(Theme.attack, lineWidth: 3).shadow(color: Theme.attack, radius: 10)
        }
    }
}

enum DropHighlight {
    case none, valid, invalid
}

/// The detail card with its stats panel and the action buttons under it (`renderCard(view, {size: 'detail'})`).
struct CardDetailView: View {
    let face: CardFaceModel
    var showStats: Bool = true
    var pieces: (owned: Int, total: Int)? = nil
    var inDeck: Bool = false
    var actions: [(sprite: String, label: String, action: () -> Void)] = []

    var body: some View {
        VStack(spacing: 0) {
            CardFaceView(face: face, size: .detail, pieces: pieces)
            if showStats {
                VStack(spacing: 10) {
                    HStack {
                        Spacer()
                        chip("hud_fighticon02", fmtNumber(face.attack), Theme.attack)
                        Spacer()
                        chip("hud_healthicon01", fmtNumber(face.maxHp), Theme.hp)
                        Spacer()
                        chip("hud_manaicon01", fmtNumber(face.mana), Theme.mana)
                        Spacer()
                    }
                    Text(face.abilityText.isEmpty ? Strings.noAbility : face.abilityText)
                        .font(face.abilityText.isEmpty ? Theme.light(23) : Theme.font(23))
                        .italic(face.abilityText.isEmpty)
                        .foregroundColor(face.abilityText.isEmpty ? Theme.muted : Theme.ability)
                        .lineSpacing(5)
                        .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
                }
                .padding(.top, 18).padding(.horizontal, 22).padding(.bottom, 16)
                .frame(width: 600)
                .background(LinearGradient(colors: [Color(hex: 0x202224), Color(hex: 0x141617)], startPoint: .top, endPoint: .bottom))
                .padding(.top, 10)
            }
            if !actions.isEmpty {
                HStack(spacing: 24) {
                    ForEach(Array(actions.enumerated()), id: \.offset) { item in
                        IconButton(sprite: item.element.sprite, size: .lg, iconScale: 0.58, action: item.element.action)
                            .saturation(inDeck && item.offset == actions.count - 1 && actions.count > 1 ? 0.2 : 1)
                            .accessibilityLabel(item.element.label)
                    }
                }
                .padding(.top, 6).padding(.bottom, 8)
                .frame(width: 600)
                .background(LinearGradient(colors: [Color(hex: 0x141617), Color(hex: 0x101213)], startPoint: .top, endPoint: .bottom))
            }
        }
    }

    private func chip(_ sprite: String, _ text: String, _ color: Color) -> some View {
        HStack(spacing: 16) {
            Sprite(sprite).frame(width: 54, height: 54).shadow(color: .black.opacity(0.8), radius: 1, x: 0, y: 2)
            Text(text).font(Theme.num(42)).foregroundColor(color).shadow(color: .black.opacity(0.8), radius: 1, x: 0, y: 2)
        }
    }
}
