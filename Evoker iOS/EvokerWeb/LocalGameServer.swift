import Foundation
import Network

/// Serves the bundled web game (the app bundle's `Game` folder, a copy of Evoker Web) on 127.0.0.1, the way
/// `npm start` (Evoker Web/tools/serve.js) serves it on a desktop. WKWebView needs a real http origin for the
/// game's ES modules, its `fetch()` of the JSON data and its `<audio>` elements (which read byte ranges), none of
/// which work from file URLs. Only the device itself can connect (loopback, `acceptLocalOnly`).
final class LocalGameServer: @unchecked Sendable {
    let root: URL
    private(set) var port: UInt16 = 0
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "evoker.web.server")

    init(root: URL) {
        self.root = root.standardizedFileURL
    }

    var isRunning: Bool { listener != nil }

    /// Starts on the first free port of `ports`. A fixed port keeps the page's origin, and so its storage, the same
    /// from one launch to the next.
    func start(ports: [UInt16]) -> Bool {
        for p in ports where listen(on: p) {
            port = p
            return true
        }
        return false
    }

    /// Restarts on the same port when iOS tore the listener down while the app was suspended.
    func ensureRunning() {
        if listener == nil && port != 0 { _ = listen(on: port) }
    }

    private func listen(on p: UInt16) -> Bool {
        guard let nwPort = NWEndpoint.Port(rawValue: p) else { return false }
        let params = NWParameters.tcp
        params.acceptLocalOnly = true
        params.allowLocalEndpointReuse = true
        params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: nwPort)
        guard let l = try? NWListener(using: params) else { return false }
        let ready = DispatchSemaphore(value: 0)
        let result = ListenResult()
        l.stateUpdateHandler = { state in
            switch state {
            case .ready:
                result.ok = true
                ready.signal()
            case .failed, .cancelled:
                ready.signal()
            default:
                break
            }
        }
        l.newConnectionHandler = { [weak self] c in self?.serve(c) }
        l.start(queue: queue)
        _ = ready.wait(timeout: .now() + 3)
        guard result.ok else {
            l.cancel()
            return false
        }
        l.stateUpdateHandler = { [weak self, weak l] state in
            if case .failed = state {
                l?.cancel()
                DispatchQueue.main.async { self?.listener = nil }
            }
        }
        listener = l
        return true
    }

    private final class ListenResult: @unchecked Sendable {
        var ok = false
    }

    // MARK: HTTP/1.1 (GET and HEAD, keep-alive, byte ranges)

    private func serve(_ c: NWConnection) {
        c.start(queue: queue)
        read(c, buffer: Data())
    }

    private func read(_ c: NWConnection, buffer: Data) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, done, error in
            guard let self else { c.cancel(); return }
            var buf = buffer
            if let data { buf.append(data) }
            if let end = buf.range(of: Data("\r\n\r\n".utf8)) {
                let head = String(decoding: buf[buf.startIndex..<end.lowerBound], as: UTF8.self)
                let rest = Data(buf[end.upperBound...])
                self.respond(c, head: head) { keepAlive in
                    if keepAlive { self.read(c, buffer: rest) } else { c.cancel() }
                }
            } else if done || error != nil || buf.count > 256 * 1024 {
                c.cancel()
            } else {
                self.read(c, buffer: buf)
            }
        }
    }

    private func respond(_ c: NWConnection, head: String, next: @escaping (Bool) -> Void) {
        let lines = head.components(separatedBy: "\r\n")
        let request = (lines.first ?? "").split(separator: " ")
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let i = line.firstIndex(of: ":") else { continue }
            headers[line[..<i].lowercased()] = line[line.index(after: i)...].trimmingCharacters(in: .whitespaces)
        }
        let keepAlive = headers["connection"]?.lowercased() != "close"
        guard request.count >= 2 else {
            send(c, status: "400 Bad Request", headers: [:], body: Data(), headOnly: false, keepAlive: false, next: next)
            return
        }
        let method = String(request[0])
        let headOnly = method == "HEAD"
        guard method == "GET" || headOnly else {
            send(c, status: "405 Method Not Allowed", headers: ["Allow": "GET, HEAD"], body: Data(), headOnly: false, keepAlive: keepAlive, next: next)
            return
        }
        guard let file = LocalGameServer.resolve(String(request[1]), root: root),
              let data = try? Data(contentsOf: file, options: .mappedIfSafe) else {
            send(c, status: "404 Not Found", headers: ["Content-Type": "text/plain; charset=utf-8"], body: Data("404 Not Found".utf8), headOnly: headOnly, keepAlive: keepAlive, next: next)
            return
        }
        var out: [String: String] = [
            "Content-Type": LocalGameServer.mime(for: file.pathExtension),
            "Accept-Ranges": "bytes",
            // the bundle changes with every app update while the URLs stay the same: never let WebKit cache them
            "Cache-Control": "no-store",
        ]
        if let range = headers["range"] {
            guard let r = LocalGameServer.byteRange(range, size: data.count) else {
                out["Content-Range"] = "bytes */\(data.count)"
                send(c, status: "416 Range Not Satisfiable", headers: out, body: Data(), headOnly: headOnly, keepAlive: keepAlive, next: next)
                return
            }
            out["Content-Range"] = "bytes \(r.lowerBound)-\(r.upperBound - 1)/\(data.count)"
            send(c, status: "206 Partial Content", headers: out, body: data.subdata(in: r), headOnly: headOnly, keepAlive: keepAlive, next: next)
            return
        }
        send(c, status: "200 OK", headers: out, body: data, headOnly: headOnly, keepAlive: keepAlive, next: next)
    }

    private func send(_ c: NWConnection, status: String, headers: [String: String], body: Data, headOnly: Bool,
                      keepAlive: Bool, next: @escaping (Bool) -> Void) {
        var head = "HTTP/1.1 \(status)\r\n"
        var all = headers
        all["Content-Length"] = String(body.count)
        all["Connection"] = keepAlive ? "keep-alive" : "close"
        for (k, v) in all { head += "\(k): \(v)\r\n" }
        head += "\r\n"
        var out = Data(head.utf8)
        if !headOnly { out.append(body) }
        c.send(content: out, completion: .contentProcessed { error in next(error == nil && keepAlive) })
    }

    // MARK: Helpers (serve.js resolvePath / MIME)

    /// The file a request target names inside `root`, or nil (missing, or escaping the root). "/" and folders
    /// serve their index.html.
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
