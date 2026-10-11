import SwiftUI
import SpriteKit
import EvokerCore

/// The battle screen (port of `src/ui/screens/battle.js`, architecture.md §8.4 step 3): the SpriteKit board full
/// screen without HUD or nav, the overlay buttons ("Skip fight" from round 1 where the fight can be skipped, the
/// 1x / 2x speed convenience, the "?" help in the hud_player02 frame), then the post-fight flow
/// (`BattleResultView`) and `AppModel.battleFinished(_:)`, which shows the player level-up dialogs and routes to
/// the fight's completion. The presentation comes from `AppModel.pendingBattles[id]`.
struct BattleScreen: View {
    let id: UUID
    @EnvironmentObject var model: AppModel
    @StateObject private var controller = BattleScreenController()

    var body: some View {
        GeometryReader { geo in
            let scale = BattleLayout.scale(forViewWidth: max(1, geo.size.width))
            let layout = BattleLayout(size: CGSize(width: BattleLayout.stageWidth, height: geo.size.height / scale),
                                      safeTop: geo.safeAreaInsets.top / scale, safeBottom: geo.safeAreaInsets.bottom / scale, top: .defender)
            ZStack(alignment: .topLeading) {
                Color(uiColor: BattleColors.background)
                if let scene = controller.scene {
                    SpriteView(scene: scene, preferredFramesPerSecond: 60, options: [.ignoresSiblingOrder])
                }
                if let p = controller.presentation {
                    BattleControls(presentation: p, layout: layout, scale: scale, controller: controller)
                    if controller.showResult {
                        BattleResultView(presentation: p, onDone: { controller.resultDone(model: model) })
                            .transition(.opacity)
                    }
                    if controller.veil {
                        Color.black.transition(.opacity)
                    }
                } else {
                    missingPresentation
                }
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
        }
        .ignoresSafeArea()
        .navigationBarBackButtonHidden(true)
        .statusBarHidden(true)
        .onAppear { controller.start(id: id, model: model) }
        .onDisappear { controller.stop(model: model) }
        .alert("The fight", isPresented: $controller.showHelp) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Cards attack in slot order, attacker first. Each card hits the enemy card facing it (or the enemy player when the slot is empty); diagonal arrows split the damage. The fight ends when a player runs out of health or after 20 rounds - the player with more health wins.")
        }
    }

    /// No presentation stored for this id (a stale route): a way back.
    private var missingPresentation: some View {
        VStack(spacing: 16) {
            Text("This fight is over.")
                .font(.custom(model.assets.fontName(.bold), size: 28))
                .foregroundColor(.white)
            Button("Continue") { model.router.back() }
                .font(.custom(model.assets.fontName(.bold), size: 24))
                .foregroundColor(.white)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Owns the scene and the overlay state of one battle screen; every callback of the scene hops to the main actor.
@MainActor
final class BattleScreenController: ObservableObject {
    @Published var scene: BattleScene?
    @Published var presentation: BattlePresentation?
    @Published var skipVisible = false
    @Published var speed: Int = 1
    @Published var fightEnded = false
    @Published var showResult = false
    @Published var showHelp = false
    @Published var veil = false
    /// Test hook (the web's `data-ended`): how the fight ended.
    @Published private(set) var playerState: BattlePlayer.State = .idle
    private var finished = false
    private weak var audio: AudioPlaying?

    func start(id: UUID, model: AppModel) {
        guard scene == nil else { return }
        guard let p = model.pendingBattles[id] else { return }
        presentation = p
        speed = p.speed >= 2 ? 2 : 1
        audio = model.audio
        let s = BattleScene(presentation: p, assets: model.assets, audio: model.audio, db: model.store.deps.db)
        s.onRoundOne = { [weak self] in
            Task { @MainActor [weak self] in self?.roundOne() }
        }
        s.onFightEnded = { [weak self] _, skipped in
            Task { @MainActor [weak self] in self?.fightEnded(skipped: skipped) }
        }
        scene = s
    }

    private func roundOne() {
        guard let p = presentation, p.skipAllowed else { return }
        withAnimation(.linear(duration: 0.4)) { skipVisible = true }
    }

    private func fightEnded(skipped: Bool) {
        fightEnded = true
        playerState = skipped ? .endedSkipped : .endedPlayed
        withAnimation(.linear(duration: 0.2)) { showResult = true }
    }

    /// Skip to the result (the request is remembered when the fight has not started yet).
    func skip() {
        guard !fightEnded else { return }
        scene?.skip()
    }

    func toggleSpeed() {
        speed = speed >= 2 ? 1 : 2
        scene?.setSpeed(Double(speed))
        audio?.sfx(BattleSounds.switchClick)
    }

    func help() {
        audio?.sfx(BattleSounds.buttonClick)
        showHelp = true
    }

    /// After Continue and the result flow: fade to black, then hand over to the model (battle.js `finish`).
    func resultDone(model: AppModel) {
        guard !finished, let p = presentation else { return }
        finished = true
        withAnimation(.linear(duration: BattleResultTiming.veilMs / 1000)) { veil = true }
        let delay = BattleResultTiming.veilMs / 1000
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard self != nil else { return }
            model.battleFinished(p)
        }
    }

    func stop(model: AppModel) {
        scene?.teardown()
        model.audio.music(nil)
    }
}

/// The overlay buttons, positioned with the same stage layout as the scene (`.battle-controls`, `.battle-help-frame`).
private struct BattleControls: View {
    let presentation: BattlePresentation
    let layout: BattleLayout
    let scale: CGFloat
    @ObservedObject var controller: BattleScreenController
    @EnvironmentObject var model: AppModel

    var body: some View {
        ZStack(alignment: .topLeading) {
            if presentation.skipAllowed {
                skipButton
                    .frame(width: layout.skipButton.width * scale, height: layout.skipButton.height * scale)
                    .position(x: layout.skipButton.midX * scale, y: layout.skipButton.midY * scale)
                    .opacity(controller.skipVisible && !controller.fightEnded ? 1 : 0)
                    .allowsHitTesting(controller.skipVisible && !controller.fightEnded)
            }
            // the playback-speed convenience is there from the start (small and dim, battle.css `.battle-speed`)
            speedButton
                .frame(width: layout.speedButton.width * scale, height: layout.speedButton.height * scale)
                .position(x: layout.speedButton.midX * scale, y: layout.speedButton.midY * scale)
                .opacity(controller.fightEnded ? 0 : 1)
                .allowsHitTesting(!controller.fightEnded)
            helpButton
                .frame(width: BattleLayout.portraitHole.width * scale, height: BattleLayout.portraitHole.height * scale)
                .position(x: (layout.helpFrame.minX + BattleLayout.portraitHole.midX) * scale, y: (layout.helpFrame.minY + BattleLayout.portraitHole.midY) * scale)
                .opacity(controller.showResult ? 0 : 1)
                .allowsHitTesting(!controller.showResult)
        }
    }

    private var skipButton: some View {
        Button(action: { controller.skip() }) {
            ZStack {
                CatalogSprite(name: controller.fightEnded ? "hud_bigbutton03_fill_inactive" : "hud_bigbutton03_fill", fallback: Color(uiColor: BattleColors.hex(0x2b4a60)))
                CatalogSprite(name: "hud_bigbutton03_frame", fallback: Color.clear)
                Text("Skip fight")
                    .font(.custom(model.assets.fontName(.bold), size: 30 * scale))
                    .foregroundColor(.white)
                    .shadow(color: .black.opacity(0.8), radius: 1, x: 0, y: 2 * scale)
                    .padding(.bottom, 2 * scale)
            }
        }
        .buttonStyle(.plain)
        .shadow(color: .black.opacity(0.7), radius: 5 * scale, x: 0, y: 3 * scale)
    }

    private var speedButton: some View {
        Button(action: { controller.toggleSpeed() }) {
            Text("\(controller.speed)x")
                .font(.custom(model.assets.fontName(.bold), size: 19 * scale))
                .foregroundColor(.white)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(
                    RoundedRectangle(cornerRadius: 4 * scale)
                        .fill(Color(uiColor: BattleColors.hex(0x2b4a60)))
                        .overlay(RoundedRectangle(cornerRadius: 4 * scale).stroke(Color.white.opacity(0.35), lineWidth: 1))
                )
        }
        .buttonStyle(.plain)
        .opacity(0.55)
    }

    private var helpButton: some View {
        Button(action: { controller.help() }) {
            Text("?")
                .font(.custom(model.assets.fontName(.bold), size: 44 * scale))
                .foregroundColor(.white)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(RoundedRectangle(cornerRadius: 3 * scale).fill(Color(uiColor: BattleColors.hex(0x2b4a60))))
        }
        .buttonStyle(.plain)
    }
}

/// A UI sprite from the catalog, stretched to its frame; `fallback` when the stem is unknown.
struct CatalogSprite: View {
    let name: String
    var fallback: Color = .clear
    @EnvironmentObject var model: AppModel

    var body: some View {
        if let img = model.assets.image(name) {
            Image(uiImage: img).resizable()
        } else {
            fallback
        }
    }
}
