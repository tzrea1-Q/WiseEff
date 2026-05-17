import type { AuditEvent } from "@/domain/audit/types";

export interface AuditSink {
  record(event: AuditEvent): Promise<void>;
  recordMany(events: AuditEvent[]): Promise<void>;
}
