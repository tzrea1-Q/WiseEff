import { randomUUID } from "node:crypto";

import { createAuditEvent } from "../audit/repository";
import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import type { Queryable } from "../../shared/database/client";

export type GovernanceAuditAction =
  | "spec-review-resolved"
  | "spec-review-dismissed"
  | "identity-mapping-resolved"
  | "identity-mapping-dismissed"
  | "config-revision-validated"
  | "binding-edited"
  | "baseline-mutated"
  | "config-revision-published"
  | "identity-migrated";

/**
 * Audit governance mutations with request/trace correlation.
 * Store IDs and evidence hashes only — never full source text.
 */
export async function writeGovernanceAudit(
  db: Queryable,
  auth: AuthContext,
  input: {
    action: GovernanceAuditAction;
    projectId?: string | null;
    targetType: string;
    targetId: string;
    metadata: Record<string, unknown>;
  },
  context: AuditCorrelationContext = {}
) {
  await createAuditEvent(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: input.projectId ?? null,
    actorUserId: auth.user.id,
    actorType: "user",
    app: "parameters",
    kind: "parameter-topology-governance",
    action: input.action,
    severity: "Medium",
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata,
    traceId: context.requestId ?? randomUUID()
  });
}

export async function linkAuditSubjects(
  db: Queryable,
  auditEventId: string,
  links: Array<{ subjectKind: string; semanticId: string; legacyId?: string | null }>
) {
  for (const link of links) {
    await db.query(
      `
      insert into audit_subject_links (audit_event_id, subject_kind, legacy_id, semantic_id)
      values ($1, $2, $3, $4)
      on conflict do nothing
      `,
      [auditEventId, link.subjectKind, link.legacyId ?? null, link.semanticId]
    );
  }
}
