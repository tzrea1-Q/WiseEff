import { randomUUID } from "node:crypto";

import type { Queryable } from "../../shared/database/client";
import type { SpecReviewTaskDraft } from "./types";

type ReviewTaskRow = {
  id: string;
  organization_id: string;
  parameter_spec_id: string | null;
  source_evidence: unknown;
  candidate_schemas: unknown;
  project_count: number | string;
  status: "open" | "resolved" | "dismissed";
  reviewer_user_id: string | null;
  reason: string | null;
  created_at: string | Date;
  resolved_at: string | Date | null;
};

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

export type PersistedSpecReviewTask = {
  id: string;
  organizationId: string;
  parameterSpecId?: string;
  sourceEvidence: Record<string, unknown>;
  candidateSchemas: unknown[];
  projectCount: number;
  status: "open" | "resolved" | "dismissed";
  reviewerUserId?: string;
  reason?: string;
  createdAt: string;
  resolvedAt?: string;
};

function toDto(row: ReviewTaskRow): PersistedSpecReviewTask {
  return {
    id: row.id,
    organizationId: row.organization_id,
    parameterSpecId: row.parameter_spec_id ?? undefined,
    sourceEvidence: (row.source_evidence ?? {}) as Record<string, unknown>,
    candidateSchemas: Array.isArray(row.candidate_schemas) ? row.candidate_schemas : [],
    projectCount: Number(row.project_count),
    status: row.status,
    reviewerUserId: row.reviewer_user_id ?? undefined,
    reason: row.reason ?? undefined,
    createdAt: dateTimeToIso(row.created_at),
    resolvedAt: row.resolved_at ? dateTimeToIso(row.resolved_at) : undefined,
  };
}

export async function insertSpecReviewTask(
  db: Queryable,
  input: {
    organizationId: string;
    draft: SpecReviewTaskDraft;
  },
): Promise<PersistedSpecReviewTask> {
  const id = input.draft.id || randomUUID();
  const result = await db.query<ReviewTaskRow>(
    `
    insert into parameter_spec_review_tasks (
      id, organization_id, parameter_spec_id, source_evidence, candidate_schemas, project_count, status
    ) values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
    returning *
    `,
    [
      id,
      input.organizationId,
      input.draft.parameterSpecId ?? null,
      JSON.stringify(input.draft.sourceEvidence),
      JSON.stringify(input.draft.candidateSchemas),
      input.draft.projectCount,
      input.draft.status,
    ],
  );
  return toDto(result.rows[0]);
}

/** Persist open review-task drafts (unmatched/ambiguous). Binding callers land in Task 7. */
export async function persistOpenReviewTaskDrafts(
  db: Queryable,
  organizationId: string,
  drafts: SpecReviewTaskDraft[],
): Promise<PersistedSpecReviewTask[]> {
  const persisted: PersistedSpecReviewTask[] = [];
  for (const draft of drafts) {
    if (draft.status !== "open") continue;
    persisted.push(await insertSpecReviewTask(db, { organizationId, draft }));
  }
  return persisted;
}

export async function listOpenSpecReviewTasks(
  db: Queryable,
  organizationId: string,
): Promise<PersistedSpecReviewTask[]> {
  const result = await db.query<ReviewTaskRow>(
    `
    select *
    from parameter_spec_review_tasks
    where organization_id = $1 and status = 'open'
    order by created_at asc
    `,
    [organizationId],
  );
  return result.rows.map(toDto);
}
