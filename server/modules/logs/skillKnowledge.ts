import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { canReadEntry } from "../knowledge/policy";
import type { KnowledgeEntryDto } from "../knowledge/types";
import type { LogSkillSpec } from "./skillSpec";

/** Resolve visibility at read time without changing the run's recorded provenance. */
export async function readableKnowledgeEntryIds(db: Queryable, auth: AuthContext, ids: string[]): Promise<Set<string>> {
  if (!ids.length || !auth.user.isActive || !auth.permissions.includes("knowledge:view")) return new Set();
  const entries = await db.query<{ id: string; status: KnowledgeEntryDto["status"]; created_by_user_id: string | null }>(
    `select id, status, created_by_user_id from knowledge_entries where organization_id = $1 and id = any($2::uuid[])`,
    [auth.organization.id, [...new Set(ids)]]);
  return new Set(entries.rows.filter((entry) => canReadEntry(auth, { status: entry.status, createdByUserId: entry.created_by_user_id })).map((entry) => entry.id));
}

/** New links are published entries or the author's normal knowledge drafts from upload. */
export async function validateSkillKnowledge(db: Queryable, auth: AuthContext, spec: LogSkillSpec, previous?: LogSkillSpec) {
  const ids = spec.knowledgeEntryIds ?? [];
  if (!ids.length) return;
  const entries = await db.query<{ id: string; status: string; created_by_user_id: string | null }>(
    `select id, status, created_by_user_id from knowledge_entries where organization_id = $1 and id = any($2::uuid[]) for share`,
    [auth.organization.id, ids]);
  for (const id of ids) {
    const entry = entries.rows.find((row) => row.id === id);
    if (!entry) throw new ApiError("NOT_FOUND", "Knowledge entry was not found.");
    if (previous?.knowledgeEntryIds?.includes(id) || entry.status === "published") continue;
    if (entry.status !== "draft" || entry.created_by_user_id !== auth.user.id || !auth.permissions.includes("knowledge:edit")) {
      throw new ApiError("FORBIDDEN", "Link a published knowledge entry, or upload a draft with knowledge edit permission.");
    }
  }
}
