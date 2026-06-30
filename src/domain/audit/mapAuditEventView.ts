import type { AuditEvent } from "@/mockData";
import { formatAuditRelativeTime } from "./formatAuditTime";
import type { AuditActorType, AuditEventDto, AuditEventView } from "./types";

function actorLabelFromDto(dto: AuditEventDto) {
  if (dto.actorName?.trim()) {
    return dto.actorName.trim();
  }
  if (dto.actorType === "agent") {
    return "小泽";
  }
  if (dto.actorType === "system") {
    return "System";
  }
  return dto.actorUserId ?? "Unknown";
}

function actorTypeFromMock(event: AuditEvent): AuditActorType {
  if (event.viaAgent || event.actor === "小泽" || event.actor === "WiseAgent") {
    return "agent";
  }
  return "user";
}

function metadataRecord(metadata: AuditEvent["metadata"] | Record<string, unknown> | undefined) {
  if (!metadata) {
    return undefined;
  }
  return metadata as Record<string, unknown>;
}

export function mapApiAuditEventToView(dto: AuditEventDto): AuditEventView {
  const metadata = metadataRecord(dto.metadata);
  return {
    id: dto.id,
    app: dto.app,
    kind: dto.kind,
    action: dto.action,
    severity: dto.severity,
    actor: actorLabelFromDto(dto),
    actorType: dto.actorType,
    timeLabel: formatAuditRelativeTime(dto.createdAt),
    createdAt: dto.createdAt,
    traceId: dto.traceId,
    targetType: dto.targetType,
    targetId: dto.targetId,
    parameterId: typeof metadata?.parameterId === "string" ? metadata.parameterId : undefined,
    batchId: typeof metadata?.batchId === "string" ? metadata.batchId : dto.targetType === "parameter-import-batch" ? dto.targetId ?? undefined : undefined,
    userId: dto.targetType === "user" ? dto.targetId ?? undefined : undefined,
    metadata,
    viaAgent: dto.actorType === "agent"
  };
}

export function mapMockAuditEventToView(event: AuditEvent): AuditEventView {
  const metadata = metadataRecord(event.metadata);
  const createdAt = Number.isFinite(new Date(event.time).getTime()) ? new Date(event.time).toISOString() : undefined;

  return {
    id: event.id,
    app: event.app,
    kind: event.kind ?? "unknown",
    action: event.action,
    severity: event.severity,
    actor: event.actor,
    actorType: actorTypeFromMock(event),
    timeLabel: createdAt ? formatAuditRelativeTime(createdAt) : event.time,
    createdAt,
    parameterId: event.parameterId,
    batchId: event.batchId,
    userId: event.userId,
    metadata,
    viaAgent: event.viaAgent,
    traceId: event.traceId
  };
}

export function isParameterAdminAuditApp(app: string) {
  return app === "parameter-admin" || app === "parameter-management";
}
