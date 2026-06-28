import Cocoa

final class BridgeAppDelegate: NSObject, NSApplicationDelegate {
  private var handledIncomingUrl = false

  func application(_ application: NSApplication, open urls: [URL]) {
    guard let url = urls.first?.absoluteString, url.hasPrefix("wiseeff-bridge://") else {
      return
    }
    handledIncomingUrl = true
    runBridge(arguments: ["--handle-url", url])
    NSApp.terminate(nil)
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    let args = CommandLine.arguments.dropFirst()
    if let url = args.first, url.hasPrefix("wiseeff-bridge://") {
      handledIncomingUrl = true
      runBridge(arguments: ["--handle-url", url])
      NSApp.terminate(nil)
      return
    }

    if handledIncomingUrl {
      return
    }

    // Cold start without URL: keep standby Bridge running in the background.
    runBridge(arguments: ["start"], wait: false)
    NSApp.terminate(nil)
  }

  private func runBridge(arguments: [String], wait: Bool = true) {
    guard let resources = Bundle.main.resourcePath else {
      appendLaunchLog("swift-bridge ERROR=missing-resources")
      return
    }
    let bridgePath = URL(fileURLWithPath: resources).appendingPathComponent("wiseeff-bridge")
    appendLaunchLog("swift-bridge argv=\(arguments.joined(separator: " "))")

    let task = Process()
    task.executableURL = bridgePath
    task.arguments = arguments
    if wait {
      task.standardOutput = FileHandle.nullDevice
      task.standardError = FileHandle.nullDevice
    }
    do {
      try task.run()
      if wait {
        task.waitUntilExit()
      }
    } catch {
      appendLaunchLog("swift-bridge ERROR=\(error.localizedDescription)")
    }
  }

  private func appendLaunchLog(_ message: String) {
    let home = FileManager.default.homeDirectoryForCurrentUser
    let logURL = home.appendingPathComponent(".wiseeff/bridge-launch.log")
    let line = "\(ISO8601DateFormatter().string(from: Date())) \(message)\n"
    try? FileManager.default.createDirectory(at: logURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    if FileManager.default.fileExists(atPath: logURL.path) {
      if let handle = try? FileHandle(forWritingTo: logURL) {
        handle.seekToEndOfFile()
        handle.write(line.data(using: .utf8) ?? Data())
        try? handle.close()
      }
    } else {
      try? line.write(to: logURL, atomically: true, encoding: .utf8)
    }
  }
}

let app = NSApplication.shared
let delegate = BridgeAppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
