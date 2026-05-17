import type { PageKey } from "@/appConfig";
import type { RiskLevel } from "../parameters/types";

export type AuditEventKind =
  | "parameter-add"
  | "parameter-update"
  | "parameter-delete"
  | "batch-import"
  | "bulk-risk-change"
  | "bulk-module-change"
  | "bulk-delete"
  | "user-add"
  | "user-role-change"
  | "user-toggle"
  | "export"
  | "rollback-undo"
  | "agent-action";

export type AuditEvent = {
  id: string;
  kind?: AuditEventKind;
  app: PageKey;
  actor: string;
  action: string;
  time: string;
  severity: RiskLevel;
  parameterId?: string;
  batchId?: string;
  userId?: string;
  metadata?: {
    previousValue?: string;
    newValue?: string;
    previousRole?: string;
    newRole?: string;
    affectedIds?: string[];
    diffSummary?: { added: number; updated: number; deleted: number };
    snapshotName?: string;
    aiActionId?: string;
    foundOrphans?: number;
  };
  viaAgent?: boolean;
};
