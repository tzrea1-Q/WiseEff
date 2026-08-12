import type { AuthContext } from "../auth/types";
import { ApiError } from "../../shared/http/errors";
import type { KnowledgeEntryDto } from "./types";

function forbidden(permission: string) {
  return new ApiError("FORBIDDEN", "Forbidden.", 403, { permission });
}

export function requireKnowledgeView(auth: AuthContext) {
  if (!auth.user.isActive || !auth.permissions.includes("knowledge:view")) {
    throw forbidden("knowledge:view");
  }
}

export function requireKnowledgeEdit(auth: AuthContext) {
  if (!auth.user.isActive || !auth.permissions.includes("knowledge:edit")) {
    throw forbidden("knowledge:edit");
  }
}

export function requireKnowledgeManage(auth: AuthContext) {
  if (!auth.user.isActive || !auth.permissions.includes("knowledge:manage")) {
    throw forbidden("knowledge:manage");
  }
}

export function hasKnowledgeManage(auth: AuthContext) {
  return auth.user.isActive && auth.permissions.includes("knowledge:manage");
}

/**
 * Publisher accountability (D18): knowledge:edit governs OWN entries only;
 * cross-person governance requires knowledge:manage.
 */
export function requireKnowledgeGovern(auth: AuthContext, entry: Pick<KnowledgeEntryDto, "createdByUserId">) {
  if (hasKnowledgeManage(auth)) {
    return;
  }
  requireKnowledgeEdit(auth);
  if (entry.createdByUserId !== auth.user.id) {
    throw new ApiError("FORBIDDEN", "Only the entry owner or a knowledge manager can govern this entry.", 403, {
      permission: "knowledge:manage"
    });
  }
}

/** Draft entries are visible to their owner and to knowledge managers only. */
export function canReadEntry(auth: AuthContext, entry: Pick<KnowledgeEntryDto, "status" | "createdByUserId">) {
  if (!auth.user.isActive || !auth.permissions.includes("knowledge:view")) {
    return false;
  }
  if (entry.status === "draft") {
    return entry.createdByUserId === auth.user.id || hasKnowledgeManage(auth);
  }
  return true;
}
