import SwiftUI
import EvokerCore

/// App entry point. `AppModel` (App/AppModel.swift) owns the store, the dependency bundle, the clock, the
/// asset catalog and the audio player; `RootView` (App/RootView.swift) hosts the router and the screens.
@main
struct EvokerApp: App {
    @StateObject private var model = AppModel.live()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .preferredColorScheme(.dark)
                .statusBarHidden(true)
                .persistentSystemOverlays(.hidden)
        }
    }
}
