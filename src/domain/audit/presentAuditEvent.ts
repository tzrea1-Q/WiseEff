import { getAuditAppLabel } from "./auditApps";
import { presentAuditAction, presentAuditKind } from "./auditSlugLabels";
import { formatAuditAbsoluteTime } from "./formatAuditTime";
import type { AuditEventView, AuditValueState } from "./types";
import type { RiskLevel } from "@/domain/prototype/types";

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
  previousValueState?: AuditValueState;
  newValueState?: AuditValueState;
  entries?: Array<{ name: string; previousValue: string; newValue: string; previousValueState?: AuditValueState; newValueState?: AuditValueState }>;
  reason?: string;
};

export type AuditPresentation = {
  headline: string;
  summary: string;
  kindLabel: string;
  appLabel: string;
  actionLabel: string;
  targetLabel: string;
  projectLabel: string;
  evidenceSource?: string;
  outcomes: Array<{ label: string; value: string }>;
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
  agent: "智能助手",
  system: "系统",
  integration: "集成凭据"
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

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function displayValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value || '""';
  if (value === null || typeof value === "boolean" || typeof value === "number") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return undefined;
  }
}

function labelParameterStatus(status: string) {
  return parameterStatusLabels[status] ?? status.replaceAll("_", " ");
}

function valueState(value: unknown): AuditValueState | undefined {
  return value === "present" || value === "deleted" ? value : undefined;
}

function namedValues(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const entries = new Map<string, { value: unknown; state?: AuditValueState }>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || typeof entry.target !== "string" || !Object.hasOwn(entry, "value") || entries.has(entry.target)) return undefined;
    entries.set(entry.target, { value: entry.value, state: valueState(entry.valueState) });
  }
  return entries;
}

function readNamedChanges(previous: unknown, next: unknown): AuditParameterChangeView["entries"] {
  const before = namedValues(previous === undefined ? [] : previous);
  const after = namedValues(next === undefined ? [] : next);
  if (!before || !after || before.size + after.size === 0) return undefined;
  return [...new Set([...before.keys(), ...after.keys()])].map((name) => ({
    name,
    previousValue: displayValue(before.get(name)?.value) ?? "未记录",
    newValue: displayValue(after.get(name)?.value) ?? "未记录",
    previousValueState: before.get(name)?.state,
    newValueState: after.get(name)?.state
  }));
}

function readParticipants(metadata: Record<string, unknown>, event: AuditEventView): AuditParticipantView[] {
  const raw = metadata.participants;
  if (Array.isArray(raw)) {
    const participants = raw.flatMap((entry): AuditParticipantView[] => {
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
    return participants.length === 1 && participants[0].name === event.actor ? [] : participants;
  }

  const submitter = asString(metadata.submitter);
  const participants: AuditParticipantView[] = [];
  if (submitter) {
    participants.push({ role: "提交人", name: submitter, action: "提交变更" });
  }
  return participants.filter((participant) => participant.name !== event.actor);
}

function readParameterChange(metadata: Record<string, unknown>, event: AuditEventView): AuditParameterChangeView | undefined {
  const name =
    asString(metadata.parameterName) ??
    asString(metadata.name) ??
    event.targetName ??
    extractParameterNameFromAction(event.action);

  const previous = event.evidence ? event.evidence.previousValue : Object.hasOwn(metadata, "previousValue") ? metadata.previousValue : metadata.currentValue;
  const next = event.evidence ? event.evidence.newValue : Object.hasOwn(metadata, "newValue") ? metadata.newValue : Object.hasOwn(metadata, "targetValue") ? metadata.targetValue : metadata.readbackValue;
  const previousValue = displayValue(previous);
  const newValue = displayValue(next);

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
    previousValue: previousValue ?? "未记录",
    newValue: newValue ?? "未记录",
    previousValueState: valueState(event.evidence?.previousValueState),
    newValueState: valueState(event.evidence?.newValueState),
    entries: event.evidence ? readNamedChanges(previous, next) : undefined,
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
  const technical: Array<{ label: string; value: string }> = [
    { label: "事件 ID", value: event.id },
    { label: "模块标识", value: event.app },
    { label: "事件类型", value: event.kind },
    { label: "操作标识", value: event.action },
    { label: "严重度标识", value: event.severity }
  ];
  if (event.projectId) technical.push({ label: "项目 ID", value: event.projectId });
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
  const allowedMetadata = {
    eventId: "来源事件 ID",
    bindingId: "绑定 ID",
    targetBindingId: "目标绑定 ID",
    valueId: "参数值 ID",
    requestId: "请求 ID",
    canonicalRevision: "规范版本",
    canonicalRevisionId: "规范版本 ID",
    sourceRevisionId: "源文件版本 ID",
    sourceRevision: "源文件版本",
    configurationRevision: "配置版本",
    configRevisionId: "配置版本 ID",
    expectedVersion: "期望版本",
    previousCanonicalRevision: "变更前规范版本",
    newCanonicalRevision: "变更后规范版本"
  };
  for (const [key, label] of Object.entries(allowedMetadata)) {
    const value = metadata[key];
    if (typeof value === "string" || typeof value === "number") {
      technical.push({ label, value: String(value) });
    }
  }
  return technical;
}

function buildSummary(event: AuditEventView, presentation: Pick<AuditPresentation, "parameterChange" | "statusChange" | "kindLabel">) {
  if (presentation.parameterChange) {
    const { name, module, previousValue, newValue, previousValueState, newValueState, entries } = presentation.parameterChange;
    const moduleText = module ? `（${module}）` : "";
    if (entries) return `${presentation.kindLabel}：已记录 ${entries.length} 项参数变更。`;
    if (newValueState === "deleted") return `${presentation.kindLabel}：${name}${moduleText} 已删除，保留历史内容用于核查。`;
    if (previousValueState === "deleted" && newValueState === "present") return `${presentation.kindLabel}：${name}${moduleText} 已恢复为有效值。`;
    return `${presentation.kindLabel}：${name}${moduleText} 从 ${previousValue} 调整为 ${newValue}。`;
  }
  if (presentation.statusChange) {
    return `${presentation.kindLabel}：流程从「${presentation.statusChange.from}」推进到「${presentation.statusChange.to}」。`;
  }
  const action = presentAuditAction(event.action);
  return action.isRaw ? "此事件的操作说明尚未分类，原始标识可在技术追踪信息中查看。" : action.label;
}

export function presentAuditEvent(event: AuditEventView): AuditPresentation {
  const metadata = event.metadata ?? {};
  const kind = presentAuditKind(event.kind);
  const kindLabel = kind.isRaw ? "未分类事件" : kind.label;
  const appLabel = getAuditAppLabel(event.app);
  const action = presentAuditAction(event.action);
  const actionLabel = action.isRaw ? "未分类操作" : action.label;
  const parameterChange = readParameterChange(metadata, event);
  const statusChange = readStatusChange(metadata);
  const headline = parameterChange ? `${actionLabel} · ${parameterChange.name}` : actionLabel;
  const targetLabels: Record<string, string> = {
    parameter: "参数", "parameter-binding": "参数绑定", "project-value": "项目参数值",
    "parameter-value": "参数值", "parameter-change-request": "参数变更申请",
    "project-parameter-value-change-request": "项目参数变更申请", "project-parameter-binding": "项目参数绑定",
    "parameter-import-batch": "参数导入批次", "project-parameter-file": "项目参数文件",
    "project-parameter-file-candidate": "参数候选文件", "parameter-definition": "参数定义",
    project: "项目", user: "用户", log: "日志", "device-bridge": "设备连接"
  };
  const targetLabel = asString(event.targetName) ?? asString(metadata.parameterName) ?? asString(metadata.fileName) ??
    asString(metadata.name) ?? (event.targetType && Object.hasOwn(targetLabels, event.targetType) ? targetLabels[event.targetType] : undefined) ?? "未记录对象名称";
  const outcomes: AuditPresentation["outcomes"] = [];
  if (typeof metadata.writeOutcome === "string") {
    const labels: Record<string, string> = { executed: "写入已执行", failed: "写入失败", unknown: "写入结果未知" };
    outcomes.push({ label: "写命令", value: Object.hasOwn(labels, metadata.writeOutcome) ? labels[metadata.writeOutcome] : "写入结果未知" });
  }
  if (typeof metadata.readbackOutcome === "string") {
    const labels: Record<string, string> = { observed: "已回读（仅观测）", failed: "回读失败", unsupported: "不支持回读", not_requested: "未请求回读", unknown: "回读结果未知" };
    outcomes.push({ label: "写后回读", value: Object.hasOwn(labels, metadata.readbackOutcome) ? labels[metadata.readbackOutcome] : "回读结果未知" });
  }

  return {
    headline,
    summary: buildSummary(event, { parameterChange, statusChange, kindLabel }),
    kindLabel,
    appLabel,
    actionLabel,
    targetLabel,
    projectLabel: event.projectName ? `${event.projectName}${event.projectCode ? ` · ${event.projectCode}` : ""}` : event.projectCode ?? (event.projectId ? "未记录项目名称" : "组织级操作"),
    evidenceSource: asString(event.evidence?.sourceLabel),
    outcomes,
    actor: {
      name: event.actorType === "system" ? "系统" : event.actor,
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
