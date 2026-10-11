import SwiftUI
import EvokerCore

/// Title screen (`src/ui/screens/title.js`): the red dragon key art with the logo, "Tap to continue". Without a
/// save the tap creates a new game with the automatic name (the opening cinematic of the web tutorial is
/// deferred, docs/PLAN.md §1) and opens the quest map; a returning player lands on the Quest tab's landing feed.
struct TitleScreen: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.stage) private var stage
    @State private var zoom: Bool = false
    @State private var pulse: Bool = false
    @State private var busy: Bool = false

    var body: some View {
        ZStack(alignment: .top) {
            Color.black
            // the painting ends with the logo plate: it fills the top 94 % of a 1280 stage
            ZStack {
                if model.assets.hasImage("title") {
                    Sprite("title", contentMode: .fill)
                } else {
                    LinearGradient(colors: [Color(hex: 0x4a0a0a), Color(hex: 0x120404)], startPoint: .top, endPoint: .bottom)
                    Sprite("evoker").frame(width: 520, height: 260).offset(y: 300)
                }
            }
            .frame(width: Stage.width, height: 1204 * stage.size.height / Stage.height)
            .clipped()
            .scaleEffect(zoom ? 1.05 : 1, anchor: .bottom)
            LinearGradient(colors: [Color.black.opacity(0.25), Color.clear], startPoint: .top, endPoint: UnitPoint(x: 0.5, y: 0.25))
            VStack {
                Spacer()
                HStack(spacing: 14) {
                    Text(Strings.tapToContinue)
                        .font(Theme.light(30))
                        .foregroundColor(Color.white.opacity(0.92))
                        .shadow(color: .black.opacity(0.95), radius: 6, x: 0, y: 2)
                    Sprite("hud_tapindicator01")
                        .frame(width: 46, height: 46)
                        .offset(y: pulse ? -8 : 0)
                }
                .opacity(pulse ? 1 : 0.7)
                .frame(height: 76)
                .padding(.bottom, max(0, stage.safeBottom))
            }
            Text(Strings.webVersion)
                .font(Theme.light(14))
                .foregroundColor(Color.white.opacity(0.45))
                .frame(maxWidth: .infinity, alignment: .trailing)
                .padding(.trailing, 16)
                .padding(.top, 12 + stage.safeTop)
        }
        .frame(width: Stage.width, height: stage.size.height)
        .contentShape(Rectangle())
        .onTapGesture { start() }
        .onAppear {
            withAnimation(.easeInOut(duration: 14).repeatForever(autoreverses: true)) { zoom = true }
            withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) { pulse = true }
        }
    }

    private func start() {
        if busy { return }
        busy = true
        model.sfx("ui_button_start")
        if model.store.state == nil {
            model.startNewGame()
        } else {
            model.startSession()
        }
        busy = false
    }
}
