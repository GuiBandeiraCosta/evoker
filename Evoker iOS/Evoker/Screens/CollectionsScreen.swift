import SwiftUI
import EvokerCore

/// Set collections screen (`src/ui/screens/collections.js`, the client's album): one page per set (Main + every
/// portal), arrows to switch, a thin "n/8" progress bar, the gem reward row (padlock until the set is complete,
/// then Claim, then Claimed), and the set's cards as art-only tiles in their rarity frames, greyed with a padlock
/// when not owned.
struct CollectionsScreen: View {
    let setId: String?
    @EnvironmentObject private var model: AppModel
    @State private var index: Int = 0
    @State private var paged: Bool = false

    var body: some View {
        Group {
            if let state = model.store.state {
                content(state)
            } else {
                Color.black
            }
        }
        .chrome(active: .cards, back: .pop(fallback: .cards()), help: "collections")
    }

    private func content(_ state: GameState) -> some View {
        let sets = ShopOps.setCollections(state, deps: model.deps)
        return ZStack {
            ZStack {
                Color(hex: 0x1b1d1f)
                Sprite("horizon-sunset", contentMode: .fill).frame(width: Stage.width).clipped()
                LinearGradient(colors: [Color(hex: 0x1b1d1f, alpha: 0.9), Color(hex: 0x281e14, alpha: 0.7), Color(hex: 0x1b1d1f, alpha: 0.92)], startPoint: .top, endPoint: .bottom)
            }
            if sets.isEmpty {
                Panel { Text(Strings.noSets).font(Theme.font(26)).foregroundColor(Theme.muted).padding(20) }.padding(40)
            } else {
                let i = CardsHelpers.wrapIndex(index, count: sets.count)
                page(state: state, sets: sets, index: i)
            }
        }
        .onAppear {
            if !paged {
                paged = true
                index = CardsHelpers.collectionPageIndex(count: sets.count, setId: setId, sets: sets)
            }
            markSeen(state: state, sets: sets)
        }
        .onChange(of: index) { _, _ in
            if let s = model.store.state { markSeen(state: s, sets: ShopOps.setCollections(s, deps: model.deps)) }
        }
    }

    /// Owned cards this album has not shown yet clear the "!" badge (shop.markAlbumSeen).
    private func markSeen(state: GameState, sets: [SetCollection]) {
        guard !sets.isEmpty else { return }
        let set = sets[CardsHelpers.wrapIndex(index, count: sets.count)]
        let seen = Set(state.collections.seen ?? [])
        let fresh = set.cards.filter { $0.owned && !seen.contains($0.cardId) }.map { $0.cardId }
        if !fresh.isEmpty {
            model.updateState(toastOnError: false) { s, _, _ in ShopOps.markAlbumSeen(s, cardIds: fresh) }
        }
    }

    private func page(state: GameState, sets: [SetCollection], index i: Int) -> some View {
        let set = sets[i]
        let seen = Set(state.collections.seen ?? [])
        return ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    ArrowButton(direction: .left) { model.sfx("ui_button_circular"); index = CardsHelpers.wrapIndex(i - 1, count: sets.count) }
                    HStack(alignment: .firstTextBaseline, spacing: 16) {
                        Text(set.name).font(Theme.font(40)).foregroundColor(Theme.headline).lineLimit(1).shadow(color: .black.opacity(0.8), radius: 1, x: 0, y: 2)
                        Text("(\(i + 1)/\(sets.count))").font(Theme.light(24)).foregroundColor(Theme.muted)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 54)
                    .background(StretchedSprite("header_framer_big"))
                    ArrowButton(direction: .right) { model.sfx("ui_button_circular"); index = CardsHelpers.wrapIndex(i + 1, count: sets.count) }
                }
                .padding(.top, 14).padding(.horizontal, 12)
                ProgressBarView(value: Double(set.ownedCount), max: Double(set.total), kind: .hp, label: "\(set.ownedCount)/\(set.total)", style: .inset, labelSize: 17)
                    .padding(.horizontal, 30).padding(.top, 14).padding(.bottom, 10)
                // reward row
                Panel {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(Strings.reward).font(Theme.light(30)).foregroundColor(Theme.text)
                            Text("\(set.reward) Gems").font(Theme.light(40)).foregroundColor(Theme.text).lineLimit(1)
                        }
                        .shadow(color: .black.opacity(0.8), radius: 1, x: 0, y: 2)
                        Spacer()
                        if set.claimed {
                            VStack(spacing: 4) {
                                Sprite("hud_gemicon01").frame(width: 56, height: 56)
                                Text(Strings.claimed).font(Theme.font(16)).foregroundColor(Theme.gem)
                            }
                            .frame(width: 110, height: 110)
                            .background(InsetPanel { Color.clear })
                        } else if set.complete {
                            ZStack {
                                Sprite("albumglow_00").frame(width: 230, height: 160).opacity(0.9)
                                SteelButton(variant: .green, action: { claim(set) }) {
                                    HStack(spacing: 10) {
                                        Text(Strings.claim)
                                        Sprite("hud_gemicon01").frame(width: 36, height: 26)
                                    }
                                }
                                .frame(minWidth: 160)
                            }
                        } else {
                            ZStack {
                                Sprite("hud_gemicon01").frame(width: 84, height: 60).opacity(0.45)
                                Sprite("lock_small").frame(width: 48, height: 70).opacity(0.95)
                            }
                            .frame(width: 110, height: 110)
                            .background(InsetPanel { Color.clear })
                        }
                    }
                    .padding(.vertical, 16).padding(.horizontal, 26)
                }
                .overlay(set.complete && !set.claimed ? AnyView(NineSlice(Theme.Frames.glowGold).padding(-6).allowsHitTesting(false)) : AnyView(EmptyView()))
                .padding(.horizontal, 16).padding(.bottom, 14)
                // the grid
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 16) {
                    ForEach(set.cards, id: \.cardId) { entry in
                        if let def = model.db.get(entry.cardId) {
                            let owned = entry.owned ? CardsHelpers.bestOwnedInstance(state, cardId: entry.cardId) : nil
                            AlbumCard(def: def, stage: owned?.stage ?? 0, locked: !entry.owned, pieces: entry.owned ? nil : CardsHelpers.pieceHuntFor(state, cardId: entry.cardId),
                                      fresh: entry.owned && !seen.contains(entry.cardId)) {
                                model.sfx("ui_button_card")
                                if let o = owned {
                                    model.router.go(.cardDetail(.owned(uid: o.uid)))
                                } else {
                                    model.router.go(.cardDetail(.catalog(cardId: entry.cardId, stage: 0, level: 1)))
                                }
                            }
                        }
                    }
                }
                .padding(.vertical, 14).padding(.horizontal, 8)
                .background(NineSlice("album_set_frame", insets: EdgeInsets(top: 24, leading: 24, bottom: 24, trailing: 24)))
                .padding(.horizontal, 12).padding(.bottom, 24)
            }
        }
    }

    private func claim(_ set: SetCollection) {
        let gems: Int? = model.update { s, d, _ in
            let r = try ShopOps.claimCollection(s, deps: d, setId: set.id)
            return (state: r.state, info: r.gems)
        }
        guard let g = gems else { return }
        model.sfx("quest_reward_gem")
        model.toast("+\(fmtNumber(g)) gems", icon: "hud_gemiconsingle")
    }
}

/// Art-only album card in its rarity frame; locked = grey art under the padlock; the puzzle pieces of a hunt over it.
struct AlbumCard: View {
    let def: CardDef
    let stage: Int
    let locked: Bool
    let pieces: (owned: Int, total: Int)?
    let fresh: Bool
    let action: () -> Void
    @State private var flash: Bool = false

    var body: some View {
        Button(action: action) {
            ZStack {
                Color(hex: 0x0a0b0c)
                CardArt(def: def, stage: stage)
                    .saturation(locked ? 0 : 1)
                    .brightness(locked ? -0.2 : 0)
                if locked && pieces == nil {
                    Sprite("lock_big").frame(width: 92, height: 120).shadow(color: .black.opacity(0.8), radius: 4, x: 0, y: 3)
                }
                if let p = pieces {
                    PiecesOverlay(owned: p.owned, total: p.total, compact: true)
                }
            }
            .frame(width: 150, height: 216)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.rarity(def.rarity), lineWidth: 4))
            .brightness(flash ? 0.6 : 0)
            .shadow(color: flash ? Color(hex: 0xffd666, alpha: 0.9) : .black.opacity(0.7), radius: flash ? 20 : 6, x: 0, y: 3)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressScaleStyle())
        .onAppear {
            if fresh {
                flash = true
                withAnimation(.easeOut(duration: 1.6)) { flash = false }
            }
        }
    }
}
