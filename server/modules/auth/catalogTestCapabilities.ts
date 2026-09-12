import { BACKEND_PERMISSIONS, type BackendPermission } from "./types";

const allowed = new Set<string>(BACKEND_PERMISSIONS);

/** Isolated-test overlay only. Never part of the default role matrix. */
export function catalogTestCapabilitiesForUser(
  userId: string,
  env: Record<string, string | undefined> = process.env
): BackendPermission[] {
  if (env.AUTH_MODE === "production" || env.NODE_ENV === "production") {
    return [];
  }
  const raw = env.WISEEFF_CATALOG_TEST_CAPABILITIES?.trim();
  if (!raw || !userId.trim()) {
    return [];
  }
  const extras: BackendPermission[] = [];
  for (const entry of raw.split(";")) {
    const separator = entry.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const id = entry.slice(0, separator).trim();
    const perms = entry.slice(separator + 1);
    if (id !== userId) {
      continue;
    }
    for (const permission of perms.split(",")) {
      const value = permission.trim();
      if (allowed.has(value) && !extras.includes(value as BackendPermission)) {
        extras.push(value as BackendPermission);
      }
    }
  }
  return extras;
}
