import path from "node:path";

export const WINDOWS_URL_SCHEME_KEY = "HKCU\\Software\\Classes\\wiseeff-bridge";
export const WINDOWS_URL_SCHEME_COMMAND_KEY = `${WINDOWS_URL_SCHEME_KEY}\\shell\\open\\command`;
export const WINDOWS_URL_SCHEME_PROTOCOL_LABEL = "URL:WiseEff Bridge Protocol";

export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options?: { windowsHide?: boolean }
) => Promise<{ stdout: string; stderr: string }>;

export type WindowsUrlSchemeDependencies = {
  platform: NodeJS.Platform;
  execFile: ExecFileFn;
  log: (message: string) => void;
  error: (message: string) => void;
};

export function isWindowsPlatform(platform: NodeJS.Platform): boolean {
  return platform === "win32";
}

export function buildWindowsUrlSchemeCommandValue(launcherPath: string): string {
  const normalized = path.win32.normalize(launcherPath);
  return `"${normalized}" --handle-url "%1"`;
}

export function normalizeWindowsLauncherPath(launcherPath: string): string {
  return path.win32.normalize(launcherPath).toLowerCase();
}

export function extractLauncherPathFromRegistryCommand(commandValue: string): string | null {
  const trimmed = commandValue.trim();
  const quotedMatch = trimmed.match(/^"([^"]+)"/);
  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }
  const firstToken = trimmed.split(/\s+/)[0];
  if (!firstToken) {
    return null;
  }
  return firstToken.replace(/^"|"$/g, "");
}

export function parseRegQueryDefaultValue(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/REG_SZ\s+(.*)$/);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

export function registryCommandMatchesLauncher(commandValue: string, expectedLauncherPath: string): boolean {
  const extracted = extractLauncherPathFromRegistryCommand(commandValue);
  if (!extracted) {
    return false;
  }
  return normalizeWindowsLauncherPath(extracted) === normalizeWindowsLauncherPath(expectedLauncherPath);
}

async function runRegAdd(
  deps: Pick<WindowsUrlSchemeDependencies, "execFile">,
  key: string,
  value: string
): Promise<void> {
  await deps.execFile("reg.exe", ["add", key, "/ve", "/d", value, "/f"], { windowsHide: true });
}

async function runRegDelete(deps: Pick<WindowsUrlSchemeDependencies, "execFile">, key: string): Promise<void> {
  await deps.execFile("reg.exe", ["delete", key, "/f"], { windowsHide: true });
}

async function queryRegistryCommandValue(deps: Pick<WindowsUrlSchemeDependencies, "execFile">): Promise<string | null> {
  try {
    const { stdout } = await deps.execFile(
      "reg.exe",
      ["query", WINDOWS_URL_SCHEME_COMMAND_KEY, "/ve"],
      { windowsHide: true }
    );
    return parseRegQueryDefaultValue(stdout);
  } catch {
    return null;
  }
}

export async function isWindowsUrlSchemeRegistered(
  expectedLauncherPath?: string,
  deps?: Pick<WindowsUrlSchemeDependencies, "execFile">
): Promise<boolean> {
  if (!deps) {
    return false;
  }

  const commandValue = await queryRegistryCommandValue(deps);
  if (!commandValue) {
    return false;
  }

  if (!expectedLauncherPath) {
    return true;
  }

  return registryCommandMatchesLauncher(commandValue, expectedLauncherPath);
}

function execFailureMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function registerWindowsUrlScheme(
  launcherPath: string,
  deps: WindowsUrlSchemeDependencies
): Promise<number> {
  if (!isWindowsPlatform(deps.platform)) {
    deps.error("register is only available on Windows.");
    return 1;
  }

  const commandValue = buildWindowsUrlSchemeCommandValue(launcherPath);

  try {
    await runRegAdd(deps, WINDOWS_URL_SCHEME_KEY, WINDOWS_URL_SCHEME_PROTOCOL_LABEL);
    await runRegAdd(deps, `${WINDOWS_URL_SCHEME_KEY}\\URL Protocol`, "");
    await runRegAdd(deps, WINDOWS_URL_SCHEME_COMMAND_KEY, commandValue);
  } catch (error) {
    deps.error(`Failed to register Windows URL scheme: ${execFailureMessage(error)}`);
    return 1;
  }

  deps.log(`Registered wiseeff-bridge:// URL scheme via ${path.win32.normalize(launcherPath)}`);
  return 0;
}

export async function unregisterWindowsUrlScheme(deps: WindowsUrlSchemeDependencies): Promise<number> {
  if (!isWindowsPlatform(deps.platform)) {
    deps.error("unregister is only available on Windows.");
    return 1;
  }

  const registered = await isWindowsUrlSchemeRegistered(undefined, deps);
  if (!registered) {
    deps.log("Windows URL scheme is not registered.");
    return 0;
  }

  try {
    await runRegDelete(deps, WINDOWS_URL_SCHEME_KEY);
  } catch (error) {
    deps.error(`Failed to unregister Windows URL scheme: ${execFailureMessage(error)}`);
    return 1;
  }

  deps.log("Unregistered wiseeff-bridge:// Windows URL scheme handler.");
  return 0;
}

export async function runWindowsUrlSchemeCommand(
  action: "register" | "unregister",
  launcherPath: string,
  deps: WindowsUrlSchemeDependencies
): Promise<number> {
  if (action === "register") {
    return registerWindowsUrlScheme(launcherPath, deps);
  }
  return unregisterWindowsUrlScheme(deps);
}
