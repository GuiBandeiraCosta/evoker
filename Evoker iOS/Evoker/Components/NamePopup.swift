import SwiftUI
import EvokerCore

/// The name prompt of the first Arena visit (`src/ui/tutorial/name-popup.js`, `comp_name_popup`): the arena guard
/// at the left, the heralds text, an input pre-filled with the automatic "user-<digits>" name, OK and the close X.
enum NamePopup {
    /// Longest name the popup accepts (comp_name_popup: txt:sub(1, 18)).
    static let nameMax = 18

    /// `needsName`: the save has not chosen a name yet (a tutorial record that is not `named`).
    static func needsName(_ state: GameState) -> Bool {
        guard let r3 = state.tutorial.r3 else { return false }
        return !r3.named
    }

    /// `cleanPlayerName`: trimmed, single spaces, at most `nameMax` characters; "" when invalid.
    static func clean(_ raw: String) -> String {
        let parts = raw.split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\t" }).map(String.init)
        let joined = parts.joined(separator: " ")
        return String(joined.prefix(nameMax))
    }

    /// The automatic account name of a new game (`autoName`: "user-<digits>").
    static func autoName(seed: UInt32) -> String {
        "user-\(1_000_000 + Int(seed % 9_000_000))"
    }
}

/// Body of the name popup; OK closes the dialog with the typed text as the value.
struct NamePopupBody: View {
    let initial: String
    let handle: DialogHandle
    @State private var text: String = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 16) {
            HStack(alignment: .top, spacing: 16) {
                Sprite("pvpguard").frame(width: 150, height: 200)
                Text(Strings.namePrompt)
                    .font(Theme.light(24))
                    .foregroundColor(Theme.text)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            TextField(Strings.yourName, text: $text)
                .font(Theme.font(32))
                .foregroundColor(Theme.gold)
                .multilineTextAlignment(.center)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled(true)
                .focused($focused)
                .onChange(of: text) { _, v in
                    if v.count > NamePopup.nameMax { text = String(v.prefix(NamePopup.nameMax)) }
                }
                .onSubmit { handle.close(text) }
                .frame(height: 72)
                .padding(.horizontal, 18)
                .background(LinearGradient(colors: [Color(hex: 0x0b0c0d), Color(hex: 0x16181a)], startPoint: .top, endPoint: .bottom))
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.stoneEdgeDark, lineWidth: 2))
            SteelButton(Strings.ok) { handle.close(text) }
        }
        .onAppear {
            text = initial
            focused = true
        }
    }
}
