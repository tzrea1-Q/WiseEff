import { ApiError } from "../../shared/http/errors";
import type { AuthContext, BackendPermission } from "../auth/types";

function requirePermission(auth: AuthContext, permission: BackendPermission) {
  if (!auth.user.isActive || !auth.permissions.includes(permission)) {
    throw new ApiError("FORBIDDEN", `Missing permission: ${permission}.`, 403, { permission });
  }
}

/** Dedicated permission for starting and reading DTS reload debugging runs. */
export function requireDtsReload(auth: AuthContext) {
  requirePermission(auth, "debugging:dts-reload");
}
