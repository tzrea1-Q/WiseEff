import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { canReadEntry } from "../knowledge/policy";
import type { KnowledgeEntryDto } from "../knowledge/types";
import type { LogSkillSpec } from "./skillSpec";
import { organizationId as logOrganizationId, type LogAccessContext } from "./principal";

/** Private live entries redact revisions; deleted entries retain the run's recorded provenance. */
export async function readableKnowledgeEntryIds(db: Queryable, auth: LogAccessContext, ids: string[]): Promise<Set<string>> {
  if (!ids.length || !auth.user.isActive || !auth.permissions.includes("knowledge:view")) return new Set();
  const entries = await db.query<{ id: string; status: KnowledgeEntryDto["status"]; created_by_user_id: string | null }>(
    `select id, status, created_by_user_id from knowledge_entries where organization_id = $1 and id = any($2::uuid[])`,
    [logOrganizationId(auth), [...new Set(ids)]]);
  const byId = new Map(entries.rows.map((entry) => [entry.id, entry]));
  return new Set(ids.filter((id) => {
    const entry = byId.get(id);
    return !entry || canReadEntry(auth, { status: entry.status, createdByUserId: entry.created_by_user_id });
  }));
}

/** New links are published entries or the author's normal knowledge drafts from upload. */
export async function validateSkillKnowledge(db: Queryable, auth: LogAccessContext, spec: LogSkillSpec, previous?: LogSkillSpec) {
  const ids = spec.knowledgeEntryIds ?? [];
  if (!ids.length) return;
  const entries = await db.query<{ id: string; status: string; created_by_user_id: string | null }>(
    `select id, status, created_by_user_id from knowledge_entries where organization_id = $1 and id = any($2::uuid[]) for share`,
    [logOrganizationId(auth), ids]);
  for (const id of ids) {
    // Existing bindings keep their identity through archive/delete until explicitly unlinked.
    if (previous?.knowledgeEntryIds?.includes(id)) continue;
    const entry = entries.rows.find((row) => row.id === id);
    if (!entry) throw new ApiError("NOT_FOUND", "未找到知识条目。");
    if (entry.status === "published") continue;
    if (entry.status !== "draft" || entry.created_by_user_id !== auth.user.id || !auth.permissions.includes("knowledge:edit")) {
      throw new ApiError("FORBIDDEN", "请选择已发布的知识条目；具有知识编辑权限的用户也可上传草稿。");
    }
  }
}
