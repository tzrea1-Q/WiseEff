export type AuditSeverity = "High" | "Medium" | "Low";

export type AuditCorrelationContext = {
  requestId?: string;
};

export type CreateAuditEventInput = {
  id: string;
  organizationId: string;
  projectId: string | null;
  actorUserId: string | null;
  actorType: "user" | "agent" | "system";
  app: string;
  kind: string;
  action: string;
  severity: AuditSeverity;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  traceId: string;
};

export type AuditEventDto = CreateAuditEventInput & {
  createdAt: string;
};
