import SwiftUI
import EvokerCore

/// Countdown formats of the original (`src/ui/components/countdown.js`, `pvp-events.js formatHms`) and a text that
/// re-renders every second from the model's clock.
enum CountdownFormat {
    /// `formatCountdown`: d:hh:mm:ss ("8:20:01:39"), floored at 0.
    static func dhms(_ ms: Int64) -> String {
        let total = Int(max(0, ms) / 1000)
        let days = total / 86400
        let hours = (total % 86400) / 3600
        let minutes = (total % 3600) / 60
        let seconds = total % 60
        return "\(days):\(padNumber(hours)):\(padNumber(minutes)):\(padNumber(seconds))"
    }

    /// `formatHms`: h:mm:ss, days roll into hours.
    static func hms(_ ms: Int64) -> String {
        let total = Int(max(0, ms) / 1000)
        let hh = total / 3600
        let mm = (total % 3600) / 60
        let ss = total % 60
        return "\(hh):\(padNumber(mm)):\(padNumber(ss))"
    }
}

enum CountdownStyle {
    case dhms, hms
}

/// A ticking countdown to `endsAt` (ms epoch) in the model's clock; `onEnd` fires once when it reaches 0.
struct CountdownText: View {
    @EnvironmentObject private var model: AppModel
    @EnvironmentObject private var clock: ClockTicker
    var endsAt: Int64
    var style: CountdownStyle = .dhms
    var font: Font = Theme.num(22)
    var color: Color = Theme.text
    /// Drawn on the liga_timer_bg plate (`.countdown`).
    var plate: Bool = false
    var onEnd: (() -> Void)? = nil
    @State private var ended: Bool = false

    private func text(tick: Int) -> String {
        let left = endsAt - model.now
        return style == .dhms ? CountdownFormat.dhms(left) : CountdownFormat.hms(left)
    }

    var body: some View {
        Text(text(tick: clock.tick))
            .font(font)
            .foregroundColor(color)
            .shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 1)
            .padding(.horizontal, plate ? 12 : 0)
            .frame(minWidth: plate ? 150 : 0, minHeight: plate ? 36 : 0)
            .background(plate ? AnyView(NineSlice(Theme.Frames.ligaTimer)) : AnyView(EmptyView()))
            .onChange(of: clock.tick) { _, _ in
                if endsAt - model.now <= 0 && !ended {
                    ended = true
                    onEnd?()
                }
            }
    }
}
