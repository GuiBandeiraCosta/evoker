import SwiftUI

/// Evoker for iPhone, the web game in a native shell: the app bundles a copy of Evoker Web (the reference
/// implementation) and runs it full screen in a WKWebView (GameShell), so it plays exactly like the browser
/// version. The native SwiftUI / SpriteKit port lives on in the Evoker target.
@main
struct EvokerWebApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var shell = GameShell()

    var body: some Scene {
        WindowGroup {
            GameWebView(shell: shell)
                .ignoresSafeArea()
                .background(Color.black.ignoresSafeArea())
                .statusBarHidden(true)
                .persistentSystemOverlays(.hidden)
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { shell.becameActive() }
                }
        }
    }
}
