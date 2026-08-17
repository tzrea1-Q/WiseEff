import type { AuthContext } from "../auth/types";
import { ApiError } from "../../shared/http/errors";

export function requireProductFeedbackSubmit(auth: AuthContext) {
  if (!auth.user.isActive) {
    throw new ApiError("FORBIDDEN", "Forbidden.", { reason: "inactive" });
  }
}

export function requireProductFeedbackAdmin(auth: AuthContext) {
  if (!auth.user.isActive || !auth.permissions.includes("admin:access")) {
    throw new ApiError("FORBIDDEN", "Forbidden.", { permission: "admin:access" });
  }
}
