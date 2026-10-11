import SwiftUI
import UniformTypeIdentifiers
import EvokerCore

/// Export / import / reset of the save for the settings screen (`Evoker Web/src/ui/screens/character-settings.js`
/// exportSave / importSave / resetProgress): small views the menus package drops in. Each takes the store and a
/// label; the `Text` conveniences use the web's button titles. The dialogs are system alerts with the web's
/// wording; a screen that wants the client's popup look can rebuild the flow on `SaveTransfer.readImportFile`,
/// `SaveFile` and `GameStore.importJSON` / `reset`.

// MARK: - Export

/// The save as a shareable file (`exportSave`): the pretty JSON is written to a temporary folder as
/// `evoker-save-<date>.json` when the share sheet asks for it.
struct SaveExportItem: Transferable {
    let state: GameState
    let fileName: String

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .json) { (item: SaveExportItem) in
            let url = try item.writeTemporaryFile()
            return SentTransferredFile(url)
        }
    }

    /// Writes `<tmp>/EvokerSaveExport/<fileName>` and returns its URL.
    func writeTemporaryFile() throws -> URL {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("EvokerSaveExport", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: nil)
        let url = folder.appendingPathComponent(fileName, isDirectory: false)
        try SaveFile.exportData(state).write(to: url, options: [.atomic])
        return url
    }
}

/// "Export save" (web: a download of `evoker-save-<date>.json`): a `ShareLink` that hands the save to the share
/// sheet (Save to Files, AirDrop, Mail ...). Dimmed and inert while there is no save.
@MainActor
struct ExportSaveLink<Label: View>: View {
    @ObservedObject var store: GameStore
    private let label: () -> Label

    init(store: GameStore, @ViewBuilder label: @escaping () -> Label) {
        self._store = ObservedObject(wrappedValue: store)
        self.label = label
    }

    var body: some View {
        if let state = store.state {
            shareLink(state)
        } else {
            label().opacity(0.5)
        }
    }

    private func shareLink(_ state: GameState) -> some View {
        let name = SaveFile.fileName(now: store.now)
        return ShareLink(item: SaveExportItem(state: state, fileName: name), preview: SharePreview(name)) {
            label()
        }
    }
}

extension ExportSaveLink where Label == Text {
    init(store: GameStore, title: String = "Export save") {
        self.init(store: store) { Text(title) }
    }
}

// MARK: - Import

enum SaveTransfer {
    /// A picked file that passed the web's validation.
    struct ReadFile {
        let data: Data
        let summary: SaveFile.Summary
    }

    /// Read a file picked with `.fileImporter` (security-scoped, coordinated) and validate it like the web's
    /// `parseSaveFile`; the error carries the web's message.
    static func readImportFile(_ url: URL) -> Result<ReadFile, SaveImportError> {
        let scoped = url.startAccessingSecurityScopedResource()
        defer {
            if scoped { url.stopAccessingSecurityScopedResource() }
        }
        var data: Data? = nil
        var coordinationError: NSError? = nil
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { readURL in
            data = try? Data(contentsOf: readURL)
        }
        guard let bytes = data else {
            return .failure(SaveImportError("The file could not be read."))
        }
        switch SaveFile.parse(bytes) {
        case .failure(let error):
            return .failure(error)
        case .success(let summary):
            return .success(ReadFile(data: bytes, summary: summary))
        }
    }
}

/// "Import save" (web `importSave`): a document picker for a `.json` file, the web's validation and messages
/// ("Import failed"), the confirmation that names the save ("Replace your current progress with ...?"), then
/// `store.importJSON`. `onImported` receives the open notices (the web then toasts "Save imported" and goes to
/// the character screen).
@MainActor
struct ImportSaveButton<Label: View>: View {
    @ObservedObject var store: GameStore
    private let onImported: (OnOpenResult) -> Void
    private let label: () -> Label

    @State private var showPicker: Bool = false
    @State private var pending: SaveTransfer.ReadFile? = nil
    @State private var errorMessage: String = ""
    @State private var showError: Bool = false

    init(store: GameStore, onImported: @escaping (OnOpenResult) -> Void, @ViewBuilder label: @escaping () -> Label) {
        self._store = ObservedObject(wrappedValue: store)
        self.onImported = onImported
        self.label = label
    }

    var body: some View {
        Button(action: { showPicker = true }) {
            label()
        }
        .fileImporter(isPresented: $showPicker, allowedContentTypes: [.json]) { result in
            handle(result)
        }
        .alert("Import save", isPresented: confirmBinding, presenting: pending) { file in
            Button("Import", role: .destructive) { perform(file) }
            Button("Cancel", role: .cancel) { }
        } message: { file in
            Text("Replace your current progress with \"\(file.summary.name)\" (level \(file.summary.level), \(file.summary.cards) cards)? This cannot be undone.")
        }
        .alert("Import failed", isPresented: $showError) {
            Button("OK", role: .cancel) { }
        } message: {
            Text(errorMessage)
        }
    }

    private var confirmBinding: Binding<Bool> {
        Binding(
            get: { pending != nil },
            set: { shown in
                if !shown { pending = nil }
            }
        )
    }

    private func handle(_ result: Result<URL, Error>) {
        switch result {
        case .failure(let error):
            fail(error.localizedDescription)
        case .success(let url):
            switch SaveTransfer.readImportFile(url) {
            case .failure(let error):
                fail(error.message)
            case .success(let file):
                pending = file
            }
        }
    }

    private func perform(_ file: SaveTransfer.ReadFile) {
        do {
            let result = try store.importJSON(file.data)
            onImported(result)
        } catch let error as SaveImportError {
            fail(error.message)
        } catch {
            fail(error.localizedDescription)
        }
    }

    private func fail(_ message: String) {
        errorMessage = message
        showError = true
    }
}

extension ImportSaveButton where Label == Text {
    init(store: GameStore, title: String = "Import save", onImported: @escaping (OnOpenResult) -> Void) {
        self.init(store: store, onImported: onImported) { Text(title) }
    }
}

// MARK: - Reset

/// "Reset progress" (web `resetProgress`): the two confirmations with the web's wording, then `store.reset()`
/// (the save file is deleted, `state` is nil and the title screen asks for a new name). `onReset` runs after.
@MainActor
struct ResetProgressButton<Label: View>: View {
    @ObservedObject var store: GameStore
    private let onReset: () -> Void
    private let label: () -> Label

    @State private var askFirst: Bool = false
    @State private var askSecond: Bool = false

    init(store: GameStore, onReset: @escaping () -> Void, @ViewBuilder label: @escaping () -> Label) {
        self._store = ObservedObject(wrappedValue: store)
        self.onReset = onReset
        self.label = label
    }

    var body: some View {
        Button(action: { askFirst = true }) {
            label()
        }
        .disabled(store.state == nil)
        .alert("Reset progress", isPresented: $askFirst) {
            Button("Reset", role: .destructive) {
                // the second alert must wait for the first one to go away
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 350_000_000)
                    askSecond = true
                }
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("Delete your whole progress and start over? All cards, gold and gems will be lost.")
        }
        .alert("Are you sure?", isPresented: $askSecond) {
            Button("Yes, reset", role: .destructive) {
                store.reset()
                onReset()
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This really cannot be undone. Reset everything now?")
        }
    }
}

extension ResetProgressButton where Label == Text {
    init(store: GameStore, title: String = "Reset progress", onReset: @escaping () -> Void) {
        self.init(store: store, onReset: onReset) { Text(title) }
    }
}

// MARK: - All three

/// The save row of the web's Options box (Export save, Import save, Reset progress) with text labels, for a
/// quick drop-in; the menus package styles its own buttons with the generic views above.
@MainActor
struct SaveTransferButtons: View {
    @ObservedObject var store: GameStore
    let onImported: (OnOpenResult) -> Void
    let onReset: () -> Void

    init(store: GameStore, onImported: @escaping (OnOpenResult) -> Void, onReset: @escaping () -> Void) {
        self._store = ObservedObject(wrappedValue: store)
        self.onImported = onImported
        self.onReset = onReset
    }

    var body: some View {
        HStack(spacing: 12) {
            ExportSaveLink(store: store)
            ImportSaveButton(store: store, onImported: onImported)
            ResetProgressButton(store: store, onReset: onReset)
        }
    }
}
