import Foundation
import UIKit
import EvokerCore

/// The decoded `GameAssets/manifest.json` written by Tools/build-assets.mjs (format: AssetCatalog.swift). Every
/// group is optional so an older or partial manifest still loads; paths are relative to the GameAssets folder.
struct AssetManifest: Decodable {
    var version: Int = 0
    /// card id -> stage ("0"…"4") -> "cards/<file>"
    var cards: [String: [String: String]] = [:]
    var ui: [String: String] = [:]
    var bg: [String: String] = [:]
    var sfx: [String: String] = [:]
    /// font role (FontRole.rawValue) -> "fonts/<file>"
    var fonts: [String: String] = [:]
    /// font role -> further files to try when the first one fails to register (the repaired CG Times)
    var fontAlternates: [String: [String]] = [:]
    /// font role -> PostScript name read from the file by the build tool (informational; FontRegistrar reads the real one)
    var fontNames: [String: String] = [:]
    var map: [String: String] = [:]
    var minions: [String: String] = [:]
    var portraits: [String: String] = [:]
    var animations: [String: String] = [:]
    /// prepackaged hash -> "prepackaged/<hash>@2.<ext>" (plus "_index" for the client's index)
    var prepackaged: [String: String] = [:]
    /// stitched 9-slice / 3-slice frames of orig/ui/frames with their slice insets
    var frames: [String: FrameSpec] = [:]
    var missing: MissingArt = MissingArt()

    struct MissingArt: Decodable {
        var cards: [String] = []
        var cardStages: [String: [String]] = [:]

        init() {}

        enum CodingKeys: String, CodingKey { case cards, cardStages }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            cards = (try? c.decode([String].self, forKey: .cards)) ?? []
            cardStages = (try? c.decode([String: [String]].self, forKey: .cardStages)) ?? [:]
        }
    }

    init() {}

    enum CodingKeys: String, CodingKey {
        case version, cards, ui, bg, sfx, fonts, fontAlternates, fontNames, map, minions, portraits, animations, prepackaged, frames, missing
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = (try? c.decode(Int.self, forKey: .version)) ?? 0
        cards = (try? c.decode([String: [String: String]].self, forKey: .cards)) ?? [:]
        ui = (try? c.decode([String: String].self, forKey: .ui)) ?? [:]
        bg = (try? c.decode([String: String].self, forKey: .bg)) ?? [:]
        sfx = (try? c.decode([String: String].self, forKey: .sfx)) ?? [:]
        fonts = (try? c.decode([String: String].self, forKey: .fonts)) ?? [:]
        fontAlternates = (try? c.decode([String: [String]].self, forKey: .fontAlternates)) ?? [:]
        // values may be null when the build tool could not read a name
        let names = (try? c.decode([String: String?].self, forKey: .fontNames)) ?? [:]
        fontNames = names.reduce(into: [String: String]()) { acc, kv in if let v = kv.value { acc[kv.key] = v } }
        map = (try? c.decode([String: String].self, forKey: .map)) ?? [:]
        minions = (try? c.decode([String: String].self, forKey: .minions)) ?? [:]
        portraits = (try? c.decode([String: String].self, forKey: .portraits)) ?? [:]
        animations = (try? c.decode([String: String].self, forKey: .animations)) ?? [:]
        prepackaged = (try? c.decode([String: String].self, forKey: .prepackaged)) ?? [:]
        frames = (try? c.decode([String: FrameSpec].self, forKey: .frames)) ?? [:]
        missing = (try? c.decode(MissingArt.self, forKey: .missing)) ?? MissingArt()
    }
}

/// A stitched frame of orig/ui/frames (frames.json): the sprite path, its pixel size and the slice insets in pixels
/// (`border-image` slices of the web CSS → `Image.resizable(capInsets:)`).
struct FrameSpec: Decodable {
    let path: String
    /// "nine" (8 or 9 pieces), "three" (horizontal bar) or "composite" (fill + frame layers).
    let kind: String
    /// [width, height] in pixels.
    let size: [Int]
    let insets: Insets

    struct Insets: Decodable {
        let top: Double
        let right: Double
        let bottom: Double
        let left: Double
    }

    var pixelSize: CGSize {
        CGSize(width: size.count > 0 ? CGFloat(size[0]) : 0, height: size.count > 1 ? CGFloat(size[1]) : 0)
    }

    var uiEdgeInsets: UIEdgeInsets {
        UIEdgeInsets(top: CGFloat(insets.top), left: CGFloat(insets.left), bottom: CGFloat(insets.bottom), right: CGFloat(insets.right))
    }
}

/// The manifest-driven `AssetCatalog` over the `GameAssets/` folder reference of the app bundle: the port of
/// dom.js `spriteUrl` / `iconUrl`, card-view.js `artUrlFor` and audio.js `url()` (docs/PLAN.md §8). Images are
/// decoded once and kept in an `NSCache`; a missing card art falls back to the stage-0 art and then to a placeholder
/// drawn with Core Graphics (the web's card-placeholder.svg with the tribe colour).
final class BundleAssetCatalog: AssetCatalog {
    static let shared = BundleAssetCatalog()

    /// The GameAssets folder (manifest paths are relative to it).
    let root: URL
    let manifest: AssetManifest

    private let images = NSCache<NSString, UIImage>()
    private let placeholders = NSCache<NSString, UIImage>()
    private let blobs = NSCache<NSString, NSData>()
    private var misses = Set<String>()
    private let lock = NSLock()

    /// The catalog of the main bundle: `GameAssets/manifest.json` next to the folder's files. Without the folder (the
    /// build tool was not run) the catalog is empty: every sprite is nil, every card shows its placeholder.
    convenience init() {
        let bundle = Bundle.main
        let folder = (bundle.resourceURL ?? bundle.bundleURL).appendingPathComponent("GameAssets", isDirectory: true)
        let manifestURL = bundle.url(forResource: "manifest", withExtension: "json", subdirectory: "GameAssets")
            ?? folder.appendingPathComponent("manifest.json")
        self.init(root: folder, manifestURL: manifestURL)
    }

    /// A catalog over any folder (tests, previews, a swapped asset set).
    init(root: URL, manifestURL: URL?) {
        self.root = root
        var loaded = AssetManifest()
        if let url = manifestURL, let data = try? Data(contentsOf: url) {
            do {
                loaded = try JSONDecoder().decode(AssetManifest.self, from: data)
            } catch {
                NSLog("BundleAssetCatalog: manifest.json unreadable: %@", String(describing: error))
            }
        } else {
            NSLog("BundleAssetCatalog: GameAssets/manifest.json missing - run `node Tools/build-assets.mjs`")
        }
        manifest = loaded
        images.countLimit = 800
        images.totalCostLimit = 256 * 1024 * 1024
        placeholders.countLimit = 300
        blobs.countLimit = 64
    }

    // MARK: AssetCatalog

    func image(_ name: String) -> UIImage? {
        guard let path = imagePath(name) else { return nil }
        return loadImage(path: path)
    }

    func hasImage(_ name: String) -> Bool {
        imagePath(name) != nil
    }

    func cardArt(_ card: CardDef, stage: Int) -> UIImage {
        if let path = cardArtPath(card, stage: stage), let image = loadImage(path: path) {
            return image
        }
        if let base = manifest.cards[card.id]?["0"], let image = loadImage(path: base) {
            return image
        }
        return placeholder(for: card)
    }

    func soundURL(_ stem: String) -> URL? {
        var key = stem
        if key.lowercased().hasSuffix(".mp3") { key = String(key.dropLast(4)) }
        guard let path = manifest.sfx[key] else { return nil }
        return url(forPath: path)
    }

    func fontName(_ role: FontRole) -> String {
        FontRegistrar.shared.fontName(for: role, catalog: self)
    }

    func data(_ path: String) -> Data? {
        let key = path as NSString
        if let cached = blobs.object(forKey: key) { return cached as Data }
        guard let data = try? Data(contentsOf: url(forPath: path)) else { return nil }
        blobs.setObject(data as NSData, forKey: key, cost: data.count)
        return data
    }

    // MARK: Resolution helpers (additions)

    /// Absolute file URL of a manifest path.
    func url(forPath path: String) -> URL {
        root.appendingPathComponent(path)
    }

    /// Manifest path of a sprite stem: ui, then the stitched frames by their bare stem ("button_default" =
    /// "frames/button_default", the way the menus name them), bg, minions, portraits, prepackaged, then the map
    /// strips. A name may carry an extension ("frames/button_default.png", "gem.svg" → the rasterised PNG) or a
    /// group prefix ("bg/title").
    func imagePath(_ name: String) -> String? {
        let stem = BundleAssetCatalog.stem(of: name)
        if let p = manifest.ui[stem] { return p }
        if let p = manifest.ui["frames/" + stem] { return p }
        if let f = manifest.frames[stem] { return f.path }
        if let p = manifest.bg[stem] { return p }
        if let p = manifest.minions[stem] { return p }
        if let p = manifest.portraits[stem] { return p }
        if let p = manifest.prepackaged[stem] { return p }
        if let p = manifest.map[stem], !p.hasSuffix(".json") { return p }
        if let slash = stem.firstIndex(of: "/") {
            let group = String(stem[..<slash])
            let rest = String(stem[stem.index(after: slash)...])
            switch group {
            case "ui": return manifest.ui[rest]
            case "bg": return manifest.bg[rest]
            case "minions": return manifest.minions[rest]
            case "portraits": return manifest.portraits[rest]
            case "prepackaged": return manifest.prepackaged[rest]
            case "map": return manifest.map[rest].flatMap { $0.hasSuffix(".json") ? nil : $0 }
            default: return nil
            }
        }
        return nil
    }

    /// Manifest path of a card's art at a stage: the stage file, else the stage-0 file (card-view.js artUrlFor), else
    /// the file names of `card.art` when the manifest predates the card.
    func cardArtPath(_ card: CardDef, stage: Int) -> String? {
        let s = max(0, min(4, stage))
        if let stages = manifest.cards[card.id] {
            if let p = stages[String(s)] ?? stages["0"] { return p }
        }
        if let file = card.artFile(stage: s) {
            let path = "cards/" + file
            if FileManager.default.fileExists(atPath: url(forPath: path).path) { return path }
        }
        return nil
    }

    /// A stitched frame's spec by stem ("button_default", "hud_nineframe", "progressbar").
    func frame(_ stem: String) -> FrameSpec? {
        manifest.frames[stem]
    }

    /// Raw JSON of an original keyframe animation by name ("goldreward", "levelup"…).
    func animation(_ name: String) -> Data? {
        var key = name
        if key.lowercased().hasSuffix(".json") { key = String(key.dropLast(5)) }
        guard let path = manifest.animations[key] else { return nil }
        return data(path)
    }

    /// The map layout (`map/layout.json`: tile strips and node positions of the quest map).
    func mapLayout() -> Data? {
        guard let path = manifest.map["layout"] else { return nil }
        return data(path)
    }

    /// The font files of a role: the manifest's file first, then its alternates.
    func fontURLs(_ role: FontRole) -> [URL] {
        var paths: [String] = []
        if let p = manifest.fonts[role.rawValue] { paths.append(p) }
        paths.append(contentsOf: manifest.fontAlternates[role.rawValue] ?? [])
        return paths.map { url(forPath: $0) }
    }

    /// Decoded image by manifest path, cached; a file that fails to decode is remembered and not retried.
    func loadImage(path: String) -> UIImage? {
        let key = path as NSString
        if let cached = images.object(forKey: key) { return cached }
        lock.lock()
        let missed = misses.contains(path)
        lock.unlock()
        if missed { return nil }
        guard let image = UIImage(contentsOfFile: url(forPath: path).path) else {
            lock.lock()
            misses.insert(path)
            lock.unlock()
            NSLog("BundleAssetCatalog: cannot load %@", path)
            return nil
        }
        let cost = Int(image.size.width * image.scale * image.size.height * image.scale) * 4
        images.setObject(image, forKey: key, cost: cost)
        return image
    }

    /// Drop every decoded image (memory warning).
    func purgeCaches() {
        images.removeAllObjects()
        placeholders.removeAllObjects()
        blobs.removeAllObjects()
    }

    /// The stem of a sprite name: a trailing image extension is removed (dom.js spriteUrl accepts both forms).
    static func stem(of name: String) -> String {
        let lower = name.lowercased()
        for ext in [".png", ".jpg", ".jpeg", ".webp", ".svg"] where lower.hasSuffix(ext) {
            return String(name.dropLast(ext.count))
        }
        return name
    }

    // MARK: Placeholder (card-placeholder.svg)

    /// The generated stand-in for missing card art: a dark card with the tribe colour band, the grey silhouette of
    /// the web's card-placeholder.svg and the card name. Cached per card.
    func placeholder(for card: CardDef) -> UIImage {
        let key = ("placeholder:" + card.id) as NSString
        if let cached = placeholders.object(forKey: key) { return cached }
        let image = BundleAssetCatalog.drawPlaceholder(name: card.name, tribe: card.tribe, fontName: fontName(.bold))
        placeholders.setObject(image, forKey: key)
        return image
    }

    /// Draws the placeholder at the card art ratio of assets/cards (541 x 768 → 270 x 384 px, scale 1).
    static func drawPlaceholder(name: String, tribe: Tribe, fontName: String) -> UIImage {
        let size = CGSize(width: 270, height: 384)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        return renderer.image { context in
            let cg = context.cgContext
            // --panel-dark #141617 with a lighter centre
            UIColor(red: 0.078, green: 0.086, blue: 0.090, alpha: 1).setFill()
            cg.fill(CGRect(origin: .zero, size: size))
            UIColor(red: 0.165, green: 0.176, blue: 0.192, alpha: 1).setFill()
            cg.fill(CGRect(x: 10, y: 24, width: size.width - 20, height: size.height - 34))
            // tribe colour band along the top
            Palette.uiTribe(tribe).setFill()
            cg.fill(CGRect(x: 0, y: 0, width: size.width, height: 14))
            // silhouette (card-placeholder.svg: circle r 13 at (32, 30) and the body curve, in a 64 x 88 box)
            let boxWidth = size.width * 0.62
            let s = boxWidth / 64
            let ox = (size.width - boxWidth) / 2
            let oy: CGFloat = 44
            UIColor(red: 0.541, green: 0.561, blue: 0.580, alpha: 0.8).setFill()
            cg.fillEllipse(in: CGRect(x: ox + (32 - 13) * s, y: oy + (30 - 13) * s, width: 26 * s, height: 26 * s))
            let body = UIBezierPath()
            body.move(to: CGPoint(x: ox + 8 * s, y: oy + 78 * s))
            body.addCurve(to: CGPoint(x: ox + 32 * s, y: oy + 50 * s),
                          controlPoint1: CGPoint(x: ox + 8 * s, y: oy + 56 * s),
                          controlPoint2: CGPoint(x: ox + 20 * s, y: oy + 50 * s))
            body.addCurve(to: CGPoint(x: ox + 56 * s, y: oy + 78 * s),
                          controlPoint1: CGPoint(x: ox + 44 * s, y: oy + 50 * s),
                          controlPoint2: CGPoint(x: ox + 56 * s, y: oy + 56 * s))
            body.close()
            body.fill()
            // corner marks
            UIColor(red: 0.788, green: 0.773, blue: 0.722, alpha: 0.5).setStroke()
            let marks = UIBezierPath()
            marks.lineWidth = 2 * s
            marks.move(to: CGPoint(x: ox + 14 * s, y: oy + 10 * s)); marks.addLine(to: CGPoint(x: ox + 22 * s, y: oy + 10 * s))
            marks.move(to: CGPoint(x: ox + 14 * s, y: oy + 10 * s)); marks.addLine(to: CGPoint(x: ox + 14 * s, y: oy + 18 * s))
            marks.move(to: CGPoint(x: ox + 50 * s, y: oy + 10 * s)); marks.addLine(to: CGPoint(x: ox + 42 * s, y: oy + 10 * s))
            marks.move(to: CGPoint(x: ox + 50 * s, y: oy + 10 * s)); marks.addLine(to: CGPoint(x: ox + 50 * s, y: oy + 18 * s))
            marks.move(to: CGPoint(x: ox + 14 * s, y: oy + 78 * s)); marks.addLine(to: CGPoint(x: ox + 14 * s, y: oy + 70 * s))
            marks.move(to: CGPoint(x: ox + 50 * s, y: oy + 78 * s)); marks.addLine(to: CGPoint(x: ox + 50 * s, y: oy + 70 * s))
            marks.stroke()
            // name
            let paragraph = NSMutableParagraphStyle()
            paragraph.alignment = .center
            paragraph.lineBreakMode = .byWordWrapping
            let font = UIFont(name: fontName, size: 22) ?? UIFont.boldSystemFont(ofSize: 22)
            let attributes: [NSAttributedString.Key: Any] = [
                .font: font,
                .foregroundColor: UIColor(white: 0.9, alpha: 1),
                .paragraphStyle: paragraph,
            ]
            let rect = CGRect(x: 12, y: size.height - 86, width: size.width - 24, height: 66)
            (name as NSString).draw(in: rect, withAttributes: attributes)
        }
    }
}
