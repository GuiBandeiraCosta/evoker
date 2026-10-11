import Foundation
import WebKit

/// Keeps a copy of the web game's save (localStorage `evoker.save.v1`, Evoker Web/src/game/state.js SAVE_KEY) in
/// the app's own Application Support folder, and writes it back into localStorage before the game boots. WebKit
/// may clear website data (storage pressure, a changed origin port), the app's files stay.
final class SaveMirror: NSObject, WKScriptMessageHandler {
    static let key = "evoker.save.v1"
    static let handlerName = "evokerSave"
    let file: URL
    private let io = DispatchQueue(label: "evoker.web.save")

    init(directory: URL) {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        file = directory.appendingPathComponent("evoker-save.json")
    }

    func load() -> String? {
        io.sync { try? String(contentsOf: file, encoding: .utf8) }
    }

    func clear() {
        io.sync { _ = try? FileManager.default.removeItem(at: file) }
    }

    /// Runs before the game's scripts: restores the mirrored save and reports every later write or removal of the
    /// save key back to the app. Built anew for every page load so it carries the latest copy.
    func userScript() -> WKUserScript {
        let saved: String
        if let s = load(), let json = try? JSONSerialization.data(withJSONObject: [s]), let text = String(data: json, encoding: .utf8) {
            saved = text
        } else {
            saved = "[null]"
        }
        let source = """
        (function () {
          var KEY = \(SaveMirror.jsString(SaveMirror.key));
          var saved = \(saved)[0];
          var ls;
          try { ls = window.localStorage; } catch (e) { return; }
          var set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
          try { if (saved !== null) set.call(ls, KEY, saved); } catch (e) {}
          var post = function (v) { try { window.webkit.messageHandlers.\(SaveMirror.handlerName).postMessage(v); } catch (e) {} };
          Storage.prototype.setItem = function (k, v) { set.call(this, k, v); if (this === ls && k === KEY) post(String(v)); };
          Storage.prototype.removeItem = function (k) { remove.call(this, k); if (this === ls && k === KEY) post(null); };
        })();
        """
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        let value = message.body as? String
        let target = file
        io.async {
            if let value {
                try? value.write(to: target, atomically: true, encoding: .utf8)
            } else {
                try? FileManager.default.removeItem(at: target)
            }
        }
    }

    private static func jsString(_ s: String) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: [s])) ?? Data("[\"\"]".utf8)
        let text = String(data: data, encoding: .utf8) ?? "[\"\"]"
        return String(text.dropFirst().dropLast())
    }
}
