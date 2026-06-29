import path from "node:path";

export const WINDOWS_URL_SCHEME_PROTOCOL = "wiseeff-bridge";
export const WINDOWS_URL_SCHEME_PROTOCOL_LABEL = "URL:WiseEff Bridge Protocol";
export const WINDOWS_URL_SCHEME_HKCU_KEY = "HKCU\\Software\\Classes\\wiseeff-bridge";
export const WINDOWS_URL_SCHEME_HKLM_KEY = "HKLM\\Software\\Classes\\wiseeff-bridge";
export const WINDOWS_URL_SCHEME_COMMAND_KEY = `${WINDOWS_URL_SCHEME_HKCU_KEY}\\shell\\open\\command`;
/** @deprecated Use WINDOWS_URL_SCHEME_HKCU_KEY */
export const WINDOWS_URL_SCHEME_KEY = WINDOWS_URL_SCHEME_HKCU_KEY;

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

export function buildWindowsUrlSchemeCommandValue(launcherPath: string, cliPath?: string): string {
  const normalized = path.win32.normalize(launcherPath);
  if (cliPath) {
    const normalizedCli = path.win32.normalize(cliPath);
    return `"${normalized}" "${normalizedCli}" --handle-url "%1"`;
  }
  return `"${normalized}" --handle-url "%1"`;
}

export function windowsUrlSchemeRegistryRoot(root: "HKCU" | "HKLM"): string {
  return `${root}\\Software\\Classes\\${WINDOWS_URL_SCHEME_PROTOCOL}`;
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

async function runRegAddNamed(
  deps: Pick<WindowsUrlSchemeDependencies, "execFile">,
  key: string,
  valueName: string,
  value: string
): Promise<void> {
  await deps.execFile("reg.exe", ["add", key, "/v", valueName, "/d", value, "/f"], { windowsHide: true });
}

async function runRegDelete(deps: Pick<WindowsUrlSchemeDependencies, "execFile">, key: string): Promise<void> {
  await deps.execFile("reg.exe", ["delete", key, "/f"], { windowsHide: true });
}

async function queryRegistryCommandValue(
  deps: Pick<WindowsUrlSchemeDependencies, "execFile">,
  root: "HKCU" | "HKLM" = "HKCU"
): Promise<string | null> {
  const commandKey = `${windowsUrlSchemeRegistryRoot(root)}\\shell\\open\\command`;
  try {
    const { stdout } = await deps.execFile("reg.exe", ["query", commandKey, "/ve"], { windowsHide: true });
    return parseRegQueryDefaultValue(stdout);
  } catch {
    return null;
  }
}

async function writeUrlSchemeRegistry(
  deps: Pick<WindowsUrlSchemeDependencies, "execFile">,
  root: "HKCU" | "HKLM",
  launcherPath: string,
  cliPath?: string
): Promise<void> {
  const schemeKey = windowsUrlSchemeRegistryRoot(root);
  const commandValue = buildWindowsUrlSchemeCommandValue(launcherPath, cliPath);
  await runRegAdd(deps, schemeKey, WINDOWS_URL_SCHEME_PROTOCOL_LABEL);
  // URL Protocol must be a named value, NOT a subkey, per Microsoft URL protocol spec.
  await runRegAddNamed(deps, schemeKey, "URL Protocol", "");
  await runRegAdd(deps, `${schemeKey}\\DefaultIcon`, launcherPath);
  await runRegAdd(deps, `${schemeKey}\\shell\\open\\command`, commandValue);
}

async function deleteUrlSchemeRegistry(
  deps: Pick<WindowsUrlSchemeDependencies, "execFile">,
  root: "HKCU" | "HKLM"
): Promise<void> {
  await runRegDelete(deps, windowsUrlSchemeRegistryRoot(root));
}

export async function isWindowsUrlSchemeRegistered(
  expectedLauncherPath?: string,
  deps?: Pick<WindowsUrlSchemeDependencies, "execFile">
): Promise<boolean> {
  if (!deps) {
    return false;
  }

  for (const root of ["HKCU", "HKLM"] as const) {
    const commandValue = await queryRegistryCommandValue(deps, root);
    if (!commandValue) {
      continue;
    }
    if (!expectedLauncherPath) {
      return true;
    }
    if (registryCommandMatchesLauncher(commandValue, expectedLauncherPath)) {
      return true;
    }
  }

  return false;
}

function execFailureMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function registerWindowsUrlScheme(
  launcherPath: string,
  deps: WindowsUrlSchemeDependencies,
  cliPath?: string
): Promise<number> {
  if (!isWindowsPlatform(deps.platform)) {
    deps.error("register is only available on Windows.");
    return 1;
  }

  try {
    await writeUrlSchemeRegistry(deps, "HKCU", launcherPath, cliPath);
    deps.log(`Registered wiseeff-bridge:// in HKCU via ${path.win32.normalize(launcherPath)}`);
  } catch (error) {
    deps.error(`Failed to register Windows URL scheme (HKCU): ${execFailureMessage(error)}`);
    return 1;
  }

  try {
    await writeUrlSchemeRegistry(deps, "HKLM", launcherPath, cliPath);
    deps.log(`Registered wiseeff-bridge:// in HKLM via ${path.win32.normalize(launcherPath)}`);
  } catch (error) {
    deps.log("HKLM URL scheme registration skipped (administrator privileges required).");
  }

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
    await deleteUrlSchemeRegistry(deps, "HKCU");
  } catch (error) {
    deps.error(`Failed to unregister Windows URL scheme (HKCU): ${execFailureMessage(error)}`);
    return 1;
  }

  try {
    await deleteUrlSchemeRegistry(deps, "HKLM");
  } catch {
    // HKLM may not exist or may require admin to delete.
  }

  deps.log("Unregistered wiseeff-bridge:// Windows URL scheme handler.");
  return 0;
}

export async function runWindowsUrlSchemeCommand(
  action: "register" | "unregister",
  launcherPath: string,
  deps: WindowsUrlSchemeDependencies,
  cliPath?: string
): Promise<number> {
  if (action === "register") {
    return registerWindowsUrlScheme(launcherPath, deps, cliPath);
  }
  return unregisterWindowsUrlScheme(deps);
}
