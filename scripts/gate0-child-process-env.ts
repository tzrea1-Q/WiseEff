type RuntimeEnv = Record<string, string | undefined>;

const REQUIRED_HOST_ENV_KEYS = new Set([
  "APPDATA",
  "COMSPEC",
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOCALAPPDATA",
  "LOGNAME",
  "PATH",
  "PATHEXT",
  "SHELL",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "USER",
  "WINDIR",
]);

/**
 * Builds the complete environment for a Gate0-owned subprocess.
 *
 * Host state is an allowlist of process-launch essentials only. Every test or
 * runtime setting must be supplied explicitly in `ownedEnv`; this prevents
 * credential helpers, CI identity tokens, provider keys, and unrelated host
 * configuration from crossing the owned-runtime boundary.
 */
export function buildGate0OwnedChildProcessEnv(
  ownedEnv: RuntimeEnv,
  inheritedEnv: RuntimeEnv = process.env,
): RuntimeEnv {
  const childEnv: RuntimeEnv = {};
  for (const key of REQUIRED_HOST_ENV_KEYS) {
    const value = inheritedEnv[key];
    if (value !== undefined) childEnv[key] = value;
  }
  for (const [key, value] of Object.entries(ownedEnv)) {
    if (value === undefined) delete childEnv[key];
    else childEnv[key] = value;
  }
  return childEnv;
}
