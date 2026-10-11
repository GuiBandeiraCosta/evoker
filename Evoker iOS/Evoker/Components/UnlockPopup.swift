import SwiftUI
import EvokerCore

/// Feature unlock popups (`src/ui/components/popup-unlock.js`, `view_unlocked_feature_popup`): a header, the unlock
/// picture over the yellow reward glow, one line of text and "OK". Which popups were shown is remembered in
/// `state.tutorial.seen` (feature ids and `cardslot3`..`cardslot5`).
struct UnlockPopupSpec: Identifiable, Hashable {
    var id: String
    var title: String
    var text: String
    var sprite: String
}

enum UnlockPopups {
    /// Popup content for a feature (`unlockPopupFor`); nil for features without a popup.
    static func spec(for feature: Feature) -> UnlockPopupSpec? {
        switch feature {
        case .fusion: return UnlockPopupSpec(id: "fusion", title: "Card Fusing Unlocked!", text: "Combine two identical cards to power up.", sprite: "unlock_fuse")
        case .training: return UnlockPopupSpec(id: "training", title: "Card Training Unlocked!", text: "Sacrifice weak cards to level strong cards up.", sprite: "unlock_train")
        case .arena: return UnlockPopupSpec(id: "arena", title: "Arena Unlocked!", text: "Duel against other players", sprite: "unlock_pvp")
        case .league: return UnlockPopupSpec(id: "league", title: "Leagues Unlocked!", text: "Get to the Top!", sprite: "unlock_pvp")
        default: return nil
        }
    }

    /// The "Card Slot Unlocked!" popup for an open-slot count.
    static func cardSlotSpec(slots: Int) -> UnlockPopupSpec {
        UnlockPopupSpec(id: "cardslot\(slots)", title: "Card Slot Unlocked!", text: "Your deck can now hold \(slots) cards.", sprite: "unlock_cardslot")
    }

    /// Seen-ids of the save (`seenIds`).
    static func seenIds(_ state: GameState) -> [String] {
        state.tutorial.seen
    }

    /// Remember popups as shown (`markSeen`, pure).
    static func markSeen(_ state: GameState, ids: [String]) -> GameState {
        let seen = state.tutorial.seen
        let add = ids.filter { !seen.contains($0) }
        if add.isEmpty { return state }
        var next = state
        next.tutorial.seen = seen + add
        return next
    }

    /// Unlock popups the save still owes (`pendingUnlocks`): level / quest features reached but not seen and the
    /// newest deck-slot count; old unlocks (more than a level / two quests back) are returned in `silent`.
    static func pending(_ state: GameState) -> (show: [UnlockPopupSpec], silent: [String]) {
        let seen = seenIds(state)
        let level = max(1, state.player.level)
        var show: [UnlockPopupSpec] = []
        var silent: [String] = []
        let reached = max(1, state.quests.main.unlocked)
        let byQuest = StateOps.unlocksByQuest(state)
        for f in Feature.popupFeatures {
            guard let popup = spec(for: f) else { continue }
            if byQuest {
                if seen.contains(popup.id) || !StateOps.isUnlocked(state, f) { continue }
                let quest = Constants.featureUnlockQuests[f] ?? 0
                if reached > quest + 3 { silent.append(popup.id) } else { show.append(popup) }
                continue
            }
            guard let need = Constants.featureUnlockLevels[f] else { continue }
            if level < need || seen.contains(popup.id) { continue }
            if level > need + 1 { silent.append(popup.id) } else { show.append(popup) }
        }
        let slots = StateOps.deckSlotCount(state)
        let start = Constants.DeckSlots.start
        if slots > start && !seen.contains("cardslot\(slots)") {
            if slots > start + 1 {
                for n in (start + 1)..<slots where !seen.contains("cardslot\(n)") { silent.append("cardslot\(n)") }
            }
            let quest = Constants.DeckSlots.quests[slots]
            if let q = quest, reached > q + 2 {
                silent.append("cardslot\(slots)")
            } else {
                show.append(cardSlotSpec(slots: slots))
            }
        }
        return (show, silent)
    }

    /// Popups owed by a level-up detail (`levelUpDetails[].unlocked`), in order.
    static func specs(for features: [Feature]) -> [UnlockPopupSpec] {
        features.compactMap { spec(for: $0) }
    }
}

/// Body of an unlock popup: the reward glow, the unlock picture (popping in), the line of text.
struct UnlockPopupBody: View {
    let spec: UnlockPopupSpec
    @State private var popped: Bool = false
    @State private var spin: Double = 0

    var body: some View {
        VStack(spacing: 14) {
            ZStack {
                Sprite("reward_glow_yellow")
                    .frame(width: 380, height: 360)
                    .opacity(0.8)
                    .rotationEffect(.degrees(spin))
                Sprite(spec.sprite)
                    .frame(width: 290, height: 285)
                    .scaleEffect(popped ? 1 : 0.3)
                    .opacity(popped ? 1 : 0)
            }
            .frame(width: 320, height: 300)
            Text(spec.text)
                .font(Theme.font(30))
                .foregroundColor(Theme.text)
                .multilineTextAlignment(.center)
                .lineSpacing(6)
        }
        .onAppear {
            withAnimation(.spring(response: 0.42, dampingFraction: 0.55)) { popped = true }
            withAnimation(.linear(duration: 9).repeatForever(autoreverses: false)) { spin = 360 }
        }
    }
}
