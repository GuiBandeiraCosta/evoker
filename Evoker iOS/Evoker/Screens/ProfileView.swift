import SwiftUI
import EvokerCore

/// Profile view of the character screen (`src/ui/screens/character-profile.js`, the client's playerinfo): avatar +
/// name, Best card, Stats bars with the Bonus column, Quest, Battles won, Your cards n/100, Support. Tapping the
/// avatar picks one of 12 card portraits, tapping the name renames. Points left over from older saves get the
/// stat-point panel under the profile.
struct ProfileView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        if let state = model.store.state {
            let p = state.player
            let xpNext = model.deps.stats.playerXpToNext(level: p.level) ?? max(1, p.xp)
            let best = CollectionOps.bestCard(state, deps: model.deps)
            let bestDef = best.flatMap { model.db.get($0.cardId) }
            VStack(spacing: 18) {
                ZStack(alignment: .topLeading) {
                    Color(hex: 0x1a1918, alpha: 0.92)
                    NineSlice(Theme.Frames.hudNineframe)
                    // avatar and name
                    Button(action: { Task { @MainActor in await pickAvatar(current: p.avatar) } }) {
                        PortraitArt(avatar: p.avatar)
                            .frame(width: 102, height: 88)
                            .clipped()
                            .overlay(NineSlice(Theme.Frames.smallWhite))
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(PressScaleStyle())
                    .at(-4, 4, 102, 88)
                    Button(action: { Task { @MainActor in await changeName(current: p.name) } }) {
                        Text(p.name.isEmpty ? "Evoker" : p.name)
                            .font(Theme.font(32))
                            .foregroundColor(Color(hex: 0xd9a85a))
                            .lineLimit(1)
                            .shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 2)
                            .frame(maxWidth: 560, alignment: .leading)
                            .frame(height: 48)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .offset(x: 110, y: 24)
                    // best card
                    Button(action: { if let b = best { model.sfx("ui_button_card"); model.router.go(.cardDetail(.owned(uid: b.uid))) } }) {
                        ZStack(alignment: .topLeading) {
                            Color(hex: 0x0a0a0a, alpha: 0.25)
                            NineSlice(Theme.Frames.smallWhite)
                            Text(Strings.bestCard).font(Theme.font(19)).foregroundColor(Color(hex: 0xf2f2f2)).offset(x: 4, y: 4)
                            Text(bestDef?.name ?? "").font(Theme.font(19)).foregroundColor(Color(hex: 0xf2f2f2)).lineLimit(1).frame(width: 238, alignment: .leading).offset(x: 4, y: 28)
                            CardThumb(def: bestDef, stage: best?.stage ?? 0).at(10, 56, 216, 252)
                        }
                        .frame(width: 246, height: 322, alignment: .topLeading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(best == nil)
                    .at(-8, 96, 246, 322)
                    // stats box
                    ZStack(alignment: .topLeading) {
                        Color(hex: 0x0a0a0a, alpha: 0.25)
                        NineSlice(Theme.Frames.smallWhite)
                        Text(Strings.stats).font(Theme.font(22)).foregroundColor(Color(hex: 0xf2f2f2)).offset(x: 10, y: 4)
                        Text(Strings.bonus).font(Theme.font(22)).foregroundColor(Color(hex: 0xf2f2f2)).offset(x: 290, y: 4)
                        ZStack(alignment: .topLeading) {
                            StretchedSprite("resourcebg_big")
                            infoBar(.xp, value: p.xp, max: xpNext, text: "Level \(p.level)").at(50, 14, 200, 28)
                            infoBar(.stamina, value: p.stamina, max: p.staminaMax, text: "\(fmtNumber(p.stamina))/\(fmtNumber(p.staminaMax))").at(50, 54, 200, 28)
                            infoBar(.mana, value: p.mana, max: p.manaMax, text: "\(fmtNumber(p.mana))/\(fmtNumber(p.manaMax))").at(50, 92, 200, 28)
                            infoBar(.hp, value: p.hpMax, max: p.hpMax, text: fmtNumber(p.hpMax)).at(50, 130, 200, 28)
                        }
                        .at(8, 36, 268, 168)
                        ForEach(Array([(BarKind.xp, 50), (BarKind.stamina, 90), (BarKind.mana, 128), (BarKind.hp, 166)].enumerated()), id: \.offset) { item in
                            Text("-").font(Theme.font(20)).foregroundColor(item.element.0.color)
                                .frame(width: 146, height: 30)
                                .background(Color.black.opacity(0.35))
                                .overlay(NineSlice(Theme.Frames.smallWhite))
                                .at(286, CGFloat(item.element.1), 146, 30)
                        }
                    }
                    .frame(width: 442, height: 216, alignment: .topLeading)
                    .at(246, 96, 442, 216)
                    // facts
                    VStack(spacing: 4) {
                        fact(Strings.quest, fmtNumber(p.questsDone))
                        fact(Strings.battlesWon, fmtNumber(p.battlesWon))
                        fact(Strings.yourCards, "\(state.cards.count)/\(Constants.collectionLimit)")
                    }
                    .frame(width: 420)
                    .offset(x: 254, y: 320)
                    // support
                    ZStack(alignment: .topTrailing) {
                        Color(hex: 0x0a0a0a, alpha: 0.25)
                        NineSlice(Theme.Frames.smallWhite)
                        Text(Strings.support).font(Theme.font(26)).foregroundColor(Color(hex: 0xf2f2f2)).frame(width: 140).offset(x: -20, y: 8)
                        Button(action: { model.sfx("ui_button_circular"); model.router.go(.help(topic: "character")) }) {
                            ZStack {
                                NineSlice(Theme.Frames.menubarButton)
                                Sprite("help_icon_active").frame(width: 46, height: 62)
                            }
                            .frame(width: 104, height: 100)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(PressScaleStyle())
                        .offset(x: -38, y: 48)
                    }
                    .frame(width: 696, height: 164, alignment: .topTrailing)
                    .at(-8, 424, 696, 164)
                }
                .frame(width: 704, height: 620, alignment: .topLeading)
                .shadow(color: .black.opacity(0.7), radius: 9, x: 0, y: 6)
                if p.statPoints > 0 {
                    StatPointsPanel()
                }
            }
        }
    }

    private func infoBar(_ kind: BarKind, value: Int, max: Int, text: String) -> some View {
        ZStack(alignment: .topLeading) {
            Text(text).font(Theme.font(20)).foregroundColor(Color(hex: 0xf4f4f4)).lineLimit(1).shadow(color: .black.opacity(0.95), radius: 1, x: 0, y: 1).offset(x: 10, y: 1)
            Rectangle().fill(kind.color).frame(width: 192 * CGFloat(barRatio(Double(value), Double(max))), height: 4).shadow(color: kind.color.opacity(0.8), radius: 2).offset(x: 4, y: 21)
        }
    }

    private func fact(_ label: String, _ value: String) -> some View {
        HStack(spacing: 0) {
            Text(label).frame(width: 236, alignment: .leading)
            Text(value).font(Theme.num(26))
            Spacer()
        }
        .font(Theme.font(26))
        .foregroundColor(Color(hex: 0xf2f2f2))
        .shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 1)
        .frame(height: 30)
    }

    /// Avatar picker dialog (12 card portraits).
    private func pickAvatar(current: Int) async {
        let ids = Array((model.deps.names?.avatars ?? []).prefix(12))
        model.sfx("ui_button_card")
        var r = DialogRequest()
        r.title = Strings.chooseAvatar
        r.width = 640
        r.body = { handle in
            AnyView(LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 14), count: 4), spacing: 14) {
                ForEach(Array(ids.enumerated()), id: \.offset) { item in
                    Button(action: { handle.close("\(item.offset)") }) {
                        PortraitArt(avatar: item.offset)
                            .frame(width: 128, height: 128)
                            .clipped()
                            .overlay(NineSlice(Theme.Frames.playerFrame))
                            .overlay(item.offset == current ? RoundedRectangle(cornerRadius: 4).stroke(Theme.tierGold, lineWidth: 3).shadow(color: Theme.tierGold.opacity(0.6), radius: 10) : nil)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(PressScaleStyle())
                }
            }.padding(.vertical, 6))
        }
        guard let v = await model.dialogs.open(r), let i = Int(v), i != current else { return }
        model.sfx("ui_button_circular")
        model.updateState { s, _, _ in PlayerOps.editProfile(s, name: nil, avatar: i) }
    }

    /// Change-name dialog.
    private func changeName(current: String) async {
        model.sfx("ui_button_circular")
        var r = DialogRequest()
        r.title = Strings.changeName
        r.body = { handle in AnyView(NameFormBody(initial: current, handle: handle)) }
        guard let typed = await model.dialogs.open(r) else { return }
        let name = String(typed.split(whereSeparator: { $0 == " " || $0 == "\n" }).joined(separator: " ").prefix(20))
        if name.isEmpty { model.toast(Strings.enterAName); return }
        model.updateState { s, _, _ in PlayerOps.editProfile(s, name: name, avatar: nil) }
        model.toast(Strings.welcome(name))
    }
}

/// The art of an avatar index (card art of names.json's avatars, the default player otherwise).
struct PortraitArt: View {
    let avatar: Int
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ZStack {
            Color(hex: 0x0a0b0c)
            if let id = avatarCardId(avatar, names: model.deps.names), let def = model.db.get(id) {
                CardArt(def: def, stage: 0)
            } else {
                Sprite("default_player", contentMode: .fill)
            }
        }
    }
}

/// Body of the change-name dialog: a line of text and the input; Cancel / OK below.
struct NameFormBody: View {
    let initial: String
    let handle: DialogHandle
    @State private var text: String = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 14) {
            Text(Strings.howShallRealmKnowYou).font(Theme.font(26)).foregroundColor(Theme.text)
            TextField(Strings.yourName, text: $text)
                .font(Theme.font(30))
                .foregroundColor(Theme.gold)
                .multilineTextAlignment(.center)
                .autocorrectionDisabled(true)
                .focused($focused)
                .onChange(of: text) { _, v in if v.count > 20 { text = String(v.prefix(20)) } }
                .onSubmit { handle.close(text) }
                .frame(height: 64)
                .padding(.horizontal, 16)
                .background(LinearGradient(colors: [Color(hex: 0x0b0c0d), Color(hex: 0x16181a)], startPoint: .top, endPoint: .bottom))
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.stoneEdgeDark, lineWidth: 2))
            HStack(spacing: 14) {
                SteelButton(Strings.cancel, variant: .grey) { handle.close(nil) }
                SteelButton(Strings.ok) { handle.close(text) }
            }
        }
        .onAppear { text = initial; focused = true }
    }
}

/// The stat-point allocation panel with +/- spinners and Confirm (points left over from older saves).
struct StatPointsPanel: View {
    @EnvironmentObject private var model: AppModel
    @State private var alloc = StatAlloc()

    private let rows: [(LevelUpAttribute, String)] = [(.hp, "hp"), (.stamina, "stamina"), (.mana, "mana")]

    var body: some View {
        if let state = model.store.state {
            let p = state.player
            let preview = PlayerOps.previewStatPoints(state, alloc: alloc)
            let total = alloc.hp + alloc.stamina + alloc.mana
            let remaining = max(0, p.statPoints - total)
            Panel {
                VStack(spacing: 8) {
                    HStack(spacing: 12) {
                        Text(Strings.statPoints).font(Theme.font(28)).foregroundColor(Theme.tan)
                        Spacer()
                        Text("\(remaining) left").font(Theme.num(24)).foregroundColor(Theme.text)
                        Sprite("badge").frame(width: 44, height: 44)
                    }
                    Text("Unspent points: 1 point = +30 health, +1 stamina or +1 mana.").font(Theme.light(17)).foregroundColor(Theme.muted)
                    HStack(spacing: 6) {
                        Text("").frame(width: 170)
                        Text("Now").frame(width: 90)
                        Text("Add").frame(maxWidth: .infinity)
                        Text("After").frame(width: 100)
                        Text("").frame(width: 80)
                    }
                    .font(Theme.font(15)).foregroundColor(Theme.muted)
                    ForEach(rows, id: \.1) { row in
                        let a = row.0
                        let cur = a == .hp ? p.hpMax : (a == .mana ? p.manaMax : p.staminaMax)
                        let next = a == .hp ? preview.hpMax : (a == .mana ? preview.manaMax : preview.staminaMax)
                        let placed = alloc.value(a)
                        HStack(spacing: 6) {
                            HStack(spacing: 8) {
                                Sprite(a.sprite).frame(width: 36, height: 36)
                                Text(a.label).font(Theme.font(24)).foregroundColor(a == .hp ? Theme.hp : (a == .mana ? Theme.mana : Theme.stamina))
                            }
                            .frame(width: 170, alignment: .leading)
                            Text(fmtNumber(cur)).font(Theme.num(24)).foregroundColor(Theme.text).frame(width: 90)
                            HStack(spacing: 4) {
                                SteelButton("−", size: .sm, disabled: placed <= 0) { bump(a, -1) }.frame(width: 54, height: 54)
                                Text("\(placed)").font(Theme.num(24)).foregroundColor(placed > 0 ? Theme.star : Theme.muted).frame(minWidth: 44)
                                SteelButton("+", variant: .green, size: .sm, disabled: remaining <= 0) { bump(a, 1) }.frame(width: 54, height: 54)
                            }
                            .frame(maxWidth: .infinity)
                            Text(fmtNumber(next)).font(Theme.num(24)).foregroundColor(placed > 0 ? Theme.tierGold : Theme.muted).frame(width: 100)
                            Text("+\(a.mult) / pt").font(Theme.font(14)).foregroundColor(Theme.muted).frame(width: 80, alignment: .trailing)
                        }
                        .padding(.vertical, 4).padding(.horizontal, 6)
                        .frame(minHeight: 64)
                        .background(Color.black.opacity(0.3))
                        .overlay(NineSlice(Theme.Frames.ironframe))
                    }
                    SteelButton("Confirm", variant: .green, disabled: !(total > 0 && total <= p.statPoints)) { confirm(total: total) }
                        .frame(minWidth: 260)
                        .padding(.top, 4)
                }
                .padding(.top, 12).padding(.horizontal, 14).padding(.bottom, 14)
            }
            .overlay(NineSlice(Theme.Frames.glowGold).padding(-8).allowsHitTesting(false))
            .frame(width: 704)
        }
    }

    private func bump(_ a: LevelUpAttribute, _ delta: Int) {
        guard let p = model.store.state?.player else { return }
        let cur = alloc.value(a)
        let others = alloc.hp + alloc.stamina + alloc.mana - cur
        let room = max(0, p.statPoints - others)
        let next = max(0, min(room, cur + delta))
        alloc.add(a, next - cur)
        model.sfx("ui_button_switch")
    }

    private func confirm(total: Int) {
        let a = alloc
        if model.updateState({ s, _, _ in try PlayerOps.spendStatPoints(s, alloc: a) }) {
            model.sfx("ui_button_circular")
            model.toast("\(total) stat point\(total == 1 ? "" : "s") spent!", icon: "hud_experienceicon01")
            alloc = StatAlloc()
        }
    }
}
