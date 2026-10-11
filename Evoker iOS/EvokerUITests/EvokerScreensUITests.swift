import XCTest

/// Simulator smoke run (CI job "ui-tests"): launches the app in known states through the `-uitest` launch options
/// (Evoker/App/UITestHooks.swift), screenshots every main screen and tries the card drags. Screenshots are kept as
/// test attachments; CI exports them as the "ui-screenshots" artifact.
final class EvokerScreensUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = true
    }

    // MARK: Helpers

    @discardableResult
    private func launch(preset: String, route: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        var args = ["-uitest", "-uitest-preset", preset]
        if let r = route { args += ["-uitest-route", r] }
        app.launchArguments = args
        app.launch()
        return app
    }

    private func shot(_ name: String, wait: TimeInterval = 2.5) {
        if wait > 0 { Thread.sleep(forTimeInterval: wait) }
        let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }

    /// A point of the window at stage-relative fractions (0...1 of the width and height).
    private func point(_ app: XCUIApplication, _ x: CGFloat, _ y: CGFloat) -> XCUICoordinate {
        app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: x, dy: y))
    }

    private func drag(_ app: XCUIApplication, from: (CGFloat, CGFloat), to: (CGFloat, CGFloat), hold: TimeInterval = 0.4) {
        let a = point(app, from.0, from.1)
        let b = point(app, to.0, to.1)
        a.press(forDuration: hold, thenDragTo: b, withVelocity: .slow, thenHoldForDuration: 0.3)
    }

    // MARK: Screens

    func test01TitleAndNewGame() {
        let app = launch(preset: "title")
        shot("01-title")
        point(app, 0.5, 0.6).tap()
        shot("02-after-title-tap", wait: 4)
    }

    func test02MainScreens() {
        let routes: [(String, String?)] = [
            ("03-quest-map", nil),
            ("04-feed", "feed"),
            ("05-cards-deck", "cards"),
            ("06-cards-training", "cards-training"),
            ("07-cards-fusion", "cards-fusion"),
            ("08-arena", "arena"),
            ("09-pieces", "pieces"),
            ("10-league", "league"),
            ("11-shop", "shop"),
            ("12-character", "character"),
            ("13-settings", "settings"),
            ("14-collections", "collections"),
            ("15-help", "help"),
            ("16-lab", "lab"),
            ("17-quest1", "quest1"),
        ]
        for (name, route) in routes {
            let app = launch(preset: "mid", route: route)
            shot(name)
            app.terminate()
        }
    }

    // MARK: Interaction

    func test03CardsDrag() {
        let app = launch(preset: "mid", route: "cards")
        shot("20-cards-before")
        // from the big-card slider at the bottom to the deck row near the top
        drag(app, from: (0.5, 0.80), to: (0.5, 0.30))
        shot("21-cards-after-drag-to-deck", wait: 1.5)
        drag(app, from: (0.5, 0.80), to: (0.15, 0.30))
        shot("22-cards-after-drag-to-slot1", wait: 1.5)
        // a horizontal swipe of the slider
        drag(app, from: (0.8, 0.80), to: (0.2, 0.80), hold: 0.05)
        shot("23-cards-after-swipe", wait: 1.5)
    }

    func test04QuestTapsAndBoss() {
        let app = launch(preset: "fresh", route: "quest1")
        shot("30-quest1")
        for i in 0..<12 {
            point(app, 0.5, 0.55).tap()
            Thread.sleep(forTimeInterval: 0.6)
            if i == 2 { shot("31-quest1-tapping", wait: 0) }
        }
        shot("32-quest1-after-taps", wait: 3)
        shot("33-quest1-later", wait: 4)
        point(app, 0.5, 0.5).tap()
        shot("34-after-tap", wait: 3)
        // the Attack! bar of the pre-battle sits in the middle of the screen
        point(app, 0.5, 0.5).tap()
        shot("35-battle-start", wait: 4)
        shot("36-battle-later", wait: 8)
    }
}
