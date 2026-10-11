import SwiftUI
import UIKit
import UniformTypeIdentifiers
import EvokerCore

/// Options view of the character screen (`src/ui/screens/character-settings.js`, options_def): "Options" header
/// with the version and the info button, Music / FX volume sliders, the battle speed, then sound, simulated
/// raids, reduced motion, export / import save (share sheet / Files) and reset progress (double confirm).
struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    @State private var music: Double = 70
    @State private var fx: Double = 100
    @State private var speedIndex: Double = 0
    @State private var loaded: Bool = false
    @State private var exportURL: URL? = nil
    @State private var showShare: Bool = false
    @State private var showImporter: Bool = false

    private static let speeds: [Int] = [1, 2]
    private var version: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "" }

    var body: some View {
        if let state = model.store.state {
            let st = state.settings
            VStack(spacing: 0) {
                ZStack(alignment: .topLeading) {
                    HeaderPlate(text: Strings.options, big: true, color: .white, fontSize: 34).frame(width: 674).offset(x: 12, y: 14)
                    InfoButton { Task { @MainActor in await model.dialogs.alert(title: "Evoker", message: Strings.about + (version.isEmpty ? "" : " v\(version)")) } }
                        .frame(width: 66, height: 62).offset(x: 0, y: 10)
                    if !version.isEmpty {
                        Text("v \(version)").font(Theme.font(20)).foregroundColor(Color(hex: 0xcfd3d6)).frame(width: 698, alignment: .trailing).padding(.trailing, 50).offset(y: 30)
                    }
                }
                .frame(width: 698, height: 96, alignment: .topLeading)
                .zIndex(1)
                .padding(.bottom, -40)
                optionBox(padTop: 44) {
                    sliderRow(label: Strings.musicVolume, value: $music, onCommit: { v in
                        setSettings { $0.musicVolume = SettingsView.clampVolume(v / 100) }
                    })
                    sliderRow(label: Strings.fxVolume, value: $fx, onCommit: { v in
                        setSettings { $0.fxVolume = SettingsView.clampVolume(v / 100) }
                        model.sfx("ui_button_switch")
                    })
                    VStack(spacing: 6) {
                        Text(Strings.battleSpeed).font(Theme.font(23)).foregroundColor(.white).frame(width: 362, height: 43).background(StretchedSprite("header_framer_small"))
                        Slider(value: $speedIndex, in: 0...Double(SettingsView.speeds.count - 1), step: 1, onEditingChanged: { editing in
                            if !editing {
                                let sp = SettingsView.speeds[Int(speedIndex.rounded())]
                                setSettings { $0.speed = sp }
                            }
                        })
                        .tint(Theme.steelHi)
                        .frame(width: 600)
                        HStack {
                            ForEach(Array(SettingsView.speeds.enumerated()), id: \.offset) { item in
                                Text("\(item.element)×").font(Theme.font(20)).foregroundColor(Int(speedIndex.rounded()) == item.offset ? .white : Color(hex: 0x9da3a8))
                                if item.offset < SettingsView.speeds.count - 1 { Spacer() }
                            }
                        }
                        .frame(width: 560)
                    }
                    .padding(.vertical, 4)
                }
                optionBox(padTop: 18) {
                    toggleRow(label: Strings.sound, hint: Strings.soundHint, value: st.sound) { v in setSettings { $0.sound = v } }
                    toggleRow(label: Strings.simulatedRaids, hint: Strings.raidsHint, value: st.raids) { v in setSettings { $0.raids = v } }
                    toggleRow(label: Strings.reducedMotion, hint: Strings.reducedMotionHint, value: st.reducedMotion) { v in setSettings { $0.reducedMotion = v } }
                    StretchedSprite("seperator_thin").frame(height: 4).padding(.vertical, 6)
                    HStack(spacing: 4) {
                        SteelButton(Strings.exportSave, size: .sm) { exportSave() }
                        SteelButton(Strings.importSave, size: .sm) { model.sfx("ui_button_circular"); showImporter = true }
                        SteelButton(Strings.resetProgress, variant: .red, size: .sm) { Task { @MainActor in await resetProgress() } }
                    }
                    .padding(.top, 2)
                    SteelButton(Strings.cardLab, size: .sm) { model.sfx("ui_button_circular"); model.router.go(.lab) }
                        .padding(.top, 4)
                }
                .padding(.top, 10)
            }
            .onAppear {
                if !loaded {
                    loaded = true
                    music = (SettingsView.clampVolume(st.musicVolume) * 100).rounded()
                    fx = (SettingsView.clampVolume(st.fxVolume) * 100).rounded()
                    speedIndex = Double(SettingsView.speeds.firstIndex(of: st.speed) ?? 0)
                }
            }
            .sheet(isPresented: $showShare) {
                if let url = exportURL { ShareSheet(items: [url]) }
            }
            .fileImporter(isPresented: $showImporter, allowedContentTypes: [UTType.json, UTType.plainText], allowsMultipleSelection: false) { result in
                if case .success(let urls) = result, let url = urls.first {
                    Task { @MainActor in await importSave(from: url) }
                }
            }
        }
    }

    /// `clampVolume`: 0..1 with two decimals.
    static func clampVolume(_ v: Double) -> Double {
        guard v.isFinite else { return 0 }
        return (max(0, min(1, v)) * 100).rounded() / 100
    }

    private func setSettings(_ change: (inout Settings) -> Void) {
        model.updateState(toastOnError: false) { s, _, _ in
            var next = s
            change(&next.settings)
            return next
        }
        if let st = model.store.state?.settings { model.audio.apply(st) }
    }

    private func optionBox<Content: View>(padTop: CGFloat, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 10) { content() }
            .padding(.top, padTop).padding(.horizontal, 26).padding(.bottom, 22)
            .frame(width: 698)
            .background(Color(hex: 0x191919, alpha: 0.78))
            .overlay(NineSlice(Theme.Frames.hudNineframe))
    }

    /// Volume slider row (the label on header_framer_small, 0-100).
    private func sliderRow(label: String, value: Binding<Double>, onCommit: @escaping (Double) -> Void) -> some View {
        VStack(spacing: 6) {
            HStack(spacing: 12) {
                Text(label).font(Theme.font(23)).foregroundColor(.white)
                Text("\(Int(value.wrappedValue.rounded()))").font(Theme.num(19)).foregroundColor(Color(hex: 0xc9cfd3))
            }
            .frame(width: 362, height: 43)
            .background(StretchedSprite("header_framer_small"))
            Slider(value: value, in: 0...100, step: 1, onEditingChanged: { editing in
                if !editing { onCommit(value.wrappedValue) }
            })
            .tint(Theme.steelHi)
            .frame(width: 600)
        }
        .padding(.vertical, 4)
    }

    /// On/Off toggle row.
    private func toggleRow(label: String, hint: String, value: Bool, onChange: @escaping (Bool) -> Void) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(Theme.font(24)).foregroundColor(Theme.text)
                Text(hint).font(Theme.light(16)).foregroundColor(Theme.muted)
            }
            Spacer()
            Button(action: { model.sfx("ui_button_switch"); onChange(!value) }) {
                ZStack(alignment: value ? .trailing : .leading) {
                    Capsule().fill(value ? LinearGradient(colors: [Color(hex: 0x2d7a24), Color(hex: 0x5fbf4a)], startPoint: .top, endPoint: .bottom) : LinearGradient(colors: [Color(hex: 0x2a2e31), Color(hex: 0x3a3f44)], startPoint: .top, endPoint: .bottom))
                        .overlay(Capsule().stroke(Theme.stoneEdgeDark, lineWidth: 2))
                    Text(value ? "On" : "Off").font(Theme.font(20)).foregroundColor(value ? .white : Theme.muted).padding(.horizontal, 16)
                    Sprite("slider_button").frame(width: 38, height: 38).offset(x: value ? -4 : 4)
                        .frame(maxWidth: .infinity, alignment: value ? .trailing : .leading)
                }
                .frame(width: 124, height: 50)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .animation(.easeInOut(duration: Theme.medium), value: value)
        }
        .padding(.vertical, 6).padding(.horizontal, 4)
        .frame(minHeight: 62)
    }

    // MARK: Export / import / reset

    private func exportSave() {
        model.sfx("ui_button_circular")
        do {
            let data = try model.store.exportJSON()
            let name = "evoker-save-\(JSDate.utcDay(model.now)).json"
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
            try data.write(to: url, options: .atomic)
            exportURL = url
            showShare = true
            model.toast(Strings.saveExported, icon: "icon_deckedit_active")
        } catch {
            model.toast(model.errorText(error))
        }
    }

    private func importSave(from url: URL) async {
        let secured = url.startAccessingSecurityScopedResource()
        defer { if secured { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else {
            await model.dialogs.alert(title: Strings.importFailed, message: "The file could not be read.")
            return
        }
        guard let json = try? JSONValue.parse(data), case .object(let o) = json else {
            await model.dialogs.alert(title: Strings.importFailed, message: "The file is not valid JSON.")
            return
        }
        guard let version = o["version"]?.intValue, version >= 1 else {
            await model.dialogs.alert(title: Strings.importFailed, message: "The save file has no version number.")
            return
        }
        if version > GameState.saveVersion {
            await model.dialogs.alert(title: Strings.importFailed, message: "The save file is from a newer version (\(version)).")
            return
        }
        guard let player = o["player"]?.objectValue, let level = player["level"]?.intValue, level >= 1, player["name"]?.stringValue != nil,
              let cards = o["cards"]?.arrayValue else {
            await model.dialogs.alert(title: Strings.importFailed, message: "Not an Evoker save file.")
            return
        }
        let name = player["name"]?.stringValue ?? "Evoker"
        let ok = await model.dialogs.confirm(title: Strings.importSave, message: "Replace your current progress with \"\(name.isEmpty ? "Evoker" : name)\" (level \(level), \(cards.count) cards)? This cannot be undone.", okLabel: "Import", danger: true)
        if !ok { return }
        do {
            _ = try model.store.importJSON(data)
            model.toast(Strings.saveImported, icon: "icon_deckedit_active")
            model.router.goTop(route: .character(tab: .profile))
        } catch {
            await model.dialogs.alert(title: Strings.importFailed, message: model.errorText(error))
        }
    }

    private func resetProgress() async {
        model.sfx("ui_button_circular")
        let first = await model.dialogs.confirm(title: Strings.resetProgress, message: Strings.resetMessage, okLabel: Strings.reset, danger: true)
        if !first { return }
        let second = await model.dialogs.confirm(title: Strings.areYouSure, message: Strings.resetMessage2, okLabel: Strings.yesReset, danger: true)
        if !second { return }
        model.resetProgress()
    }
}

/// UIActivityViewController for the exported save file.
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
