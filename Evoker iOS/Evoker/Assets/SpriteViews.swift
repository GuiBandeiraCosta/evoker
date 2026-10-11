import SwiftUI
import UIKit
import SpriteKit
import EvokerCore

/// The asset catalog of the view hierarchy (`@Environment(\.assets)`), the bundle catalog by default.
struct AssetCatalogKey: EnvironmentKey {
    static let defaultValue: AssetCatalog = BundleAssetCatalog.shared
}

extension EnvironmentValues {
    var assets: AssetCatalog {
        get { self[AssetCatalogKey.self] }
        set { self[AssetCatalogKey.self] = newValue }
    }
}

/// An original UI sprite by stem (dom.js `sprite()` / `icon()`: "hud_coinsicon01", "gem", "frames/button_default").
/// The image is `resizable()`: `.frame(...)` scales it (add `.scaledToFit()` to keep the ratio), `.fixedSize()` draws
/// it at its natural size. Natural size = pixel size of the sprite (the client's 640-wide @2x art, scale 1), so a
/// screen scales by its own stage factor. A missing sprite draws nothing.
struct SpriteImage: View {
    let name: String
    private let scale: CGFloat?
    @Environment(\.assets) private var assets

    init(_ name: String) {
        self.name = name
        self.scale = nil
    }

    /// The sprite framed at `scale` x its natural size (the web's `--sprite-scale` 1.125, or a stage scale).
    init(_ name: String, scale: CGFloat) {
        self.name = name
        self.scale = scale
    }

    var body: some View {
        if let image = assets.image(name) {
            if let scale = scale {
                Image(uiImage: image)
                    .resizable()
                    .interpolation(.high)
                    .frame(width: image.size.width * scale, height: image.size.height * scale)
            } else {
                Image(uiImage: image)
                    .resizable()
                    .interpolation(.high)
            }
        } else {
            Color.clear
        }
    }

    /// Pixel size of a sprite (nil when the catalog does not know it).
    static func naturalSize(_ name: String, assets: AssetCatalog) -> CGSize? {
        assets.image(name)?.size
    }
}

/// A stretched 9-slice frame (the web's `border-image` of the stitched orig/ui/frames sprites, or any sprite with
/// cap insets given in pixels of the image): `resizable(capInsets:resizingMode: .stretch)`.
struct NineSliceImage: View {
    let name: String
    private let capInsets: EdgeInsets?
    private let frameStem: String?
    @Environment(\.assets) private var assets

    init(_ name: String, capInsets: EdgeInsets) {
        self.name = name
        self.capInsets = capInsets
        self.frameStem = nil
    }

    /// A frame of the manifest's `frames` group ("button_default", "hud_nineframe", "glowgold", "progressbar"…) with
    /// the slice insets recorded by the build tool (frames.json).
    init(frame stem: String) {
        self.name = "frames/" + stem
        self.capInsets = nil
        self.frameStem = stem
    }

    var body: some View {
        if let image = assets.image(name) {
            Image(uiImage: image)
                .resizable(capInsets: insets(for: image), resizingMode: .stretch)
                .interpolation(.high)
        } else {
            Color.clear
        }
    }

    private func insets(for image: UIImage) -> EdgeInsets {
        if let capInsets = capInsets { return capInsets }
        if let stem = frameStem, let spec = (assets as? BundleAssetCatalog)?.frame(stem) {
            return EdgeInsets(top: CGFloat(spec.insets.top), leading: CGFloat(spec.insets.left),
                              bottom: CGFloat(spec.insets.bottom), trailing: CGFloat(spec.insets.right))
        }
        // unknown frame: a quarter of the image on each side
        let w = image.size.width / 4
        let h = image.size.height / 4
        return EdgeInsets(top: h, leading: w, bottom: h, trailing: w)
    }
}

/// The art of a card at a fusion stage (card.js art `<img>`): aspect-filled and clipped to the proposed frame, with
/// the catalog's fallbacks (stage-0 art, then the generated placeholder).
struct CardArtView: View {
    let card: CardDef
    let stage: Int
    @Environment(\.assets) private var assets

    init(card: CardDef, stage: Int) {
        self.card = card
        self.stage = stage
    }

    var body: some View {
        Color.clear
            .overlay(
                Image(uiImage: assets.cardArt(card, stage: stage))
                    .resizable()
                    .interpolation(.high)
                    .aspectRatio(contentMode: .fill)
            )
            .clipped()
    }
}

// MARK: - SpriteKit

/// Textures created through the catalog are cached per catalog and name (the battle scene asks for the same sprite
/// many times per fight).
private let spriteTextureCache: NSCache<NSString, SKTexture> = {
    let cache = NSCache<NSString, SKTexture>()
    cache.countLimit = 512
    return cache
}()

extension SKTexture {
    /// A SpriteKit texture of a UI sprite by stem through the catalog (battle/assets.js sprites); nil when unknown.
    static func sprite(_ name: String, assets: AssetCatalog) -> SKTexture? {
        let key = "\(ObjectIdentifier(assets).hashValue):\(name)" as NSString
        if let cached = spriteTextureCache.object(forKey: key) { return cached }
        guard let image = assets.image(name) else { return nil }
        let texture = SKTexture(image: image)
        spriteTextureCache.setObject(texture, forKey: key)
        return texture
    }

    /// The card art texture (stage art, stage-0 fallback, placeholder) for the battle board.
    static func cardArt(_ card: CardDef, stage: Int, assets: AssetCatalog) -> SKTexture {
        let key = "\(ObjectIdentifier(assets).hashValue):card:\(card.id):\(stage)" as NSString
        if let cached = spriteTextureCache.object(forKey: key) { return cached }
        let texture = SKTexture(image: assets.cardArt(card, stage: stage))
        spriteTextureCache.setObject(texture, forKey: key)
        return texture
    }

    /// Drop every cached texture (memory warning, catalog swap).
    static func purgeSpriteCache() {
        spriteTextureCache.removeAllObjects()
    }
}
