import Foundation
import WebKit
import os

/// Serves the bundled web game (the app bundle's `Game` folder, a copy of Evoker Web made by
/// Tools/copy-web-game.sh) to the web view under `evoker://game/`, the way `npm start` (Evoker Web/tools/serve.js)
/// serves it on a desktop: the page is one fixed origin, so its ES modules, `fetch()` of the JSON data and
/// localStorage work, and `<audio>` gets the byte ranges it asks for. No network is involved.
final class GameSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "evoker"
    static let startURL = URL(string: "evoker://game/index.html")!

    let root: URL
    private let log = Logger(subsystem: "com.guiba.evoker", category: "files")

    init(root: URL) {
        self.root = root.standardizedFileURL
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL))
            return
        }
        guard let file = GameFiles.resolve(url.path, root: root),
              let data = try? Data(contentsOf: file, options: .mappedIfSafe) else {
            log.error("404 \(url.path, privacy: .public)")
            reply(task, url: url, status: 404, headers: ["Content-Type": "text/plain; charset=utf-8"], body: Data("404 Not Found".utf8))
            return
        }
        var headers = [
            "Content-Type": GameFiles.mime(for: file.pathExtension),
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
        ]
        if let range = task.request.value(forHTTPHeaderField: "Range") {
            guard let r = GameFiles.byteRange(range, size: data.count) else {
                headers["Content-Range"] = "bytes */\(data.count)"
                reply(task, url: url, status: 416, headers: headers, body: Data())
                return
            }
            headers["Content-Range"] = "bytes \(r.lowerBound)-\(r.upperBound - 1)/\(data.count)"
            reply(task, url: url, status: 206, headers: headers, body: data.subdata(in: r))
            return
        }
        reply(task, url: url, status: 200, headers: headers, body: data)
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private func reply(_ task: WKURLSchemeTask, url: URL, status: Int, headers: [String: String], body: Data) {
        var all = headers
        all["Content-Length"] = String(body.count)
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: all) else {
            task.didFailWithError(URLError(.cannotParseResponse))
            return
        }
        task.didReceive(response)
        task.didReceive(body)
        task.didFinish()
    }
}

/// Request-target helpers shared by the scheme handler (serve.js resolvePath / MIME).
enum GameFiles {
    /// The file a request path names inside `root`, or nil (missing, or escaping the root). "/" and folders serve
    /// their index.html.
    static func resolve(_ target: String, root: URL) -> URL? {
        var path = target
        if let cut = path.firstIndex(where: { $0 == "?" || $0 == "#" }) { path = String(path[..<cut]) }
        path = path.removingPercentEncoding ?? path
        let parts = path.split(separator: "/").map(String.init)
        if parts.contains("..") { return nil }
        var url = root
        for p in parts where !p.isEmpty && p != "." { url.appendPathComponent(p) }
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) else { return nil }
        if isDir.boolValue {
            url.appendPathComponent("index.html")
            guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        }
        return url
    }

    /// `bytes=a-b`, `bytes=a-` or `bytes=-n` of a file of `size` bytes as a half-open range, or nil when it is
    /// malformed or unsatisfiable. Only the first range of a list is served.
    static func byteRange(_ header: String, size: Int) -> Range<Int>? {
        guard header.lowercased().hasPrefix("bytes="), size > 0 else { return nil }
        let spec = header.dropFirst(6).split(separator: ",").first.map(String.init)?.trimmingCharacters(in: .whitespaces) ?? ""
        let ends = spec.split(separator: "-", omittingEmptySubsequences: false).map { String($0) }
        guard ends.count == 2 else { return nil }
        if ends[0].isEmpty {
            guard let n = Int(ends[1]), n > 0 else { return nil }
            return max(0, size - n)..<size
        }
        guard let a = Int(ends[0]), a < size else { return nil }
        let b = ends[1].isEmpty ? size - 1 : min(size - 1, Int(ends[1]) ?? -1)
        guard b >= a else { return nil }
        return a..<(b + 1)
    }

    static func mime(for ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "map": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "ico": return "image/x-icon"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        case "ttf": return "font/ttf"
        case "txt": return "text/plain; charset=utf-8"
        case "md": return "text/markdown; charset=utf-8"
        case "mp3": return "audio/mpeg"
        case "ogg": return "audio/ogg"
        case "wav": return "audio/wav"
        default: return "application/octet-stream"
        }
    }
}
