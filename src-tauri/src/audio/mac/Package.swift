// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "SystemAudioDump",
    platforms: [.macOS(.v12)],
    targets: [
        .executableTarget(
            name: "SystemAudioDump",
            path: ".",
            exclude: ["build.sh", "record.js"],
            sources: ["SystemAudioDump.swift"]
        )
    ]
)
