import XCTest

/// Simulator run of the shipped app (EvokerWeb: the web game in a native shell). The shell's `-uitest` launch
/// options (EvokerWeb/GameShell.swift) expose an invisible "uitest-state" readout with the save's numbers and the
/// on-screen centres of the elements a test taps; taps are real touches at those points (web px = window points).
final class EvokerWebShellUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    // MARK: Helpers

    private func launch(_ args: [String], js: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        var all = ["-uitest"] + args
        // base64: launch arguments lose their quote characters on the way to the app
        if let js { all += ["-uitest-js", Data(js.utf8).base64EncodedString()] }
        app.launchArguments = all
        app.launch()
        return app
    }

    private func shot(_ name: String, wait: TimeInterval = 0) {
        if wait > 0 { Thread.sleep(forTimeInterval: wait) }
        let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }

    private func state(_ app: XCUIApplication) -> [String: String] {
        let el = app.staticTexts["uitest-state"]
        guard el.exists else { return [:] }
        var out: [String: String] = [:]
        for part in el.label.split(separator: ";") {
            guard let i = part.firstIndex(of: ":") else { continue }
            out[String(part[..<i])] = String(part[part.index(after: i)...])
        }
        return out
    }

    /// Polls the readout until `ok` holds; fails the test with the last readout after `timeout` seconds.
    @discardableResult
    private func waitFor(_ app: XCUIApplication, _ what: String, timeout: TimeInterval = 20,
                         _ ok: ([String: String]) -> Bool) -> [String: String] {
        let end = Date().addingTimeInterval(timeout)
        var last: [String: String] = [:]
        while Date() < end {
            last = state(app)
            if ok(last) { return last }
            Thread.sleep(forTimeInterval: 0.4)
        }
        shot("timeout - \(what)")
        XCTFail("timed out waiting for \(what); readout: \(last)")
        return last
    }

    /// A real tap at the centre the readout reported for `key` ("x,y" in window points).
    private func tap(_ app: XCUIApplication, _ key: String, in s: [String: String]) {
        guard let v = s[key], !v.isEmpty else { XCTFail("no \(key) on screen: \(s)"); return }
        let xy = v.split(separator: ",").compactMap { Double($0) }
        guard xy.count == 2 else { XCTFail("bad \(key): \(v)"); return }
        let origin = app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
        origin.withOffset(CGVector(dx: xy[0], dy: xy[1])).tap()
    }

    private func int(_ s: [String: String], _ key: String) -> Int { Int(s[key] ?? "") ?? -999 }

    /// A new save one minion tap short of level 2 (like the native "levelup" preset), on quest 1 of the main line.
    private let levelUpSetup = """
    evoker.debug.newGame('Tester');
    evoker.store.update(function (s) { return Object.assign({}, s, { player: Object.assign({}, s.player, { xp: 46 }) }); });
    evoker.go('quest', { line: 'main', quest: 1 });
    """

    // MARK: Tests

    func test01BootsToTitle() {
        let app = launch(["-uitest-reset"])
        let s = waitFor(app, "the title screen", timeout: 40) { $0["boot"] == "0" && $0["title"] == "1" }
        shot("01-title", wait: 1.5)
        XCTAssertEqual(s["save"], "0", "a reset launch starts without a save")
        // the stage fills the width of the phone (web fitStage letterboxes the 720 x 1280 stage)
        XCTAssertGreaterThan(int(s, "w"), 300)
        tap(app, "titletap", in: s)
        shot("02-after-title-tap", wait: 4)
    }

    /// Regression 2026-10-11 (reported on the native port): the level-up dialog's + and Proceed did nothing.
    func test02LevelUpPlusMinusAndProceed() {
        let app = launch(["-uitest-reset"], js: levelUpSetup)
        var s = waitFor(app, "quest 1 with a minion", timeout: 40) { !($0["minion"] ?? "").isEmpty && $0["level"] == "1" }
        shot("10-quest1")
        let hpBefore = int(s, "hpmax")
        tap(app, "minion", in: s)
        s = waitFor(app, "the level-up dialog with its + button", timeout: 15) { $0["lvl"] == "1" && !($0["plus"] ?? "").isEmpty && !($0["left"] ?? "").isEmpty }
        // the "Level Up" ribbon shows for 900 ms before the panel takes taps (popup-levelup.js RIBBON_MS)
        shot("11-levelup", wait: 1.6)
        s = state(app)
        let left = int(s, "left")
        XCTAssertGreaterThan(left, 0, "the dialog offers points")
        tap(app, "plus", in: s)
        s = waitFor(app, "one point placed", timeout: 5) { self.int($0, "left") == left - 1 }
        tap(app, "plus", in: s)
        s = waitFor(app, "two points placed", timeout: 5) { self.int($0, "left") == left - 2 }
        tap(app, "minus", in: s)
        s = waitFor(app, "one point taken back", timeout: 5) { self.int($0, "left") == left - 1 }
        shot("12-levelup-points")
        tap(app, "proceed", in: s)
        s = waitFor(app, "the dialog to close after Proceed", timeout: 20) { $0["lvl"] == "0" }
        shot("13-after-proceed", wait: 1)
        XCTAssertEqual(int(s, "level"), 2)
        XCTAssertEqual(int(s, "points"), 0, "Proceed spends every point")
        XCTAssertGreaterThan(int(s, "hpmax"), hpBefore, "the placed Health point raised max health")
    }

    /// Regression 2026-10-11 ("the app feels very sluggish on the iPhone"): the game files used to be served
    /// uncacheable from the main thread, so every screen visit read, sent and decoded all its images again. A second
    /// visit to the Cards screen must now come almost entirely from WebKit's cache.
    func test04SecondVisitIsCached() {
        let app = launch(["-uitest-reset"], js: """
        evoker.debug.newGame('Tester');
        setTimeout(function () { evoker.goTop('cards'); }, 3000);
        setTimeout(function () { evoker.goTop('quest'); }, 8000);
        setTimeout(function () { evoker.goTop('cards'); }, 13000);
        """)
        let s0 = waitFor(app, "the new save", timeout: 40) { $0["save"] == "1" }
        let served0 = int(s0, "served")
        waitFor(app, "the Cards screen", timeout: 15) { $0["screen"] == "cards" }
        Thread.sleep(forTimeInterval: 2.5)
        let s1 = state(app)
        shot("30-cards-first-visit")
        waitFor(app, "the quest map", timeout: 15) { $0["screen"] == "quest-map" }
        Thread.sleep(forTimeInterval: 2.5)
        let s2 = state(app)
        waitFor(app, "the Cards screen again", timeout: 15) { $0["screen"] == "cards" }
        Thread.sleep(forTimeInterval: 2.5)
        let s3 = state(app)
        shot("31-cards-second-visit")
        let first = int(s1, "served") - served0
        let second = int(s3, "served") - int(s2, "served")
        print("files served: first Cards visit \(first), second \(second); fps title \(s0["fps"] ?? "-"), cards \(s1["fps"] ?? "-"), map \(s2["fps"] ?? "-"), cards again \(s3["fps"] ?? "-")")
        XCTAssertGreaterThan(first, 0, "the first visit loads the screen's files")
        XCTAssertLessThanOrEqual(second, max(2, first / 4), "a second visit comes from the cache (first \(first), second \(second))")
    }

    /// The save survives closing the app, and comes back from the app's own copy when WebKit's storage is wiped.
    func test03SaveSurvivesRelaunch() {
        var app = launch(["-uitest-reset"], js: "evoker.debug.newGame('Keeper'); evoker.debug.giveGold(12345);")
        var s = waitFor(app, "the new save", timeout: 40) { $0["name"] == "Keeper" && self.int($0, "gold") >= 12345 }
        let gold = int(s, "gold")
        Thread.sleep(forTimeInterval: 2)
        app.terminate()

        app = launch([])
        s = waitFor(app, "the save after a relaunch", timeout: 40) { $0["boot"] == "0" && $0["save"] == "1" }
        XCTAssertEqual(s["name"], "Keeper")
        XCTAssertEqual(int(s, "gold"), gold)
        shot("20-relaunch")
        app.terminate()

        app = launch(["-uitest-clear-webdata"])
        s = waitFor(app, "the save restored from the app's copy", timeout: 40) { $0["boot"] == "0" && $0["save"] == "1" }
        XCTAssertEqual(s["name"], "Keeper")
        XCTAssertEqual(int(s, "gold"), gold)
        shot("21-restored-from-mirror")
    }
}
