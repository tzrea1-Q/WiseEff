import type { AuditEvent, AuditEventKind, RiskLevel } from "@/domain/prototype/types";

export type ParameterRange = {
  min?: number;
  max?: number;
  raw: string;
};

export function migrateParameterRange(raw: string | null | undefined): ParameterRange {
  const safe = typeof raw === "string" ? raw : "";
  const matches = safe.match(/-?\d+(?:\.\d+)?/g) ?? [];

  if (matches.length >= 2) {
    const [min, max] = matches.map(Number);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return { min, max, raw: safe };
    }
  }

  return { raw: safe };
}

let auditSeq = 0;

function makeAuditId() {
  auditSeq += 1;
  return `audit-${Date.now().toString(36)}-${auditSeq.toString(36)}`;
}

export type BuildAuditInput = {
  kind: AuditEventKind;
  actor: string;
  action: string;
  severity: RiskLevel;
  parameterId?: string;
  batchId?: string;
  userId?: string;
  metadata?: AuditEvent["metadata"];
  viaAgent?: boolean;
  time?: string;
};

export function buildAuditEvent(input: BuildAuditInput): AuditEvent {
  return {
    id: makeAuditId(),
    app: "parameter-admin",
    actor: input.actor,
    action: input.action,
    kind: input.kind,
    severity: input.severity,
    time: input.time ?? new Date().toISOString(),
    parameterId: input.parameterId,
    batchId: input.batchId,
    userId: input.userId,
    metadata: input.metadata,
    viaAgent: input.viaAgent
  };
}
