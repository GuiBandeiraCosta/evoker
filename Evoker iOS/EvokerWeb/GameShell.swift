import SwiftUI
import UIKit
import WebKit
import os

/// The app's single screen: a full-screen WKWebView running the web game from `GameSchemeHandler`, with the save
/// mirrored by `SaveMirror`. The web game letterboxes its 720 x 1280 stage itself (src/ui/components/stage.js
/// fitStage), so the view covers the whole display, safe areas included.
@MainActor
final class GameShell: NSObject, ObservableObject {
    let files: GameSchemeHandler
    let mirror: SaveMirror
    let webView: WKWebView
    let readout = UILabel()
    private var started = false
    /// Test-state clearing is done: only then may the game load.
    private var booted = false
    private let log = Logger(subsystem: "com.guiba.evoker", category: "shell")
    private let pageLog = PageLogHandler()
    private var pendingTestScript: String?
    private var readoutTimer: Timer?
    /// The file the current download (the settings' "export save") writes.
    fileprivate var exportURL: URL?

    override init() {
        let root = (Bundle.main.resourceURL ?? URL(fileURLWithPath: NSTemporaryDirectory())).appendingPathComponent("Game")
        files = GameSchemeHandler(root: root)
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        mirror = SaveMirror(directory: support.appendingPathComponent("Evoker"))

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.websiteDataStore = .default()
        config.setURLSchemeHandler(files, forURLScheme: GameSchemeHandler.scheme)
        config.userContentController.add(mirror, name: SaveMirror.handlerName)
        config.userContentController.add(pageLog, name: PageLogHandler.name)
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()

        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.minimumZoomScale = 1
        webView.scrollView.maximumZoomScale = 1
        webView.scrollView.delegate = self
        webView.allowsLinkPreview = false
        webView.allowsBackForwardNavigationGestures = false
        webView.navigationDelegate = self
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif

        readout.textColor = .clear
        readout.isUserInteractionEnabled = false
        readout.isAccessibilityElement = true
        readout.accessibilityIdentifier = "uitest-state"
    }

    /// Clears the test state when asked, then loads the game (once).
    func start() {
        guard !started else { return }
        started = true
        let args = ProcessInfo.processInfo.arguments
        // base64, because the launch arguments lose their quote characters on the way to the app
        if let i = args.firstIndex(of: "-uitest-js"), i + 1 < args.count,
           let data = Data(base64Encoded: args[i + 1]), let script = String(data: data, encoding: .utf8) {
            pendingTestScript = script
        }
        if args.contains("-uitest") { startReadout() }
        // -uitest-reset: no save at all; -uitest-clear-webdata: WebKit's storage wiped, the mirrored save kept
        let reset = args.contains("-uitest-reset")
        if reset || args.contains("-uitest-clear-webdata") {
            if reset { mirror.clear() }
            WKWebsiteDataStore.default().removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) { [weak self] in
                Task { @MainActor in self?.boot() }
            }
        } else {
            boot()
        }
    }

    private func boot() {
        booted = true
        let index = files.root.appendingPathComponent("index.html").path
        log.notice("game files at \(self.files.root.path, privacy: .public), index.html present: \(FileManager.default.fileExists(atPath: index), privacy: .public)")
        load()
    }

    /// (Re)loads the game with a fresh save-restoring script (it carries the latest mirrored save).
    func load() {
        guard booted else { return }
        let ucc = webView.configuration.userContentController
        ucc.removeAllUserScripts()
        ucc.addUserScript(WKUserScript(source: PageLogHandler.script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        ucc.addUserScript(mirror.userScript())
        ucc.addUserScript(WKUserScript(source: GameShell.shellCSS, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        let url = GameSchemeHandler.startURL
        log.notice("loading \(url.absoluteString, privacy: .public)")
        webView.load(URLRequest(url: url))
    }

    /// Back from the background: the web content process may have been reclaimed meanwhile.
    func becameActive() {
        guard booted else { return }
        if webView.url == nil { load() }
    }

    /// No text selection, callouts or tap highlight on the game (it is not a page to read).
    private static let shellCSS = """
    (function () {
      var s = document.createElement('style');
      s.textContent = 'html, body { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; overscroll-behavior: none; background: #000; }';
      document.head.appendChild(s);
    })();
    """

    // MARK: UI test hooks (-uitest, -uitest-reset, -uitest-clear-webdata, -uitest-js <base64 script>)

    /// What the UI tests read through the invisible "uitest-state" label.
    private static let readoutJS = """
    (function () {
      var e = window.evoker;
      if (!e || !e.state) return 'boot:1';
      var s = e.state();
      var q = function (sel) { return document.querySelector(sel); };
      var t = function (sel) { var n = q(sel); return n ? n.textContent.trim() : ''; };
      var at = function (sel) {
        var n = q(sel);
        if (!n) return '';
        var r = n.getBoundingClientRect();
        return Math.round(r.left + r.width / 2) + ',' + Math.round(r.top + r.height / 2);
      };
      var p = s ? s.player : null;
      return ['boot:0', 'title:' + (q('.title-screen') ? 1 : 0), 'save:' + (s ? 1 : 0),
        'level:' + (p ? p.level : -1), 'xp:' + (p ? p.xp : -1), 'points:' + (p && p.statPoints != null ? p.statPoints : 0),
        'hpmax:' + (p ? p.hpMax : -1), 'gold:' + (p ? p.gold : -1), 'name:' + (p ? p.name : ''),
        'lvl:' + (q('.lvl-backdrop') ? 1 : 0), 'left:' + t('.lvl-points-left'),
        'minion:' + at('button.quest-minion:not(.slain)'), 'titletap:' + at('.title-screen .title-tap'),
        'plus:' + at('.lvl-attr[data-attr="hp"] .lvl-btn.plus'), 'minus:' + at('.lvl-attr[data-attr="hp"] .lvl-btn.minus'),
        'proceed:' + at('.lvl-backdrop .lvl-proceed'),
        'w:' + window.innerWidth, 'h:' + window.innerHeight].join(';');
    })()
    """

    private func startReadout() {
        readoutTimer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.pollReadout() }
        }
    }

    private func pollReadout() {
        webView.evaluateJavaScript(GameShell.readoutJS) { [weak self] value, _ in
            guard let self else { return }
            let text = (value as? String) ?? "boot:1"
            self.readout.accessibilityLabel = text
            self.readout.text = text
            if let script = self.pendingTestScript, text.hasPrefix("boot:0") {
                self.pendingTestScript = nil
                self.webView.evaluateJavaScript(script, completionHandler: nil)
            }
        }
    }
}

extension GameShell: UIScrollViewDelegate {
    nonisolated func viewForZooming(in scrollView: UIScrollView) -> UIView? { nil }
}

extension GameShell: WKNavigationDelegate, WKDownloadDelegate {
    /// The game's own origin stays in the view; any other web link opens in Safari; downloads (the settings'
    /// "export save") go to the share sheet.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        if action.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        guard let url = action.request.url else { decisionHandler(.allow); return }
        let local = [GameSchemeHandler.scheme, "about", "blob", "data"].contains(url.scheme ?? "")
        if !local && (url.scheme == "http" || url.scheme == "https") && action.targetFrame?.isMainFrame != false {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping @MainActor @Sendable (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        log.error("web content process terminated, reloading")
        load()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        log.notice("page loaded: \(webView.url?.absoluteString ?? "-", privacy: .public)")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        log.error("page load failed: \(error.localizedDescription, privacy: .public)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        log.error("page load failed before it started: \(error.localizedDescription, privacy: .public) (\((error as NSError).code, privacy: .public))")
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping @MainActor @Sendable (URL?) -> Void) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("exports", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let name = suggestedFilename.isEmpty ? "evoker-save.json" : suggestedFilename
        let url = dir.appendingPathComponent(name)
        try? FileManager.default.removeItem(at: url)
        exportURL = url
        completionHandler(url)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let url = exportURL else { return }
        exportURL = nil
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = webView
        topViewController()?.present(sheet, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        exportURL = nil
    }

    private func topViewController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        var top = scene?.windows.first(where: { $0.isKeyWindow })?.rootViewController
        while let next = top?.presentedViewController { top = next }
        return top
    }
}

/// Hosts the shell's web view (and the test readout) in SwiftUI.
struct GameWebView: UIViewRepresentable {
    let shell: GameShell

    func makeUIView(context: Context) -> UIView {
        let container = UIView()
        container.backgroundColor = .black
        let web = shell.webView
        web.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(web)
        NSLayoutConstraint.activate([
            web.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            web.topAnchor.constraint(equalTo: container.topAnchor),
            web.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])
        let label = shell.readout
        label.frame = CGRect(x: 0, y: 0, width: 2, height: 2)
        container.addSubview(label)
        shell.start()
        return container
    }

    func updateUIView(_ uiView: UIView, context: Context) {}
}

/// Forwards the page's script errors, rejected promises and console.error lines to the app log (os_log category
/// "page"), so a game that does not boot on a device or in CI says why.
final class PageLogHandler: NSObject, WKScriptMessageHandler {
    static let name = "evokerLog"
    private let log = Logger(subsystem: "com.guiba.evoker", category: "page")

    static let script = """
    (function () {
      var post = function (m) { try { window.webkit.messageHandlers.evokerLog.postMessage(String(m)); } catch (e) {} };
      window.addEventListener('error', function (e) { post('error: ' + e.message + ' @ ' + (e.filename || '') + ':' + (e.lineno || 0)); });
      window.addEventListener('unhandledrejection', function (e) { post('unhandled rejection: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)); });
      var ce = console.error;
      console.error = function () { post('console.error: ' + Array.prototype.join.call(arguments, ' ')); return ce.apply(console, arguments); };
      document.addEventListener('DOMContentLoaded', function () { post('DOMContentLoaded ' + location.href); });
    })();
    """

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        log.notice("\(String(describing: message.body), privacy: .public)")
    }
}
