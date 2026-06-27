import { existsSync } from "node:fs";
import { access, chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const LAUNCHER_APP_NAME = "WiseEffBridgeLauncher.app";
export const LAUNCHER_BUNDLE_ID = "com.wiseeff.bridge.launcher";
export const LAUNCHER_EXECUTABLE = "WiseEffBridge";

export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options?: { windowsHide?: boolean }
) => Promise<{ stdout: string; stderr: string }>;

export type MacosUrlSchemeDependencies = {
  platform: NodeJS.Platform;
  homedir: () => string;
  execFile: ExecFileFn;
  mkdir: typeof mkdir;
  writeFile: typeof writeFile;
  chmod: typeof chmod;
  rm: typeof rm;
  access: typeof access;
  nodePath: string;
  cliPath: string;
  log: (message: string) => void;
  error: (message: string) => void;
};

const LSREGISTER_CANDIDATES = [
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
];

export function isDarwinPlatform(platform: NodeJS.Platform): boolean {
  return platform === "darwin";
}

export function resolveLauncherAppPath(homedir: () => string): string {
  return path.join(homedir(), ".wiseeff", LAUNCHER_APP_NAME);
}

export function resolveLsRegisterPath(): string | null {
  for (const candidate of LSREGISTER_CANDIDATES) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function buildLauncherInfoPlist(version = "0.1.0"): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>WiseEff Bridge</string>
  <key>CFBundleDisplayName</key>
  <string>WiseEff Bridge</string>
  <key>CFBundleIdentifier</key>
  <string>${LAUNCHER_BUNDLE_ID}</string>
  <key>CFBundleVersion</key>
  <string>${version}</string>
  <key>CFBundleShortVersionString</key>
  <string>${version}</string>
  <key>CFBundleExecutable</key>
  <string>${LAUNCHER_EXECUTABLE}</string>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key>
      <string>${LAUNCHER_BUNDLE_ID}</string>
      <key>CFBundleURLSchemes</key>
      <array>
        <string>wiseeff-bridge</string>
      </array>
    </dict>
  </array>
</dict>
</plist>
`;
}

export function buildLauncherScript(nodePath: string, cliPath: string): string {
  return `#!/bin/bash
set -euo pipefail
NODE=${JSON.stringify(nodePath)}
CLI=${JSON.stringify(cliPath)}
if [[ $# -eq 1 && "$1" == wiseeff-bridge://* ]]; then
  exec "$NODE" "$CLI" --handle-url "$1"
fi
exec "$NODE" "$CLI" "$@"
`;
}

export async function isPortableUrlSchemeRegistered(deps: Pick<MacosUrlSchemeDependencies, "access" | "homedir">): Promise<boolean> {
  const appPath = resolveLauncherAppPath(deps.homedir);
  const executablePath = path.join(appPath, "Contents", "MacOS", LAUNCHER_EXECUTABLE);
  try {
    await deps.access(appPath);
    await deps.access(executablePath);
    return true;
  } catch {
    return false;
  }
}

async function runLsRegister(deps: MacosUrlSchemeDependencies, appPath: string, unregister = false): Promise<void> {
  const lsregister = resolveLsRegisterPath();
  if (!lsregister) {
    throw new Error("lsregister not found on this macOS system.");
  }
  const args = unregister ? ["-u", appPath] : ["-f", appPath];
  await deps.execFile(lsregister, args);
}

export async function registerPortableUrlScheme(deps: MacosUrlSchemeDependencies): Promise<number> {
  if (!isDarwinPlatform(deps.platform)) {
    deps.error("register is only available on macOS.");
    return 1;
  }

  const appPath = resolveLauncherAppPath(deps.homedir);
  const contentsPath = path.join(appPath, "Contents");
  const macosPath = path.join(contentsPath, "MacOS");
  const executablePath = path.join(macosPath, LAUNCHER_EXECUTABLE);

  await deps.mkdir(macosPath, { recursive: true });
  await deps.writeFile(path.join(contentsPath, "Info.plist"), buildLauncherInfoPlist(), "utf8");
  await deps.writeFile(executablePath, buildLauncherScript(deps.nodePath, deps.cliPath), "utf8");
  await deps.chmod(executablePath, 0o755);

  try {
    await runLsRegister(deps, appPath, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to register URL scheme.";
    deps.error(message);
    return 1;
  }

  deps.log(`Registered wiseeff-bridge:// URL scheme via ${appPath}`);
  deps.log("If browser pairing still uses an old handler, log out and back in or restart your Mac.");
  return 0;
}

export async function unregisterPortableUrlScheme(deps: MacosUrlSchemeDependencies): Promise<number> {
  if (!isDarwinPlatform(deps.platform)) {
    deps.error("unregister is only available on macOS.");
    return 1;
  }

  const appPath = resolveLauncherAppPath(deps.homedir);
  const registered = await isPortableUrlSchemeRegistered(deps);
  if (!registered) {
    deps.log("Portable URL scheme is not registered.");
    return 0;
  }

  try {
    await runLsRegister(deps, appPath, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to unregister URL scheme.";
    deps.error(message);
    return 1;
  }

  try {
    await deps.rm(appPath, { recursive: true, force: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to remove launcher app.";
    deps.error(message);
    return 1;
  }

  deps.log("Unregistered wiseeff-bridge:// portable URL scheme handler.");
  return 0;
}

export async function runMacosUrlSchemeCommand(
  action: "register" | "unregister",
  deps: MacosUrlSchemeDependencies
): Promise<number> {
  if (action === "register") {
    return registerPortableUrlScheme(deps);
  }
  return unregisterPortableUrlScheme(deps);
}
