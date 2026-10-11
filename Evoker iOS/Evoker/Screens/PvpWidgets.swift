import SwiftUI
import EvokerCore

/// Widgets shared by the Arena and League screens (`src/ui/screens/pvp-widgets.js`, `pvp-events.js`,
/// `pvp-puzzle.js`): today's event banner, the opponent info popup (comp_enemyinfo_popup), the puzzle card of a
/// piece hunt, the fight-history lines.

/// Today's event banner (comp_promotion_banner smallBanner) with its timer.
struct EventBannerView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        if let ev = model.dailyEvent {
            let endsAt = JSDate.utcDayStart(model.now) + JSDate.dayMs
            let art = model.db.get(EventBannerInfo.artCardId(ev.id))
            ZStack(alignment: .topLeading) {
                Color(hex: 0x241820)
                if let def = art {
                    CardArt(def: def, stage: 0)
                        .opacity(0.9)
                        .mask(LinearGradient(stops: [.init(color: .clear, location: 0.18), .init(color: .black, location: 0.42), .init(color: .black, location: 0.7), .init(color: .clear, location: 0.92)], startPoint: .leading, endPoint: .trailing))
                }
                LinearGradient(stops: [.init(color: Color(hex: 0x5f4678, alpha: 0.92), location: 0), .init(color: Color(hex: 0x6e5078, alpha: 0.55), location: 0.34), .init(color: Color(hex: 0x1e141e, alpha: 0.15), location: 0.55), .init(color: Color(hex: 0x19141e, alpha: 0.7), location: 0.75), .init(color: Color(hex: 0x141018, alpha: 0.9), location: 1)], startPoint: .leading, endPoint: .trailing)
                Text(ev.name.uppercased())
                    .font(Theme.font(34))
                    .foregroundColor(Color(hex: 0xdce6f4))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                    .shadow(color: .black.opacity(0.95), radius: 1.5, x: 0, y: 2)
                    .frame(width: 300, height: 84)
                    .offset(x: 20, y: 10)
                Text(EventBannerInfo.headline(ev.id).uppercased())
                    .font(Theme.font(16))
                    .foregroundColor(Color(hex: 0xf1f1f1))
                    .multilineTextAlignment(.center)
                    .frame(width: 240)
                    .offset(x: Stage.width - 12 - 86 - 240, y: 10)
                if EventBannerInfo.isDouble(ev.id) {
                    X2Badge(size: 58).offset(x: Stage.width - 12 - 10 - 58, y: 8)
                }
                CountdownText(endsAt: endsAt, style: .hms, font: Theme.num(25), color: .white)
                    .frame(width: 270, height: 34)
                    .background(Color(hex: 0x08080c, alpha: 0.85))
                    .offset(x: Stage.width - 12 - 10 - 270, y: 104 - 8 - 34)
            }
            .frame(width: Stage.width - 12, height: 104)
            .clipped()
            .overlay(Rectangle().stroke(Color(hex: 0x5d3a48), lineWidth: 3))
            .padding(.top, 8).padding(.horizontal, 6).padding(.bottom, 4)
        }
    }
}

/// The opponent info popup (comp_enemyinfo_popup on pvp_playerinfo_bg): name and portrait, best card, level,
/// stamina, mana and HP bars, Quests and Fights Won, the attack / reroll buttons.
struct SimInfoBody: View {
    let info: SimInfo
    let canAttack: Bool
    let rerollGems: Int?
    let handle: DialogHandle
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 18) {
                PortraitView(avatar: info.avatar, size: 52)
                Text(info.name).font(Theme.font(32)).foregroundColor(Theme.gold).lineLimit(1).shadow(color: .black.opacity(0.8), radius: 1, x: 0, y: 2)
            }
            .padding(.horizontal, 50)
            .frame(height: 52)
            .padding(.bottom, 20)
            HStack(alignment: .top, spacing: 24) {
                VStack(spacing: 8) {
                    if let best = info.bestCard, let def = model.db.get(best.cardId) {
                        CardFaceView(face: CardFaceModel.fromDef(def, stage: best.stage, level: best.level, deps: model.deps), size: .compact)
                            .scaleEffect(1.5, anchor: .top)
                            .frame(width: 180, height: 252, alignment: .top)
                        Text(def.name).font(Theme.font(20)).foregroundColor(Theme.muted)
                    } else {
                        InsetPanel { Color.clear.frame(width: 180, height: 252) }
                        Text(Strings.noCards).font(Theme.font(20)).foregroundColor(Theme.muted)
                    }
                }
                .frame(width: 212)
                .padding(.top, 8)
                VStack(spacing: 14) {
                    VStack(spacing: 4) {
                        statRow("hud_experienceicon01", "Level \(fmtNumber(info.level))", .xp)
                        statRow("hud_stamicon01", "\(fmtNumber(info.stamina))/\(fmtNumber(info.stamina))", .stamina)
                        statRow("hud_manaicon01", "\(fmtNumber(info.mana))/\(fmtNumber(info.mana))", .mana)
                        statRow("hud_healthicon01", fmtNumber(info.hp), .hp)
                    }
                    .padding(.vertical, 6).padding(.horizontal, 10)
                    VStack(spacing: 4) {
                        HStack { Text(Strings.quests); Spacer(); Text(fmtNumber(info.quests)).font(Theme.num(22)) }
                        HStack { Text(Strings.fightsWon); Spacer(); Text(fmtNumber(info.battlesWon)).font(Theme.num(22)) }
                    }
                    .font(Theme.font(22))
                    .foregroundColor(Theme.text)
                    .padding(.top, 10).padding(.horizontal, 12)
                }
                .frame(maxWidth: .infinity)
            }
            .padding(.horizontal, 4)
            if canAttack || rerollGems != nil {
                HStack(spacing: 10) {
                    Spacer()
                    if let gems = rerollGems {
                        SteelButton(size: .sm, action: { handle.close("reroll") }) {
                            VStack(spacing: 0) {
                                Text(Strings.rerollOpponent).font(Theme.font(17))
                                GemPrice(amount: gems, fontSize: 22, iconSize: 24)
                            }
                        }
                        .frame(minHeight: 76)
                    }
                    if canAttack {
                        PvpAttackButton { handle.close("attack") }
                    }
                }
                .padding(.top, 10).padding(.horizontal, 14)
                .frame(minHeight: 96)
            }
        }
        .padding(.top, 14).padding(.horizontal, 20).padding(.bottom, 18)
        .frame(minHeight: 420)
        .background(StretchedSprite("pvp_playerinfo_bg"))
    }

    private func statRow(_ icon: String, _ text: String, _ kind: BarKind) -> some View {
        HStack(spacing: 10) {
            Sprite(icon).frame(width: 30, height: 30).shadow(color: .black.opacity(0.8), radius: 1, x: 0, y: 2)
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 3).fill(LinearGradient(colors: [Color(hex: 0x0b0c0d), Color(hex: 0x16181a)], startPoint: .top, endPoint: .bottom))
                    .overlay(RoundedRectangle(cornerRadius: 3).stroke(Color(hex: 0x0a0b0c), lineWidth: 1))
                Rectangle().fill(kind.color).frame(height: 4).shadow(color: kind.color.opacity(0.8), radius: 2).frame(maxHeight: .infinity, alignment: .bottom)
                Text(text).font(Theme.font(19)).foregroundColor(Theme.text).shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 1).padding(.leading, 12).padding(.bottom, 4)
            }
            .frame(height: 26)
        }
    }
}

enum PvpDialogs {
    /// Open the opponent info dialog: "attack", "reroll" or nil (`showSimInfo`).
    @MainActor
    static func showSimInfo(_ info: SimInfo, model: AppModel, canAttack: Bool = true, rerollGems: Int? = nil) async -> String? {
        var r = DialogRequest()
        r.width = 640
        r.body = { handle in AnyView(SimInfoBody(info: info, canAttack: canAttack, rerollGems: rerollGems, handle: handle)) }
        return await model.dialogs.open(r)
    }
}

/// The puzzle card of a hunt: the art under the original piece overlays (outline = owned, dark = missing).
struct PuzzleView: View {
    let def: CardDef
    let owned: Int
    let total: Int
    let width: CGFloat
    let height: CGFloat

    var body: some View {
        ZStack {
            Color(hex: 0x050506)
            CardArt(def: def, stage: 0)
            PiecesOverlay(owned: owned, total: total, compact: false)
        }
        .frame(width: width, height: height)
        .clipped()
        .overlay(Rectangle().stroke(Theme.rarityThumb(def.rarity), lineWidth: 4))
        .shadow(color: .black.opacity(0.8), radius: 6, x: 0, y: 4)
    }
}

/// `huntProgress`: "n / total" and the missing count.
func huntProgress(owned: Int, total: Int) -> (text: String, missing: Int) {
    let t = max(1, total)
    let o = max(0, min(t, owned))
    return ("\(o) / \(t)", t - o)
}

/// `historyResult` / `historyDate`: the result line and the date / time of a fight-history entry.
enum HistoryLines {
    static func result(_ rep: Replay) -> (label: String, color: Color) {
        if rep.result.winner == .draw { return ("Draw", Color(hex: 0xff9b1a)) }
        if rep.won { return ("Won", Color(hex: 0x199632)) }
        return ("Lost", Color(hex: 0xe0261d))
    }

    static func date(_ ms: Int64) -> (date: String, time: String) {
        let d = Date(timeIntervalSince1970: Double(ms) / 1000)
        let c = Calendar.current.dateComponents([.day, .month, .year, .hour, .minute, .second], from: d)
        return ("\(padNumber(c.day ?? 0)).\(padNumber(c.month ?? 0)).\(c.year ?? 0)", "\(padNumber(c.hour ?? 0)):\(padNumber(c.minute ?? 0)):\(padNumber(c.second ?? 0))")
    }
}
