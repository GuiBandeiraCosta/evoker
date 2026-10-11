import SwiftUI
import EvokerCore

/// Drag and drop of cards between deck slots (`src/ui/components/drag-drop.js`): a `DragGesture`-based coordinator
/// with a `PreferenceKey` registry of drop targets (deck slots, training / fusion zones). The dragged card is drawn
/// as a ghost tilted -6 degrees with a blue glow; the source fades; the slot under the finger highlights (blue =
/// accepted, red = refused); dropping outside / on a refused slot glides the ghost back.

/// What is being dragged (`DropInfo` minus the target).
struct DragPayload: Equatable {
    var uid: String?
    var cardId: String
    /// A card-piece hunt entry of the slider (`data-piece`).
    var pieceId: String?
    /// Slot index the card came from (nil = drawer / collection).
    var fromSlot: Int?
    /// `data-zone` of the drop zone the card came from.
    var fromZone: String?
}

/// A drop target: a deck slot index and / or a named zone (`data-slot`, `data-zone`).
struct DropTargetID: Hashable {
    var slot: Int?
    var zone: String?

    static func slot(_ i: Int) -> DropTargetID { DropTargetID(slot: i, zone: nil) }
    static func zone(_ name: String) -> DropTargetID { DropTargetID(slot: nil, zone: name) }
}

struct DropTargetsKey: PreferenceKey {
    static var defaultValue: [DropTargetID: CGRect] = [:]
    static func reduce(value: inout [DropTargetID: CGRect], nextValue: () -> [DropTargetID: CGRect]) {
        value.merge(nextValue(), uniquingKeysWith: { _, new in new })
    }
}

/// The drag in progress.
struct ActiveDrag {
    var payload: DragPayload
    var face: CardFaceModel
    /// The dragged card's layout size (the ghost keeps it).
    var size: CGSize
    /// Grab point inside the card.
    var grab: CGPoint
    /// Finger position in stage coordinates.
    var position: CGPoint
    /// Source frame (the ghost glides back there).
    var origin: CGRect
    var target: DropTargetID?
    var valid: Bool = false
    var returning: Bool = false
}

@MainActor
final class DragDropCoordinator: ObservableObject {
    @Published var active: ActiveDrag?
    @Published var targets: [DropTargetID: CGRect] = [:]
    var canDrop: ((DragPayload, DropTargetID) -> Bool)?
    var onDrop: ((DragPayload, DropTargetID) -> Void)?
    var onDropOutside: ((DragPayload) -> Void)?
    var onDropInvalid: ((DragPayload, DropTargetID) -> Void)?
    var onDragStart: ((DragPayload) -> Void)?
    var onDragEnd: ((DragPayload) -> Void)?
    var enabled: Bool = true

    var dragging: Bool { active != nil && !(active?.returning ?? false) }

    /// The drop target under a stage point.
    func targetAt(_ p: CGPoint) -> DropTargetID? {
        for (id, rect) in targets where rect.contains(p) { return id }
        return nil
    }

    func begin(payload: DragPayload, face: CardFaceModel, frame: CGRect, at point: CGPoint) {
        guard enabled, active == nil else { return }
        let grab = CGPoint(x: point.x - frame.minX, y: point.y - frame.minY)
        active = ActiveDrag(payload: payload, face: face, size: frame.size, grab: grab, position: point, origin: frame, target: nil)
        onDragStart?(payload)
    }

    func move(to point: CGPoint) {
        guard var d = active, !d.returning else { return }
        d.position = point
        let t = targetAt(point)
        if t != d.target {
            d.target = t
            if let t = t {
                d.valid = canDrop?(d.payload, t) ?? true
            } else {
                d.valid = false
            }
        }
        active = d
    }

    func end(at point: CGPoint, cancelled: Bool = false) {
        guard let d = active, !d.returning else { return }
        let target = cancelled ? nil : d.target
        let dropped = target != nil && d.valid
        if dropped, let t = target {
            active = nil
            onDrop?(d.payload, t)
        } else {
            glideBack(d)
            if !cancelled {
                if let t = target {
                    onDropInvalid?(d.payload, t)
                } else {
                    onDropOutside?(d.payload)
                }
            }
        }
        onDragEnd?(d.payload)
    }

    private func glideBack(_ d: ActiveDrag) {
        var back = d
        back.returning = true
        back.target = nil
        withAnimation(.easeOut(duration: 0.18)) {
            back.position = CGPoint(x: d.origin.minX + d.grab.x, y: d.origin.minY + d.grab.y)
            active = back
        }
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 190_000_000)
            if self?.active?.returning == true { self?.active = nil }
        }
    }

    /// Highlight of a drop target while a card hovers it.
    func highlight(_ id: DropTargetID) -> DropHighlight {
        guard let d = active, !d.returning, d.target == id else { return .none }
        return d.valid ? .valid : .invalid
    }

    /// Is this card the one being dragged (drawn faded)?
    func isSource(uid: String?, pieceId: String?) -> Bool {
        guard let d = active else { return false }
        if let uid = uid { return d.payload.uid == uid }
        if let p = pieceId { return d.payload.pieceId == p }
        return false
    }
}

/// Reads a view's frame in the stage coordinate space.
struct FrameReader: View {
    let onChange: (CGRect) -> Void

    var body: some View {
        GeometryReader { geo in
            Color.clear
                .onAppear { onChange(geo.frame(in: .named(stageCoordinateSpace))) }
                .onChange(of: geo.frame(in: .named(stageCoordinateSpace))) { _, f in onChange(f) }
        }
    }
}

/// A card that can be picked up (`draggableSelector`): a drag past 6 units starts it, a release without a drag
/// is a tap.
struct DraggableCard: ViewModifier {
    @ObservedObject var coordinator: DragDropCoordinator
    let payload: DragPayload
    let face: CardFaceModel
    var onTap: (() -> Void)?
    @State private var frame: CGRect = .zero
    @State private var started: Bool = false

    func body(content: Content) -> some View {
        content
            .background(FrameReader { f in frame = f })
            .opacity(coordinator.isSource(uid: payload.uid, pieceId: payload.pieceId) ? 0.3 : 1)
            .onTapGesture { onTap?() }
            .gesture(
                DragGesture(minimumDistance: 6, coordinateSpace: .named(stageCoordinateSpace))
                    .onChanged { v in
                        if !started {
                            started = true
                            coordinator.begin(payload: payload, face: face, frame: frame, at: v.startLocation)
                        }
                        coordinator.move(to: v.location)
                    }
                    .onEnded { v in
                        started = false
                        coordinator.end(at: v.location)
                    }
            )
    }
}

/// A drop target (`slotSelector`): publishes its frame to the coordinator.
struct DropTargetModifier: ViewModifier {
    let id: DropTargetID

    func body(content: Content) -> some View {
        content.background(GeometryReader { geo in
            Color.clear.preference(key: DropTargetsKey.self, value: [id: geo.frame(in: .named(stageCoordinateSpace))])
        })
    }
}

extension View {
    func draggableCard(_ coordinator: DragDropCoordinator, payload: DragPayload, face: CardFaceModel, onTap: (() -> Void)? = nil) -> some View {
        modifier(DraggableCard(coordinator: coordinator, payload: payload, face: face, onTap: onTap))
    }

    func dropTarget(_ id: DropTargetID) -> some View {
        modifier(DropTargetModifier(id: id))
    }

    /// Collect the drop targets of this subtree into the coordinator and draw the drag ghost over it.
    func dragDropLayer(_ coordinator: DragDropCoordinator) -> some View {
        self
            .onPreferenceChange(DropTargetsKey.self) { targets in coordinator.targets = targets }
            .overlay(DragGhostLayer(coordinator: coordinator))
    }
}

/// The ghost of the dragged card (`.drag-ghost`): tilted, glowing blue, following the finger.
struct DragGhostLayer: View {
    @ObservedObject var coordinator: DragDropCoordinator

    var body: some View {
        GeometryReader { geo in
            if let d = coordinator.active {
                let local = geo.frame(in: .named(stageCoordinateSpace))
                CardFaceView(face: d.face, size: .compact)
                    .frame(width: 120, height: 168)
                    .scaleEffect(x: d.size.width / 120, y: d.size.height / 168, anchor: .topLeading)
                    .frame(width: d.size.width, height: d.size.height, alignment: .topLeading)
                    .rotationEffect(.degrees(d.returning ? 0 : -6))
                    .scaleEffect(d.returning ? 1 : 1.05)
                    .shadow(color: Theme.mana.opacity(0.9), radius: 14)
                    .shadow(color: .black.opacity(0.8), radius: 10, x: 0, y: 8)
                    .position(x: d.position.x - d.grab.x + d.size.width / 2 - local.minX,
                              y: d.position.y - d.grab.y + d.size.height / 2 - local.minY)
                    .allowsHitTesting(false)
                    .zIndex(50)
            }
        }
        .allowsHitTesting(false)
    }
}
