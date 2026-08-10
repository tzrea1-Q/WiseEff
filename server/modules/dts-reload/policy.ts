import { ApiError } from "../../shared/http/errors";
import type { AuthContext, BackendPermission } from "../auth/types";

function requirePermission(auth: AuthContext, permission: BackendPermission) {
  if (!auth.user.isActive || !auth.permissions.includes(permission)) {
    throw new ApiError("FORBIDDEN", `Missing permission: ${permission}.`, 403, { permission });
  }
}

function hasPermission(auth: AuthContext, permission: BackendPermission) {
  return auth.user.isActive && auth.permissions.includes(permission);
}

/** Dedicated permission for starting and mutating DTS reload debugging runs. */
export function requireDtsReload(auth: AuthContext) {
  requirePermission(auth, "debugging:dts-reload");
}

/**
 * Read history / candidates / residue / artifact metadata.
 * Accepts either `debugging:view` or `debugging:dts-reload` so view-only users
 * can learn from past runs without being able to start one.
 */
export function requireDtsReloadView(auth: AuthContext) {
  if (hasPermission(auth, "debugging:view") || hasPermission(auth, "debugging:dts-reload")) {
    return;
  }
  throw new ApiError("FORBIDDEN", "Missing permission: debugging:view.", 403, {
    permission: "debugging:view"
  });
}
