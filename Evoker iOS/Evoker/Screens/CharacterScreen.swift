import SwiftUI
import EvokerCore

/// Character screens (`src/ui/screens/character.js`): the profile (from the HUD bar and the extended menu's
/// Profile button), the options (Options button) and the 21-day daily calendar, each a pushed screen with the
/// back arrow.
struct CharacterScreen: View {
    let tab: CharacterTab
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Group {
            if model.store.state != nil {
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(spacing: 14) {
                        switch tab {
                        case .profile: ProfileView()
                        case .daily:
                            ScreenTitle(text: Strings.dailyRewards)
                            DailyView()
                        case .settings: SettingsView()
                        }
                    }
                    .padding(.top, 16).padding(.horizontal, 8).padding(.bottom, 24)
                    .frame(maxWidth: .infinity)
                }
                .background(FullscreenBackground())
            } else {
                Color.black
            }
        }
        .chrome(active: nil, activeExtended: tab == .settings ? .options : .profile, back: .pop(fallback: .questMap()), help: "character")
    }
}
