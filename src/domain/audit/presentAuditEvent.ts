import { getAuditAppLabel } from "./auditApps";
import { formatAuditAbsoluteTime } from "./formatAuditTime";
import type { AuditEventView } from "./types";
import type { RiskLevel } from "@/mockData";

export type AuditParticipantView = {
  role: string;
  name: string;
  action?: string;
  note?: string;
  time?: string;
};

export type AuditParameterChangeView = {
  name: string;
  module?: string;
  unit?: string;
  risk?: RiskLevel | string;
  previousValue: string;
  newValue: string;
  reason?: string;
};

export type AuditPresentation = {
  headline: string;
  summary: string;
  kindLabel: string;
  appLabel: string;
  actor: { name: string; typeLabel: string };
  timestamp: { absolute: string; relative: string };
  parameterChange?: AuditParameterChangeView;
  statusChange?: { from: string; to: string };
  participants: AuditParticipantView[];
  notes: string[];
  technical: Array<{ label: string; value: string }>;
};

const actorTypeLabel = {
  user: "用户",
  agent: "Agent",
  system: "系统"
} as const;

const parameterStatusLabels: Record<string, string> = {
  submitted: "待审阅",
  hardware_review: "硬件 Committer 检视",
  software_review: "软件 Committer 检视",
  software_merge: "软件开发人员合入",
  merged: "已合入",
  rejected: "已打回",
  withdrawn: "已撤回",
  stashed: "已暂存"
};

const kindLabels: Record<string, string> = {
  "parameter-merge": "参数合入",
  "parameter-review-advance": "审阅推进",
  "parameter-review-reject": "审阅打回",
  "parameter-submit": "参数提交",
  "parameter-update": "参数更新",
  "parameter-add": "新增参数",
  "parameter-delete": "删除参数",
  "batch-import": "批量导入",
  "bulk-risk-change": "批量风险调整",
  "bulk-module-change": "批量模块调整",
  "bulk-delete": "批量删除",
  "user-role-change": "角色变更",
  "user-add": "新增用户",
  "user-toggle": "用户状态",
  "debug-node-write": "节点写入",
  "debug-snapshot-rollback": "快照回滚",
  "agent-action": "Agent 操作",
  export: "导出",
  "rollback-undo": "撤销操作"
};

const actionLabels: Record<string, string> = {
  merge: "合入参数",
  advance: "推进审阅",
  reject: "打回变更",
  submit: "提交变更",
  apply: "应用导入"
};

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function labelParameterStatus(status: string) {
  return parameterStatusLabels[status] ?? status.replaceAll("_", " ");
}

function readParticipants(metadata: Record<string, unknown>, event: AuditEventView): AuditParticipantView[] {
  const raw = metadata.participants;
  if (Array.isArray(raw)) {
    return raw.flatMap((entry): AuditParticipantView[] => {
      if (!entry || typeof entry !== "object") {
        return [];
      }
      const record = entry as Record<string, unknown>;
      const name = asString(record.name);
      const role = asString(record.role);
      if (!name || !role) {
        return [];
      }
      return [
        {
          role,
          name,
          action: asString(record.action),
          note: asString(record.note),
          time: asString(record.time) ?? asString(record.at)
        }
      ];
    });
  }

  const submitter = asString(metadata.submitter);
  const participants: AuditParticipantView[] = [];
  if (submitter) {
    participants.push({ role: "提交人", name: submitter, action: "提交变更" });
  }
  participants.push({
    role: "操作人",
    name: event.actor,
    action: actionLabels[event.action] ?? event.action
  });
  return participants;
}

function readParameterChange(metadata: Record<string, unknown>, event: AuditEventView): AuditParameterChangeView | undefined {
  const name =
    asString(metadata.parameterName) ??
    asString(metadata.name) ??
    (event.parameterId ? event.parameterId : undefined) ??
    extractParameterNameFromAction(event.action);

  const previousValue = asString(metadata.currentValue) ?? asString(metadata.previousValue);
  const newValue = asString(metadata.targetValue) ?? asString(metadata.newValue) ?? asString(metadata.readbackValue);

  if (!name && !previousValue && !newValue) {
    return undefined;
  }

  if (!previousValue && !newValue) {
    return undefined;
  }

  return {
    name: name ?? "未命名参数",
    module: asString(metadata.module),
    unit: asString(metadata.unit),
    risk: (asString(metadata.risk) as RiskLevel | string | undefined) ?? undefined,
    previousValue: previousValue ?? "—",
    newValue: newValue ?? "—",
    reason: asString(metadata.reason)
  };
}

function extractParameterNameFromAction(action: string) {
  const match = action.match(/(?:更新|调整|删除|新增|撤销删除)\s+([^\s]+)/);
  return match?.[1];
}

function readStatusChange(metadata: Record<string, unknown>) {
  const fromStatus = asString(metadata.fromStatus);
  const toStatus = asString(metadata.toStatus);
  if (!fromStatus || !toStatus) {
    return undefined;
  }
  return {
    from: labelParameterStatus(fromStatus),
    to: labelParameterStatus(toStatus)
  };
}

function readNotes(metadata: Record<string, unknown>) {
  const notes: string[] = [];
  const note = asString(metadata.note);
  if (note) {
    notes.push(note);
  }
  const rejectReason = asString(metadata.rejectReason);
  if (rejectReason) {
    notes.push(rejectReason);
  }
  return notes;
}

function readTechnical(event: AuditEventView, metadata: Record<string, unknown>) {
  const technical: Array<{ label: string; value: string }> = [];
  if (event.traceId) {
    technical.push({ label: "Trace ID", value: event.traceId });
  }
  if (event.targetType) {
    technical.push({ label: "目标类型", value: event.targetType });
  }
  if (event.targetId) {
    technical.push({ label: "目标 ID", value: event.targetId });
  }
  if (event.parameterId) {
    technical.push({ label: "参数 ID", value: event.parameterId });
  }
  if (event.batchId) {
    technical.push({ label: "批次 ID", value: event.batchId });
  }
  if (event.userId) {
    technical.push({ label: "用户 ID", value: event.userId });
  }
  const expectedVersion = metadata.expectedVersion;
  if (typeof expectedVersion === "number") {
    technical.push({ label: "期望版本", value: String(expectedVersion) });
  }
  return technical;
}

function buildSummary(event: AuditEventView, presentation: Pick<AuditPresentation, "parameterChange" | "statusChange" | "kindLabel">) {
  if (presentation.parameterChange) {
    const { name, module, previousValue, newValue } = presentation.parameterChange;
    const moduleText = module ? `（${module}）` : "";
    return `${presentation.kindLabel}：${name}${moduleText} 从 ${previousValue} 调整为 ${newValue}。`;
  }
  if (presentation.statusChange) {
    return `${presentation.kindLabel}：流程从「${presentation.statusChange.from}」推进到「${presentation.statusChange.to}」。`;
  }
  return event.action;
}

export function presentAuditEvent(event: AuditEventView): AuditPresentation {
  const metadata = event.metadata ?? {};
  const kindLabel = kindLabels[event.kind] ?? event.kind;
  const appLabel = getAuditAppLabel(event.app);
  const parameterChange = readParameterChange(metadata, event);
  const statusChange = readStatusChange(metadata);
  const headline = parameterChange
    ? `${kindLabel} · ${parameterChange.name}`
    : `${kindLabel} · ${actionLabels[event.action] ?? event.action}`;

  return {
    headline,
    summary: buildSummary(event, { parameterChange, statusChange, kindLabel }),
    kindLabel,
    appLabel,
    actor: {
      name: event.actor,
      typeLabel: actorTypeLabel[event.actorType]
    },
    timestamp: {
      absolute: formatAuditAbsoluteTime(event.createdAt),
      relative: event.timeLabel
    },
    parameterChange,
    statusChange,
    participants: readParticipants(metadata, event),
    notes: readNotes(metadata),
    technical: readTechnical(event, metadata)
  };
}
