import SwiftUI
import EvokerCore

/// Modal dialogs on the original popup sprites (`src/ui/components/dialog.js`): popup_bg plate, popup_header_grey
/// title, the close button at the top-right corner. `DialogCenter.open` returns the pressed button's value
/// asynchronously (nil when closed with X / the backdrop); presets: confirm, alert, drinkPotion.

enum ButtonVariant {
    case steel, green, red, grey
}

enum ButtonSize {
    case sm, md, lg
}

struct DialogButton: Identifiable {
    let id = UUID()
    var label: String
    var value: String
    var variant: ButtonVariant = .steel
    var disabled: Bool = false
    /// A custom label (price with gem icon …) drawn instead of `label`.
    var content: AnyView? = nil

    init(_ label: String, value: String, variant: ButtonVariant = .steel, disabled: Bool = false, content: AnyView? = nil) {
        self.label = label
        self.value = value
        self.variant = variant
        self.disabled = disabled
        self.content = content
    }
}

/// Closes the dialog it was handed to (custom bodies with their own buttons).
@MainActor
final class DialogHandle {
    let id: UUID
    private weak var center: DialogCenter?
    init(id: UUID, center: DialogCenter) {
        self.id = id
        self.center = center
    }
    func close(_ value: String?) {
        center?.resolve(id: id, value: value)
    }
}

struct DialogRequest: Identifiable {
    let id = UUID()
    var title: String? = nil
    var titleOrange: Bool = true
    var message: String? = nil
    var body: ((DialogHandle) -> AnyView)? = nil
    var buttons: [DialogButton] = []
    var closable: Bool = true
    var width: CGFloat = 620
    /// Title plate drawn on ornament_top (the league popups) in a tier colour.
    var ornamentTitle: Bool = false
    var continuation: CheckedContinuation<String?, Never>? = nil
}

/// The dialog stack (`dialog.js openDialogs`); the top one is shown by `DialogLayer`.
@MainActor
final class DialogCenter: ObservableObject {
    @Published private(set) var stack: [DialogRequest] = []

    var isOpen: Bool { !stack.isEmpty }
    var top: DialogRequest? { stack.last }

    /// Open a dialog and wait for its answer: a button value, or nil for X / backdrop / `dismissAll`.
    func open(_ request: DialogRequest) async -> String? {
        await withCheckedContinuation { (c: CheckedContinuation<String?, Never>) in
            var r = request
            r.continuation = c
            stack.append(r)
        }
    }

    func resolve(id: UUID, value: String?) {
        guard let i = stack.firstIndex(where: { $0.id == id }) else { return }
        let req = stack.remove(at: i)
        req.continuation?.resume(returning: value)
    }

    /// Remove every open dialog at once (navigation): their callers get nil.
    func dismissAll() {
        let all = stack
        stack = []
        for r in all { r.continuation?.resume(returning: nil) }
    }

    /// Yes/No confirmation (`dialog.confirm`).
    func confirm(title: String = Strings.confirm, message: String, okLabel: String = Strings.ok, cancelLabel: String = Strings.cancel, danger: Bool = false) async -> Bool {
        var r = DialogRequest()
        r.title = title
        r.message = message
        r.buttons = [
            DialogButton(cancelLabel, value: "cancel", variant: .grey),
            DialogButton(okLabel, value: "ok", variant: danger ? .red : .steel),
        ]
        return await open(r) == "ok"
    }

    /// Simple message with one button (`dialog.alert`).
    func alert(title: String? = nil, message: String, okLabel: String = Strings.ok) async {
        var r = DialogRequest()
        r.title = title
        r.message = message
        r.buttons = [DialogButton(okLabel, value: "ok")]
        _ = await open(r)
    }

    /// The "Drink potion" dialog (`dialog.drinkPotion`): resolves "use" | "buy" | nil.
    func drinkPotion(kind: PotionKind, count: Int, gemPrice: Int, gems: Int) async -> String? {
        var r = DialogRequest()
        r.title = Strings.drinkPotion
        r.width = 620
        r.body = { handle in
            AnyView(DrinkPotionBody(kind: kind, count: max(0, count), price: gemPrice, canBuy: gems >= gemPrice, handle: handle))
        }
        return await open(r)
    }
}

/// Body of the Drink-potion dialog: potion column (sprite + "n potions" plate), message column with the action.
private struct DrinkPotionBody: View {
    let kind: PotionKind
    let count: Int
    let price: Int
    let canBuy: Bool
    let handle: DialogHandle

    private var label: String { kind == .mana ? Strings.manaLabel : Strings.staminaLabel }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 16) {
                Sprite(kind == .mana ? "potion_mana1" : "potion_stamina1")
                    .frame(width: 150, height: 170)
                    .shadow(color: (kind == .mana ? Theme.mana : Theme.stamina).opacity(0.55), radius: 18)
                Plate {
                    Text(Strings.potionsCount(count))
                        .font(Theme.font(30))
                        .foregroundColor(Theme.orange)
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 18)
            .padding(.horizontal, 12)
            .background(Color(hex: 0x0c0d0e, alpha: 0.55))
            .overlay(NineSlice(Theme.Frames.smallWhite))

            VStack(spacing: 16) {
                Text(count > 0 ? Strings.potionLowUse(label) : Strings.potionLowBuy(label, price: price))
                    .font(Theme.font(27))
                    .foregroundColor(Theme.text)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                Spacer(minLength: 0)
                if count > 0 {
                    SteelButton(Strings.usePotionNow, size: .md, fullWidth: true) { handle.close("use") }
                } else {
                    SteelButton(variant: .green, size: .md, fullWidth: true, disabled: !canBuy, action: { handle.close("buy") }) {
                        HStack(spacing: 6) {
                            Text(Strings.buyFor(price)).font(Theme.font(24))
                            Sprite("hud_gemiconsingle").frame(width: 26, height: 26)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 18)
            .padding(.horizontal, 12)
            .background(Color(hex: 0x0c0d0e, alpha: 0.55))
            .overlay(NineSlice(Theme.Frames.smallWhite))
        }
    }
}

/// Draws the top dialog of a `DialogCenter` over the stage.
struct DialogLayer: View {
    @ObservedObject var center: DialogCenter

    var body: some View {
        if let req = center.top {
            DialogView(request: req, handle: DialogHandle(id: req.id, center: center))
                .id(req.id)
                .transition(.opacity)
        }
    }
}

/// One dialog: backdrop, popup_bg plate, title plate, message / body, buttons, close X.
struct DialogView: View {
    let request: DialogRequest
    let handle: DialogHandle
    @State private var shown: Bool = false

    var body: some View {
        ZStack {
            Color.black.opacity(0.62)
                .contentShape(Rectangle())
                .onTapGesture { if request.closable { handle.close(nil) } }
            VStack(spacing: 14) {
                if let title = request.title {
                    if request.ornamentTitle {
                        Text(title)
                            .font(Theme.font(46))
                            .foregroundColor(Theme.text)
                            .shadow(color: .black, radius: 0, x: 3, y: 3)
                            .padding(.vertical, 14)
                            .frame(maxWidth: .infinity)
                            .background(NineSlice(Theme.Frames.ornamentTop))
                    } else {
                        Text(title)
                            .font(Theme.font(34))
                            .foregroundColor(request.titleOrange ? Theme.orange : Theme.text)
                            .shadow(color: .black.opacity(0.8), radius: 1, x: 0, y: 2)
                            .padding(.vertical, 6)
                            .padding(.horizontal, 10)
                            .frame(maxWidth: .infinity)
                            .background(NineSlice(Theme.Frames.popupHeader))
                    }
                }
                if let message = request.message {
                    Text(message)
                        .font(Theme.font(26))
                        .foregroundColor(Theme.text)
                        .multilineTextAlignment(.center)
                        .lineSpacing(4)
                        .padding(.vertical, 10)
                        .padding(.horizontal, 12)
                }
                if let body = request.body {
                    body(handle)
                }
                if !request.buttons.isEmpty {
                    HStack(spacing: 14) {
                        ForEach(request.buttons) { b in
                            if let content = b.content {
                                SteelButton(variant: b.variant, size: .md, disabled: b.disabled, action: { handle.close(b.value) }) { content }
                            } else {
                                SteelButton(b.label, variant: b.variant, disabled: b.disabled) { handle.close(b.value) }
                            }
                        }
                    }
                }
            }
            .padding(.top, 14)
            .padding(.horizontal, 12)
            .padding(.bottom, 12)
            .frame(width: request.width)
            .background(NineSlice(Theme.Frames.popupBg).padding(-18))
            .shadow(color: .black.opacity(0.85), radius: 20, x: 0, y: 12)
            .overlay(alignment: .topTrailing) {
                if request.closable {
                    Button(action: { handle.close(nil) }) {
                        ZStack {
                            NineSlice(Theme.Frames.buttonDefault)
                            Sprite("close_icon").frame(width: 32, height: 32)
                        }
                        .frame(width: 70, height: 70)
                    }
                    .buttonStyle(.plain)
                    .offset(x: 44, y: -46)
                }
            }
            .scaleEffect(shown ? 1 : 0.9)
            .opacity(shown ? 1 : 0)
        }
        .onAppear {
            withAnimation(.easeOut(duration: Theme.medium)) { shown = true }
        }
    }
}
