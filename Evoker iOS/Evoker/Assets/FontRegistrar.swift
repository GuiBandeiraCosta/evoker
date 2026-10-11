import Foundation
import UIKit
import CoreText
import SwiftUI

/// Registers the client's typefaces (css/fonts.css: Proxima Nova Light / Semibold, CG Times Bold, Roboto Bold)
/// from `GameAssets/fonts` for the process and resolves their PostScript names (`AssetCatalog.fontName`). The
/// names are read from the font files (CGFont) after registration rather than hard-coded; a file CoreText rejects
/// falls back to the manifest's alternate file, then to a system font. Call `registerAll()` once at launch
/// (`AppModel.live()`); every accessor registers lazily anyway.
final class FontRegistrar {
    static let shared = FontRegistrar()

    /// System fonts used when a client font could not be registered.
    static let fallbackNames: [FontRole: String] = [
        .standard: "HelveticaNeue-Light",
        .bold: "HelveticaNeue-Medium",
        .thin: "TimesNewRomanPS-BoldMT",
        .googleBold: "HelveticaNeue-Bold",
    ]

    private var names: [FontRole: String] = [:]
    private var done = false
    private let lock = NSLock()

    /// Registers the font of every role once (idempotent, thread-safe) and returns the PostScript names that worked.
    @discardableResult
    func registerAll(catalog: BundleAssetCatalog = .shared) -> [FontRole: String] {
        lock.lock()
        defer { lock.unlock() }
        if done { return names }
        done = true
        for role in FontRole.allCases {
            for url in catalog.fontURLs(role) {
                if let name = register(url: url) {
                    names[role] = name
                    break
                }
            }
            if names[role] == nil {
                NSLog("FontRegistrar: no font registered for role %@ (using %@)", role.rawValue, FontRegistrar.fallbackNames[role] ?? "system")
            }
        }
        return names
    }

    /// The registered PostScript name of a role, nil when its font failed to register.
    func postScriptName(for role: FontRole) -> String? {
        registerAll()
        lock.lock()
        defer { lock.unlock() }
        return names[role]
    }

    /// The name to hand to `UIFont(name:)` / `Font.custom`: the registered font, else the system fallback.
    func fontName(for role: FontRole, catalog: BundleAssetCatalog) -> String {
        registerAll(catalog: catalog)
        lock.lock()
        defer { lock.unlock() }
        return names[role] ?? FontRegistrar.fallbackNames[role] ?? "HelveticaNeue"
    }

    /// Registers one font file for the process and returns its PostScript name; nil when CoreText rejects the file
    /// or UIKit cannot find the registered name afterwards.
    private func register(url: URL) -> String? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        var error: Unmanaged<CFError>?
        let registered = CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error)
        if !registered {
            var code = 0
            if let err = error?.takeRetainedValue() { code = CFErrorGetCode(err) }
            let alreadyThere = code == CTFontManagerError.alreadyRegistered.rawValue || code == CTFontManagerError.duplicatedName.rawValue
            if !alreadyThere {
                NSLog("FontRegistrar: %@ rejected by CTFontManager (error %ld)", url.lastPathComponent, code)
                return nil
            }
        }
        guard let name = FontRegistrar.postScriptName(ofFontAt: url) else {
            NSLog("FontRegistrar: cannot read the PostScript name of %@", url.lastPathComponent)
            return nil
        }
        guard UIFont(name: name, size: 12) != nil else {
            NSLog("FontRegistrar: %@ registered but UIFont cannot find %@", url.lastPathComponent, name)
            return nil
        }
        return name
    }

    /// The PostScript name stored in a font file: through CGFont, then through the CoreText descriptors.
    static func postScriptName(ofFontAt url: URL) -> String? {
        if let provider = CGDataProvider(url: url as CFURL), let font = CGFont(provider), let name = font.postScriptName {
            return name as String
        }
        if let array = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL), CFArrayGetCount(array) > 0 {
            let descriptor = unsafeBitCast(CFArrayGetValueAtIndex(array, 0), to: CTFontDescriptor.self)
            if let name = CTFontDescriptorCopyAttribute(descriptor, kCTFontNameAttribute) as? String {
                return name
            }
        }
        return nil
    }
}

extension FontRole {
    /// The system weight that stands in for the client cut (tokens.css: 300 light, 600 semibold, titles bold).
    var systemWeight: Font.Weight {
        switch self {
        case .standard: return .light
        case .bold: return .semibold
        case .thin: return .bold
        case .googleBold: return .bold
        }
    }

    var uiWeight: UIFont.Weight {
        switch self {
        case .standard: return .light
        case .bold: return .semibold
        case .thin: return .bold
        case .googleBold: return .bold
        }
    }
}

extension Font {
    /// A client font at a fixed size (`--font-ui` / `--font-title` of tokens.css); the system font when the file
    /// could not be registered (serif for the ornamental CG Times titles).
    static func evoker(_ role: FontRole, size: CGFloat) -> Font {
        if let name = FontRegistrar.shared.postScriptName(for: role) {
            return Font.custom(name, fixedSize: size)
        }
        return Font.system(size: size, weight: role.systemWeight, design: role == .thin ? .serif : .default)
    }
}

extension UIFont {
    /// The UIKit / SpriteKit counterpart of `Font.evoker` (SKLabelNode.fontName wants the PostScript name).
    static func evoker(_ role: FontRole, size: CGFloat) -> UIFont {
        if let name = FontRegistrar.shared.postScriptName(for: role), let font = UIFont(name: name, size: size) {
            return font
        }
        if role == .thin, let serif = UIFont.systemFont(ofSize: size, weight: .bold).fontDescriptor.withDesign(.serif) {
            return UIFont(descriptor: serif, size: size)
        }
        return UIFont.systemFont(ofSize: size, weight: role.uiWeight)
    }
}
