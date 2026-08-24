import { randomUUID } from "node:crypto";

import type { TrustedInvocationContext } from "../auth/trustedInvocation";
import { assertTrustedInvocationContext, TrustedInvocationContextError } from "../auth/trustedInvocation";
import type { CreateAuditEventInput, AuditActorType, AuditSeverity } from "./types";

export type TrustedInvocationAuditProjection = {
  organizationId: string | null;
  actorUserId: string | null;
  actorType: AuditActorType;
  metadata: Record<string, unknown>;
};

export type TrustedAuditEventInput = {
  invocation: TrustedInvocationContext;
  id?: string;
  /** System invocations may supply an explicit organization scope; user/Agent scope is derived. */
  organizationId?: string | null;
  projectId: string | null;
  app: string;
  kind: string;
  action: string;
  severity: AuditSeverity;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  traceId: string;
};

export function projectTrustedInvocationForAudit(
  context: TrustedInvocationContext
): TrustedInvocationAuditProjection {
  const trusted = assertTrustedInvocationContext(context);

  if (trusted.initiator === "user") {
    return {
      organizationId: trusted.principal.organization.id,
      actorUserId: trusted.principal.user.id,
      actorType: "user",
      metadata: { initiator: "user" }
    };
  }

  if (trusted.initiator === "agent") {
    return {
      organizationId: trusted.principal.organization.id,
      actorUserId: trusted.principal.user.id,
      actorType: "agent",
      metadata: {
        initiator: "agent",
        sessionId: trusted.sessionId,
        toolCallId: trusted.toolCallId,
        approvalId: trusted.approvalId
      }
    };
  }

  return {
    organizationId: null,
    actorUserId: null,
    actorType: "system",
    metadata: {
      initiator: "system",
      systemKind: trusted.identity.kind,
      systemName: trusted.identity.name
    }
  };
}

/** Build audit input with actor, organization, and provenance derived from one trusted context. */
export function buildTrustedAuditEventInput(input: TrustedAuditEventInput): CreateAuditEventInput {
  const trusted = assertTrustedInvocationContext(input.invocation);
  const projection = projectTrustedInvocationForAudit(trusted);

  if (trusted.initiator !== "system" && input.organizationId !== undefined) {
    throw new TrustedInvocationContextError("trusted audit organization scope is derived from the authenticated principal");
  }

  return {
    id: input.id ?? randomUUID(),
    organizationId: input.organizationId ?? projection.organizationId,
    projectId: input.projectId,
    actorUserId: projection.actorUserId,
    actorType: projection.actorType,
    app: input.app,
    kind: input.kind,
    action: input.action,
    severity: input.severity,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: { ...input.metadata, ...projection.metadata },
    traceId: input.traceId
  };
}
