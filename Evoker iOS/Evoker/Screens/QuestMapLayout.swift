import Foundation
import EvokerCore

/// Layout of the quest maps (`src/ui/screens/quest-map-layout.js`, pure): the stitched original world maps and
/// their painted sockets (GameAssets/map/layout.json), the map scale, the drifting clouds, and the winding path
/// of the fallback painting drawn when the layout is missing. Plus the portal gate of `quest-portal.js`.

struct MapStrip: Decodable {
    let file: String
    let x: Double
    let y: Double
    let w: Double
    let h: Double
}

struct MapPoint: Decodable, Hashable {
    let x: Double
    let y: Double
}

struct WorldMap: Decodable {
    let name: String?
    let width: Double
    let height: Double
    let strips: [MapStrip]?
    let nodes: [MapPoint]?
}

struct MapLayout: Decodable {
    let maps: [WorldMap]

    /// Parse GameAssets/map/layout.json.
    static func parse(_ data: Data) -> MapLayout? {
        try? JSONDecoder().decode(MapLayout.self, from: data)
    }
}

enum QuestMapLayout {
    /// Vertical distance between nodes of the fallback painting (stage px).
    static let nodeStep: Double = 104
    static let mapTop: Double = 150
    static let mapBottom: Double = 420
    /// Map pixels → stage pixels.
    static let mapScale: Double = 0.85
    /// Height of the map viewport (stage 1280 − HUD 118 − nav 136): a map is never drawn shorter.
    static let mapViewHeight: Double = 1026
    /// Portal lines with a themed map; the others cycle through the portal maps.
    static let portalMaps: [String: Int] = ["the-dark-beyond": 1, "dragon-hunt": 2, "desert-twilight": 3, "dying-dreams": 4]
    /// Drifting clouds: sprite, vertical position (fraction of the map height), duration (s), scale, delay.
    static let clouds: [(file: String, y: Double, dur: Double, scale: Double, delay: Double)] = [
        ("map_cloud01", 0.12, 95, 1.1, 0),
        ("map_cloud02", 0.55, 120, 1.3, -40),
        ("map_cloud03", 0.82, 80, 0.9, -70),
    ]

    /// Position of node `i` on the winding path of the fallback painting.
    static func nodePos(_ i: Int) -> MapPoint {
        let d = Double(i)
        let x = (360 + 190 * sin(d * 0.78) + 40 * sin(d * 2.1)).rounded()
        return MapPoint(x: x, y: mapTop + d * nodeStep)
    }

    /// The map of a quest line: the main map for 'main', a themed or cycled portal map otherwise.
    static func world(for line: String, layout: MapLayout?, portalIds: [String]) -> WorldMap? {
        guard let layout = layout else { return nil }
        let maps = layout.maps.filter { $0.width >= 512 && $0.height >= 512 }
        guard !maps.isEmpty else { return nil }
        if line == "main" { return maps[0] }
        let portalMaps = Array(maps.dropFirst())
        if portalMaps.isEmpty { return maps[0] }
        if let themed = QuestMapLayout.portalMaps[line], themed < maps.count { return maps[themed] }
        let idx = max(0, portalIds.firstIndex(of: line) ?? 0)
        return portalMaps[idx % portalMaps.count]
    }

    /// Fit a socket chain to exactly `count` nodes (`fitNodes`).
    static func fitNodes(_ nodes: [MapPoint], count: Int) -> [MapPoint] {
        var pts = nodes
        if pts.count < 2 || count < 2 { return Array(pts.prefix(count)) }
        while pts.count > count {
            var best = -1
            var bestDev = Double.infinity
            for i in 1..<(pts.count - 1) {
                let a = pts[i - 1], b = pts[i + 1]
                let dx = b.x - a.x, dy = b.y - a.y
                var len = (dx * dx + dy * dy).squareRoot()
                if len == 0 { len = 1 }
                let dev = abs((pts[i].x - a.x) * dy - (pts[i].y - a.y) * dx) / len
                if dev < bestDev { bestDev = dev; best = i }
            }
            if best < 0 { break }
            pts.remove(at: best)
        }
        if pts.count < count {
            var lens: [Double] = []
            for i in 0..<(pts.count - 1) {
                let dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y
                lens.append((dx * dx + dy * dy).squareRoot())
            }
            var extra = [Int](repeating: 0, count: lens.count)
            var n = pts.count
            while n < count {
                var best = 0
                if lens.count > 1 {
                    for i in 1..<lens.count where lens[i] / Double(extra[i] + 2) > lens[best] / Double(extra[best] + 2) { best = i }
                }
                if lens.isEmpty { break }
                extra[best] += 1
                n += 1
            }
            var out: [MapPoint] = []
            for (i, p) in pts.enumerated() {
                out.append(p)
                if i >= lens.count { continue }
                let q = pts[i + 1]
                if extra[i] > 0 {
                    for k in 1...extra[i] {
                        let t = Double(k) / Double(extra[i] + 1)
                        out.append(MapPoint(x: (p.x + (q.x - p.x) * t).rounded(), y: (p.y + (q.y - p.y) * t).rounded()))
                    }
                }
            }
            pts = out
        }
        return pts
    }

    /// Node coordinates (map pixels) for `count` quests on a map (`nodeCoords`): the painted sockets, else a serpentine.
    static func nodeCoords(_ world: WorldMap, count: Int, spacing: Double = 230) -> [MapPoint] {
        let nodes = world.nodes ?? []
        if Double(nodes.count) >= Double(count) * 0.7 && nodes.count >= 2 { return fitNodes(nodes, count: count) }
        let W = world.width, H = world.height
        let vertical = H > W
        let long = vertical ? H : W
        let short = vertical ? W : H
        let mL = min(260, long * 0.08)
        let mS = min(220, short * 0.12)
        let usableL = long - 2 * mL
        let usableS = short - 2 * mS
        var capacity = max(2, Int((usableL / spacing).rounded(.down)) + 1)
        var lanes = max(1, Int((Double(count) / Double(capacity)).rounded(.up)))
        let maxLanes = max(1, Int((usableS / 200).rounded(.down)) + 1)
        if lanes > maxLanes { lanes = maxLanes; capacity = Int((Double(count) / Double(lanes)).rounded(.up)) }
        let pitch = lanes > 1 ? usableS / Double(lanes - 1) : 0
        var out: [MapPoint] = []
        for i in 0..<count {
            let lane = i / capacity
            let k = i - lane * capacity
            let n = min(capacity, count - lane * capacity)
            let t = n > 1 ? Double(k) / Double(n - 1) : 0.5
            let tl = lane % 2 == 1 ? 1 - t : t
            let a = mL + tl * usableL
            let wobble = sin(Double(i) * 1.7) * min(90, (pitch > 0 ? pitch : usableS) * 0.22)
            let b = (lanes > 1 ? mS + Double(lane) * pitch : short / 2) + wobble
            out.append(vertical ? MapPoint(x: b.rounded(), y: a.rounded()) : MapPoint(x: a.rounded(), y: b.rounded()))
        }
        return out
    }

    /// Stage-px scale of a painted map: MAP_SCALE, raised for a map that would end above the nav.
    static func scale(for world: WorldMap) -> Double {
        world.height > 0 ? max(mapScale, mapViewHeight / world.height) : mapScale
    }
}

/// The portal gate of the quest maps (`quest-portal.js`): which portal runs now (the 7-day rotation), the banner
/// over a map, and the level-8 lock.
enum PortalGate {
    /// Player level from which the portals can be entered.
    static let portalLevel = 8

    struct Running {
        var portalId: String
        var name: String
        var endsAt: Int64
        var next: (portalId: String, name: String, startsAt: Int64)?
    }

    struct Banner {
        var name: String
        var portalId: String
        var endsAt: Int64?
        /// The map a tap enters (nil = no tap target).
        var target: String?
    }

    enum Reason {
        case closed, level
    }

    static func canEnterPortals(_ state: GameState) -> Bool {
        state.player.level >= portalLevel
    }

    /// The running portal and the next one by the 7-day rotation.
    static func runningPortal(_ state: GameState, deps: Deps, now: Int64) -> Running? {
        guard let sched = QuestOps.portalSchedule(deps: deps, createdAt: state.createdAt, now: now),
              let line = QuestOps.questLine(deps: deps, lineId: sched.portalId) else { return nil }
        let portals = deps.quests?.portals ?? []
        var next: (portalId: String, name: String, startsAt: Int64)? = nil
        if portals.count > 1 {
            let def = portals[(sched.index + 1) % portals.count]
            next = (portalId: def.id, name: def.name, startsAt: sched.endsAt)
        }
        return Running(portalId: sched.portalId, name: line.name, endsAt: sched.endsAt, next: next)
    }

    /// The map a request may show (`resolveMapLine`): a portal map only for the running portal and from level 8.
    static func resolveMapLine(_ state: GameState, deps: Deps, now: Int64, line: String) -> (line: String, reason: Reason?) {
        if line == "main" || QuestOps.questLine(deps: deps, lineId: line) == nil { return ("main", nil) }
        guard let run = runningPortal(state, deps: deps, now: now), run.portalId == line else { return ("main", .closed) }
        if !canEnterPortals(state) { return ("main", .level) }
        return (line, nil)
    }

    /// The banner over a map (`mapBanner`).
    static func banner(_ state: GameState, deps: Deps, now: Int64, line: String) -> Banner? {
        let run = runningPortal(state, deps: deps, now: now)
        if line == "main" || QuestOps.questLine(deps: deps, lineId: line) == nil {
            guard let r = run else { return nil }
            return Banner(name: r.name, portalId: r.portalId, endsAt: r.endsAt, target: r.portalId)
        }
        guard let def = QuestOps.questLine(deps: deps, lineId: line) else { return nil }
        let running = run?.portalId == line
        return Banner(name: def.name, portalId: line, endsAt: running ? run?.endsAt : nil, target: nil)
    }

    /// `quest-model.js portalBlock`: why a quest of `line` may not be played now.
    static func block(_ state: GameState, deps: Deps, now: Int64, line: String) -> Reason? {
        if line == "main" { return nil }
        return resolveMapLine(state, deps: deps, now: now, line: line).reason
    }
}
