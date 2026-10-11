import Foundation
import SwiftUI
import UIKit
import EvokerCore

/// A keyframe animation of the original client (`GameAssets/animations/<name>.json`, the comp_anim_player
/// format), port of `src/ui/anim-player.js`: `images[]` (sprites, or `type: "template"` slots the caller fills,
/// e.g. the reward card) with their start state (x, y, xScale, yScale, rotation, alpha, width, height in the
/// client's 320-wide content units, centred on the animation's origin), `startVisibility` / `endVisibility` (ms),
/// `blendMode` ("add" for sprites painted on black) and `tweens[]` (`{id, timestamp, params: {time, x, y, xScale,
/// yScale, rotation, alpha}}`, id = 1-based image index, linear like Corona's default easing).
struct ClientAnimation: Decodable {
    struct Image: Decodable {
        let src: String?
        let type: String?
        let x: Double?
        let y: Double?
        let xScale: Double?
        let yScale: Double?
        let rotation: Double?
        let alpha: Double?
        let width: Double?
        let height: Double?
        let blendMode: String?
        let startVisibility: Double?
        let endVisibility: Double?

        var isTemplate: Bool { type == "template" }
        var isAdditive: Bool { blendMode == "add" }
        /// Sprite stem of the source path ("assets/gfx/hud/rewardanimation/goldrain.jpg" → "goldrain").
        var stem: String? {
            guard let s = src, let last = s.split(separator: "/").last else { return nil }
            var name = String(last)
            for ext in [".png", ".jpg", ".jpeg", ".PNG", ".JPG"] where name.hasSuffix(ext) { name = String(name.dropLast(ext.count)); break }
            return name
        }
    }

    struct Tween: Decodable {
        let id: Int?
        let timestamp: Double?
        let params: [String: Double]?
    }

    let startTime: Double?
    let duration: Double?
    let width: Double?
    let height: Double?
    let templates: [String: Int]?
    let images: [Image]?
    let tweens: [Tween]?

    var durationMs: Double { duration ?? 0 }
    var imageList: [Image] { images ?? [] }

    /// The state of one image at a time.
    struct ImageState {
        var x: Double
        var y: Double
        var xScale: Double
        var yScale: Double
        var rotation: Double
        var alpha: Double
        var visible: Bool
    }

    /// A tween segment of one property: start time, duration, target value.
    struct Segment {
        let ts: Double
        let time: Double
        let to: Double
    }

    static let props = ["x", "y", "xScale", "yScale", "rotation", "alpha"]

    /// Tween segments per image and property, sorted by start time (`segmentsOf`).
    func segments() -> [[String: [Segment]]] {
        var segs: [[String: [Segment]]] = imageList.map { _ in [:] }
        for tw in tweens ?? [] {
            let i = (tw.id ?? 0) - 1
            guard i >= 0, i < segs.count, let prm = tw.params else { continue }
            let time = Swift.max(0, prm["time"] ?? 0)
            for k in ClientAnimation.props {
                guard let to = prm[k] else { continue }
                segs[i][k, default: []].append(Segment(ts: tw.timestamp ?? 0, time: time, to: to))
            }
        }
        for i in segs.indices {
            for k in segs[i].keys { segs[i][k]?.sort { $0.ts < $1.ts } }
        }
        return segs
    }

    private static func initial(_ img: Image, _ k: String) -> Double {
        switch k {
        case "x": return img.x ?? 0
        case "y": return img.y ?? 0
        case "xScale": return img.xScale ?? 1
        case "yScale": return img.yScale ?? 1
        case "rotation": return img.rotation ?? 0
        case "alpha": return img.alpha ?? 1
        default: return 0
        }
    }

    /// State of every image at time t (ms of animation time) — `sampleAnim`.
    func sample(_ t: Double, segments segs: [[String: [Segment]]]) -> [ImageState] {
        var out: [ImageState] = []
        for (i, img) in imageList.enumerated() {
            let end = img.endVisibility ?? Double.infinity
            var st = ImageState(x: 0, y: 0, xScale: 1, yScale: 1, rotation: 0, alpha: 1, visible: t >= (img.startVisibility ?? 0) && t <= end)
            for k in ClientAnimation.props {
                var v = ClientAnimation.initial(img, k)
                let list = i < segs.count ? (segs[i][k] ?? []) : []
                for s in list {
                    if t < s.ts { break }
                    if s.time <= 0 || t >= s.ts + s.time { v = s.to; continue }
                    v += (s.to - v) * ((t - s.ts) / s.time)
                    break
                }
                switch k {
                case "x": st.x = v
                case "y": st.y = v
                case "xScale": st.xScale = v
                case "yScale": st.yScale = v
                case "rotation": st.rotation = v
                default: st.alpha = v
                }
            }
            out.append(st)
        }
        return out
    }

    /// `loadAnim(name)`: the animation file through the catalog (`animations/<name>.json`), nil when missing.
    static func load(_ name: String, assets: AssetCatalog) -> ClientAnimation? {
        guard let data = assets.data("animations/\(name).json") else { return nil }
        return try? JSONDecoder().decode(ClientAnimation.self, from: data)
    }
}

/// One frame of a client animation centred on its origin (`playAnim`'s draw): the images at their state, the
/// first image in front (the client brings them to the front from last to first), additive sprites with
/// `plusLighter`, the template slot filled by `template`.
struct ClientAnimationFrame: View {
    let anim: ClientAnimation
    let segments: [[String: [ClientAnimation.Segment]]]
    /// Animation time (ms).
    let t: Double
    let assets: AssetCatalog
    let template: AnyView?
    var unit: CGFloat = BattleResultTiming.unit

    var body: some View {
        let states = anim.sample(t, segments: segments)
        let images = anim.imageList
        return ZStack {
            ForEach(Array(images.enumerated()), id: \.offset) { pair in
                let i = pair.offset
                let img = pair.element
                let s = i < states.count ? states[i] : ClientAnimation.ImageState(x: 0, y: 0, xScale: 1, yScale: 1, rotation: 0, alpha: 0, visible: false)
                let w = CGFloat(img.width ?? 0) * unit
                let h = CGFloat(img.height ?? 0) * unit
                Group {
                    if img.isTemplate {
                        if let tv = template { tv } else { Color.clear }
                    } else if let stem = img.stem, let ui = assets.image(stem) {
                        Image(uiImage: ui).resizable()
                    } else {
                        Color.clear
                    }
                }
                .frame(width: w, height: h)
                .scaleEffect(x: CGFloat(Swift.max(0.0001, s.xScale)), y: CGFloat(Swift.max(0.0001, s.yScale)))
                .rotationEffect(.degrees(s.rotation))
                .offset(x: CGFloat(s.x) * unit, y: CGFloat(s.y) * unit)
                .opacity(s.visible ? Swift.max(0, Swift.min(1, s.alpha)) : 0)
                .blendMode(img.isAdditive ? .plusLighter : .normal)
                .zIndex(Double(images.count - i))
            }
        }
        .allowsHitTesting(false)
    }
}

/// Plays a client animation from `start` at `speed` (the client's anim speed; reward_comp plays at 1.2), or
/// holds the frame `frozenAt` (ms) once stopped.
struct ClientAnimationPlayer: View {
    let anim: ClientAnimation
    let segments: [[String: [ClientAnimation.Segment]]]
    let start: Date
    let speed: Double
    let frozenAt: Double?
    let assets: AssetCatalog
    let template: AnyView?

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60.0, paused: frozenAt != nil)) { context in
            let elapsed = context.date.timeIntervalSince(start) * 1000 * speed
            let t = frozenAt ?? Swift.min(anim.durationMs, Swift.max(0, elapsed))
            ClientAnimationFrame(anim: anim, segments: segments, t: t, assets: assets, template: template)
        }
    }
}
