import {
  catalogActionsForActor,
  isCatalogActionEnabled,
  type CatalogActorKind,
  type CatalogAuthorizedAction
} from "@/application/parameter-catalog/authority";
import type { CatalogDomainState, CatalogEmptyReason } from "@/application/parameter-catalog/states";
import {
  catalogActionDisabledCopy,
  catalogActionLabels,
  catalogEmptyMessages,
  catalogErrorCopy,
  catalogLifecycleLabels,
  catalogRegistrationLabels,
  catalogRetiredMessages,
  catalogSubjectTypeLabels,
  catalogTimelineChangeLabels,
  catalogTimelineKindLabels
} from "./copy";

export type CatalogActionAffordance = {
  action: CatalogAuthorizedAction;
  label: string;
  enabled: boolean;
  disabledReason: string | null;
};

export function catalogMutationActionsForActor(actor: CatalogActorKind): CatalogAuthorizedAction[] {
  return catalogActionsForActor(actor).filter((action) => action !== "read");
}

export function catalogActionAffordances(
  actor: CatalogActorKind,
  state: CatalogDomainState
): CatalogActionAffordance[] {
  return catalogMutationActionsForActor(actor).map((action) => {
    const enabled = isCatalogActionEnabled(actor, action, state);
    return {
      action,
      label: catalogActionLabels[action],
      enabled,
      disabledReason: enabled ? null : catalogActionDisabledCopy(state.kind)
    };
  });
}

export function catalogStateMessage(state: CatalogDomainState): string | null {
  switch (state.kind) {
    case "loading":
      return state.stale ? "正在刷新目录发布，写入已暂停" : "正在加载目录";
    case "error":
      return catalogErrorCopy(state.reason);
    case "empty":
      return catalogEmptyMessages[state.emptyReason];
    case "retired":
      return catalogRetiredMessages[state.target];
    case "unregistered":
      return "该主体尚未登记。可阅读目录内容，放置尚未建立。";
    case "conflict":
      return "目录发布或放置发生冲突，请刷新证据后重新确认。";
    case "ready":
      return null;
  }
}

export function catalogEmptyMessage(reason: CatalogEmptyReason): string {
  return catalogEmptyMessages[reason];
}

export function catalogSubjectTypeLabel(type: string): string {
  if (type === "driver" || type === "node-type") {
    return catalogSubjectTypeLabels[type];
  }
  return "主体";
}

export function catalogLifecycleLabel(lifecycle: string): string {
  if (lifecycle === "active" || lifecycle === "deprecated" || lifecycle === "retired") {
    return catalogLifecycleLabels[lifecycle];
  }
  return "未知状态";
}

export function catalogRegistrationLabel(status: string): string {
  if (status === "unregistered" || status === "active" || status === "retired") {
    return catalogRegistrationLabels[status];
  }
  return "未登记";
}

export function catalogTimelineKindLabel(kind: string): string {
  if (kind === "catalog-publication" || kind === "history" || kind === "audit") {
    return catalogTimelineKindLabels[kind];
  }
  return "目录事实";
}

export function catalogTimelineChangeLabel(change: string): string {
  if (change === "introduced" || change === "content" || change === "documentation" || change === "lifecycle") {
    return catalogTimelineChangeLabels[change];
  }
  return "变更";
}

export function catalogValueShapeLabel(schema: { type?: unknown } | undefined): string {
  const type = schema && typeof schema.type === "string" ? schema.type : "";
  switch (type) {
    case "integer":
      return "整数";
    case "number":
      return "数值";
    case "string":
      return "字符串";
    case "boolean":
      return "布尔";
    case "array":
      return "数组";
    case "object":
      return "对象";
    default:
      return "结构化取值";
  }
}
