import { randomUUID } from "node:crypto";

import { writeAuditEventInTx, writeTrustedAuditEventInTx, type AuditTx } from "../audit/auditedWrite";
import type { AuditCorrelationContext } from "../audit/types";
import type { TrustedInvocationContext } from "../auth/trustedInvocation";
import type { AuthContext } from "../auth/types";
import type { Queryable } from "../../shared/database/client";

export type GovernanceAuditAction =
  | "spec-review-resolved"
  | "spec-review-dismissed"
  | "spec-draft-created"
  | "spec-activated"
  | "spec-updated"
  | "spec-deprecated"
  | "spec-restored"
  | "spec-reattributed"
  | "spec-property-key-changed"
  | "spec-property-key-cutover-started"
  | "spec-property-key-cutover-prepared"
  | "spec-property-key-cutover-finalized"
  | "spec-version-cutover-prepared"
  | "spec-version-cutover-finalized"
  | "identity-mapping-resolved"
  | "identity-mapping-dismissed"
  | "identity-mapping-new-identity"
  | "identity-mapping-reopened"
  | "config-revision-validated"
  | "binding-edited"
  | "enablement-changed"
  | "baseline-mutated"
  | "identity-migrated";

/**
 * Audit governance mutations with request/trace correlation.
 * Store IDs and evidence hashes only — never full source text.
 */
export async function writeGovernanceAudit(
  tx: AuditTx,
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
  // requestId fallback survives only until governance contexts become mandatory (ADR-0027).
  await writeAuditEventInTx(tx, auth, { requestId: context.requestId ?? randomUUID() }, {
    app: "parameters",
    kind: "parameter-topology-governance",
    action: input.action,
    severity: "Medium",
    projectId: input.projectId ?? null,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata
  });
}

/** Trusted-provenance variant used only by migrated #614 governance writes. */
export async function writeTrustedGovernanceAudit(
  tx: AuditTx,
  invocation: TrustedInvocationContext,
  input: {
    action: GovernanceAuditAction;
    organizationId: string;
    projectId?: string | null;
    targetType: string;
    targetId: string;
    metadata: Record<string, unknown>;
  },
  requestId: string
) {
  await writeTrustedAuditEventInTx(tx, {
    invocation,
    ...(invocation.initiator === "system" ? { organizationId: input.organizationId } : {}),
    projectId: input.projectId ?? null,
    app: "parameters",
    kind: "parameter-topology-governance",
    action: input.action,
    severity: "Medium",
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata,
    traceId: requestId
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
