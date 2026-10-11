import Foundation
import EvokerCore

/// The save on disk (`Evoker Web/src/app.js readSave / writeSave`, which used `localStorage['evoker.save.v1']`):
/// one JSON file in the web's format under Application Support, written atomically, the previous file kept as a
/// `.bak` copy, a file that no longer parses kept aside as `.corrupt.json`. Created on demand; nothing here
/// excludes the folder from backups (the save is small and worth backing up).
///
/// Layout (inside the app sandbox):
/// ```
/// Library/Application Support/Evoker/evoker.save.v1.json          the save (SaveCodec.serialize: sorted keys, lastSeen touched)
/// Library/Application Support/Evoker/evoker.save.v1.json.bak      the save before the last write
/// Library/Application Support/Evoker/evoker.save.v1.corrupt.json  the last primary file that failed to load
/// ```
final class FileSaveStore: SaveStore {
    static let folderName = "Evoker"
    /// `GameState.saveKey` + ".json".
    static let fileName = GameState.saveKey + ".json"
    static let backupName = GameState.saveKey + ".json.bak"
    static let corruptName = GameState.saveKey + ".corrupt.json"

    let directory: URL
    let fileURL: URL
    let backupURL: URL
    let corruptURL: URL

    private let fileManager = FileManager.default

    /// `<Application Support>/Evoker/` of the current user (the temporary directory when the former is unknown).
    static func defaultDirectory() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent(folderName, isDirectory: true)
    }

    /// A store over `directory` (default: `defaultDirectory()`); tests and previews pass a scratch folder.
    init(directory: URL = FileSaveStore.defaultDirectory()) {
        self.directory = directory
        self.fileURL = directory.appendingPathComponent(FileSaveStore.fileName, isDirectory: false)
        self.backupURL = directory.appendingPathComponent(FileSaveStore.backupName, isDirectory: false)
        self.corruptURL = directory.appendingPathComponent(FileSaveStore.corruptName, isDirectory: false)
    }

    // MARK: SaveStore

    /// A save (or its backup) is on disk.
    var exists: Bool {
        return fileManager.fileExists(atPath: fileURL.path) || fileManager.fileExists(atPath: backupURL.path)
    }

    /// `parseSave(localStorage.getItem(SAVE_KEY), now)`: the migrated save, the `.bak` when the primary file is
    /// missing or does not parse, nil when neither does (the primary file is kept as `.corrupt.json` then).
    func load(now: Int64) throws -> GameState? {
        if let state = read(fileURL, now: now) {
            return state
        }
        if fileManager.fileExists(atPath: fileURL.path) {
            keepCorruptCopy()
        }
        if let state = read(backupURL, now: now) {
            return state
        }
        return nil
    }

    /// `writeSave(state)`: `SaveCodec.serialize` (touches `lastSeen`), the previous file copied to `.bak`, then an
    /// atomic write (a crash mid-write leaves the old file in place).
    func save(_ state: GameState, now: Int64) throws {
        let data = try SaveCodec.serialize(state, now: now)
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true, attributes: nil)
        if fileManager.fileExists(atPath: fileURL.path) {
            if fileManager.fileExists(atPath: backupURL.path) {
                _ = try? fileManager.removeItem(at: backupURL)
            }
            _ = try? fileManager.copyItem(at: fileURL, to: backupURL)
        }
        try data.write(to: fileURL, options: [.atomic])
    }

    /// `localStorage.removeItem(SAVE_KEY)`: removes the save and its backup (the corrupt copy stays for forensics).
    func delete() throws {
        for url in [fileURL, backupURL] where fileManager.fileExists(atPath: url.path) {
            try fileManager.removeItem(at: url)
        }
    }

    // MARK: Internals

    /// The parsed file, or nil when it is missing, empty, not a save or fails to decode (`parseSave` returns null).
    private func read(_ url: URL, now: Int64) -> GameState? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? SaveCodec.parse(data, now: now)
    }

    private func keepCorruptCopy() {
        if fileManager.fileExists(atPath: corruptURL.path) {
            _ = try? fileManager.removeItem(at: corruptURL)
        }
        _ = try? fileManager.copyItem(at: fileURL, to: corruptURL)
    }
}
