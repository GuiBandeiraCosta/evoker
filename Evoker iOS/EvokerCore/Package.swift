// swift-tools-version: 5.9
// EvokerCore: the game logic of Evoker (data, stats, abilities, the battle engine, the pure game functions and the
// battle playback timeline). Foundation only, so it builds and tests on macOS, Linux and Windows as well as iOS.
import PackageDescription

let package = Package(
    name: "EvokerCore",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "EvokerCore", targets: ["EvokerCore"]),
    ],
    targets: [
        .target(
            name: "EvokerCore",
            path: "Sources/EvokerCore",
            resources: [
                .copy("Data"),
            ],
            swiftSettings: [
                .define("EVOKER_CORE"),
            ]
        ),
        .testTarget(
            name: "EvokerCoreTests",
            dependencies: ["EvokerCore"],
            path: "Tests/EvokerCoreTests",
            resources: [
                .copy("Golden"),
                .copy("Parity"),
            ]
        ),
    ]
)
