import SwiftUI
import EvokerCore

/// Card Lab (`src/ui/screens/lab.js` + `lab-model.js`): a test screen for the behaviour of every card in combat.
/// Pick any card at any fusion stage and level; "Auto set-up" builds the simplest scenario around it (the card in
/// the middle of your row between two sturdy allies, five plain attackers opposite); every slot can be changed by
/// hand; Fight! runs the real engine on the real battle screen, then the engine's event log is listed here. The
/// effect showcase has one "Show" per effect type. Fights touch nothing in the save.
enum LabModel {
    /// Both players' HP in the lab.
    static let hp = 10000

    typealias Slot = FightRunner.LabSlot

    /// `fillerCards`: ability-free direct attackers; `weak` hits softly, `strong` kills, `ally` lasts.
    static func fillerCards(db: CardsDb, tribe: Tribe? = nil) -> (weak: CardDef, strong: CardDef, ally: CardDef)? {
        var plain = db.all().filter { d in
            !d.isTrainer && d.base.attack > 0 && d.dirs.contains(.direct) && !(0...4).contains { Abilities.hasAbility(d.ability, stage: $0) }
        }
        if let t = tribe {
            let ofTribe = plain.filter { $0.tribe == t }
            if !ofTribe.isEmpty { plain = ofTribe }
        }
        guard !plain.isEmpty else { return nil }
        let byAttack = plain.sorted { a, b in a.base.attack != b.base.attack ? a.base.attack < b.base.attack : a.mana < b.mana }
        let byHp = plain.sorted { a, b in a.base.hp != b.base.hp ? a.base.hp > b.base.hp : a.base.attack > b.base.attack }
        return (byAttack[0], byAttack[byAttack.count - 1], byHp[0])
    }

    /// `requiredTribe`: the tribe an ability's buffs are restricted to (`filter.tribe`).
    static func requiredTribe(_ ability: AbilityDef?, stage: Int) -> Tribe? {
        guard let entry = ability?.entry(stage: stage) else { return nil }
        for b in entry.buffs {
            if let t = b.filter?.tribe { return t }
        }
        return nil
    }

    /// A slot of `cardId` at `stage`, at the stage's level cap.
    static func slotAt(deps: Deps, cardId: String, stage: Int) -> Slot? {
        guard let def = deps.db.get(cardId) else { return nil }
        return Slot(cardId: cardId, stage: stage, level: deps.stats.capFor(def, stage: stage))
    }

    /// `autoScenario`: the card in the middle between two sturdy allies, five fillers opposite.
    static func autoScenario(deps: Deps, cardId: String, stage: Int, level: Int, strong: Bool) -> (own: [Slot?], opp: [Slot?]) {
        guard let def = deps.db.get(cardId), let fillers = fillerCards(db: deps.db) else { return ([nil, nil, nil, nil, nil], [nil, nil, nil, nil, nil]) }
        let tribe = requiredTribe(def.ability, stage: stage)
        let ally = fillerCards(db: deps.db, tribe: tribe)?.ally ?? fillers.ally
        let foe = strong ? fillers.strong : fillers.weak
        func at(_ d: CardDef) -> Slot { Slot(cardId: d.id, stage: stage, level: min(level, deps.stats.capFor(d, stage: stage))) }
        return ([at(ally), at(ally), Slot(cardId: cardId, stage: stage, level: level), at(ally), at(ally)], [at(foe), at(foe), at(foe), at(foe), at(foe)])
    }

    struct Showcase: Identifiable {
        let type: BuffType
        let label: String
        let what: String
        let look: String
        let cardId: String
        let stage: Int
        let strong: Bool
        let seed: UInt32
        let rows: ((Deps) -> (own: [Slot?], opp: [Slot?]))?
        var id: String { type.rawValue }

        init(_ type: BuffType, _ label: String, _ what: String, _ look: String, _ cardId: String, _ stage: Int, _ strong: Bool, _ seed: UInt32, rows: ((Deps) -> (own: [Slot?], opp: [Slot?]))? = nil) {
            self.type = type; self.label = label; self.what = what; self.look = look; self.cardId = cardId; self.stage = stage; self.strong = strong; self.seed = seed; self.rows = rows
        }
    }

    private static func filled(_ deps: Deps, own: [(String, Int)], opp: [(String, Int)]) -> (own: [Slot?], opp: [Slot?]) {
        (own.map { slotAt(deps: deps, cardId: $0.0, stage: $0.1) }, opp.map { slotAt(deps: deps, cardId: $0.0, stage: $0.1) })
    }

    /// One entry per effect type an ability can have (`SHOWCASE`).
    static let showcase: [Showcase] = [
        Showcase(.raise_attack, "Raise attack", "Targets hit harder this round (flat or %).", "Red sword arrows and a glow on the boosted cards, \"+N\" in orange over them; their attack number rises for the round.", "air-elemental", 4, false, 1),
        Showcase(.increment_attack, "Increment attack (permanent)", "Attack grows for good, accumulating every time it triggers.", "The same sword arrows and \"+N\", but the attack number stays raised after the round.", "baby-dragon", 4, true, 1),
        Showcase(.raise_hp, "Raise HP", "Targets get more maximum HP.", "Green heart arrows and \"+N\" on the neighbours; their HP numbers go up.", "arch-angel", 4, false, 1),
        Showcase(.raise_player_hp, "Raise player HP", "Your own player gets more maximum HP.", "Your HP bar (bottom) jumps to a bigger maximum right at the start.", "dwarven-sage", 4, false, 1),
        Showcase(.reduce_ability_attack_percent, "Weaken ability cards", "Every card with an ability loses X % of its attack in round 1.", "Red \"-N\" debuff arrows on all five enemy Air Elementals (ability cards) in round 1; the allies, with no ability, are untouched.", "medusa", 4, false, 1, rows: { deps in
            let ally = fillerCards(db: deps.db)?.ally.id ?? "envoy"
            return filled(deps, own: [(ally, 4), (ally, 4), ("medusa", 4), (ally, 4), (ally, 4)], opp: Array(repeating: ("air-elemental", 4), count: 5))
        }),
        Showcase(.heal, "Heal", "Heals the cards in its directions every round.", "Green glow on the healer, green \"+N\" on the healed cards, their HP bars refill.", "airborne-parasite", 4, false, 1),
        Showcase(.heal_player, "Heal player", "Heals your own player.", "Your HP bar (bottom) flashes green with a \"+N\".", "astral-navigator", 4, true, 1),
        Showcase(.heal_boost_percent, "Heal boost", "Your other cards' heals are X % stronger while it lives.", "The two Alchemists' green \"+N\" on their neighbours are bigger than an Alchemist's own heal value.", "djinn", 4, false, 1, rows: { deps in
            let f = fillerCards(db: deps.db)
            let ally = f?.ally.id ?? "envoy", weak = f?.weak.id ?? "envoy"
            return filled(deps, own: [("alchemist", 4), (ally, 4), ("djinn", 4), (ally, 4), ("alchemist", 4)], opp: Array(repeating: (weak, 4), count: 5))
        }),
        Showcase(.deal_damage_to_opponent_player, "Damage the enemy player", "Direct damage to the opposing player every round, past the cards.", "A bolt from the card to the enemy HP bar (top), the bar flashes red with \"-N\".", "raptorial-fungus", 4, false, 1),
        Showcase(.deal_damage_to_player, "Damage your own player", "The card hurts its own player every round (a drawback).", "A bolt from the card to your own HP bar (bottom), \"-N\" on it.", "arch-demon", 4, false, 1),
        Showcase(.deal_damage_to_all_opponent_cards, "Damage all enemies", "Hits every enemy card at once, regardless of direction.", "Bolts from the card to all five enemy cards at the same time, each with a burst and \"-N\".", "lightning-spirit", 4, false, 1),
        Showcase(.bonus_attack, "Bonus attack (on death)", "An extra attack with a share of its attack, typically when it dies.", "When the card dies, one more attack beam leaves it before it shatters.", "flameling", 4, true, 1),
        Showcase(.self_damage, "Self damage", "The card wounds itself every round.", "A damage burst and \"-N\" on the card itself with nobody attacking it.", "blood-spitter", 0, true, 1),
        Showcase(.reflect_damage, "Reflect damage", "Whoever hits it takes the same damage back.", "A shockwave on the reflector and the beam bounces back to the attacker, which takes a burst and \"-N\".", "lookalike", 4, false, 1),
        Showcase(.reflect_damage_to_player, "Reflect to the enemy player", "Whoever hits it, their player takes the damage (capped).", "The bounce goes from the card to the enemy HP bar (top) instead of the attacker.", "loremaster", 4, true, 1),
        Showcase(.kill, "Kill", "Outright kills a chosen card at the end of a given round, ignoring HP.", "At the end of round 2 the enemy with the highest attack explodes and dies, whatever its HP.", "colossus", 4, false, 1, rows: { deps in
            let f = fillerCards(db: deps.db)
            let ally = f?.ally.id ?? "envoy", weak = f?.weak.id ?? "envoy"
            return filled(deps, own: [(weak, 0), (weak, 0), ("colossus", 4), (weak, 0), (weak, 0)], opp: Array(repeating: (ally, 4), count: 5))
        }),
        Showcase(.invulnerable, "Invulnerable", "Takes no damage (in given rounds, for neighbours, or for its tribe).", "A golden aura with rays on the protected card; hits on it show \"blocked\" with a shield icon.", "anvil-guard", 4, false, 1),
        Showcase(.no_damage, "Dazed (deals no damage)", "The target cannot deal damage for a while.", "The dazed status icon on the enemy opposite; its attack beam lands for 0.", "basilisk", 4, false, 1),
        Showcase(.no_buff, "Suspended (ability off)", "The ability of the target is switched off.", "The suspended status icon on the enemy opposite in round 1; its ability does nothing that round.", "scorpion-rider", 4, false, 1),
        Showcase(.stun_pattern, "Stun pattern", "Dazes and suspends the front and sides in odd rounds, the diagonals in even rounds.", "Dazed + suspended icons on three enemies, then on the two diagonal ones, alternating every round.", "thief-of-time", 4, false, 1),
        Showcase(.resurrect, "Resurrect", "The first time it dies it comes back (at full health, or with more attack).", "The card shatters, then returns in a big glow with a lens flare.", "phoenix", 4, true, 1),
        Showcase(.resurrect_allies, "Resurrect allies", "When it dies, every ally that died this round returns with it.", "Moon Dragon dies and all the allies that fell this round come back in a glow.", "moon-dragon", 4, true, 1),
    ]

    /// `showcaseScenario`: the rows of a showcase entry.
    static func scenario(deps: Deps, entry: Showcase) -> (own: [Slot?], opp: [Slot?]) {
        if let rows = entry.rows { return rows(deps) }
        let cap = deps.db.get(entry.cardId).map { deps.stats.capFor($0, stage: entry.stage) } ?? 1
        return autoScenario(deps: deps, cardId: entry.cardId, stage: entry.stage, level: cap, strong: entry.strong)
    }

    /// `effectFires`: the round in which an effect of `type` sourced by the own middle card first shows, or nil.
    static func effectFires(_ events: [BattleEvent], type: BuffType) -> Int? {
        var round = 0
        func mine(_ s: EventSource?) -> Bool { s?.side == .attacker && s?.slot == 2 }
        for e in events {
            if case .roundStart(let r, _, _) = e { round = r }
            if let s = e.source, s.effect == type.rawValue, mine(s) { return round }
            switch (type, e) {
            case (.resurrect, .revive(let side, let slot, _, _, _)): if side == .attacker && slot == 2 { return round }
            case (.resurrect_allies, .revive(let side, _, _, _, _)): if side == .attacker { return round }
            case (.swap_stats_random, .swap): return round
            case (.gamble, .gamble): return round
            case (.kill, .damage(_, _, _, _, let cause, _, _)): if cause == .kill { return round }
            case (.heal_boost_percent, .heal(let side, _, _, _, _)): if side == .attacker && round >= 1 { return round }
            case (.self_damage, .damage(let side, let slot, _, _, let cause, _, _)): if side == .attacker && slot == 2 && cause != .attack { return round }
            default: break
            }
        }
        return nil
    }
}

/// The lab's state across the battle round-trip.
@MainActor
final class LabState: ObservableObject {
    @Published var cardId: String = ""
    @Published var stage: Int = 0
    @Published var level: Int = 1
    @Published var strong: Bool = false
    @Published var hp: Int = LabModel.hp
    @Published var own: [LabModel.Slot?] = [nil, nil, nil, nil, nil]
    @Published var opp: [LabModel.Slot?] = [nil, nil, nil, nil, nil]
    @Published var showcase: BuffType? = nil
    @Published var last: LastFight? = nil

    struct LastFight {
        var seed: UInt32
        var winner: Winner
        var rounds: Int
        var attackerHp: Int
        var defenderHp: Int
        var lines: [String]
        var type: BuffType?
        var fired: Int?
    }
}

struct LabScreen: View {
    @EnvironmentObject private var model: AppModel
    @StateObject private var lab = LabState()

    private var stageLabels: [String] { ["base", "+", "++", "+++", "++++"] }

    private var defs: [CardDef] {
        model.db.all().filter { !$0.isTrainer }.sorted { $0.name.lowercased() < $1.name.lowercased() }
    }

    private var sets: [String] {
        var out: [String] = []
        for d in defs where !out.contains(d.set) { out.append(d.set) }
        return out
    }

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: 10) {
                Panel {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(Strings.cardLab).font(Theme.font(30)).foregroundColor(Theme.goldCoin)
                        Text(Strings.labHint).font(Theme.light(15)).foregroundColor(Color.white.opacity(0.75))
                        HStack(spacing: 8) {
                            cardPicker(selection: Binding(get: { lab.cardId }, set: { v in
                                lab.cardId = v
                                lab.stage = 0
                                lab.level = model.db.get(v).map { model.deps.stats.capFor($0, stage: 0) } ?? 1
                                auto()
                            }), empty: true)
                            .frame(maxWidth: .infinity)
                            stagePicker(selection: Binding(get: { lab.stage }, set: { v in
                                lab.stage = v
                                if let d = model.db.get(lab.cardId) { lab.level = model.deps.stats.capFor(d, stage: v) }
                                auto()
                            }))
                            .disabled(lab.cardId.isEmpty)
                            levelField(Binding(get: { lab.level }, set: { v in lab.level = max(1, v); auto() }), cap: model.db.get(lab.cardId).map { model.deps.stats.capFor($0, stage: lab.stage) })
                                .disabled(lab.cardId.isEmpty)
                        }
                        Text(abilityText).font(Theme.font(17)).foregroundColor(abilityText == Strings.pickACard || abilityText == Strings.noAbility ? Color.white.opacity(0.55) : Color(hex: 0xffb347))
                        HStack(spacing: 8) {
                            SteelButton(Strings.autoSetup, size: .sm) { auto() }
                            SteelButton("Opponents: \(lab.strong ? "strong" : "weak")", size: .sm) { lab.strong.toggle(); auto() }
                            Spacer()
                            Text("Player HP").font(Theme.font(15)).foregroundColor(Color.white.opacity(0.8))
                            levelField(Binding(get: { lab.hp }, set: { v in lab.hp = max(1, v) }), cap: nil)
                        }
                    }
                    .padding(.vertical, 10).padding(.horizontal, 12)
                }
                rowPanel(title: Strings.opponentRow, slots: $lab.opp, side: "opp")
                rowPanel(title: Strings.yourRow, slots: $lab.own, side: "own")
                HStack(spacing: 10) {
                    SteelButton(Strings.fight) { fight(seed: nil) }
                    SteelButton(Strings.sameFightAgain, size: .sm, disabled: lab.last == nil) { if let l = lab.last { fight(seed: l.seed) } }
                }
                Panel { logView.padding(.vertical, 10).padding(.horizontal, 12) }
                Panel {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Effect showcase - every effect a card can have (\(LabModel.showcase.count))").font(Theme.font(17)).foregroundColor(Color.white.opacity(0.85))
                        Text("Show sets the rows up for that effect and starts the fight (fixed seed, so it plays the same every time).").font(Theme.light(15)).foregroundColor(Color.white.opacity(0.75))
                        ForEach(LabModel.showcase) { entry in
                            HStack(spacing: 10) {
                                VStack(alignment: .leading, spacing: 2) {
                                    HStack(spacing: 8) {
                                        Text(entry.label).font(Theme.font(16)).foregroundColor(Theme.goldCoin)
                                        Text(entry.type.rawValue).font(.system(size: 12, design: .monospaced)).foregroundColor(Color.white.opacity(0.5))
                                    }
                                    Text(entry.what).font(Theme.light(14)).foregroundColor(Color.white.opacity(0.85))
                                    Text("Look for: " + entry.look).font(Theme.light(13)).foregroundColor(Color(hex: 0xffb347))
                                    Text("\(model.db.get(entry.cardId)?.name ?? entry.cardId) \(String(repeating: "+", count: entry.stage)) - \(entry.strong ? "strong" : "weak") opponents").font(Theme.light(12)).foregroundColor(Color.white.opacity(0.55))
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                SteelButton("Show", size: .sm) { show(entry) }
                            }
                            .padding(.vertical, 8).padding(.horizontal, 10)
                            .background(Color.black.opacity(0.35))
                            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color(hex: 0x3a3d42), lineWidth: 1))
                        }
                    }
                    .padding(.vertical, 10).padding(.horizontal, 12)
                }
            }
            .padding(.top, 10).padding(.horizontal, 16).padding(.bottom, 24)
        }
        .chrome(active: .cards, back: .pop(fallback: .questMap()), help: "battle", hideNav: true)
    }

    private var abilityText: String {
        guard let d = model.db.get(lab.cardId) else { return Strings.pickACard }
        let face = CardFaceModel.fromDef(d, stage: lab.stage, level: lab.level, deps: model.deps)
        return face.abilityText.isEmpty ? Strings.noAbility : face.abilityText
    }

    private func cardPicker(selection: Binding<String>, empty: Bool) -> some View {
        Picker("Card", selection: selection) {
            if empty { Text("- empty -").tag("") }
            ForEach(sets, id: \.self) { set in
                Section(header: Text(set.replacingOccurrences(of: "-", with: " "))) {
                    ForEach(defs.filter { $0.set == set }, id: \.id) { d in
                        Text("\(d.name) (\(d.rarity.rawValue))").tag(d.id)
                    }
                }
            }
        }
        .pickerStyle(.menu)
        .tint(Theme.text)
        .font(Theme.font(15))
        .padding(.horizontal, 6)
        .frame(minHeight: 36)
        .background(Color(hex: 0x15171a))
        .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color(hex: 0x4a4d52), lineWidth: 1))
    }

    private func stagePicker(selection: Binding<Int>) -> some View {
        Picker("Stage", selection: selection) {
            ForEach(0..<5, id: \.self) { s in Text(stageLabels[s]).tag(s) }
        }
        .pickerStyle(.menu)
        .tint(Theme.text)
        .frame(width: 92, height: 36)
        .background(Color(hex: 0x15171a))
        .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color(hex: 0x4a4d52), lineWidth: 1))
    }

    private func levelField(_ value: Binding<Int>, cap: Int?) -> some View {
        TextField("", value: value, format: .number)
            .keyboardType(.numberPad)
            .font(Theme.font(15))
            .foregroundColor(Theme.text)
            .multilineTextAlignment(.center)
            .frame(width: 70, height: 36)
            .background(Color(hex: 0x15171a))
            .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color(hex: 0x4a4d52), lineWidth: 1))
            .onChange(of: value.wrappedValue) { _, v in
                if let c = cap, v > c { value.wrappedValue = c }
            }
    }

    private func rowPanel(title: String, slots: Binding<[LabModel.Slot?]>, side: String) -> some View {
        Panel {
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(Theme.font(17)).foregroundColor(Color.white.opacity(0.85))
                HStack(spacing: 6) {
                    ForEach(0..<5, id: \.self) { i in
                        slotEditor(slots: slots, index: i, test: side == "own" && i == 2 && slots.wrappedValue[i]?.cardId == lab.cardId && !lab.cardId.isEmpty)
                    }
                }
            }
            .padding(.vertical, 10).padding(.horizontal, 12)
        }
    }

    private func slotEditor(slots: Binding<[LabModel.Slot?]>, index i: Int, test: Bool) -> some View {
        let slot = slots.wrappedValue[i]
        return VStack(spacing: 4) {
            HStack {
                Spacer()
                Text("\(i + 1)").font(Theme.light(12)).foregroundColor(Color.white.opacity(0.5))
            }
            cardPicker(selection: Binding(get: { slot?.cardId ?? "" }, set: { id in
                var next = slots.wrappedValue
                if id.isEmpty {
                    next[i] = nil
                } else {
                    let st = slot?.stage ?? 0
                    next[i] = LabModel.Slot(cardId: id, stage: st, level: slot?.level ?? (model.db.get(id).map { model.deps.stats.capFor($0, stage: st) } ?? 1))
                }
                slots.wrappedValue = next
            }), empty: true)
            HStack(spacing: 4) {
                stagePicker(selection: Binding(get: { slot?.stage ?? 0 }, set: { v in
                    var next = slots.wrappedValue
                    if var s = next[i] {
                        s.stage = v
                        s.level = model.db.get(s.cardId).map { model.deps.stats.capFor($0, stage: v) } ?? 1
                        next[i] = s
                        slots.wrappedValue = next
                    }
                }))
                .frame(width: 60)
                .disabled(slot == nil)
                levelField(Binding(get: { slot?.level ?? 0 }, set: { v in
                    var next = slots.wrappedValue
                    if var s = next[i] {
                        s.level = max(1, v)
                        next[i] = s
                        slots.wrappedValue = next
                    }
                }), cap: slot.flatMap { s in model.db.get(s.cardId).map { model.deps.stats.capFor($0, stage: s.stage) } })
                .frame(width: 52)
                .disabled(slot == nil)
            }
        }
        .padding(.vertical, 6).padding(.horizontal, 5)
        .background(Color.black.opacity(0.35))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(test ? Theme.goldCoin : Color(hex: 0x3a3d42), lineWidth: 1))
        .shadow(color: test ? Theme.goldCoin.opacity(0.5) : .clear, radius: 8)
        .opacity(slot == nil ? 0.7 : 1)
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var logView: some View {
        if let l = lab.last {
            VStack(alignment: .leading, spacing: 6) {
                let who = l.winner == .attacker ? "you won" : (l.winner == .defender ? "the opponent won" : "draw")
                Text("Last fight: \(who) after \(l.rounds) round\(l.rounds == 1 ? "" : "s") - you \(l.attackerHp) HP, opponent \(l.defenderHp) HP (seed \(l.seed))")
                    .font(Theme.font(16)).foregroundColor(Theme.text)
                if let t = l.type {
                    Text(l.fired == nil ? "Showcase: \(t.rawValue) did not show in this fight" : "Showcase: \(t.rawValue) fired in round \(l.fired!)")
                        .font(Theme.font(15)).foregroundColor(l.fired == nil ? Color(hex: 0xff7b6b) : Color(hex: 0x7dff6a))
                }
                ScrollView(.vertical) {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(Array(l.lines.enumerated()), id: \.offset) { item in
                            Text("\(item.offset + 1). \(item.element)").font(Theme.light(14)).foregroundColor(Color.white.opacity(0.85))
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 420)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            Text(Strings.noFightYet).font(Theme.font(16)).foregroundColor(Color.white.opacity(0.55)).frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func auto() {
        lab.showcase = nil
        guard let d = model.db.get(lab.cardId) else { return }
        lab.level = min(max(1, lab.level), model.deps.stats.capFor(d, stage: lab.stage))
        let s = LabModel.autoScenario(deps: model.deps, cardId: d.id, stage: lab.stage, level: lab.level, strong: lab.strong)
        lab.own = s.own
        lab.opp = s.opp
    }

    private func show(_ entry: LabModel.Showcase) {
        guard let d = model.db.get(entry.cardId) else { model.toast("Unknown card \(entry.cardId)"); return }
        lab.cardId = d.id
        lab.stage = entry.stage
        lab.level = model.deps.stats.capFor(d, stage: entry.stage)
        lab.strong = entry.strong
        let rows = LabModel.scenario(deps: model.deps, entry: entry)
        lab.own = rows.own
        lab.opp = rows.opp
        lab.showcase = entry.type
        fight(seed: entry.seed)
    }

    private func fight(seed: UInt32?) {
        if !lab.own.contains(where: { $0 != nil }) {
            model.toast(Strings.putOneCard, icon: "icon_deckedit_active")
            return
        }
        let s = seed ?? UInt32(truncatingIfNeeded: Int64(Date().timeIntervalSince1970 * 1000))
        guard let run = FightRunner.lab(own: lab.own, opp: lab.opp, hp: lab.hp, seed: s, model: model) else {
            model.toast("The fight could not be built")
            return
        }
        let type = lab.showcase
        lab.last = LabState.LastFight(seed: s, winner: run.outcome.result.winner, rounds: run.outcome.result.rounds, attackerHp: run.outcome.result.attackerHp,
                                      defenderHp: run.outcome.result.defenderHp, lines: Summaries.lines(run.outcome.events), type: type,
                                      fired: type.flatMap { LabModel.effectFires(run.outcome.events, type: $0) })
        model.sfx("ui_button_attack")
        model.presentBattle(run.presentation, replacing: false)
    }
}
