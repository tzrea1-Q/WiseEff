export type DtsIdentityFallbackMode = "allow" | "warn" | "deny";

const DEFAULT_MODE: DtsIdentityFallbackMode = "allow";

/** Read `DTS_IDENTITY_FALLBACK_MODE` (`allow` | `warn` | `deny`). Default `allow`. */
export function readDtsIdentityFallbackMode(env: NodeJS.ProcessEnv = process.env): DtsIdentityFallbackMode {
  const raw = env.DTS_IDENTITY_FALLBACK_MODE?.trim().toLowerCase();
  if (raw === "allow" || raw === "warn" || raw === "deny") {
    return raw;
  }
  return DEFAULT_MODE;
}
