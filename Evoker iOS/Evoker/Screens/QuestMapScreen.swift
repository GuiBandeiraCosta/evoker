import SwiftUI
import EvokerCore

/// Quest map (`src/ui/screens/quest-map.js`): the running portal's banner with its countdown over the top of the
/// map, the painted world map scrolling in both directions with the quest nodes on the painted sockets (beaten =
/// grey numbered badges, current = dark badge in the golden fx_glow_map rune circle, locked = the socket itself),
/// drifting clouds, the section plates, the ranger guide's line, the owed unlock popups.
struct QuestMapScreen: View {
    let line: String
    @EnvironmentObject private var model: AppModel
    @Environment(\.stage) private var stage
    @State private var layout: MapLayout? = nil
    @State private var layoutLoaded: Bool = false
    @State private var guideHidden: Bool = false
    @State private var scrolledOnce: Bool = false

    var body: some View {
        Group {
            if let state = model.store.state {
                content(state)
                    .chrome(active: .quest, back: line == "main" ? .none : .pop(fallback: .questMap()), help: "quest-map")
            } else {
                Color.black
            }
        }
        .onAppear {
            if !layoutLoaded {
                layoutLoaded = true
                if let data = model.assets.data("map/layout.json") { layout = MapLayout.parse(data) }
            }
            checkPortal()
            model.catchUpUnlocks()
        }
    }

    private var resolved: (line: String, reason: PortalGate.Reason?) {
        guard let state = model.store.state else { return ("main", nil) }
        return PortalGate.resolveMapLine(state, deps: model.deps, now: model.now, line: line)
    }

    private func checkPortal() {
        let r = resolved
        if r.reason == .closed {
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 700_000_000)
                model.toast(Strings.portalClosed, icon: "icon_map_active")
            }
        }
        if r.line != line {
            model.router.replace(.questMap())
        }
    }

    @ViewBuilder
    private func content(_ state: GameState) -> some View {
        let lineId = resolved.line
        let nodes = QuestOps.mapNodes(state, deps: model.deps, lineId: lineId)
        let sections = lineId == "main" ? (model.deps.quests?.sections ?? []) : []
        let portalIds = (model.deps.quests?.portals ?? []).map { $0.id }
        let world = QuestMapLayout.world(for: lineId, layout: layout, portalIds: portalIds)
        let banner = PortalGate.banner(state, deps: model.deps, now: model.now, line: lineId)
        ZStack(alignment: .top) {
            Color(hex: world == nil ? 0x0f1a12 : 0x0b1216)
            ScrollViewReader { proxy in
                ScrollView([.horizontal, .vertical], showsIndicators: false) {
                    if let w = world {
                        WorldMapView(world: w, line: lineId, nodes: nodes, sections: sections, onTap: { n in tapNode(n, nodes: nodes, line: lineId) })
                    } else {
                        FallbackMapView(line: lineId, nodes: nodes, sections: sections, onTap: { n in tapNode(n, nodes: nodes, line: lineId) })
                    }
                }
                .onAppear {
                    // the original centres the current node horizontally, at about 40 % of the height
                    if let cur = nodes.first(where: { $0.status == .current }) {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                            proxy.scrollTo("node-\(cur.n)", anchor: UnitPoint(x: 0.5, y: 0.4))
                        }
                    }
                }
            }
            if let b = banner {
                PortalBannerView(banner: b, strip: bannerStrip(for: b.portalId, portalIds: portalIds)) {
                    if let target = b.target { enterPortal(target) }
                }
                .padding(.top, 8)
            }
            if let text = QuestOps.guideLine(state, lastLoss: false), !guideHidden {
                VStack {
                    Spacer()
                    GuideView(text: text) { guideHidden = true }
                }
            }
        }
    }

    private func bannerStrip(for portalId: String, portalIds: [String]) -> String? {
        QuestMapLayout.world(for: portalId, layout: layout, portalIds: portalIds)?.strips?.first.map { stem($0.file) }
    }

    private func tapNode(_ n: Int, nodes: [MapNode], line: String) {
        guard let node = nodes.first(where: { $0.n == n }) else { return }
        model.sfx("ui_button_map")
        if node.status == .locked {
            model.toast(Strings.beatQuestFirst(n - 1), icon: "lock_small")
            return
        }
        model.router.go(.quest(line: line, n: n))
    }

    /// Enter a portal map, or below level 8 the client's locked-feature popup.
    private func enterPortal(_ target: String) {
        guard let state = model.store.state else { return }
        if PortalGate.canEnterPortals(state) {
            model.router.go(.questMap(line: target))
        } else {
            Task { @MainActor in
                await model.dialogs.alert(title: Strings.portalsTitle, message: Strings.portalsLocked)
            }
        }
    }
}

/// File name → sprite stem ("world-0-0.jpg" → "world-0-0").
func stem(_ file: String) -> String {
    if let dot = file.lastIndex(of: ".") { return String(file[file.startIndex..<dot]) }
    return file
}

/// The stitched world map with its nodes, clouds and section plates (map pixels × scale).
struct WorldMapView: View {
    let world: WorldMap
    let line: String
    let nodes: [MapNode]
    let sections: [QuestSection]
    let onTap: (Int) -> Void
    @State private var cloudDrift: Bool = false

    var body: some View {
        let sc = QuestMapLayout.scale(for: world)
        let W = (world.width * sc).rounded()
        let H = (world.height * sc).rounded()
        let coords = QuestMapLayout.nodeCoords(world, count: nodes.count).map { CGPoint(x: ($0.x * sc).rounded(), y: ($0.y * sc).rounded()) }
        ZStack(alignment: .topLeading) {
            ForEach(Array((world.strips ?? []).enumerated()), id: \.offset) { item in
                let s = item.element
                StretchedSprite(stem(s.file))
                    .frame(width: (s.w * sc).rounded(), height: (s.h * sc).rounded())
                    .offset(x: (s.x * sc).rounded(), y: (s.y * sc).rounded())
            }
            LinearGradient(stops: line == "main"
                           ? [.init(color: .black.opacity(0.35), location: 0), .init(color: .clear, location: 90 / max(H, 1)), .init(color: .clear, location: 0.85), .init(color: .black.opacity(0.35), location: 1)]
                           : [.init(color: Color(hex: 0x280a3c, alpha: 0.3), location: 0), .init(color: Color(hex: 0x140028, alpha: 0.12), location: 0.5), .init(color: Color(hex: 0x1e0032, alpha: 0.3), location: 1)],
                           startPoint: .top, endPoint: .bottom)
                .frame(width: W, height: H)
                .allowsHitTesting(false)
            ForEach(Array(QuestMapLayout.clouds.enumerated()), id: \.offset) { item in
                let c = item.element
                Sprite(c.file)
                    .frame(width: 384 * c.scale)
                    .opacity(0.75)
                    .offset(x: cloudDrift ? W : -520, y: (c.y * H).rounded())
                    .animation(.linear(duration: c.dur).repeatForever(autoreverses: false).delay(c.delay), value: cloudDrift)
                    .allowsHitTesting(false)
            }
            ForEach(sections, id: \.index) { sec in
                let i = sec.from - 1
                if i >= 0 && i < coords.count {
                    let p = coords[i]
                    Text(sec.name)
                        .font(Theme.font(22))
                        .foregroundColor(Theme.gold)
                        .shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 2)
                        .padding(.vertical, 6).padding(.horizontal, 18)
                        .background(Color(hex: 0x151617))
                        .overlay(NineSlice(Theme.Frames.smallWhite))
                        .fixedSize()
                        .position(x: p.x, y: p.y - 62 - 18)
                        .allowsHitTesting(false)
                }
            }
            ForEach(Array(nodes.enumerated()), id: \.offset) { item in
                let node = item.element
                if item.offset < coords.count {
                    let p = coords[item.offset]
                    if node.status == .current {
                        RuneCircle().position(p).allowsHitTesting(false)
                    }
                    QuestNodeButton(node: node, painted: true) { onTap(node.n) }
                        .position(p)
                        .id("node-\(node.n)")
                }
            }
        }
        .frame(width: W, height: H, alignment: .topLeading)
        .clipped()
        .onAppear { cloudDrift = true }
    }
}

/// The CSS painting with the winding path, drawn when the layout is missing.
struct FallbackMapView: View {
    let line: String
    let nodes: [MapNode]
    let sections: [QuestSection]
    let onTap: (Int) -> Void

    var body: some View {
        let count = nodes.count
        let height = QuestMapLayout.mapTop + Double(max(0, count - 1)) * QuestMapLayout.nodeStep + QuestMapLayout.mapBottom
        let pts = (0..<count).map { QuestMapLayout.nodePos($0) }
        ZStack(alignment: .topLeading) {
            LinearGradient(colors: line == "main" ? [Color(hex: 0x1f3a24), Color(hex: 0x0f1a12)] : [Color(hex: 0x2a1240), Color(hex: 0x140028)], startPoint: .top, endPoint: .bottom)
            Path { p in
                for (i, pt) in pts.enumerated() {
                    if i == 0 { p.move(to: CGPoint(x: pt.x, y: pt.y)) } else { p.addLine(to: CGPoint(x: pt.x, y: pt.y)) }
                }
            }
            .stroke(Color(hex: 0xe5d7a8).opacity(0.9), style: StrokeStyle(lineWidth: 5, lineCap: .round, lineJoin: .round, dash: [2, 16]))
            ForEach(sections, id: \.index) { sec in
                let i = sec.from - 1
                if i >= 0 && i < count {
                    let p = pts[i]
                    Text(sec.name)
                        .font(Theme.font(22))
                        .foregroundColor(Theme.gold)
                        .padding(.vertical, 6).padding(.horizontal, 18)
                        .background(Color(hex: 0x151617))
                        .overlay(NineSlice(Theme.Frames.smallWhite))
                        .fixedSize()
                        .offset(x: p.x > 360 ? 24 : 420, y: p.y - 22)
                }
            }
            ForEach(Array(nodes.enumerated()), id: \.offset) { item in
                let node = item.element
                let p = CGPoint(x: pts[item.offset].x, y: pts[item.offset].y)
                if node.status == .current {
                    RuneCircle().position(p).allowsHitTesting(false)
                }
                QuestNodeButton(node: node, painted: false) { onTap(node.n) }
                    .position(p)
                    .id("node-\(node.n)")
            }
        }
        .frame(width: Stage.width, height: height, alignment: .topLeading)
    }
}

/// The fx_glow_map rune circle drawn around the current node, slowly turning.
struct RuneCircle: View {
    @State private var spin: Double = 0

    var body: some View {
        Sprite("fx_glow_map")
            .frame(width: 230, height: 230)
            .opacity(0.95)
            .shadow(color: Color(hex: 0xffc850, alpha: 0.7), radius: 8)
            .rotationEffect(.degrees(spin))
            .onAppear {
                withAnimation(.linear(duration: 30).repeatForever(autoreverses: false)) { spin = 360 }
            }
    }
}

/// A quest node: the original's square badges (beaten grey, current dark in the ring, locked = the painted socket).
struct QuestNodeButton: View {
    let node: MapNode
    let painted: Bool
    let action: () -> Void
    @State private var pulse: Bool = false

    var body: some View {
        Button(action: action) {
            switch node.status {
            case .locked:
                if painted {
                    Color.clear.frame(width: 46, height: 46).contentShape(Circle())
                } else {
                    Circle()
                        .fill(RadialGradient(colors: [Color(hex: 0x3b3733), Color(hex: 0x26231f), Color(hex: 0x1a1816)], center: UnitPoint(x: 0.5, y: 0.4), startRadius: 0, endRadius: 20))
                        .overlay(Circle().stroke(Color(hex: 0xb8ada0), lineWidth: 2))
                        .frame(width: 34, height: 34)
                }
            case .done:
                badge(size: 54, radius: 8, font: 25,
                      colors: [Color(hex: 0x9aa3a8), Color(hex: 0x6d767c), Color(hex: 0x4f575d)], ring: Color(hex: 0x7d8589))
            case .current:
                badge(size: 64, radius: 9, font: 29,
                      colors: [Color(hex: 0x5d6870), Color(hex: 0x353e45), Color(hex: 0x22292e)], ring: Color(hex: 0xc9d0d3))
                    .shadow(color: Color(hex: 0xffd66e, alpha: 0.75), radius: 11)
                    .brightness(pulse ? 0.22 : 0)
                    .onAppear {
                        withAnimation(.easeInOut(duration: 1.6).repeatForever(autoreverses: true)) { pulse = true }
                    }
            }
        }
        .buttonStyle(PressScaleStyle())
    }

    private func badge(size: CGFloat, radius: CGFloat, font: CGFloat, colors: [Color], ring: Color) -> some View {
        Text("\(node.n)")
            .font(Theme.font(font))
            .foregroundColor(.white)
            .shadow(color: .black.opacity(0.85), radius: 1, x: 0, y: 2)
            .frame(width: size, height: size)
            .background(LinearGradient(colors: colors, startPoint: .top, endPoint: .bottom))
            .overlay(RoundedRectangle(cornerRadius: radius).stroke(Color(hex: 0x15181b), lineWidth: 3))
            .overlay(RoundedRectangle(cornerRadius: radius + 3).stroke(ring, lineWidth: 2).padding(-3))
            .overlay(RoundedRectangle(cornerRadius: radius + 5).stroke(Color(hex: 0x0a0b0c), lineWidth: 2).padding(-5))
            .cornerRadius(radius)
            .shadow(color: .black.opacity(0.7), radius: 5, x: 0, y: 5)
    }
}

/// The portal banner over the top of a map (microbanner_comp): painted strip, the portal's name, the countdown.
struct PortalBannerView: View {
    let banner: PortalGate.Banner
    let strip: String?
    let onTap: () -> Void
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Button(action: { if banner.target != nil { model.sfx("ui_button_circular"); onTap() } }) {
            HStack(spacing: 12) {
                Text(banner.name)
                    .font(Theme.font(38))
                    .foregroundColor(Color(hex: 0xd2aaf8))
                    .lineLimit(1)
                    .shadow(color: .black, radius: 1, x: 0, y: 2)
                    .shadow(color: Color(hex: 0x783cc8, alpha: 0.6), radius: 8)
                Spacer(minLength: 0)
                if let ends = banner.endsAt {
                    CountdownText(endsAt: ends, style: .dhms, font: Theme.num(24), color: .white)
                }
            }
            .padding(.leading, 20).padding(.trailing, 22)
            .frame(width: Stage.width - 16, height: 76)
            .background(
                ZStack {
                    Color(hex: 0x141826)
                    if let s = strip {
                        StretchedSprite(s).opacity(0.9)
                    }
                    LinearGradient(stops: [.init(color: Color(hex: 0x0a0c1a, alpha: 0.96), location: 0), .init(color: Color(hex: 0x0e1022, alpha: 0.88), location: 0.36), .init(color: Color(hex: 0x1e2850, alpha: 0.25), location: 0.62), .init(color: Color(hex: 0x0a0c1a, alpha: 0.7), location: 1)], startPoint: .leading, endPoint: .trailing)
                }
                .clipped()
            )
            .overlay(RoundedRectangle(cornerRadius: 3).stroke(Color(hex: 0x6d7378), lineWidth: 2).padding(2))
            .overlay(RoundedRectangle(cornerRadius: 3).stroke(Color(hex: 0x0b0c0d), lineWidth: 3))
            .shadow(color: .black.opacity(0.75), radius: 6, x: 0, y: 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(banner.target == nil)
    }
}

/// The ranger guide with her speech bubble (`.qm-guide`); a tap dismisses it.
struct GuideView: View {
    let text: String
    let onDismiss: () -> Void

    var body: some View {
        HStack(alignment: .bottom, spacing: 0) {
            Sprite("guide-ranger", contentMode: .fill)
                .frame(width: 210, height: 290)
                .clipped()
                .mask(LinearGradient(colors: [.black, .black, .clear], startPoint: .top, endPoint: .bottom))
                .shadow(color: .black.opacity(0.9), radius: 12)
            Text(text)
                .font(Theme.font(32))
                .foregroundColor(Theme.tan)
                .multilineTextAlignment(.center)
                .lineSpacing(6)
                .shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 2)
                .padding(.vertical, 26).padding(.horizontal, 34)
                .frame(maxWidth: .infinity, minHeight: 150)
                .background(Color(hex: 0x0a0b0c, alpha: 0.9))
                .overlay(NineSlice(Theme.Frames.hudNineframe))
                .shadow(color: .black.opacity(0.8), radius: 7, x: 0, y: 4)
                .padding(.leading, -20)
                .padding(.trailing, 14)
                .padding(.bottom, 40)
                .onTapGesture { onDismiss() }
        }
        .frame(width: Stage.width, height: 290, alignment: .bottom)
    }
}
