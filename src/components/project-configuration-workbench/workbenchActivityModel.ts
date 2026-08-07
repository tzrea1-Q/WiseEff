import type { AuditEventView } from "@/domain/audit/types";
import { presentAuditEvent } from "@/domain/audit/presentAuditEvent";

export type WorkbenchActivityOutcome =
  | "成功"
  | "失败"
  | "已阻断"
  | "已放弃"
  | "进行中"
  | "已记录";

export type WorkbenchActivityRow = {
  id: string;
  actor: string;
  action: string;
  targetLabel: string;
  outcome: WorkbenchActivityOutcome;
  timeLabel: string;
  absoluteTime: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  kind: string;
};

export type WorkbenchActivityTargetKind =
  | "config-set"
  | "file"
  | "candidate"
  | "baseline"
  | "node"
  | "property"
  | "conflict"
  | "unknown";

export type ResolvedWorkbenchActivityTarget = {
  kind: WorkbenchActivityTargetKind;
  configSetId?: string;
  fileId?: string;
  candidateId?: string;
  baselineId?: string;
  nodePath?: string;
  propertyName?: string;
  conflictId?: string;
  missing: boolean;
  missingReason?: string;
};

const TARGET_TYPE_LABELS: Record<string, string> = {
  "project-parameter-file": "参数文件",
  "project-parameter-file-candidate": "候选文件版本",
  "dts-config-set": "配置集",
  "dts-release-baseline": "发布基线",
  "parameter-file-conflict": "文件冲突",
  "dts-node": "DTS 节点",
  "dts-property": "DTS 属性"
};

const ACTION_PRODUCT_LABELS: Record<string, string> = {
  create: "创建",
  abandon: "放弃",
  recompute: "重算影响",
  upload: "上传",
  sync: "同步",
  release: "发布",
  restore: "恢复",
  resolve: "裁决"
};

const PARAMETER_ACTIVITY_APPS = ["parameter-management", "parameter-admin", "parameters"] as const;

export function workbenchActivityApps(): string[] {
  return [...PARAMETER_ACTIVITY_APPS];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function outcomeFromEvent(event: AuditEventView): WorkbenchActivityOutcome {
  const status = asString(event.metadata?.status)?.toLowerCase();
  if (status === "failed" || status === "fail") return "失败";
  if (status === "blocked") return "已阻断";
  if (status === "abandoned") return "已放弃";
  if (status === "uploading" || status === "parsing") return "进行中";
  if (status === "ready" || status === "released" || status === "ok" || status === "success") return "成功";
  if (event.action === "abandon") return "已放弃";
  if (event.severity === "High" && event.kind.includes("fail")) return "失败";
  return "已记录";
}

function targetLabelFromEvent(event: AuditEventView, presentationAction: string): string {
  const metadata = event.metadata ?? {};
  const fileName = asString(metadata.fileName);
  const nodePath = asString(metadata.nodePath);
  const propertyName = asString(metadata.propertyName);
  const configSetName = asString(metadata.configSetName) ?? asString(metadata.name);
  const typeLabel = event.targetType ? TARGET_TYPE_LABELS[event.targetType] ?? event.targetType : "目标";

  if (propertyName && nodePath) {
    return `${typeLabel} · ${nodePath}.${propertyName}`;
  }
  if (nodePath) {
    return `${typeLabel} · ${nodePath}`;
  }
  if (fileName) {
    return `${typeLabel} · ${fileName}`;
  }
  if (configSetName) {
    return `${typeLabel} · ${configSetName}`;
  }
  if (event.targetId) {
    return `${typeLabel} · ${event.targetId}`;
  }
  return `${typeLabel} · ${presentationAction}`;
}

export function presentWorkbenchActivity(event: AuditEventView): WorkbenchActivityRow {
  const presentation = presentAuditEvent(event);
  const action =
    ACTION_PRODUCT_LABELS[event.action] ??
    presentation.kindLabel ??
    event.action;

  return {
    id: event.id,
    actor: presentation.actor.name,
    action,
    targetLabel: targetLabelFromEvent(event, action),
    outcome: outcomeFromEvent(event),
    timeLabel: presentation.timestamp.relative,
    absoluteTime: presentation.timestamp.absolute,
    targetType: event.targetType ?? null,
    targetId: event.targetId ?? null,
    metadata: event.metadata ?? {},
    kind: event.kind
  };
}

export type WorkbenchActivityCatalog = {
  configSetIds: ReadonlySet<string>;
  fileIds: ReadonlySet<string>;
  candidateIds: ReadonlySet<string>;
  baselineIds: ReadonlySet<string>;
  knownNodePathsByFileId?: ReadonlyMap<string, ReadonlySet<string>>;
};

export function resolveWorkbenchActivityTarget(
  event: AuditEventView,
  catalog: WorkbenchActivityCatalog
): ResolvedWorkbenchActivityTarget {
  const metadata = event.metadata ?? {};
  const nodePath = asString(metadata.nodePath);
  const propertyName = asString(metadata.propertyName);
  const fileIdFromMeta = asString(metadata.fileId);
  const configSetIdFromMeta = asString(metadata.configSetId);

  if (event.targetType === "dts-config-set" && event.targetId) {
    const missing = !catalog.configSetIds.has(event.targetId);
    return {
      kind: "config-set",
      configSetId: event.targetId,
      missing,
      ...(missing ? { missingReason: "配置集已不存在或当前项目不可见。" } : {})
    };
  }

  if (event.targetType === "dts-release-baseline" && event.targetId) {
    const missing = catalog.baselineIds.size > 0 && !catalog.baselineIds.has(event.targetId);
    return {
      kind: "baseline",
      baselineId: event.targetId,
      ...(configSetIdFromMeta ? { configSetId: configSetIdFromMeta } : {}),
      missing,
      ...(missing ? { missingReason: "发布基线已不存在；事件仍可作为只读证据。" } : {})
    };
  }

  if (event.targetType === "project-parameter-file-candidate" && event.targetId) {
    const fileId = fileIdFromMeta;
    const missing = !catalog.candidateIds.has(event.targetId);
    return {
      kind: "candidate",
      candidateId: event.targetId,
      ...(fileId ? { fileId } : {}),
      missing,
      ...(missing ? { missingReason: "候选已不存在或已离开当前项目视图。" } : {})
    };
  }

  if (event.targetType === "parameter-file-conflict" && event.targetId) {
    return {
      kind: "conflict",
      conflictId: event.targetId,
      ...(fileIdFromMeta ? { fileId: fileIdFromMeta } : {}),
      missing: false
    };
  }

  if (event.targetType === "project-parameter-file" && event.targetId) {
    const fileId = event.targetId;
    const missing = !catalog.fileIds.has(fileId);
    if (propertyName && nodePath) {
      const known = catalog.knownNodePathsByFileId?.get(fileId);
      const nodeMissing = Boolean(known && !known.has(nodePath));
      return {
        kind: "property",
        fileId,
        nodePath,
        propertyName,
        missing: missing || nodeMissing,
        ...(missing || nodeMissing
          ? { missingReason: "属性或所属文件已不在当前工作配置中。" }
          : {})
      };
    }
    if (nodePath) {
      const known = catalog.knownNodePathsByFileId?.get(fileId);
      const nodeMissing = Boolean(known && !known.has(nodePath));
      return {
        kind: "node",
        fileId,
        nodePath,
        missing: missing || nodeMissing,
        ...(missing || nodeMissing
          ? { missingReason: "节点或所属文件已不在当前工作配置中。" }
          : {})
      };
    }
    return {
      kind: "file",
      fileId,
      missing,
      ...(missing ? { missingReason: "文件已不在当前项目或配置集成员中。" } : {})
    };
  }

  if (fileIdFromMeta && catalog.fileIds.has(fileIdFromMeta)) {
    if (propertyName && nodePath) {
      return { kind: "property", fileId: fileIdFromMeta, nodePath, propertyName, missing: false };
    }
    if (nodePath) {
      return { kind: "node", fileId: fileIdFromMeta, nodePath, missing: false };
    }
    return { kind: "file", fileId: fileIdFromMeta, missing: false };
  }

  return {
    kind: "unknown",
    missing: true,
    missingReason: "该事件没有可恢复的工作台目标。"
  };
}
