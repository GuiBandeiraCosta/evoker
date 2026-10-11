import XCTest

/// Simulator smoke run (CI job "ui-tests"): launches the app in known states through the `-uitest` launch options
/// (Evoker/App/UITestHooks.swift), screenshots every main screen and tries the card drags, a quest and a fight.
/// Screenshots are kept as test attachments; CI exports them as the "ui-screenshots" artifact.
///
/// Positions are given in the web stage's 720 x 1280 units (the same numbers as the web game's screenshots in
/// Evoker Web/tests/screenshots); `stage(_:_:_:)` maps them into the letterboxed window like `StageCanvas` does.
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

    /// A stage point (720 x 1280 units) as a window coordinate (StageCanvas: fit the width or height, centred).
    private func stage(_ app: XCUIApplication, _ x: CGFloat, _ y: CGFloat) -> XCUICoordinate {
        let window = app.windows.firstMatch
        let size = window.frame.size
        let scale = min(size.width / 720, size.height / 1280)
        let ox = (size.width - 720 * scale) / 2
        let oy = (size.height - 1280 * scale) / 2
        let origin = window.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
        return origin.withOffset(CGVector(dx: ox + x * scale, dy: oy + y * scale))
    }

    private func tap(_ app: XCUIApplication, _ x: CGFloat, _ y: CGFloat) {
        stage(app, x, y).tap()
    }

    private func drag(_ app: XCUIApplication, from: (CGFloat, CGFloat), to: (CGFloat, CGFloat), hold: TimeInterval = 0.4) {
        let a = stage(app, from.0, from.1)
        let b = stage(app, to.0, to.1)
        a.press(forDuration: hold, thenDragTo: b, withVelocity: .slow, thenHoldForDuration: 0.3)
    }

    // MARK: Screens

    func test01TitleAndNewGame() {
        let app = launch(preset: "title")
        shot("01-title")
        tap(app, 360, 900)
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
            ("17-daily", "daily"),
        ]
        for (name, route) in routes {
            let app = launch(preset: "mid", route: route)
            shot(name)
            app.terminate()
        }
    }

    // MARK: Interaction

    /// Cards screen (web: qa-cards-economy/08-deck-5-slots.png): deck slots at y 357, x 68 / 213 / 360 / 506 / 652;
    /// the big-card slider's visible card at (660, 830).
    func test03CardsSliderAndDrag() {
        let app = launch(preset: "mid", route: "cards")
        shot("20-cards-before")
        // swipe the slider to the left (the row starts at its right end, like the client)
        drag(app, from: (660, 830), to: (120, 830), hold: 0.02)
        shot("21-cards-after-swipe", wait: 2)
        // drag a big card up into the first deck slot
        drag(app, from: (360, 830), to: (68, 357))
        shot("22-cards-after-drag-to-slot1", wait: 2)
        // and another one into the last slot
        drag(app, from: (360, 830), to: (652, 357))
        shot("23-cards-after-drag-to-slot5", wait: 2)
        // drag a deck card back down out of the deck
        drag(app, from: (68, 357), to: (360, 830))
        shot("24-cards-after-drag-out", wait: 2)
        // tap a card: the card detail
        tap(app, 360, 830)
        shot("25-card-detail", wait: 2)
    }

    /// Quest 1 (web: qa-core-loop/04-quest-1.png): minions around y 700 at x 150 / 275 / 400.
    func test04QuestTaps() {
        let app = launch(preset: "fresh", route: "quest1")
        shot("30-quest1")
        let xs: [CGFloat] = [150, 275, 400, 210, 340]
        for i in 0..<14 {
            tap(app, xs[i % xs.count], 700)
            Thread.sleep(forTimeInterval: 0.7)
            if i == 1 { shot("31-quest1-after-2-taps", wait: 0.3) }
        }
        shot("32-quest1-after-taps", wait: 3)
        shot("33-boss-intro-or-prebattle", wait: 4)
    }

    /// Pre-battle of quest 1's boss (web: 06-prebattle.png): Attack! at (360, 510), own slots at y 880.
    func test05PrebattleDragAndFight() {
        let app = launch(preset: "mid", route: "prebattle-quest1")
        shot("40-prebattle")
        // a card from the "Your cards" drawer (bottom) into the own row
        drag(app, from: (120, 1080), to: (68, 880))
        shot("41-prebattle-after-drag", wait: 2)
        tap(app, 360, 510)
        shot("42-battle-start", wait: 3)
        shot("43-battle-running", wait: 6)
        shot("44-battle-later", wait: 10)
        shot("45-battle-end", wait: 15)
        tap(app, 360, 640)
        shot("46-after-result-tap", wait: 3)
    }
}
