import SwiftUI
import EvokerCore

/// Card slider of the Cards screen (`src/ui/screens/cards-slider.js`, comp_cardslider2): the cards on an arc, the
/// middle one in front, swiped sideways with inertia (velocity × 0.95 per frame). One gesture decides on the
/// first movement: a sideways swipe scrolls, a steeper move picks the card under the finger up (drag and drop),
/// a release without movement is a tap.
struct CardsSliderView: View {
    let entries: [SliderEntry]
    let inDeck: Set<String>
    @Binding var offset: Double
    @ObservedObject var dnd: DragDropCoordinator
    let onTap: (SliderEntry) -> Void
    @State private var frame: CGRect = .zero
    @State private var gesture: SliderGesture? = nil
    @State private var animation: Task<Void, Never>? = nil

    /// The slider box on the screen body (stage px) and the cards' origin inside it.
    static let box = CGRect(x: -90, y: 522, width: 900, height: 504)
    static let origin = CGPoint(x: 450, y: 258)

    private struct SliderGesture {
        enum Mode { case undecided, scroll, drag, none }
        var start: CGPoint
        var startOffset: Double
        var mode: Mode = .undecided
        var samples: [(t: Double, o: Double)] = []
        var entry: SliderEntry?
    }

    var body: some View {
        let limits = SliderGeometry.limits(entries.count)
        ZStack(alignment: .topLeading) {
            Sprite("fight_cardbackground01", contentMode: .fill)
                .frame(width: CardsSliderView.box.width, height: CardsSliderView.box.height)
                .clipped()
            ForEach(Array(entries.enumerated()), id: \.element.id) { item in
                let pose = SliderGeometry.pose(offset + Double(item.offset) * SliderGeometry.step)
                if pose.visible {
                    CardFaceView(face: item.element.face, size: .compact, inDeck: item.element.uid.map { inDeck.contains($0) } ?? false,
                                 pieces: pieces(item.element))
                        .opacity(dnd.isSource(uid: item.element.uid, pieceId: item.element.pieceId) ? 0.3 : 1)
                        .scaleEffect(pose.scale)
                        .offset(x: CardsSliderView.origin.x - 60 + pose.x, y: CardsSliderView.origin.y - 84 + pose.y)
                        .zIndex(Double(pose.z))
                        .allowsHitTesting(false)
                }
            }
        }
        .frame(width: CardsSliderView.box.width, height: CardsSliderView.box.height, alignment: .topLeading)
        .clipped()
        .contentShape(Rectangle())
        .background(FrameReader { f in frame = f })
        .gesture(
            DragGesture(minimumDistance: 0, coordinateSpace: .named(stageCoordinateSpace))
                .onChanged { v in onChanged(v, limits: limits) }
                .onEnded { v in onEnded(v, limits: limits) }
        )
        .onDisappear { animation?.cancel() }
    }

    private func pieces(_ e: SliderEntry) -> (owned: Int, total: Int)? {
        if case .piece(_, _, let owned, let total) = e { return (owned, total) }
        return nil
    }

    /// Hit box of card i in stage coordinates (the pose's position and scale).
    private func cardRect(_ i: Int) -> CGRect {
        let pose = SliderGeometry.pose(offset + Double(i) * SliderGeometry.step)
        let w = 120 * pose.scale, h = 168 * pose.scale
        let cx = frame.minX + CardsSliderView.origin.x + pose.x
        let cy = frame.minY + CardsSliderView.origin.y + pose.y
        return CGRect(x: cx - w / 2, y: cy - h / 2, width: w, height: h)
    }

    /// The front-most card under a stage point.
    private func entryAt(_ p: CGPoint) -> (index: Int, entry: SliderEntry)? {
        var best: (Int, SliderEntry, Int)? = nil
        for (i, e) in entries.enumerated() {
            let pose = SliderGeometry.pose(offset + Double(i) * SliderGeometry.step)
            guard pose.visible, cardRect(i).contains(p) else { continue }
            if best == nil || pose.z > best!.2 { best = (i, e, pose.z) }
        }
        return best.map { ($0.0, $0.1) }
    }

    private func onChanged(_ v: DragGesture.Value, limits: (min: Double, max: Double)) {
        if gesture == nil {
            animation?.cancel()
            gesture = SliderGesture(start: v.startLocation, startOffset: offset, entry: entryAt(v.startLocation)?.entry)
        }
        guard var g = gesture else { return }
        let dx = v.location.x - g.start.x, dy = v.location.y - g.start.y
        if g.mode == .undecided {
            if (dx * dx + dy * dy).squareRoot() < 6 { return }
            if SliderGeometry.isSwipe(dx: dx, dy: dy) {
                g.mode = .scroll
            } else if let hit = entryAt(g.start) {
                g.mode = .drag
                let rect = cardRect(hit.index)
                let e = hit.entry
                dnd.begin(payload: DragPayload(uid: e.uid, cardId: e.face.cardId, pieceId: e.pieceId, fromSlot: nil, fromZone: nil), face: e.face, frame: rect, at: g.start)
            } else {
                g.mode = .none
            }
        }
        switch g.mode {
        case .scroll:
            offset = max(limits.min, min(limits.max, g.startOffset + Double(dx) * SliderGeometry.degPerPx))
            let t = Date().timeIntervalSince1970 * 1000
            g.samples.append((t, offset))
            while g.samples.count > 2 && t - g.samples[0].t > 100 { g.samples.removeFirst() }
        case .drag:
            dnd.move(to: v.location)
        default:
            break
        }
        gesture = g
    }

    private func onEnded(_ v: DragGesture.Value, limits: (min: Double, max: Double)) {
        guard let g = gesture else { return }
        gesture = nil
        switch g.mode {
        case .undecided:
            if let e = g.entry { onTap(e) }
        case .scroll:
            if g.samples.count > 1, let a = g.samples.first, let b = g.samples.last, b.t > a.t {
                let vel = max(-0.4, min(0.4, (b.o - a.o) / (b.t - a.t)))
                decay(from: vel, limits: limits)
            }
        case .drag:
            dnd.end(at: v.location)
        case .none:
            break
        }
    }

    /// Inertia: velocity × 0.95 per 16.7 ms frame, clamped at both ends.
    private func decay(from v0: Double, limits: (min: Double, max: Double)) {
        animation?.cancel()
        var vel = v0
        animation = Task { @MainActor in
            var last = Date().timeIntervalSince1970 * 1000
            while abs(vel) > 0.0005 && !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 16_000_000)
                let now = Date().timeIntervalSince1970 * 1000
                let dt = min(50, now - last)
                last = now
                var next = offset + vel * dt
                vel *= pow(0.95, dt / 16.7)
                let c = max(limits.min, min(limits.max, next))
                if c != next { next = c; vel = 0 }
                offset = next
            }
        }
    }

    /// Glide card `index` to the front (the client's snapToEndFast when a card went into the training slot).
    func scroll(to index: Int, limits: (min: Double, max: Double)) {
        animation?.cancel()
        let target = max(limits.min, min(limits.max, SliderGeometry.offset(for: index)))
        animation = Task { @MainActor in
            var last = Date().timeIntervalSince1970 * 1000
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 16_000_000)
                let now = Date().timeIntervalSince1970 * 1000
                let dt = min(50, now - last)
                last = now
                let d = target - offset
                if abs(d) < 0.05 { offset = target; break }
                offset += d * min(1, dt * 0.012)
            }
        }
    }
}
