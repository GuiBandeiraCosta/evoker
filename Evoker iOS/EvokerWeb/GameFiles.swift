import Foundation
import WebKit
import os

/// Serves the bundled web game (the app bundle's `Game` folder, a copy of Evoker Web made by
/// Tools/copy-web-game.sh) to the web view under `evoker://game/`, the way `npm start` (Evoker Web/tools/serve.js)
/// serves it on a desktop: the page is one fixed origin, so its ES modules, `fetch()` of the JSON data and
/// localStorage work, and `<audio>` gets the byte ranges it asks for. No network is involved.
///
/// Speed on a phone: files are read on a background queue (the main thread also carries the touches), recently
/// used ones stay in memory, and the responses may be cached by WebKit (the screens rebuild their DOM on every
/// visit, so without caching every image would be read, sent and decoded again). The bundle only changes with an
/// app update, and `GameShell` drops WebKit's caches when the installed build changes.
final class GameSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "evoker"
    static let startURL = URL(string: "evoker://game/index.html")!

    let root: URL
    /// Files handed to the web view since launch (the UI tests read it to check that caching works).
    private(set) var served = 0
    private let log = Logger(subsystem: "com.guiba.evoker", category: "files")
    private let io = DispatchQueue(label: "evoker.web.files", qos: .userInitiated, attributes: .concurrent)
    private let cache = NSCache<NSString, NSData>()
    /// Tasks WebKit has not stopped yet (main thread only); a stopped task must not be answered.
    private var running = Set<ObjectIdentifier>()

    init(root: URL) {
        self.root = root.standardizedFileURL
        cache.totalCostLimit = 96 * 1024 * 1024
        super.init()
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL))
            return
        }
        let id = ObjectIdentifier(task)
        running.insert(id)
        served += 1
        let range = task.request.value(forHTTPHeaderField: "Range")
        let root = self.root
        let cache = self.cache
        io.async { [weak self] in
            let answer = GameFiles.answer(path: url.path, range: range, root: root, cache: cache)
            DispatchQueue.main.async {
                guard let self, self.running.remove(id) != nil else { return }
                if answer.status == 404 { self.log.error("404 \(url.path, privacy: .public)") }
                self.reply(task, url: url, answer: answer)
            }
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        running.remove(ObjectIdentifier(task))
    }

    private func reply(_ task: WKURLSchemeTask, url: URL, answer: GameFiles.Answer) {
        var all = answer.headers
        all["Content-Length"] = String(answer.body.count)
        guard let response = HTTPURLResponse(url: url, statusCode: answer.status, httpVersion: "HTTP/1.1", headerFields: all) else {
            task.didFailWithError(URLError(.cannotParseResponse))
            return
        }
        task.didReceive(response)
        task.didReceive(answer.body)
        task.didFinish()
    }
}

/// Request-target helpers of the scheme handler (serve.js resolvePath / MIME), free of WebKit so they run on any
/// thread.
enum GameFiles {
    struct Answer {
        var status: Int
        var headers: [String: String]
        var body: Data
    }

    /// The response to a GET of `path` (with an optional `Range` header) from the files under `root`.
    static func answer(path: String, range: String?, root: URL, cache: NSCache<NSString, NSData>) -> Answer {
        guard let file = resolve(path, root: root), let data = read(file, cache: cache) else {
            return Answer(status: 404, headers: ["Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store"],
                          body: Data("404 Not Found".utf8))
        }
        var headers = [
            "Content-Type": mime(for: file.pathExtension),
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=31536000, immutable",
        ]
        guard let range else { return Answer(status: 200, headers: headers, body: data) }
        guard let r = byteRange(range, size: data.count) else {
            headers["Content-Range"] = "bytes */\(data.count)"
            return Answer(status: 416, headers: headers, body: Data())
        }
        headers["Content-Range"] = "bytes \(r.lowerBound)-\(r.upperBound - 1)/\(data.count)"
        return Answer(status: 206, headers: headers, body: data.subdata(in: r))
    }

    /// A file's bytes, from the memory cache when it was read recently.
    static func read(_ file: URL, cache: NSCache<NSString, NSData>) -> Data? {
        let key = file.path as NSString
        if let hit = cache.object(forKey: key) { return hit as Data }
        guard let data = try? Data(contentsOf: file, options: .mappedIfSafe) else { return nil }
        cache.setObject(data as NSData, forKey: key, cost: data.count)
        return data
    }

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
