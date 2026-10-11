import SwiftUI
import EvokerCore

/// Toast notifications on the small_white plate (`src/ui/components/toast.js`), stacked under the HUD.
struct ToastItem: Identifiable {
    let id = UUID()
    var text: String
    /// Sprite stem drawn before the text (nil = none).
    var icon: String?
    var daily: Bool = false
    var shownAt: Date = Date()
}

@MainActor
final class ToastCenter: ObservableObject {
    @Published private(set) var toasts: [ToastItem] = []

    /// Show a toast for `duration` seconds (toast.js: 2.2 s by default).
    func show(_ text: String, icon: String? = nil, duration: Double = 2.2, daily: Bool = false) {
        if daily {
            // one daily-reward toast at a time (app.js showNotices)
            toasts.removeAll { $0.daily }
        }
        let item = ToastItem(text: text, icon: icon, daily: daily)
        toasts.append(item)
        let id = item.id
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(max(0.1, duration) * 1_000_000_000))
            self?.dismiss(id)
        }
    }

    func dismiss(_ id: UUID) {
        withAnimation(.easeOut(duration: Theme.medium)) {
            toasts.removeAll { $0.id == id }
        }
    }

    /// Remove visible toasts; those shown more recently than `olderThanMs` survive (a screen change).
    func clear(olderThanMs: Double = 0) {
        let now = Date()
        toasts.removeAll { now.timeIntervalSince($0.shownAt) * 1000 >= olderThanMs }
    }
}

/// Draws the toasts of a `ToastCenter` (top 240 px of the stage, under the HUD and the portal banner).
struct ToastLayer: View {
    @ObservedObject var center: ToastCenter
    @Environment(\.stage) private var stage

    var body: some View {
        VStack(spacing: 10) {
            ForEach(center.toasts) { t in
                ToastView(item: t)
                    .transition(.asymmetric(insertion: .move(edge: .top).combined(with: .opacity), removal: .opacity))
            }
            Spacer(minLength: 0)
        }
        .padding(.top, 240 + stage.safeTop)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .allowsHitTesting(false)
        .animation(.easeOut(duration: Theme.medium), value: center.toasts.count)
    }
}

struct ToastView: View {
    let item: ToastItem

    var body: some View {
        HStack(spacing: 12) {
            if let icon = item.icon {
                Sprite(icon).frame(width: 36, height: 36)
            }
            Text(item.text)
                .font(Theme.font(24))
                .foregroundColor(Theme.tan)
                .multilineTextAlignment(.center)
                .shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 1)
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 18)
        .frame(maxWidth: 560)
        .background(Color(hex: 0x0e0f10, alpha: 0.94))
        .overlay(NineSlice(Theme.Frames.smallWhite))
        .shadow(color: .black.opacity(0.8), radius: 6, x: 0, y: 4)
    }
}
