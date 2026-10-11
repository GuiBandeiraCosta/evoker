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

    /// The deck size the app reports through its test readout (UITestStateReadout), or -1.
    private func deckCount(_ app: XCUIApplication) -> Int {
        let el = app.staticTexts["uitest-state"]
        guard el.waitForExistence(timeout: 3) else { return -1 }
        for part in el.label.split(separator: ";") where part.hasPrefix("deck:") {
            return Int(part.dropFirst(5)) ?? -1
        }
        return -1
    }

    /// A number of the test readout ("cards", "deck", "mana"), or -1.
    private func readout(_ app: XCUIApplication, _ key: String) -> Int {
        let el = app.staticTexts["uitest-state"]
        guard el.waitForExistence(timeout: 3) else { return -1 }
        for part in el.label.split(separator: ";") where part.hasPrefix(key + ":") {
            return Int(part.dropFirst(key.count + 1)) ?? -1
        }
        return -1
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
        // regression 2026-10-11 ("the dragging of the cards is not working"): drags must change the deck
        let start = deckCount(app)
        // drag a big card up into the first deck slot
        drag(app, from: (360, 830), to: (68, 357))
        shot("22-cards-after-drag-to-slot1", wait: 2)
        XCTAssertEqual(deckCount(app), start + 1, "dragging a card into an empty deck slot adds it to the deck")
        // and another one into the last slot
        drag(app, from: (360, 830), to: (652, 357))
        shot("23-cards-after-drag-to-slot5", wait: 2)
        XCTAssertEqual(deckCount(app), start + 2, "a second card dragged into the deck")
        // drag a deck card back down out of the deck
        drag(app, from: (68, 357), to: (360, 830))
        shot("24-cards-after-drag-out", wait: 2)
        XCTAssertEqual(deckCount(app), start + 1, "dragging a deck card out removes it from the deck")
        // tap a card: the card detail
        tap(app, 360, 830)
        shot("25-card-detail", wait: 2)
    }

    /// Quest 1 (web: qa-core-loop/04-quest-1.png): five minions around y 700 at x 150 / 275 / 400; then the boss
    /// intro and the pre-battle (Attack! at (360, 510)) and the fight.
    func test04QuestToBossFight() {
        let app = launch(preset: "fresh", route: "quest1")
        shot("30-quest1")
        let xs: [CGFloat] = [150, 275, 400, 210, 340]
        for i in 0..<5 {
            tap(app, xs[i], 700)
            Thread.sleep(forTimeInterval: 0.9)
            if i == 1 { shot("31-quest1-after-2-taps", wait: 0.2) }
        }
        shot("32-boss-intro", wait: 1.2)
        shot("33-prebattle", wait: 4)
        tap(app, 360, 510)
        shot("34-quest-battle", wait: 6)
        shot("35-quest-battle-end", wait: 25)
    }

    /// Pre-battle of quest 1's boss (web: 06-prebattle.png): Attack! at (360, 510), own slots at y 880.
    func test05PrebattleDragAndFight() {
        let app = launch(preset: "mid", route: "prebattle-quest1")
        shot("40-prebattle")
        // a card from the "Your cards" drawer into the own row (iOS layout: drawer cards at y 930, own row at y 700)
        let before = deckCount(app)
        drag(app, from: (90, 930), to: (360, 700))
        shot("41-prebattle-after-drag", wait: 2)
        XCTAssertGreaterThanOrEqual(deckCount(app), before, "the pre-battle drag keeps or grows the deck")
        tap(app, 360, 510)
        shot("42-battle-start", wait: 3)
        shot("43-battle-running", wait: 6)
        shot("44-battle-later", wait: 10)
        shot("45-battle-end", wait: 15)
        tap(app, 360, 640)
        shot("46-after-result-tap", wait: 3)
    }

    /// Training (web: qa-cards-economy/12-training-ready.png): Training slot (134, 380), Sacrifice stack (586, 380),
    /// OK (360, 426); the slider's cards around y 830 after a swipe.
    func test06Training() {
        let app = launch(preset: "mid", route: "cards-training")
        shot("50-training")
        drag(app, from: (660, 830), to: (120, 830), hold: 0.02)
        shot("51-training-swiped", wait: 1.5)
        let before = readout(app, "cards")
        drag(app, from: (360, 830), to: (134, 380))
        // regression 2026-10-11: the slider must glide to its last (weakest) card once the training slot is filled
        shot("52-training-slot-filled", wait: 2)
        drag(app, from: (360, 830), to: (586, 380))
        shot("53-training-sacrifice-filled", wait: 1.5)
        tap(app, 360, 426)
        shot("54-training-ok", wait: 2)
        // the weakest card is in the deck: the client asks "Your sacrifice stack contains a card that is: -in your deck"
        tap(app, 440, 698)
        shot("55-training-done", wait: 4)
        tap(app, 360, 640)
        shot("56-training-after", wait: 2)
        XCTAssertEqual(readout(app, "cards"), before - 1, "training consumes the sacrificed card")
    }

    /// Fusion (web: qa-cards-economy/18-fusion-ready.png): Slot 1 (134, 380), Slot 2 (584, 380), OK (360, 426).
    /// The "mid" save owns two Throat-Cutters.
    func test07Fusion() {
        let app = launch(preset: "mid", route: "cards-fusion")
        shot("60-fusion")
        drag(app, from: (660, 830), to: (120, 830), hold: 0.02)
        shot("61-fusion-swiped", wait: 1.5)
        let before = readout(app, "cards")
        drag(app, from: (360, 830), to: (134, 380))
        shot("62-fusion-slot1", wait: 1.5)
        // the slider now lists the partners from its start (the first one at the right, p = 30°): swipe it to the front
        drag(app, from: (680, 830), to: (360, 830), hold: 0.02)
        shot("62b-fusion-partner-front", wait: 1.5)
        drag(app, from: (360, 830), to: (584, 380))
        shot("63-fusion-slot2", wait: 1.5)
        tap(app, 360, 426)
        shot("64-fusion-ok", wait: 2)
        shot("65-fusion-done", wait: 4)
        tap(app, 360, 640)
        shot("66-fusion-after", wait: 2)
        XCTAssertEqual(readout(app, "cards"), before - 1, "fusion turns two cards into one")
    }

    /// Booster (web: qa-cards-economy/29-booster-grid.png): 3 x 3 grid, columns x 124 / 360 / 596, rows y 350 / 670 / 990.
    func test08BoosterPick() {
        let app = launch(preset: "mid", route: "booster-neophyte")
        shot("70-booster", wait: 3)
        shot("71-booster-grid", wait: 3)
        let before = readout(app, "cards")
        tap(app, 360, 670)
        shot("72-booster-reveal", wait: 3)
        tap(app, 360, 670)
        shot("73-booster-after", wait: 2)
        XCTAssertEqual(readout(app, "cards"), before + 1, "a booster pick adds the card")
    }

    /// Arena (web: 16-arena.png): the first opponent's attack button at (654, 336); then the pre-battle's Attack!.
    func test09ArenaFight() {
        let app = launch(preset: "mid", route: "arena")
        shot("80-arena")
        tap(app, 654, 336)
        shot("81-arena-prebattle", wait: 3)
        tap(app, 360, 510)
        shot("82-arena-battle", wait: 6)
        shot("83-arena-battle-end", wait: 30)
        tap(app, 360, 640)
        shot("84-arena-after", wait: 3)
    }

    /// Level-up dialog (web: qa-core-loop/07-levelup-points.png): Proceed at (486, 906).
    func test10LevelUp() {
        let app = launch(preset: "levelup", route: "quest1")
        tap(app, 150, 700)
        shot("90-levelup", wait: 2.5)
        shot("91-levelup-points", wait: 2)
        tap(app, 486, 906)
        shot("92-after-proceed", wait: 3)
        XCTAssertGreaterThanOrEqual(readout(app, "level"), 2, "the tap levelled the player up")
    }
}
